# Warden in a container: for running 24/7 on a server or NAS. The normal way is `node bin/warden.js --setup`; use this if you prefer Docker.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data GUI_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY bin ./bin
COPY lists ./lists
COPY gui ./gui
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 48731
CMD ["node", "dist/index.js"]
