// API base the browser uses (relative → same-origin, no CORS); proxied to the API by Nitro.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
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
  // browser calls same-origin /api/v1; the Nitro server proxies it to the API container
  routeRules: {
    '/api/**': { proxy: `${apiProxyTarget}/api/**` },
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? '/api/v1',
    },
  },
});
