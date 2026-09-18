/**
 * A floor for degenerate responses, not a guess at whether art exists.
 *
 * This replaces per-zoom thresholds of 5,000 / 13,000 / 20,000 bytes, which
 * were trying to answer "is there a cover here?" by weight and got it wrong in
 * both directions. Measured across 13 volumes: a real cover at zoom 2 came in
 * at 12,934 bytes and was rejected for being 66 bytes light, so the page fell
 * back to the zoom 1 image; another at 10,626 was rejected at zoom 2 and its
 * zoom 1 at 4,786 was rejected too, leaving that book with no cover at all.
 * Whether art exists is now cache-control's answer (see below).
 *
 * What weight still catches is Google occasionally returning a blank sliver —
 * one volume answers zoom 2 with a 300x48 white bar of 1,026 bytes, marked
 * durable. The smallest real cover measured was 4,786 bytes and the largest
 * sliver 1,491, so the floor sits between them with room on both sides.
 */
const MIN_IMAGE_BYTES = 3000;

/**
 * Google serves its "image not available" card with `max-age=30`, and real
 * cover art with `max-age=86400`. It is saying the response is not durable,
 * which is exactly the question here, so that is what we read.
 *
 * Byte size cannot answer it. The placeholder rendered at zoom 2 is 15,567
 * bytes — larger than that zoom's threshold, so it was accepted, and the
 * cascade stopped before reaching a zoom that had the real jacket. Raising the
 * threshold past it is not available either: of ten real covers measured at
 * zoom 2, two are smaller than the placeholder (10,626 and 12,934 bytes).
 * Content type does not separate them either — the placeholder is a PNG, but
 * so is a real line-art cover measured at 86,631 bytes.
 *
 * Checked against 39 responses (13 volumes x 3 zooms): every placeholder said
 * 30, every real cover 86400, including the volume that has real art at zoom 1
 * and the placeholder above it. The cutoff sits between the two by an order of
 * magnitude on either side, so a change to Google's exact numbers has room
 * before it reverses the decision.
 */
const DURABLE_MAX_AGE_SECONDS = 3600;

function isPlaceholderResponse(response: Response): boolean {
  const cacheControl = response.headers.get('cache-control');
  if (!cacheControl) return false;
  const match = /max-age\s*=\s*(\d+)/i.exec(cacheControl);
  if (!match) return false;
  return parseInt(match[1], 10) < DURABLE_MAX_AGE_SECONDS;
}

/**
 * "No cover here", cached like a cover is. It used to go out bare — no
 * Cache-Control, never put in the edge cache — so every view of a book with
 * no jacket re-ran this Function and up to three upstream fetches, and a page
 * that kept re-requesting the image (see UiRecentListings.gridItems) spent a
 * billed Functions request on each try. A day is long enough to stop that and
 * short enough for a cover added upstream to appear.
 */
const MISSING_COVER_MAX_AGE_SECONDS = 86400;

function missingCover(context: EventContext<unknown, any, Record<string, unknown>>): Response {
  const response = new Response(null, {
    status: 404,
    headers: { 'Cache-Control': `public, max-age=${MISSING_COVER_MAX_AGE_SECONDS}` },
  });
  context.waitUntil(caches.default.put(context.request, response.clone()));
  return response;
}

