import { BookMeta, handleBookPage, headTags } from '../_lib/book-meta';

interface Env {
  /** The same variable the Angular build reads (…/api/v1). Pages exposes
   *  project environment variables to Functions at runtime; without it this
   *  Function serves the page untouched. */
  NG_APP_BACKEND_URL?: string;
}

/**
 * /<region>/book?isbn=… (or ?id=…) with og:, twitter: and canonical tags a
 * link preview can read. See functions/_lib/book-meta.ts for what is written
 * and when the API is consulted.
 *
 * Only this path runs a Function: the _routes.json Pages generates from this
 * directory includes /api/cover and /:region/book, so every other page and
 * every asset is still served statically, uninvoiced.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    return await handleBookPage(
      {
        request: context.request,
        backendUrl: context.env.NG_APP_BACKEND_URL,
        region: context.params.region,
        next: (path) => (path ? context.next(new URL(path, context.request.url).toString()) : context.next()),
        waitUntil: (promise) => context.waitUntil(promise),
      },
      { cache: caches.default, fetch: (url, init) => fetch(url, init), inject },
    );
  } catch {
    return context.next();
  }
};

/** The page's own copies, removed before the book's are appended: with two
 *  canonicals a search engine may ignore both, and preview fetchers differ
 *  on which of two og:title tags they read. The site's og:image stays when
 *  the book has no cover, with its size and alt, so its preview still has
 *  the site's card. */
const REPLACED_HEAD_TAGS = [
  'link[rel="canonical"]',
  'link[rel="alternate"][hreflang]',
  'meta[property^="og:"]',
  'meta[name^="twitter:"]',
];

function inject(page: Response, meta: BookMeta, status: number): Response {
  let rewriter = new HTMLRewriter();
  for (const selector of REPLACED_HEAD_TAGS) {
    rewriter = rewriter.on(selector, {
      element(el) {
        if (!meta.image && el.getAttribute('property')?.startsWith('og:image')) return;
        el.remove();
      },
    });
  }
  const rewritten = rewriter
    .on('title', {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute('content', meta.description);
      },
    })
    .on('head', {
      element(el) {
        el.append(headTags(meta), { html: true });
      },
    })
    .transform(page);
  return new Response(rewritten.body, { status, headers: rewritten.headers });
}
