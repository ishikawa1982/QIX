# Multi-stage build: compile the client + server, then run a slim runtime image.
FROM node:22-slim AS build
WORKDIR /app

# Install all workspace dependencies (dev deps needed for the build).
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci

# Build client (vite) and server (esbuild bundle).
COPY . .
RUN npm run build

# ---- Runtime image ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only the server needs runtime deps (ws). Install them standalone.
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Bundled server + built client static assets.
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
