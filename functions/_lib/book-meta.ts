/**
 * Link-preview tags for /<region>/book, filled in at the edge.
 *
 * LINE, Facebook, Slack and friends read a shared link's <head> without
 * running JavaScript, so the tags SeoService writes in the browser never
 * reach them and every book shared from the site previewed as the bare site
 * name with no cover. functions/[region]/book.ts puts the same facts into
 * the served index.html; everything that decides *what* to write lives here,
 * free of Workers-only globals, so the Angular test run can exercise it
 * (src/app/core/book-meta-function.spec.ts).
 *
 * Deliberately not a route: Pages only mounts files that export onRequest*.
 */

export const SITE_NAME = 'UniBooks';

/** Past this, a crawler gets the untouched page rather than waiting longer.
 *  The API runs in iad1; from an Asian edge a cold book lookup measured
 *  ~1s, and link-preview fetchers give up after a few seconds. */
export const API_TIMEOUT_MS = 2500;

/** Book facts are stable; an hour keeps a popular book to ~24 API calls a day
 *  per Cloudflare location. A miss (API 404) is kept briefly, because the
 *  API also answers 404 when an external catalogue lookup failed. */
export const FOUND_TTL_SECONDS = 3600;
export const MISSING_TTL_SECONDS = 300;
export const ERROR_TTL_SECONDS = 10;

export type BookIdentity = { kind: 'isbn' | 'id'; value: string };

/** The fields of the book API response this needs, and nothing else — the
 *  response also carries listings with seller names, which are not cached. */
export interface BookFacts {
  id: string;
  isbn13: string;
  title: string;
  authors: string;
  cover_url: string;
}

export type LookupResult = { status: 'found'; book: BookFacts } | { status: 'missing' } | { status: 'error' };

export interface BookMeta {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
}

/** Same wording as the app's seo.bookDescription keys; the spec holds them equal. */
export const DESCRIPTIONS: Record<'en' | 'zh-TW' | 'zh-HK', { withAuthor: string; noAuthor: string }> = {
  en: {
    withAuthor: '{title} by {authors}. Buy it second-hand from students on UniBooks.',
    noAuthor: '{title}. Buy it second-hand from students on UniBooks.',
  },
  'zh-TW': {
    withAuthor: '《{title}》，{authors} 著。在 UniBooks 向同學購買二手書。',
    noAuthor: '《{title}》。在 UniBooks 向同學購買二手書。',
  },
  'zh-HK': {
    withAuthor: '《{title}》，{authors} 著。在 UniBooks 向同學購買二手書。',
    noAuthor: '《{title}》。在 UniBooks 向同學購買二手書。',
  },
};

/** Region codes are ISO 3166-1 alpha-2, as stripRegionPrefix assumes. */
export function regionFrom(param: unknown): string | null {
  return typeof param === 'string' && /^[a-z]{2}$/i.test(param) ? param.toLowerCase() : null;
}

/** isbn wins over id, matching the book page itself. Anything malformed is
 *  left to the SPA rather than forwarded to the API. */
export function bookIdentity(url: URL): BookIdentity | null {
  const isbn = url.searchParams.get('isbn');
  if (isbn) return /^\d{10}(\d{3})?$|^\d{9}[\dX]$/i.test(isbn) ? { kind: 'isbn', value: isbn.toUpperCase() } : null;
  const id = url.searchParams.get('id');
  if (id) return /^\d{1,12}$/.test(id) ? { kind: 'id', value: id } : null;
  return null;
}

/**
 * Cache API key. Built from the parsed identity rather than the request URL,
 * so `?utm_source=`, `&engine=` and parameter order do not split one book
 * into many entries. Never fetched; it only has to be a URL.
 */
export function cacheKey(origin: string, region: string, identity: BookIdentity): string {
  return `${origin}/__book-meta/v1/${region}/${identity.kind}/${encodeURIComponent(identity.value)}`;
}

export function bookApiUrl(backendUrl: string, region: string, identity: BookIdentity): string {
  const base = backendUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ [identity.kind]: identity.value, region });
  return `${base}/books/?${params.toString()}`;
}

/**
 * Link-preview fetchers and search crawlers: the clients that cannot run the
 * app. Only these wait for the API on a cache miss. A false negative costs a
 * preview without a cover; a false positive costs one visitor up to
 * API_TIMEOUT_MS. So app names that also appear in in-app browser UAs
 * ("Line/13.x", "Slack/4.x") are not matched on their own: LINE's fetcher
 * identifies as facebookexternalhit plus line-poker, Slack's as Slackbot.
 */
export function isLinkPreviewAgent(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return /bot\b|bot\/|crawler|spider|facebookexternalhit|line-poker|whatsapp\/|skypeuripreview|embedly|vkshare|bingpreview|google-inspectiontool|kakaotalk-scrap|iframely/i.test(userAgent);
}

function langForRegion(region: string): keyof typeof DESCRIPTIONS {
  if (region === 'tw') return 'zh-TW';
  if (region === 'hk') return 'zh-HK';
  return 'en';
}

/** Same transform as the app's BookCoverPipe at zoom 2, made absolute: a
 *  preview image must be a full URL, and Google's zoom=1 thumbnail is too
 *  small for most preview cards. */
