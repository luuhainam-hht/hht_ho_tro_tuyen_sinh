# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
# tini: PID 1 chuyển SIGTERM cho node -> tắt máy an toàn. tzdata: log hiển thị giờ VN
# (nghiệp vụ KHÔNG phụ thuộc TZ – đã tính bằng Intl Asia/Ho_Chi_Minh).
RUN apk add --no-cache tini tzdata wget
ENV NODE_ENV=production TZ=Asia/Ho_Chi_Minh PORT=3000 UPLOAD_DIR=/app/data/uploads
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY db ./db
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT}/api/health/deep || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
