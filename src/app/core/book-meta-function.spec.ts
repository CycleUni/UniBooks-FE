import {
  BookMeta, BookPageDeps, CacheLike, DESCRIPTIONS, LookupResult,
  bookApiUrl, bookIdentity, cacheKey, coverImageUrl, handleBookPage, headTags,
  isLinkPreviewAgent, metaFor, regionFrom,
} from '../../../functions/_lib/book-meta';
import { en } from './i18n/en';
import { zhTW } from './i18n/zh-TW';
import { zhHK } from './i18n/zh-HK';

/**
 * The Pages Function at functions/[region]/book.ts. Nothing in the Angular
 * build runs it, and Cloudflare serves whatever it returns without a check,
 * so a regression here would only show up as broken link previews — or, in
 * the failure the design guards against, a broken book page.
 */

const ORIGIN = 'https://cycleunife.pages.dev';
const GOOGLE_COVER = 'https://books.google.com/books/content?id=UWlo-c4WEpAC&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api';
const BOOK = { id: 1, isbn13: '9781449319793', title: 'Python for Data Analysis', authors: 'Wes McKinney', cover_url: GOOGLE_COVER, listings: { results: [{ seller_name: 'someone' }] } };
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const LINE_PREVIEW = 'facebookexternalhit/1.1;line-poker/1.0';

