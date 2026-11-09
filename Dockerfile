FROM node:22-alpine
ENV NODE_ENV=production TZ=Europe/Berlin DATA_DIR=/data
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/gesund || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "src/server.js"]
