FROM node:22-slim AS build
WORKDIR /app/apps/web
COPY apps/web/ ./
RUN npm install
# sub-path the app is served under (default root); prefixes asset/router/API URLs baked into the bundle
ARG APP_BASE_URL=/
ENV APP_BASE_URL=${APP_BASE_URL}
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV PORT=3000
ENV NITRO_HOST=0.0.0.0
# read at runtime by server/routes/api/[...].ts; compose overrides for the container network
ENV API_PROXY_TARGET=http://api:3001
# read at runtime by server/routes/api/[...].ts to strip the sub-path before proxying upstream
ENV APP_BASE_URL=/
COPY --from=build /app/apps/web/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