describe('book link-preview Function', () => {
  describe('reading the request', () => {
    it('accepts two-letter regions only', () => {
      expect(regionFrom('TW')).toBe('tw');
      expect(regionFrom('messages')).toBeNull();
      expect(regionFrom(['tw'])).toBeNull();
    });

    it('identifies a book by a well-formed isbn, else a numeric id', () => {
      expect(bookIdentity(new URL(`${ORIGIN}/tw/book?id=2&isbn=9781449319793`))).toEqual({ kind: 'isbn', value: '9781449319793' });
      expect(bookIdentity(new URL(`${ORIGIN}/tw/book?isbn=059652068x`))).toEqual({ kind: 'isbn', value: '059652068X' });
      expect(bookIdentity(new URL(`${ORIGIN}/tw/book?id=2`))).toEqual({ kind: 'id', value: '2' });
      expect(bookIdentity(new URL(`${ORIGIN}/tw/book?isbn=abc`))).toBeNull();
      expect(bookIdentity(new URL(`${ORIGIN}/tw/book?id=2%20OR%201`))).toBeNull();
      expect(bookIdentity(new URL(`${ORIGIN}/tw/book`))).toBeNull();
    });

    it('keys the cache by the book, not by the URL it was shared under', () => {
      const a = bookIdentity(new URL(`${ORIGIN}/tw/book?isbn=9781449319793&engine=googlebooks`))!;
      const b = bookIdentity(new URL(`${ORIGIN}/tw/book?utm_source=line&isbn=9781449319793`))!;
      expect(cacheKey(ORIGIN, 'tw', a)).toBe(cacheKey(ORIGIN, 'tw', b));
      expect(cacheKey(ORIGIN, 'tw', a)).not.toBe(cacheKey(ORIGIN, 'hk', a));
    });

    it('asks the API the way the app does', () => {
      expect(bookApiUrl('https://cycle-uni-be.vercel.app/api/v1/', 'tw', { kind: 'isbn', value: '9781449319793' }))
        .toBe('https://cycle-uni-be.vercel.app/api/v1/books/?isbn=9781449319793&region=tw');
    });

    it('waits for the API only for clients that cannot run the app', () => {
      expect(isLinkPreviewAgent(LINE_PREVIEW)).toBe(true);
      expect(isLinkPreviewAgent('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true);
      expect(isLinkPreviewAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
      expect(isLinkPreviewAgent('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)')).toBe(true);
      expect(isLinkPreviewAgent('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)')).toBe(true);
      expect(isLinkPreviewAgent('TelegramBot (like TwitterBot)')).toBe(true);
      expect(isLinkPreviewAgent('WhatsApp/2.23.20.0')).toBe(true);
      expect(isLinkPreviewAgent(CHROME)).toBe(false);
      // A person reading in LINE's in-app browser must not wait on the API.
      expect(isLinkPreviewAgent(`${CHROME} Line/13.14.0`)).toBe(false);
      expect(isLinkPreviewAgent(null)).toBe(false);
    });
  });

  describe('what it writes', () => {
    it('describes the book in the region\'s language, with the app\'s wording', () => {
      for (const [lang, table] of [['en', en], ['zh-TW', zhTW], ['zh-HK', zhHK]] as const) {
        expect(DESCRIPTIONS[lang].withAuthor).toBe(table['seo.bookDescription']);
        expect(DESCRIPTIONS[lang].noAuthor).toBe(table['seo.bookDescriptionNoAuthor']);
      }
      const book = { id: '1', isbn13: '9781449319793', title: 'Python for Data Analysis', authors: 'Wes McKinney', cover_url: '' };
      expect(metaFor(book, ORIGIN, 'tw').description).toBe('《Python for Data Analysis》，Wes McKinney 著。在 UniBooks 向同學購買二手書。');
      expect(metaFor({ ...book, authors: '' }, ORIGIN, 'sg').description).toBe('Python for Data Analysis. Buy it second-hand from students on UniBooks.');
    });

    it('points the canonical at the isbn form, falling back to id', () => {
      const book = { id: '2', isbn13: '9781449319793', title: 'T', authors: '', cover_url: '' };
      expect(metaFor(book, ORIGIN, 'tw').canonical).toBe(`${ORIGIN}/tw/book?isbn=9781449319793`);
      expect(metaFor({ ...book, isbn13: '' }, ORIGIN, 'tw').canonical).toBe(`${ORIGIN}/tw/book?id=2`);
      expect(metaFor(book, ORIGIN, 'tw').title).toBe('T · UniBooks');
    });

    it('uses the cover proxy at a size preview cards can use', () => {
      const image = coverImageUrl(ORIGIN, GOOGLE_COVER)!;
      expect(image.startsWith(`${ORIGIN}/api/cover?src=`)).toBe(true);
      const src = new URL(decodeURIComponent(image.split('src=')[1]));
      expect(src.searchParams.get('zoom')).toBe('2');
      expect(src.searchParams.has('edge')).toBe(false);
      expect(coverImageUrl(ORIGIN, 'https://covers.openlibrary.org/b/id/1-M.jpg')).toContain('/api/cover?src=');
      expect(coverImageUrl(ORIGIN, 'http://example.com/x.jpg')).toBeNull();
      expect(coverImageUrl(ORIGIN, '')).toBeNull();
    });

    it('escapes book data written into the head', () => {
      const tags = headTags({ title: '"><script>alert(1)</script> · UniBooks', description: "O'Reilly & <b>", canonical: `${ORIGIN}/tw/book?id=1`, image: null });
      expect(tags).not.toContain('<script>');
      expect(tags).toContain('content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; · UniBooks"');
      expect(tags).toContain('content="O&#39;Reilly &amp; &lt;b&gt;"');
      expect(tags).toContain('<meta name="twitter:card" content="summary">');
      expect(tags).not.toContain('og:image');
    });
  });

  describe('serving the page', () => {
    const SHELL = '<!doctype html><html><head><title>UniBooks</title></head><body></body></html>';

    class MemoryCache implements CacheLike {
      store = new Map<string, string>();
      async match(key: string) {
        const body = this.store.get(key);
        return body === undefined ? undefined : new Response(body);
      }
      async put(key: string, response: Response) {
        this.store.set(key, await response.text());
      }
    }

    function setup(options: { ua?: string; url?: string; method?: string; backendUrl?: string | undefined; api?: (url: string, init: RequestInit) => Promise<Response>; page?: () => Response } = {}) {
      const cache = new MemoryCache();
      const pending: Promise<unknown>[] = [];
      const api = vi.fn(options.api ?? (async () => new Response(JSON.stringify(BOOK), { status: 200 })));
      const injected: Array<{ meta: BookMeta; status: number }> = [];
      const next = vi.fn(async () => options.page?.() ?? new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
      const deps: BookPageDeps = {
        cache,
        fetch: (url, init) => api(url, init),
        inject: (page, meta, status) => {
          injected.push({ meta, status });
          return new Response('injected', { status, headers: page.headers });
        },
        timeoutMs: 20,
      };
      const run = () => handleBookPage({
        request: new Request(options.url ?? `${ORIGIN}/tw/book?isbn=9781449319793`, {
          method: options.method ?? 'GET',
          headers: { 'User-Agent': options.ua ?? LINE_PREVIEW },
        }),
        backendUrl: 'backendUrl' in options ? options.backendUrl : 'https://api.example/api/v1',
        region: 'tw',
        next,
        waitUntil: p => { pending.push(p); },
      }, deps);
      return { cache, api, injected, next, pending, run };
    }

    it('writes the tags for a crawler, and caches only the book facts', async () => {
      const t = setup();
      const response = await t.run();
      expect(await response.text()).toBe('injected');
      expect(response.status).toBe(200);
      expect(t.injected[0].meta.title).toBe('Python for Data Analysis · UniBooks');
      expect(t.api).toHaveBeenCalledWith('https://api.example/api/v1/books/?isbn=9781449319793&region=tw', expect.anything());
      const stored = [...t.cache.store.values()][0];
      expect(stored).not.toContain('someone');
      expect(JSON.parse(stored)).toEqual({ status: 'found', book: expect.objectContaining({ isbn13: '9781449319793' }) });
    });

    it('does not make a person wait on a miss, but warms the cache behind them', async () => {
      const t = setup({ ua: CHROME });
      const response = await t.run();
      expect(await response.text()).toBe(SHELL);
      expect(t.injected).toEqual([]);
      await Promise.all(t.pending);
      expect(t.cache.store.size).toBe(1);

      // The crawler that follows the share is answered from the cache.
      const again = setup({ ua: LINE_PREVIEW });
      again.cache.store = t.cache.store;
      expect(await (await again.run()).text()).toBe('injected');
      expect(again.api).not.toHaveBeenCalled();
    });

    it('answers 404 when the API says the book does not exist', async () => {
      const t = setup({ api: async () => new Response('{}', { status: 404 }) });
      const response = await t.run();
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(SHELL);
      expect(JSON.parse([...t.cache.store.values()][0])).toEqual({ status: 'missing' } satisfies LookupResult);
    });

    it('serves the untouched page when the API fails, is slow, or answers nonsense', async () => {
      const failures: Array<(url: string, init: RequestInit) => Promise<Response>> = [
        async () => new Response('boom', { status: 500 }),
        async () => { throw new TypeError('network'); },
        async () => new Response('not json', { status: 200 }),
        async () => new Response(JSON.stringify({ title: '' }), { status: 200 }),
      ];
      for (const api of failures) {
        const t = setup({ api });
        const response = await t.run();
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(SHELL);
        expect(t.cache.store.size).toBe(1);
        const stored = [...t.cache.store.values()][0];
        expect(JSON.parse(stored)).toEqual({ status: 'error' } satisfies LookupResult);
      }

      // Never answers; rejects only when lookup() aborts, as fetch does.
      const slow = setup({
        api: (_url, init) => new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      });
      const response = await slow.run();
      expect(await response.text()).toBe(SHELL);
      expect(slow.cache.store.size).toBe(1);
    });

    it('leaves requests it has nothing to add to exactly as Pages serves them', async () => {
      for (const options of [
        { backendUrl: undefined },
        { url: `${ORIGIN}/tw/book` },
        { url: `${ORIGIN}/tw/book?isbn=not-an-isbn` },
        { method: 'POST' },
      ]) {
        const t = setup(options);
        expect(await (await t.run()).text()).toBe(SHELL);
        expect(t.api).not.toHaveBeenCalled();
        expect(t.next).toHaveBeenCalledTimes(1);
      }

      const notHtml = setup({ page: () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) });
      expect(await (await notHtml.run()).text()).toBe('{}');
      expect(notHtml.api).not.toHaveBeenCalled();
    });

    it('treats an unreadable cache entry as a miss', async () => {
      const t = setup();
      const key = cacheKey(ORIGIN, 'tw', { kind: 'isbn', value: '9781449319793' });
      t.cache.store.set(key, 'not json');
      expect(await (await t.run()).text()).toBe('injected');
      expect(t.api).toHaveBeenCalledTimes(1);
    });
  });
});
