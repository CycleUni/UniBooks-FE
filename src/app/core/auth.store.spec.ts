import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AuthStore } from './auth.store';
import { RegionLinkService } from './region-link.service';
import { RegionService } from './region.service';
import { Meta, Title } from '@angular/platform-browser';
import { Component, inject, signal } from '@angular/core';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';

describe('AuthStore', () => {
  let authStore: AuthStore;
  let mockRegionService: any;

  beforeEach(() => {
    mockRegionService = {
      region: signal('tw')
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule],
      providers: [
        AuthStore,
        RegionLinkService,
        { provide: RegionService, useValue: mockRegionService },
        Title,
        Meta
      ]
    });
    
    authStore = TestBed.inject(AuthStore);
  });

  describe('isVerifiedIn()', () => {
    it('should return true for region match regardless of case (TW vs tw)', () => {
      const user = {
        id: 1,
        email: 'test@test.com',
        verifications: [
          { region: 'TW', school: 1, edu_email: 'test@edu.tw', verified_at: '2026-08-28T12:27:44Z' }
        ]
      };
      
      (authStore as any)._user.set(user);

      expect(authStore.isVerifiedIn('tw')).toBe(true);
      expect(authStore.isVerifiedIn('TW')).toBe(true);
    });

    it('should return false if verified_at is null', () => {
      const user = {
        id: 1,
        email: 'test@test.com',
        verifications: [
          { region: 'TW', school: 1, edu_email: 'test@edu.tw', verified_at: null }
        ]
      };
      
      (authStore as any)._user.set(user);

      expect(authStore.isVerifiedIn('tw')).toBe(false);
      expect(authStore.isVerifiedIn('TW')).toBe(false);
    });
  });
});

/**
 * Regression cover for the production bug where opening the PUBLIC homepage
 * with stale tokens threw the visitor to /login the moment the backend
 * answered the background bootstrap GET /auth/me/.
 *
 * These drive a real Router over a real route table, because the thing under
 * test is precisely "which page am I on, and may a signed-out visitor be
 * here?" — a navigate() spy alone cannot tell those cases apart.
 */
