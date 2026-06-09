/** Base URL of the NestJS API and a small typed fetch helper. */
export function useApi() {
  const base = useRuntimeConfig().public.apiBase;

  const get = <T>(path: string): Promise<T> => $fetch<T>(`${base}${path}`);

  const exportUrl = (dataset: string, query: Record<string, string> = {}): string => {
    const qs = new URLSearchParams({ dataset, ...query }).toString();
    return `${base}/export?${qs}`;
  };

  return { base, get, exportUrl };
}
