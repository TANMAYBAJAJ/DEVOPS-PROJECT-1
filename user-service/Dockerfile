# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-alpine3.21 AS deps

WORKDIR /app

# Copy only package files first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine3.21 AS runtime

WORKDIR /app

# Copy installed modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

EXPOSE 3001

CMD ["node", "index.js"]