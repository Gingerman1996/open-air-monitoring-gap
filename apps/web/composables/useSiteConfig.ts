/** Shared runtime feature flags (seeded by plugins/site-config.ts). */
export function useSiteConfig() {
  const donationsEnabled = useState<boolean>('donationsEnabled', () => true);

  /** Re-read the flags from the API (used by the admin page after a toggle). */
  async function refresh(): Promise<void> {
    const base = useRuntimeConfig().public.apiBase;
    try {
      const cfg = await $fetch<{ donationsEnabled: boolean }>(`${base}/config`, { timeout: 2500 });
      donationsEnabled.value = cfg.donationsEnabled;
    } catch {
      /* keep current value */
    }
  }

  return { donationsEnabled, refresh };
}
