# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
EXPOSE 8080
USER node
CMD ["node", "server.js"]
