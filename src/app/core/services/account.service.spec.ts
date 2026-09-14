import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { AccountService } from './account.service';
import { AuthStore } from '../auth.store';
import { I18nService } from '../i18n.service';
import { RegionLinkService } from '../region-link.service';
import { RegionService } from '../region.service';

/**
 * adminGuard and superuserGuard read profileCache() directly, with no TTL and
 * no identity check. Whatever lands in that cache is therefore trusted as the
 * CURRENT user's is_staff / is_superuser — so a profile belonging to a session
 * that has already ended must never be written there.
 */
describe('AccountService profile cache across sessions', () => {
  let httpMock: HttpTestingController;
  let store: AuthStore;
  let account: AccountService;

  const profileRequests = () =>
    httpMock.match(req => req.url === '/auth/me/' && req.params.get('page') === '1');

  /** Stand-in for a completed sign-in, without the network round trip. */
  const signIn = () => (store as any)._isAuthenticated.set(true);

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        RegionLinkService,
        { provide: RegionService, useValue: { region: signal('tw') } },
        { provide: I18nService, useValue: { lang: () => 'zh-TW' } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
    account = TestBed.inject(AccountService);
  });

  it('clears the cache when the session ends', () => {
    signIn();
    account.getMyProfile().subscribe();
    profileRequests()[0].flush({ id: 1, is_staff: true });
    expect(account.profileCache()).not.toBeNull();

    store.endSession();
    TestBed.tick();

    expect(account.profileCache()).toBeNull();
  });

  it('drops a profile that lands after its session ended', () => {
    signIn();
    account.getMyProfile().subscribe();
    const [inFlight] = profileRequests();

    store.endSession();
    TestBed.tick();
    inFlight.flush({ id: 99, email: 'staff@x.y', is_staff: true, is_superuser: true });

    // The effect cleared the cache before the response arrived; the response
    // must not put the ended session's flags back.
    expect(account.profileCache()).toBeNull();
  });

  it("does not let the old session's response clobber the next session's request", () => {
    signIn();
    account.getMyProfile().subscribe();
    const [staffRequest] = profileRequests();

    store.endSession();
    TestBed.tick();

    // A different, non-staff user signs in on the same tab.
    signIn();
    let nextProfile: any = null;
    account.getMyProfile().subscribe(profile => (nextProfile = profile));
    const [nextRequest] = profileRequests();

    staffRequest.flush({ id: 99, is_staff: true });

    // Still one request in flight, and it is the new session's: a third caller
    // shares it instead of starting another, which it would if the stale
    // response had reset the flight-lock.
    account.getMyProfile().subscribe();
    expect(profileRequests()).toEqual([] as TestRequest[]);
    expect(account.profileCache()).toBeNull();

    nextRequest.flush({ id: 7, is_staff: false });
    expect(nextProfile).toEqual({ id: 7, is_staff: false });
    expect(account.profileCache()).toEqual({ id: 7, is_staff: false });

    httpMock.verify();
  });

  it("does not let the old session's FAILED request reset the next session's lock either", () => {
    signIn();
    account.getMyProfile().subscribe({ error: () => {} });
    const [oldRequest] = profileRequests();

    store.endSession();
    TestBed.tick();

    signIn();
    account.getMyProfile().subscribe();
    const [nextRequest] = profileRequests();

    oldRequest.flush({}, { status: 500, statusText: 'Server Error' });

    account.getMyProfile().subscribe();
    expect(profileRequests()).toEqual([] as TestRequest[]);

    nextRequest.flush({ id: 7, is_staff: false });
    httpMock.verify();
  });

  it('releases the lock of a request that 401s while signed out, so the next sign-in can load', () => {
    // Signed out, something asks for the profile anyway. The 401 finds no
    // refresh token and the interceptor ends the (non-existent) session. That
    // request must still let go of the lock, or after the next sign-in every
    // call replays its dead observable and the cache is never filled.
    //
    // Run the effect's first pass now, as app start-up has long since done in
    // a real tab. Otherwise that first pass lands in the tick() below and
    // clears the lock itself, hiding exactly the bug under test.
    TestBed.tick();
    account.getMyProfile().subscribe({ error: () => {} });
    const [anonymous] = profileRequests();
    store.endSession();
    anonymous.flush({}, { status: 401, statusText: 'Unauthorized' });
    TestBed.tick();

    signIn();
    account.getMyProfile().subscribe();
    const fresh = profileRequests();
    expect(fresh.length).toBe(1);

    fresh[0].flush({ id: 7, is_staff: false });
    expect(account.profileCache()).toEqual({ id: 7, is_staff: false });
    httpMock.verify();
  });
});

/**
 * The backend writes notification emails in the language the site was last
 * used in, so the frontend reports it — once per change, not per page load.
 */
describe('AccountService site language reporting', () => {
  let httpMock: HttpTestingController;
  let store: AuthStore;
  let lang: ReturnType<typeof signal<string>>;
  const reports = () => httpMock.match(req => req.url === '/auth/me/site-language/');

  /** A signed-in visitor whose profile says they last used `siteLanguage`. */
  function signedIn(siteLanguage: string) {
    (store as any)._isAuthenticated.set(true);
    (store as any)._user.set({ id: 1, email: 'a@b.c', site_language: siteLanguage });
    TestBed.tick();
  }

  beforeEach(() => {
    localStorage.clear();
    lang = signal('zh-HK');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        RegionLinkService,
        { provide: RegionService, useValue: { region: signal('tw') } },
        { provide: I18nService, useValue: { lang, t: (k: string) => k } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
    TestBed.inject(AccountService);
    TestBed.tick();
  });

  it('reports the language when the profile says a different one, then stops', () => {
    signedIn('zh-TW');

    const [report] = reports();
    expect(report.request.method).toBe('PUT');
    expect(report.request.body).toEqual({ language: 'zh-HK' });
    report.flush(null, { status: 204, statusText: 'No Content' });
    TestBed.tick();

    expect(store.user()?.site_language).toBe('zh-HK');
    expect(reports()).toEqual([]);
  });

  it('sends nothing when the language has not changed', () => {
    signedIn('zh-HK');
    expect(reports()).toEqual([]);
  });

  it('sends nothing while signed out', () => {
    lang.set('en');
    TestBed.tick();
    expect(reports()).toEqual([]);
  });

  it('reports a language switch', () => {
    signedIn('zh-HK');

    lang.set('en');
    TestBed.tick();

    const [report] = reports();
    expect(report.request.body).toEqual({ language: 'en' });
  });

  it('does not repeat a report that is already on its way', () => {
    signedIn('zh-TW');
    const pending = reports();
    expect(pending.length).toBe(1);

    // Anything else about the profile changes while the report is out.
    store.updateUser(u => ({ ...u, first_name: 'X' }));
    TestBed.tick();

    expect(reports()).toEqual([]);
  });

  it('tries again later when a report fails', () => {
    signedIn('zh-TW');
    reports()[0].flush(null, { status: 503, statusText: 'Service Unavailable' });

    store.updateUser(u => ({ ...u, first_name: 'X' }));
    TestBed.tick();

    const [retry] = reports();
    expect(retry.request.body).toEqual({ language: 'zh-HK' });
  });
});

