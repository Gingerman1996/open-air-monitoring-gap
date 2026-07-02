import { gzipSync } from 'node:zlib';

/**
 * Same-origin proxy for /api/** → the NestJS API, with gzip on the way out.
 *
 * Replaces the old `routeRules` proxy: that path ran through undici, which
 * auto-decompresses the upstream gzip and drops Content-Encoding, so the browser
 * received the full ~4 MB /monitors payload uncompressed. Here we buffer the
 * upstream response and gzip it ourselves when the client accepts it.
 */
const TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';
// strip the sub-path prefix (e.g. /openair) before proxying, so the upstream always sees /api/v1
const BASE = (process.env.APP_BASE_URL ?? '/').replace(/\/+$/, '');
const GZIP_MIN_BYTES = 1024;

export default defineEventHandler(async (event) => {
  const method = event.method;
  const headers: Record<string, string> = {};
  const contentType = getRequestHeader(event, 'content-type');
  if (contentType) headers['content-type'] = contentType;

  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(event, false);

  const path =
    BASE && event.path.startsWith(BASE) ? event.path.slice(BASE.length) || '/' : event.path;
  const upstream = await fetch(TARGET + path, { method, headers, body });
  const buf = Buffer.from(await upstream.arrayBuffer());

  setResponseStatus(event, upstream.status);
  const type = upstream.headers.get('content-type');
  if (type) setResponseHeader(event, 'content-type', type);

  const acceptsGzip = (getRequestHeader(event, 'accept-encoding') ?? '').includes('gzip');
  if (acceptsGzip && buf.length >= GZIP_MIN_BYTES) {
    setResponseHeader(event, 'content-encoding', 'gzip');
    setResponseHeader(event, 'vary', 'accept-encoding');
    return gzipSync(buf);
  }
  return buf;
});
