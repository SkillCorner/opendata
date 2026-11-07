# Build context = this folder (set the Railway service's root directory to /model_viewer)
FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
COPY data ./data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.mjs"]
