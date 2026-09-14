import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, Routes, provideRouter } from '@angular/router';

import { AuthInterceptor } from './auth.interceptor';
import { ApiUrlInterceptor } from './api-url.interceptor';
import { AuthStore } from './auth.store';
import { RegionLinkService } from './region-link.service';
import { RegionService } from './region.service';
import { I18nService } from './i18n.service';
import { authGuard } from './auth.guard';
import { environment } from '../../environments/environment';

/**
 * The path production actually takes: a visitor opens a page with an access
 * token that expired more than 15 minutes ago, the background requests 401,
 * the interceptor tries POST /auth/refresh/, and the backend refuses it —
 * because the whitelist entry was evicted, a Redis read timed out, or the
 * token was rotated by a response that never reached the browser.
 *
 * Before the fix that answer logged the visitor out of the page they were
 * reading, whatever page it was.
 */
describe('AuthInterceptor refresh refusal', () => {
  @Component({ standalone: true, template: 'stub' })
  class StubPage {}

  const TEST_ROUTES: Routes = [
    {
      path: 'tw',
      children: [
        { path: '', component: StubPage },
        { path: 'login', component: StubPage },
        { path: 'account', canActivate: [authGuard], component: StubPage },
      ],
    },
  ];

  const REFRESH_URL = `${environment.backendUrl}/auth/refresh/`;
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  let httpMock: HttpTestingController;
  let http: HttpClient;
  let router: Router;
  let store: AuthStore;

  /** Seed localStorage BEFORE calling this. */
  function build() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        provideRouter(TEST_ROUTES),
        { provide: HTTP_INTERCEPTORS, useClass: ApiUrlInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        RegionLinkService,
        { provide: RegionService, useValue: { region: signal('tw') } },
        { provide: I18nService, useValue: { lang: () => 'zh-TW' } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    http = TestBed.inject(HttpClient);
    store = TestBed.inject(AuthStore);
  }

  /** The AuthStore bootstrap fires its own GET /auth/me/; drain whatever is
   *  still queued so a test's assertions are not order-dependent. */
  const drain = () => httpMock.match(() => true).forEach(req => req.flush({}, { status: 401, statusText: 'Unauthorized' }));

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  });

  it('keeps the visitor on a public page when the refresh token is refused', async () => {
    localStorage.setItem('access_token', 'stale');
    localStorage.setItem('refresh_token', 'revoked');
    build();
    await router.navigateByUrl('/tw');

    http.get('/listings/').subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne(req => req.url.endsWith('/listings/'))
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    await settle();
    httpMock.expectOne(REFRESH_URL)
      .flush({ error: { code: 'auth.errTokenRevoked' } }, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(store.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('access_token')).toBeNull();
    // The bug: this used to be '/tw/login'.
    expect(router.url).toBe('/tw');
    drain();
  });

  it('takes the visitor off a protected page when the refresh token is refused', async () => {
    localStorage.setItem('access_token', 'stale');
    localStorage.setItem('refresh_token', 'revoked');
    build();
    await router.navigateByUrl('/tw/account');
    expect(router.url).toBe('/tw/account');

    http.get('/listings/').subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne(req => req.url.endsWith('/listings/'))
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    await settle();
    httpMock.expectOne(REFRESH_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(router.url).toBe('/tw/login?returnUrl=%2Ftw%2Faccount');
    drain();
  });

  it('retries anonymously when there is no refresh token left to try', async () => {
    // Deliberately no refresh_token: the branch that used to reject with a bare
    // Error, which `instanceof HttpErrorResponse` rejected, so the anonymous
    // retry below never ran and the request died unreadable.
    localStorage.setItem('access_token', 'stale');
    build();
    await router.navigateByUrl('/tw');

    http.get('/listings/').subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne(req => req.url.endsWith('/listings/'))
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(store.isAuthenticated()).toBe(false);
    expect(router.url).toBe('/tw');

    const retried = httpMock.match(req => req.url.endsWith('/listings/'));
    expect(retried.length).toBe(1);
    expect(retried[0].request.headers.has('Authorization')).toBe(false);
    retried.forEach(req => req.flush({}));
    drain();
  });

  it('shares one refresh between the requests a page load fires together', async () => {
    localStorage.setItem('access_token', 'stale');
    localStorage.setItem('refresh_token', 'good');
    build();
    await router.navigateByUrl('/tw');

    http.get('/listings/').subscribe({ next: () => {}, error: () => {} });
    http.get('/orders/').subscribe({ next: () => {}, error: () => {} });

    httpMock.expectOne(req => req.url.endsWith('/listings/'))
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    httpMock.expectOne(req => req.url.endsWith('/orders/'))
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await settle();

    // One refresh, not one per 401 — the refresh token is single-use server-side.
    expect(httpMock.match(REFRESH_URL).length).toBe(1);
    drain();
  });

  it('lets a refresh finish even if everyone waiting on it goes away', async () => {
    // With refCount:true the last subscriber leaving (a component destroyed by
    // navigation) aborted the POST — possibly after the server had already
    // rotated the token, so the next 401 re-sent a refresh token that no longer
    // existed and signed the visitor out.
    localStorage.setItem('access_token', 'stale');
    localStorage.setItem('refresh_token', 'good');
    build();
    await router.navigateByUrl('/tw');

    const subscription = http.get('/listings/').subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne(req => req.url.endsWith('/listings/'))
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await settle();

    subscription.unsubscribe();

    const refresh = httpMock.expectOne(REFRESH_URL);
    expect(refresh.cancelled).toBe(false);
    refresh.flush({ access: 'fresh', refresh: 'fresh-refresh' });
    expect(localStorage.getItem('access_token')).toBe('fresh');
    drain();
  });

  describe('a refresh that fails for reasons unrelated to the session', () => {
    const listings = (req: { url: string }) => req.url.endsWith('/listings/');
    const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

    /** Stale access token, good refresh token, one request that has just 401'd
     *  and handed off to the refresh. Fake timers from here on. */
    async function refreshUnderWay() {
      localStorage.setItem('access_token', 'stale');
      localStorage.setItem('refresh_token', 'good');
      build();
      await router.navigateByUrl('/tw');
      vi.useFakeTimers();

      const outcome: { value?: any; error?: any } = {};
      http.get('/listings/').subscribe({ next: v => (outcome.value = v), error: e => (outcome.error = e) });
      httpMock.expectOne(listings).flush({}, { status: 401, statusText: 'Unauthorized' });
      await tick(0);
      return outcome;
    }

    afterEach(() => vi.useRealTimers());

    it('retries a refresh whose response was lost, well inside the grace window', async () => {
      const outcome = await refreshUnderWay();

      // Connection dropped: the server may already have rotated the token.
      httpMock.expectOne(REFRESH_URL).error(new ProgressEvent('error'));
      await tick(1000);

      // Same refresh token again, within the backend's 60s grace: it answers
      // with the pair it rotated into.
      const retry = httpMock.expectOne(REFRESH_URL);
      expect(retry.request.body).toEqual({ refresh: 'good' });
      retry.flush({ access: 'rotated', refresh: 'rotated-refresh' });
      await tick(0);

      const replayed = httpMock.expectOne(listings);
      expect(replayed.request.headers.get('Authorization')).toBe('Bearer rotated');
      replayed.flush({ ok: true });

      expect(outcome.value).toEqual({ ok: true });
      expect(store.isAuthenticated()).toBe(true);
      expect(localStorage.getItem('refresh_token')).toBe('rotated-refresh');
      drain();
    });

    it('rides out the token store being briefly unavailable (503)', async () => {
      const outcome = await refreshUnderWay();

      httpMock.expectOne(REFRESH_URL).flush(
        { error: { code: 'auth.errSessionStoreUnavailable' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
      await tick(1000);
      httpMock.expectOne(REFRESH_URL).flush({ access: 'fresh', refresh: 'fresh-refresh' });
      await tick(0);
      httpMock.expectOne(listings).flush({ ok: true });

      expect(outcome.value).toEqual({ ok: true });
      expect(store.isAuthenticated()).toBe(true);
      drain();
    });

    it('gives up after its retries without signing the visitor out', async () => {
      const outcome = await refreshUnderWay();
      const unavailable = { status: 503, statusText: 'Service Unavailable' };

      httpMock.expectOne(REFRESH_URL).flush({}, unavailable);
      await tick(1000);
      httpMock.expectOne(REFRESH_URL).flush({}, unavailable);
      await tick(2000);
      httpMock.expectOne(REFRESH_URL).flush({}, unavailable);
      await tick(5000);

      expect(httpMock.match(REFRESH_URL)).toEqual([]);
      expect(outcome.error?.status).toBe(503);
      // An outage is not a verdict on the session: keep it for the next try.
      expect(store.isAuthenticated()).toBe(true);
      expect(localStorage.getItem('refresh_token')).toBe('good');
      expect(router.url).toBe('/tw');
      drain();
    });

    it('does not retry a refresh the server actually refused', async () => {
      await refreshUnderWay();

      httpMock.expectOne(REFRESH_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
      await tick(5000);

      expect(httpMock.match(REFRESH_URL)).toEqual([]);
      expect(store.isAuthenticated()).toBe(false);
      drain();
    });
  });

  it('does not resend a request that was already anonymous when it got its 401', async () => {
    build();                                        // no tokens at all
    await router.navigateByUrl('/tw');

    let status = 0;
    http.get('/messaging/hub-token/').subscribe({ error: err => (status = err.status) });
    httpMock.expectOne(req => req.url.endsWith('/messaging/hub-token/'))
      .flush({ detail: 'not signed in' }, { status: 401, statusText: 'Unauthorized' });
    await settle();

    // Stripping an Authorization header it never had would send the identical
    // request straight back to be refused again.
    expect(httpMock.match(req => req.url.endsWith('/messaging/hub-token/'))).toEqual([]);
    expect(status).toBe(401);
    drain();
  });
});
