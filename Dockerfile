# NestWorth: a small, non-root image. The app has no runtime dependencies.
FROM node:26-alpine

LABEL org.opencontainers.image.title="NestWorth" \
      org.opencontainers.image.description="AI home-search assistant for UK buyers: your numbers, your rules, a detailed picture of every home." \
      org.opencontainers.image.source="https://github.com/vinovee/NestWorth" \
      org.opencontainers.image.authors="Vino Veeraiyan" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY prompts ./prompts
COPY LICENSE README.md ./

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

CMD ["node", "src/server/index.js"]
