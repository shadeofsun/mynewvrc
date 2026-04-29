# syntax=docker/dockerfile:1.6
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
COPY package.json server.js ./
EXPOSE 8080
USER node
CMD ["node", "server.js"]
