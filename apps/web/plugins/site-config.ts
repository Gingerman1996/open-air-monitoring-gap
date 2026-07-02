/**
 * Fetch runtime feature flags once at app start so pages/components (and the
 * donate route guard) can read them from shared state without a flash.
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