// Cache-Control on the returned Response only governs the *browser's* cache.
// Cloudflare's edge/CDN cache does not automatically store dynamic
// Pages Functions responses just because a Cache-Control header is present —
// that has to be opted into explicitly via the Cache API, which is what the
// `caches.default.match`/`.put` calls below do. Without this, every request
// for the same book cover (from any visitor, anywhere) would re-run the
// zoom-cascade/size-check logic and re-fetch from Google/Open Library every
// single time, instead of being served instantly from Cloudflare's edge
// after the first successful lookup.
export const onRequestGet: PagesFunction = async (context) => {
  const cache = caches.default;
  const cached = await cache.match(context.request);
  if (cached) {
    return cached;
  }

  const requestUrl = new URL(context.request.url);
  const src = requestUrl.searchParams.get('src');

  if (!src) {
    return new Response('Missing required "src" query parameter', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  let srcUrl: URL;
  try {
    srcUrl = new URL(src);
    if (srcUrl.protocol !== 'http:' && srcUrl.protocol !== 'https:') {
      return new Response('Invalid "src" query parameter: protocol must be http or https', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  } catch {
    return new Response('Invalid "src" query parameter: malformed URL', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (
    srcUrl.hostname !== 'books.google.com' &&
    srcUrl.hostname !== 'covers.openlibrary.org' &&
    srcUrl.hostname !== 'pdsapp.ncl.edu.tw'
  ) {
    return new Response('Invalid "src" query parameter: unsupported host', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (srcUrl.hostname === 'covers.openlibrary.org' || srcUrl.hostname === 'pdsapp.ncl.edu.tw') {
    // Open Library answers a missing cover with a 43-byte blank GIF and a
    // 200 unless asked not to; default=false makes it a plain 404.
    const upstreamUrl = new URL(srcUrl.toString());
    if (upstreamUrl.hostname === 'covers.openlibrary.org') {
      upstreamUrl.searchParams.set('default', 'false');
    }
    try {
      const upstreamResponse = await fetch(upstreamUrl.toString());
      if (!upstreamResponse.ok) {
        return upstreamResponse.status >= 500 ? new Response(null, { status: 404 }) : missingCover(context);
      }

      let byteLength = -1;
      let bodyBuffer: ArrayBuffer | null = null;

      const contentLengthHeader = upstreamResponse.headers.get('content-length');
      if (contentLengthHeader) {
        const parsedLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(parsedLength) && parsedLength >= 0) {
          byteLength = parsedLength;
        }
      }

      if (byteLength < 0) {
        bodyBuffer = await upstreamResponse.arrayBuffer();
        byteLength = bodyBuffer.byteLength;
      }

      if (byteLength < 100) {
        return missingCover(context);
      }

      if (!bodyBuffer) {
        bodyBuffer = await upstreamResponse.arrayBuffer();
      }

      if (bodyBuffer.byteLength < 100) {
        return missingCover(context);
      }

      const contentType = upstreamResponse.headers.get('content-type') || 'image/jpeg';
      const response = new Response(bodyBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=2592000, immutable',
        },
      });
      context.waitUntil(cache.put(context.request, response.clone()));
      return response;
    } catch {
      // A network failure says nothing about whether the cover exists: not
      // cached, so the next request tries again.
      return new Response(null, { status: 404 });
    }
  }

  const zoomParam = srcUrl.searchParams.get('zoom');
  let initialZoom = 1;
  if (zoomParam) {
    const parsed = parseInt(zoomParam, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      initialZoom = Math.min(parsed, 3);
    }
  }

  // Set when an attempt failed for a reason that says nothing about the
  // cover (network error, upstream 5xx), so that "missing" is not cached.
  let transientFailure = false;
  for (let currentZoom = initialZoom; currentZoom >= 1; currentZoom--) {
    const targetUrl = new URL(srcUrl.toString());
    targetUrl.searchParams.set('zoom', currentZoom.toString());

    try {
      const upstreamResponse = await fetch(targetUrl.toString());
      if (!upstreamResponse.ok) {
        if (upstreamResponse.status >= 500) transientFailure = true;
        continue;
      }

      // Before measuring anything: a 200 here can still be the "image not
      // available" card, and it can outweigh any size floor.
      if (isPlaceholderResponse(upstreamResponse)) {
        continue;
      }

      let byteLength = -1;
      let bodyBuffer: ArrayBuffer | null = null;

      const contentLengthHeader = upstreamResponse.headers.get('content-length');
      if (contentLengthHeader) {
        const parsedLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(parsedLength) && parsedLength >= 0) {
          byteLength = parsedLength;
        }
      }

      if (byteLength < 0) {
        bodyBuffer = await upstreamResponse.arrayBuffer();
        byteLength = bodyBuffer.byteLength;
      }

      if (byteLength >= MIN_IMAGE_BYTES) {
        if (!bodyBuffer) {
          bodyBuffer = await upstreamResponse.arrayBuffer();
        }

        if (bodyBuffer.byteLength < MIN_IMAGE_BYTES) {
          continue;
        }

        const contentType = upstreamResponse.headers.get('content-type') || 'image/jpeg';
        const response = new Response(bodyBuffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=2592000, immutable',
          },
        });
        context.waitUntil(cache.put(context.request, response.clone()));
        return response;
      }
    } catch {
      transientFailure = true;
      continue;
    }
  }

  return transientFailure ? new Response(null, { status: 404 }) : missingCover(context);
};
