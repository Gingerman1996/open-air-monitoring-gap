// API base the browser uses (relative → same-origin, no CORS); proxied to the API by Nitro.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';
// Martin vector-tile server (PostGIS → MVT), also proxied same-origin under /tiles
const tileProxyTarget = process.env.TILE_PROXY_TARGET ?? 'http://localhost:3002';

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  // keep test files out of the Nuxt build + utils/ auto-import scan (Vitest finds them itself)
  ignore: ['**/*.spec.*', '**/*.test.*'],
  css: [
    'leaflet/dist/leaflet.css',
    'leaflet.markercluster/dist/MarkerCluster.css',
    '~/assets/css/demo.css',
  ],
  app: {
    head: {
      title: 'Open Air Monitoring Gap',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
        {
          name: 'description',
          content: 'Where air-quality monitors exist vs where air pollution kills the most.',
        },
      ],
    },
  },
  // browser calls same-origin; the Nitro server proxies /api → API, /tiles → Martin
  routeRules: {
    '/api/**': { proxy: `${apiProxyTarget}/api/**` },
    '/tiles/**': { proxy: `${tileProxyTarget}/**` },
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? '/api/v1',
      tileBase: process.env.NUXT_PUBLIC_TILE_BASE ?? '/tiles',
    },
  },
});
