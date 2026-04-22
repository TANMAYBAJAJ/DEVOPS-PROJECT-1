# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-alpine3.21 AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine3.21 AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3002

CMD ["node", "index.js"]