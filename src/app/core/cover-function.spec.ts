import { handleCover } from '../../../functions/_lib/cover';

/**
 * functions/_lib/cover.ts (the /api/cover proxy), run against a stubbed fetch and edge cache. What
 * matters is how long each answer is kept: a cover for a year, a missing
 * cover for a day, and an upstream failure for ten seconds — short, but not
 * zero, or every page asking while the upstream is down re-runs the Function.
 */
describe('/api/cover caching', () => {
  let stored: Map<string, Response>;
  let pending: Promise<unknown>[];

  beforeEach(() => {
    stored = new Map();
    pending = [];
    (globalThis as any).caches = {
      default: {
        match: vi.fn(async (req: Request) => stored.get(req.url)?.clone()),
        put: vi.fn(async (req: Request, res: Response) => { stored.set(req.url, res); }),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).caches;
    vi.unstubAllGlobals();
  });

  async function get(src: string): Promise<Response> {
    const request = new Request(`https://cycleunife.pages.dev/api/cover?src=${encodeURIComponent(src)}`);
    const response = await handleCover(request, { cache: (globalThis as any).caches.default, fetch: (url: string) => fetch(url), waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
    await Promise.all(pending);
    return response;
  }

  const OL = 'https://covers.openlibrary.org/b/isbn/9786263241893-L.jpg';
  const image = () => new Response(new Uint8Array(5000), { status: 200, headers: { 'content-type': 'image/jpeg' } });

  it('keeps a found cover for a year', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => image()));
    const res = await get(OL);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(stored.size).toBe(1);
  });

  it('keeps "no cover" for a day, and asks Open Library for a real 404', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await get(OL);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('default')).toBe('false');
  });

  it('holds an upstream failure for ten seconds instead of caching it as missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await get(OL);
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('public, max-age=10');
    expect(stored.size).toBe(1);
  });

  it('treats an upstream 5xx from Google as a failure too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    const res = await get('https://books.google.com/books/content?id=X&printsec=frontcover&img=1&zoom=3');
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('public, max-age=10');
  });

  it('serves a repeat request from the edge cache without going upstream', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await get(OL);
    await get(OL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
