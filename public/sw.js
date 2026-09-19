// The service worker the app registers: Angular's, with cross-origin requests
// left to the browser.
//
// ngsw-worker.js answers every fetch it sees unless the request carries
// ngsw-bypass — including requests to other origins, which it never caches
// here (no data group names one), so it only fetched them again itself. Every
// Google Fonts file, analytics call, R2 image and backend request took that
// extra hop, and showed up twice in DevTools, once from the page and once from
// the worker. The Google Fonts files cannot carry ngsw-bypass, since their
// URLs come from Google's stylesheet.
//
// This listener is registered before ngsw-worker.js adds its own, and stops
// the event from reaching it for any other origin, so the browser handles
// those requests natively. Same-origin requests — the app shell, route
// chunks, index.html — are left to Angular's worker exactly as before.
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).origin !== self.location.origin) {
    event.stopImmediatePropagation();
  }
});

importScripts('./ngsw-worker.js');
