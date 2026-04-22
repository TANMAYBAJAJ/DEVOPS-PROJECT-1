# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-alpine3.21 AS deps

WORKDIR /app
RUN apk update && apk upgrade --no-cache
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine3.21 AS runtime

WORKDIR /app
RUN apk update && apk upgrade --no-cache
COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
