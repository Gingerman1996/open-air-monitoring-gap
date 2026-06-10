/** Base URL of the NestJS API and a small typed fetch helper. */
export function useApi() {
  const cfg = useRuntimeConfig().public;
  const base = cfg.apiBase;

  const get = <T>(path: string): Promise<T> => $fetch<T>(`${base}${path}`);

  const post = <T>(path: string, body: unknown): Promise<T> =>
    $fetch<T>(`${base}${path}`, { method: 'POST', body });

  const exportUrl = (dataset: string, query: Record<string, string> = {}): string => {
    const qs = new URLSearchParams({ dataset, ...query }).toString();
    return `${base}/export?${qs}`;
  };

  return { base, get, post, exportUrl };
}
