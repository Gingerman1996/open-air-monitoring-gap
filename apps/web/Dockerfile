FROM node:22-slim AS build
WORKDIR /app/apps/web
COPY apps/web/ ./
RUN npm install
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV PORT=3000
ENV NITRO_HOST=0.0.0.0
# read at runtime by server/routes/api/[...].ts; compose overrides for the container network
ENV API_PROXY_TARGET=http://api:3001
COPY --from=build /app/apps/web/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
