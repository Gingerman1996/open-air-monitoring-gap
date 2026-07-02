/** Prefix a public/ asset with the app baseURL so it resolves under a sub-path deploy (/openair/…). */
export function useAssetUrl(path: string): string {
  const base = useRuntimeConfig().app.baseURL || '/';
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
}