describe('AuthStore session expiry', () => {
  @Component({ standalone: true, template: 'stub' })
  class StubPage {}

  /** A lazy chunk a test can hold open, standing in for loadComponent's
   *  download — the window in which a navigation has passed its guards but has
   *  not committed. */
  function heldChunk() {
    let release!: () => void;
    const promise = new Promise<typeof StubPage>(resolve => (release = () => resolve(StubPage)));
    return { promise, release };
  }

  /** A guard verdict a test can hold open, then release with any result. */
  function heldVerdict() {
    let release!: (verdict: boolean | 'redirect-home') => void;
    const promise = new Promise<boolean | 'redirect-home'>(resolve => (release = resolve));
    return { promise, release };
  }

  /** A lazy chunk that fails to download once released. */
  function failingChunk() {
    let fail!: () => void;
    const promise = new Promise<typeof StubPage>((_, reject) => (fail = () => reject(new Error('chunk failed'))));
    return { promise, fail };
  }

  let slowAccount = heldChunk();
  let slowPublic = heldChunk();
  let heldGuard = heldVerdict();
  let brokenChunk = failingChunk();

  /** Fresh Route objects per test: Angular caches a loaded component on the
   *  Route object itself, so a shared table would only ever hold a chunk open
   *  in the first test that touched it. */
  function testRoutes(): Routes {
    return [
      {
        path: 'tw',
        children: [
          { path: '', component: StubPage },
          { path: 'login', component: StubPage },
          { path: 'account', canActivate: [authGuard], component: StubPage },
          { path: 'slow-account', canActivate: [authGuard], loadComponent: () => slowAccount.promise },
          { path: 'slow-public', loadComponent: () => slowPublic.promise },
          {
            // Resolves to whatever the test releases: true, false (cancel), or
            // a redirect to the public home page.
            path: 'held',
            canActivate: [() => {
              const guardRouter = inject(Router);
              return heldGuard.promise.then(v => (v === 'redirect-home' ? guardRouter.parseUrl('/tw') : v));
            }],
            component: StubPage,
          },
          { path: 'broken', loadComponent: () => brokenChunk.promise },
        ],
      },
    ];
  }

  let httpMock: HttpTestingController;
  let router: Router;

  /** Seed localStorage BEFORE this: the bootstrap fetch is scheduled from the
   *  AuthStore constructor. */
  function build(): AuthStore {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        provideRouter(testRoutes()),
        RegionLinkService,
        { provide: RegionService, useValue: { region: signal('tw') } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    return TestBed.inject(AuthStore);
  }

  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => {
    localStorage.clear();
    slowAccount = heldChunk();
    slowPublic = heldChunk();
    heldGuard = heldVerdict();
    brokenChunk = failingChunk();
  });

  /** Put a signed-in visitor on /tw/account with the bootstrap profile loaded. */
  async function signedInOnAccount(): Promise<AuthStore> {
    localStorage.setItem('access_token', 'live');
    localStorage.setItem('refresh_token', 'live-refresh');
    const store = build();
    await router.navigateByUrl('/tw/account');
    await settle();
    httpMock.expectOne('/auth/me/').flush({ id: 1, email: 'a@b.c' });
    return store;
  }
  afterEach(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  });

  it('stays on a public page when the session turns out to be dead', async () => {
    localStorage.setItem('access_token', 'stale');
    localStorage.setItem('refresh_token', 'stale-refresh');
    const store = build();

    // Optimistic: the mere presence of a token marks the session live, which is
    // what lets the homepage render signed-in before the backend disagrees.
    expect(store.isAuthenticated()).toBe(true);

    await router.navigateByUrl('/tw');
    await settle();
    httpMock.expectOne('/auth/me/').flush({ detail: 'expired' }, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    // The bug: this used to be '/tw/login'.
    expect(router.url).toBe('/tw');
  });

  it('leaves a protected page for the sign-in page, carrying returnUrl', async () => {
    localStorage.setItem('access_token', 'stale');
    localStorage.setItem('refresh_token', 'stale-refresh');
    const store = build();

    // The stale token gets them past authGuard, exactly as on a cold deep link.
    await router.navigateByUrl('/tw/account');
    expect(router.url).toBe('/tw/account');

    await settle();
    httpMock.expectOne('/auth/me/').flush({ detail: 'expired' }, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(store.isAuthenticated()).toBe(false);
    expect(router.url).toBe('/tw/login?returnUrl=%2Ftw%2Faccount');
  });

  it('waits for a deep link that already passed its guard, then sends it to sign in', async () => {
    // A bookmarked /account opened with expired tokens: authGuard admits it on
    // the stale token, and the page's chunk is still downloading when the
    // backend refuses the session. routerState at that moment is the router's
    // empty initial state, so deciding then would find nothing to leave.
    localStorage.setItem('access_token', 'stale');
    localStorage.setItem('refresh_token', 'stale-refresh');
    const store = build();

    const navigation = router.navigateByUrl('/tw/slow-account');
    await settle();
    expect(router.currentNavigation()).not.toBeNull();

    httpMock.expectOne('/auth/me/').flush({ detail: 'expired' }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    expect(store.isAuthenticated()).toBe(false);

    slowAccount.release();
    await navigation;
    await settle();
    await settle();

    expect(router.url).toBe('/tw/login?returnUrl=%2Ftw%2Fslow-account');
  });

  it('lets a visitor leaving a protected page for a public one arrive there', async () => {
    localStorage.setItem('access_token', 'live');
    localStorage.setItem('refresh_token', 'live-refresh');
    const store = build();

    await router.navigateByUrl('/tw/account');
    await settle();
    httpMock.expectOne('/auth/me/').flush({ id: 1, email: 'a@b.c' });

    // Mid-navigation, routerState still says /tw/account. Deciding from that
    // would pull the visitor back to /login away from the page they chose.
    const navigation = router.navigateByUrl('/tw/slow-public');
    await settle();
    store.endSession();

    slowPublic.release();
    await navigation;
    await settle();
    await settle();

    expect(store.isAuthenticated()).toBe(false);
    expect(router.url).toBe('/tw/slow-public');
  });

  it('logout() lands on the sign-in page wherever it was called from', async () => {
    localStorage.setItem('access_token', 'live');
    localStorage.setItem('refresh_token', 'live-refresh');
    const store = build();

    await router.navigateByUrl('/tw');
    await settle();
    httpMock.expectOne('/auth/me/').flush({ id: 1, email: 'a@b.c' });

    store.logout().subscribe();
    httpMock.expectOne('/auth/logout/').flush({});
    await settle();

    expect(store.isAuthenticated()).toBe(false);
    expect(router.url).toBe('/tw/login');
  });

  it('logout() still lands there when the server refuses to revoke the token', async () => {
    localStorage.setItem('access_token', 'live');
    localStorage.setItem('refresh_token', 'live-refresh');
    const store = build();

    await router.navigateByUrl('/tw');
    await settle();
    httpMock.expectOne('/auth/me/').flush({ id: 1, email: 'a@b.c' });

    store.logout().subscribe();
    httpMock.expectOne('/auth/logout/').flush({}, { status: 500, statusText: 'Server Error' });
    await settle();

    expect(router.url).toBe('/tw/login');
  });

  it('decides after a redirecting navigation lands, not when it is cancelled for the redirect', async () => {
    // A guard redirect emits NavigationCancel and then starts a second
    // navigation. Deciding at the cancel would read /tw/account and pull the
    // visitor to /login away from the public page the redirect is taking them to.
    const store = await signedInOnAccount();

    const navigation = router.navigateByUrl('/tw/held');
    await settle();
    store.endSession();
    heldGuard.release('redirect-home');
    await navigation;
    for (let i = 0; i < 4; i++) await settle();

    expect(router.url).toBe('/tw');
  });

  it('still decides when the pending navigation is cancelled', async () => {
    const store = await signedInOnAccount();

    const navigation = router.navigateByUrl('/tw/held');
    await settle();
    store.endSession();
    heldGuard.release(false);
    await navigation;
    await settle();
    await settle();

    // The cancelled navigation left them where they were, which they can no
    // longer see.
    expect(router.url).toBe('/tw/login?returnUrl=%2Ftw%2Faccount');
  });

  it('still decides when the pending navigation errors', async () => {
    const store = await signedInOnAccount();

    const navigation = router.navigateByUrl('/tw/broken').catch(() => false);
    await settle();
    store.endSession();
    brokenChunk.fail();
    await navigation;
    await settle();
    await settle();

    expect(router.url).toBe('/tw/login?returnUrl=%2Ftw%2Faccount');
  });

  it('replaces the history entry, so Back does not return to the lost page', async () => {
    const store = await signedInOnAccount();
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl');

    store.endSession();
    await settle();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith(expect.anything(), { replaceUrl: true });
  });

  it('makes one decision when the session is ended several times during one navigation', async () => {
    localStorage.setItem('access_token', 'live');
    localStorage.setItem('refresh_token', 'live-refresh');
    const store = build();

    const navigation = router.navigateByUrl('/tw/slow-account');
    await settle();
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl');
    store.endSession();
    store.endSession();
    store.endSession();

    slowAccount.release();
    await navigation;
    await settle();
    await settle();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/tw/login?returnUrl=%2Ftw%2Fslow-account');
    httpMock.match(() => true).forEach(req => req.flush({}));
  });

  it('leaves the visitor alone if they signed back in while the navigation was pending', async () => {
    localStorage.setItem('access_token', 'live');
    localStorage.setItem('refresh_token', 'live-refresh');
    const store = build();

    const navigation = router.navigateByUrl('/tw/slow-account');
    await settle();
    store.endSession();
    store.setAuth({ access: 'fresh', refresh: 'fresh-refresh' });

    slowAccount.release();
    await navigation;
    await settle();
    await settle();

    expect(router.url).toBe('/tw/slow-account');
    httpMock.match(() => true).forEach(req => req.flush({ id: 1, email: 'a@b.c' }));
  });

  it('follows a sign-out in another tab off a protected page', async () => {
    const store = await signedInOnAccount();

    // The other tab removed the tokens; this tab only hears the storage event.
    // Earlier tests in this file built stores of their own: if any still
    // listened, this dispatch would reach a destroyed injector (NG0205).
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.dispatchEvent(new StorageEvent('storage', { key: 'access_token' }));
    await settle();

    expect(store.isAuthenticated()).toBe(false);
    expect(router.url).toBe('/tw/login?returnUrl=%2Ftw%2Faccount');
  });

  it('stops listening for other tabs once its injector is destroyed', async () => {
    const store = await signedInOnAccount();
    const endSession = vi.spyOn(store, 'endSession');

    TestBed.resetTestingModule();
    localStorage.removeItem('access_token');
    window.dispatchEvent(new StorageEvent('storage', { key: 'access_token' }));

    // A store left listening would act on a destroyed injector (NG0205).
    expect(endSession).not.toHaveBeenCalled();
  });

  it('does not bring the user back when their profile lands after they signed out', async () => {
    localStorage.setItem('access_token', 'live');     // no refresh token: logout() signs out locally
    const store = build();
    await router.navigateByUrl('/tw');
    await settle();
    const bootstrapProfile = httpMock.expectOne('/auth/me/');

    store.logout().subscribe();
    await settle();
    bootstrapProfile.flush({ id: 1, email: 'a@b.c' });

    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
  });
});

/**
 * A session can be intact while its profile failed to load — a cold serverless
 * start failing the first /auth/me/ (or the refresh behind it). Without the
 * profile the header has no name and staff have no admin link, which reads as
 * signed out until the page is reloaded.
 */
describe('AuthStore profile after a transient failure', () => {
  @Component({ standalone: true, template: 'stub' })
  class StubPage {}

  let httpMock: HttpTestingController;
  let router: Router;
  let store: AuthStore;
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const profileRequests = () => httpMock.match('/auth/me/');
  const unavailable = { status: 503, statusText: 'Service Unavailable' };

  /** Signed in with a live token, bootstrap /auth/me/ in the air, fake timers on. */
  async function signedInWithProfileOut() {
    localStorage.setItem('access_token', 'live');
    localStorage.setItem('refresh_token', 'live-refresh');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        provideRouter([{ path: 'tw', children: [{ path: '', component: StubPage }, { path: 'search', component: StubPage }] }]),
        RegionLinkService,
        { provide: RegionService, useValue: { region: signal('tw') } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(AuthStore);
    await router.navigateByUrl('/tw');
    await settle();
    vi.useFakeTimers();
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('fetches the profile again on its own after a transient failure', async () => {
    await signedInWithProfileOut();

    const [first] = profileRequests();
    first.flush({}, unavailable);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.user()).toBeNull();

    // Nobody clicks anything.
    await vi.advanceTimersByTimeAsync(3000);
    const [second] = profileRequests();
    second.flush({ id: 1, email: 'staff@x.y', is_staff: true });

    expect(store.user()?.is_staff).toBe(true);
  });

  it('keeps trying on a backing-off schedule, then stops', async () => {
    await signedInWithProfileOut();
    profileRequests()[0].flush({}, unavailable);

    let attempts = 0;
    for (let second = 0; second < 120; second++) {
      await vi.advanceTimersByTimeAsync(1000);
      for (const req of profileRequests()) {
        attempts++;
        req.flush({}, unavailable);
      }
    }

    expect(attempts).toBe(3);
  });

  it('tries again when the visitor navigates, even after the schedule has run out', async () => {
    await signedInWithProfileOut();
    profileRequests()[0].flush({}, unavailable);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      profileRequests().forEach(req => req.flush({}, unavailable));
    }
    expect(profileRequests()).toEqual([]);

    await router.navigateByUrl('/tw/search');
    await vi.advanceTimersByTimeAsync(0);

    const retried = profileRequests();
    expect(retried.length).toBe(1);
    retried[0].flush({ id: 1, email: 'a@b.c' });
    expect(store.user()).not.toBeNull();
  });

  it('tries again when the visitor comes back to the tab', async () => {
    await signedInWithProfileOut();
    profileRequests()[0].flush({}, unavailable);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(profileRequests().length).toBe(1);
  });

  it('does not stack a second request while one is already out', async () => {
    await signedInWithProfileOut();

    // Bootstrap request still pending; a navigation asks for the profile too.
    await router.navigateByUrl('/tw/search');
    await vi.advanceTimersByTimeAsync(0);

    expect(profileRequests().length).toBe(1);
  });

  it('does not retry an answer that will not change by waiting', async () => {
    await signedInWithProfileOut();
    profileRequests()[0].flush({}, { status: 404, statusText: 'Not Found' });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(profileRequests()).toEqual([]);
  });

  it('gives the next session a full retry schedule of its own', async () => {
    await signedInWithProfileOut();
    // First session: fail, then fail its first scheduled retry as well, so it
    // is two steps into its schedule when it ends.
    profileRequests()[0].flush({}, unavailable);
    await vi.advanceTimersByTimeAsync(3000);
    profileRequests()[0].flush({}, unavailable);

    store.logout().subscribe();
    httpMock.match(() => true).forEach(req => req.flush({}));

    // Signed straight back in; its profile fails too.
    store.setAuth({ access: 'fresh', refresh: 'fresh-refresh' });
    profileRequests()[0].flush({}, unavailable);

    let attempts = 0;
    for (let second = 0; second < 120; second++) {
      await vi.advanceTimersByTimeAsync(1000);
      for (const req of profileRequests()) {
        attempts++;
        req.flush({}, unavailable);
      }
    }

    expect(attempts).toBe(3);
  });

  it('stops retrying once the visitor signs out', async () => {
    await signedInWithProfileOut();
    profileRequests()[0].flush({}, unavailable);

    store.logout().subscribe();
    httpMock.match(() => true).forEach(req => req.flush({}));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(profileRequests()).toEqual([]);
  });
});

