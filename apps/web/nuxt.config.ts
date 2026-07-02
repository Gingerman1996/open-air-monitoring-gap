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
    // sub-path the app is served under (e.g. /openair/ on tools.airgradient.net); '/' locally.
    // baked from the APP_BASE_URL build arg — prefixes the router, assets and the /api proxy route.
    baseURL: process.env.APP_BASE_URL || '/',
    head: {
      title: 'Open Air Monitoring Gap',
      // head links are not baseURL-prefixed automatically, so build the href from the same env
      link: [
        {
          rel: 'icon',
          type: 'image/png',
          href: `${(process.env.APP_BASE_URL || '/').replace(/\/+$/, '')}/logo-colored.png`,
        },
      ],
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
      // defaults to <baseURL>/api/v1 so a sub-path deploy just works; override with NUXT_PUBLIC_API_BASE.
      apiBase:
        process.env.NUXT_PUBLIC_API_BASE ??
        `${(process.env.APP_BASE_URL || '/').replace(/\/+$/, '')}/api/v1`,
    },
  },
});