export function coverImageUrl(origin: string, coverUrl: string): string | null {
  if (!coverUrl) return null;
  let src: URL;
  try {
    src = new URL(coverUrl);
  } catch {
    return null;
  }
  if (src.hostname === 'books.google.com') {
    src.searchParams.set('zoom', '2');
    src.searchParams.delete('edge');
    src.protocol = 'https:';
  } else if (src.hostname !== 'covers.openlibrary.org' && src.hostname !== 'pdsapp.ncl.edu.tw') {
    return src.protocol === 'https:' ? src.toString() : null;
  }
  return `${origin}/api/cover?src=${encodeURIComponent(src.toString())}`;
}

export function pickBookFacts(body: unknown): BookFacts | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  const title = text(b['title']).trim();
  if (!title) return null;
  return {
    id: text(b['id']),
    isbn13: text(b['isbn13']),
    title,
    authors: text(b['authors']).trim(),
    cover_url: text(b['cover_url']),
  };
}

export function metaFor(book: BookFacts, origin: string, region: string): BookMeta {
  const strings = DESCRIPTIONS[langForRegion(region)];
  const template = book.authors ? strings.withAuthor : strings.noAuthor;
  const description = template.replaceAll('{title}', book.title).replaceAll('{authors}', book.authors);
  // The ISBN form whenever there is one, like the app's own canonical: the
  // same book is also reachable by id and with an &engine= hint.
  const query = book.isbn13
    ? `isbn=${encodeURIComponent(book.isbn13)}`
    : `id=${encodeURIComponent(book.id)}`;
  return {
    title: `${book.title} · ${SITE_NAME}`,
    description,
    canonical: `${origin}/${region}/book?${query}`,
    image: coverImageUrl(origin, book.cover_url),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Tags appended to <head>. <title> and the description already exist in
 *  index.html and are rewritten in place instead. */
export function headTags(meta: BookMeta): string {
  const tag = (attr: 'property' | 'name', key: string, content: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(content)}">`;
  return [
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}">`,
    tag('property', 'og:site_name', SITE_NAME),
    tag('property', 'og:type', 'book'),
    tag('property', 'og:title', meta.title),
    tag('property', 'og:description', meta.description),
    tag('property', 'og:url', meta.canonical),
    ...(meta.image ? [tag('property', 'og:image', meta.image)] : []),
    tag('name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary'),
  ].join('');
}

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

export interface BookPageContext {
  request: Request;
  backendUrl: string | undefined;
  region: unknown;
  /** The response Pages would have served without this Function. */
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface BookPageDeps {
  cache: CacheLike;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Streams `page` with the tags for `meta` written in, under `status`. */
  inject: (page: Response, meta: BookMeta, status: number) => Response;
  timeoutMs?: number;
}

async function lookup(url: string, deps: BookPageDeps): Promise<LookupResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? API_TIMEOUT_MS);
  try {
    const response = await deps.fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return { status: 'missing' };
    if (!response.ok) return { status: 'error' };
    const book = pickBookFacts(await response.json());
    return book ? { status: 'found', book } : { status: 'error' };
  } catch {
    return { status: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(cache: CacheLike, key: string): Promise<LookupResult | null> {
  try {
    const hit = await cache.match(key);
    return hit ? ((await hit.json()) as LookupResult) : null;
  } catch {
    return null;
  }
}

async function writeCache(cache: CacheLike, key: string, result: LookupResult): Promise<void> {
  const ttl = result.status === 'found' ? FOUND_TTL_SECONDS : result.status === 'missing' ? MISSING_TTL_SECONDS : ERROR_TTL_SECONDS;
  try {
    await cache.put(key, new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
    }));
  } catch {
    // A cache that will not store is a slower page, not a broken one.
  }
}

/**
 * Every failure path — no backend configured, malformed query, API error or
 * timeout, a page that is not HTML — returns exactly what Pages would have
 * served, so the worst case is today's behaviour.
 *
 * On a cache miss only a preview agent waits for the API. Anyone else gets
 * the page at once and the lookup runs after the response (waitUntil), which
 * warms this location for the crawler that follows a share.
 */
export async function handleBookPage(ctx: BookPageContext, deps: BookPageDeps): Promise<Response> {
  const url = new URL(ctx.request.url);
  const region = regionFrom(ctx.region);
  const identity = bookIdentity(url);
  if (ctx.request.method !== 'GET' || !ctx.backendUrl || !region || !identity) {
    return ctx.next();
  }

  const page = await ctx.next();
  if (!page.ok || !(page.headers.get('content-type') ?? '').includes('text/html')) {
    return page;
  }

  try {
    const key = cacheKey(url.origin, region, identity);
    let result = await readCache(deps.cache, key);
    if (!result) {
      const apiUrl = bookApiUrl(ctx.backendUrl, region, identity);
      const fetchAndStore = lookup(apiUrl, deps).then(async fresh => {
        await writeCache(deps.cache, key, fresh);
        return fresh;
      });
      if (!isLinkPreviewAgent(ctx.request.headers.get('user-agent'))) {
        ctx.waitUntil(fetchAndStore);
        return page;
      }
      result = await fetchAndStore;
    }

    if (result.status === 'error') {
      return page;
    }
    if (result.status === 'missing') {
      // The SPA would show its not-found state; say so in the status too.
      return new Response(page.body, { status: 404, headers: page.headers });
    }
    return deps.inject(page, metaFor(result.book, url.origin, region), page.status);
  } catch {
    return page;
  }
}
