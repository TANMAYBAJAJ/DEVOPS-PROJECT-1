# ─── Stage 1: Build ───────────────────────────────────────────────────────────
# Use Node 18 Alpine to install deps and build the React/Vite app.
# The output lands in /app/dist and is passed to the next stage.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine3.21 AS builder

WORKDIR /app
RUN apk update && apk upgrade --no-cache
# Install dependencies first (layer-cache friendly)
COPY package.json package-lock.json* ./
RUN npm install --silent

# Copy source and build
COPY . .
RUN npm run build


# ─── Stage 2: Serve ───────────────────────────────────────────────────────────
# Lightweight Nginx image to serve the static dist and proxy /api → api-gateway.
# Only the compiled assets are copied — no Node, no source code in the final image.
# ──────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine3.21 AS runtime
RUN apk update && apk upgrade --no-cache
# Remove the default Nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy compiled React app from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy our custom Nginx config (proxies /api → api-gateway container)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Nginx runs in foreground so Docker can manage the process
CMD ["nginx", "-g", "daemon off;"]
