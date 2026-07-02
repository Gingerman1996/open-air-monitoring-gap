/**
 * Fetch runtime feature flags once during SSR so pages/components (and the
 * donate route guard) can read them from shared state without a flash.
 * Server-only: the useState value rides the hydration payload to the client,
 * so the browser never re-pays this fetch on load (admin.vue refresh()es on demand).
 * Non-critical: if /config is unreachable we keep the default (donations shown).
 */
export default defineNuxtPlugin(async () => {
  const donationsEnabled = useState<boolean>('donationsEnabled', () => true);
  const base = useRuntimeConfig().public.apiBase;
  try {
    const cfg = await $fetch<{ donationsEnabled: boolean }>(`${base}/config`, { timeout: 2500 });
    donationsEnabled.value = cfg.donationsEnabled;
  } catch {
    /* leave the default */
  }
});
