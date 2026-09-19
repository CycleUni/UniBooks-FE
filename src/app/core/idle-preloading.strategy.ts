import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';

/**
 * Loads the code of the pages a visitor is likely to open next, once the
 * current page is done and the browser is idle — so opening them is not a
 * wait on the network.
 *
 * The service worker only caches a route's chunks when they are first used
 * (see ngsw-config.json), which made the first visit to every page wait for
 * its download. Preloading everything instead would bring back what that
 * change removed: the admin console and its charts, for every visitor. So
 * only routes marked `data: { preload: true }` are fetched, and not at all
 * for a visitor who asked the browser to save data or is on a 2G link.
 */
@Injectable({ providedIn: 'root' })
export class IdlePreloadingStrategy implements PreloadingStrategy {
  private platformId = inject(PLATFORM_ID);

  /** How long after start-up before preloading may begin, at the earliest. */
  static readonly START_DELAY_MS = 2000;

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!route.data?.['preload'] || !isPlatformBrowser(this.platformId) || !preloadAllowed()) {
      return of(null);
    }
    return timer(IdlePreloadingStrategy.START_DELAY_MS).pipe(
      switchMap(() => whenIdle()),
      switchMap(() => load()),
    );
  }
}

/** False when the visitor asked to save data, or the link is 2G. */
export function preloadAllowed(nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  const connection = (nav as { connection?: { saveData?: boolean; effectiveType?: string } } | undefined)?.connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/(^|-)2g$/.test(connection.effectiveType ?? '');
}

/** Resolves when the browser next has idle time (Safari has no requestIdleCallback). */
function whenIdle(): Observable<void> {
  return new Observable<void>(subscriber => {
    const done = () => { subscriber.next(); subscriber.complete(); };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) {
      const handle = ric(done, { timeout: 5000 });
      return () => (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
    }
    const handle = setTimeout(done, 0);
    return () => clearTimeout(handle);
  });
}
