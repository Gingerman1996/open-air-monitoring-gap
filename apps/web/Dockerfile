FROM node:22-slim AS build
WORKDIR /app/apps/web
# baked into the Nitro route-rule proxies so the browser stays same-origin
ENV API_PROXY_TARGET=http://api:3001
ENV TILE_PROXY_TARGET=http://martin:3000
COPY apps/web/ ./
RUN npm install
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV PORT=3000
ENV NITRO_HOST=0.0.0.0
COPY --from=build /app/apps/web/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
