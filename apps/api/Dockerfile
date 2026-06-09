FROM node:22-slim AS build
WORKDIR /app/apps/api
COPY apps/api/package.json ./
RUN npm install
COPY apps/api/ ./
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app/apps/api
ENV NODE_ENV=production
COPY apps/api/package.json ./
RUN npm install --omit=dev
COPY --from=build /app/apps/api/dist ./dist
# world-atlas + schema are read by the seed at startup
COPY db /app/db
ENV WORLD_ATLAS_PATH=/app/db/data/countries-110m.json
ENV INIT_SQL_PATH=/app/db/init.sql
EXPOSE 3001
CMD ["node", "dist/main.js"]
