export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  // keep test files out of the Nuxt build + utils/ auto-import scan (Vitest finds them itself)
  ignore: ['**/*.spec.*', '**/*.test.*'],
  // serve the JS/CSS bundle pre-gzipped/brotli'd (the node server picks the .gz/.br by Accept-Encoding)
  nitro: { compressPublicAssets: { gzip: true, brotli: true } },
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
  // /api is proxied to the API by server/routes/api/[...].ts (which also gzips the
  // big JSON — the routeRules proxy couldn't, undici decompressed it on the way through).
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? '/api/v1',
    },
  },
});
