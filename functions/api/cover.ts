import { handleCover } from '../_lib/cover';

/**
 * /api/cover?src=<cover URL>: fetches a book cover from an allowed catalogue
 * host, checks it is a real jacket, and caches the answer at the edge. The
 * logic lives in functions/_lib/cover.ts.
 */
export const onRequestGet: PagesFunction = (context) =>
  handleCover(context.request, {
    cache: caches.default,
    fetch: (url) => fetch(url),
    waitUntil: (promise) => context.waitUntil(promise),
  });
