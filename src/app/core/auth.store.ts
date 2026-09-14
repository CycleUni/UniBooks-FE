import { DestroyRef, Injectable, Injector, signal, inject, untracked, runInInjectionContext } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, catchError, filter, take, finalize } from 'rxjs/operators';
import { Observable, of } from 'rxjs';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, Router } from '@angular/router';
import { GoogleAnalyticsService } from './services/google-analytics.service';
import { RegionLinkService } from './region-link.service';
import { isSameRegion } from './region-path';
import { isUserVerifiedIn } from './verification';
import { signedOutRedirectFor } from './signed-out-redirect';
import { isTransientHttpFailure } from './http-failure';

export interface RegionVerification {
  region: string;
  school: any;
  edu_email: string;
  verified_at: string | null;
}

export interface AuthUser {
  id: string | number;
  email: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  is_active?: boolean;
  average_rating?: number;
  review_count?: number;
  no_show_count?: number;
  has_password?: boolean;
  avatar_url?: string;
  is_google_linked?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  verifications?: RegionVerification[];
  /** The language the site was last used in, as last reported. */
  site_language?: string;
  [key: string]: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class AuthStore {
  private readonly _isAuthenticated = signal<boolean>(false);
  private readonly _user = signal<AuthUser | null>(null);

  readonly isAuthenticated = this._isAuthenticated.asReadonly();
  readonly user = this._user.asReadonly();

  updateUser(updateFn: (user: AuthUser) => AuthUser) {
    this._user.update(u => u ? updateFn(u) : null);
  }

  private fetchedForToken: string | null = null;

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const token = localStorage.getItem('access_token');
      if (token) {
        this._isAuthenticated.set(true);
        // Bootstrap: fetch profile once when the page initialises with a
        // persisted token. Deferred via setTimeout to break the construction
        // cycle — AuthStore → HttpClient → HTTP_INTERCEPTORS → AuthInterceptor
        // → AuthStore. Waiting one microtask lets all providers finish.
        // Wrapped in runInInjectionContext: this fires as an independent
        // macrotask that can land in the same browser task turn as the
        // router's initial (possibly lazy-loaded) route resolution, and
        // without an explicit context the nested first-time DI resolution
        // inside fetchUserProfile() (HttpClient + interceptors) can race
        // Angular's internal "current injector" tracking and throw NG0203.
        setTimeout(() => runInInjectionContext(this.injector, () => untracked(() => this.fetchUserProfile())), 0);
      }
    }

    if (typeof window !== 'undefined') {
      const onStorage = (e: StorageEvent) => {
        if (e.key === 'access_token' || e.key === null) {
          const token = this.getAccessToken();
          if (!token) {
            // Another tab signed out. Route it through the same handling as an
            // expiry in this tab, so this branch stops skipping the GA identity
            // clear and stops stranding this tab on a page it can no longer see.
            this.endSession();
            return;
          }
          this._isAuthenticated.set(true);
          if (token !== this.fetchedForToken) {
            untracked(() => this.fetchUserProfile());
          }
        }
      };
      window.addEventListener('storage', onStorage);

      // A profile that failed to load for a reason unrelated to the session
      // gets another chance whenever the visitor does something: moves to
      // another page, or comes back to the tab. See retryProfileIfMissing.
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          this.retryProfileIfMissing();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      const navigations = this.router.events
        .pipe(filter(e => e instanceof NavigationEnd))
        .subscribe(() => this.retryProfileIfMissing());

      // Removed with the injector. A root service outlives nothing in the app,
      // but a destroyed store still listening would act on a dead injector
      // (NG0205) the next time another tab touches the tokens.
      inject(DestroyRef).onDestroy(() => {
        window.removeEventListener('storage', onStorage);
        document.removeEventListener('visibilitychange', onVisible);
        navigations.unsubscribe();
        this.cancelProfileRetry();
      });
    }
  }

  /**
   * Best-effort profile fetch.  Idempotent: if the current access token
   * exactly matches the one we already fetched we skip the call.
   */
  private fetchUserProfile(): void {
    const token = this.getAccessToken();
    if (!token) return;
    if (token === this.fetchedForToken && this._user()) return;

    // One profile request per session at a time. The bootstrap fetch, the
    // first NavigationEnd and a refresh's setAuth() can all ask within the
    // same moment; the request already out will fill in the user for all of
    // them (a 401 on it is refreshed and replayed by the interceptor).
    if (this.profileRequestGeneration === this._sessionGeneration) return;

    this.fetchedForToken = token;

    const generation = this._sessionGeneration;
    this.profileRequestGeneration = generation;
    this.http.get<AuthUser>('/auth/me/').pipe(
      tap(profile => {
        // Signed out while this was in the air (e.g. logout with an expired
        // access token: the refresh fires this fetch, then the retried logout
        // lands first). Writing it would bring back the user it belonged to —
        // in the header, in the admin checks, and as GA's user id.
        if (generation !== this._sessionGeneration) {
          return;
        }
        this.cancelProfileRetry();
        this._user.set(profile);
        // Identify user in GA4 for User Explorer & cross-device reports
        this.ga.setUserId(profile.id);
        this.ga.setUserProperties({
          school: null,
          verified_region_count: profile.verifications ? profile.verifications.filter(v => !!v.verified_at).length : 0,
          role:        null   // enriched later if needed
        });
      }),
      catchError(err => {
        if (err.status === 401) {
          this.endSession();
        } else {
          console.error('Failed to load user profile from /auth/me/', err?.status, err);
          // The session is intact but the profile is missing — which looks
          // exactly like being signed out: no name in the header, no admin
          // link. That used to last until a full reload. On a cold serverless
          // start the first /auth/me/ (and the refresh behind it) can fail
          // while a request seconds later succeeds, so try again on a timer.
          if (isTransientHttpFailure(err)) {
            this.scheduleProfileRetry();
          }
        }
        // Clear dedup flag so a later login/sign-in can retry
        this.fetchedForToken = null;
        return of(null);
      }),
      finalize(() => {
        if (this.profileRequestGeneration === generation) {
          this.profileRequestGeneration = null;
        }
      })
    ).subscribe();
  }

  /** The session generation a /auth/me/ request is out for, or null. */
  private profileRequestGeneration: number | null = null;
  private profileRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private profileRetryIndex = 0;

  /** After a transient failure. Short enough to catch a function warming up,
   *  spaced enough not to hammer a backend that is actually down. Once these
   *  run out, the next navigation or return to the tab tries again. */
  private static readonly PROFILE_RETRY_DELAYS_MS = [3000, 10000, 30000];

  /** Signed in, no profile, nothing already fetching it: fetch it. */
  private retryProfileIfMissing(): void {
    if (!this._isAuthenticated() || this._user()) return;
    untracked(() => this.fetchUserProfile());
  }

  private scheduleProfileRetry(): void {
    if (this.profileRetryTimer !== null) return;
    const delay = AuthStore.PROFILE_RETRY_DELAYS_MS[this.profileRetryIndex];
    if (delay === undefined) return;
    this.profileRetryIndex++;
    this.profileRetryTimer = setTimeout(() => {
      this.profileRetryTimer = null;
      // Same reason as the bootstrap fetch: an independent macrotask doing
      // first-time DI resolution needs an explicit injection context (NG0203).
      runInInjectionContext(this.injector, () => this.retryProfileIfMissing());
    }, delay);
  }

  private cancelProfileRetry(): void {
    if (this.profileRetryTimer !== null) {
      clearTimeout(this.profileRetryTimer);
      this.profileRetryTimer = null;
    }
    this.profileRetryIndex = 0;
  }

  setAuth(data: { access: string; refresh?: string }) {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('access_token', data.access);
        if (data.refresh) {
          localStorage.setItem('refresh_token', data.refresh);
        }
      } catch (err) {
        console.error('Failed to persist auth tokens to localStorage', err);
      }
    }
    this._isAuthenticated.set(true);
    // Fetch the profile immediately (not via an effect) so the UI can show
    // the user name without waiting for a second change-detection cycle.
    untracked(() => this.fetchUserProfile());
  }

  private router = inject(Router);
  // Resolved lazily via the injector below, never with a field-level
  // inject(). AuthStore is constructed by AuthInterceptor, and
  // RegionLinkService → RegionService → HttpClient → HTTP_INTERCEPTORS closes
  // a DI cycle: Angular then fails the entire interceptor chain with NG0200
  // and every API call in the app dies, which surfaces as a bare
  // "An error occurred" on each page. Its only use is inside a navigation
  // handler, long after the injector is built.
  private get regionLink(): RegionLinkService {
    return this.injector.get(RegionLinkService);
  }
  private injector = inject(Injector);
  private ga = inject(GoogleAnalyticsService);

  // Lazy HttpClient: avoids circular dependency with HTTP_INTERCEPTORS.
  // AuthInterceptor → AuthStore → HttpClient → HTTP_INTERCEPTORS → AuthInterceptor
  // would be a cycle if we injected HttpClient directly in the constructor;
  // resolving it lazily via Injector lets all interceptors finish initialising
  // before the first HTTP call actually needs HttpClient.
  private _http: HttpClient | null = null;
  private get http(): HttpClient {
    if (!this._http) {
      this._http = this.injector.get(HttpClient);
    }
    return this._http;
  }

  /**
   * Wipe every trace of the session. Deliberately does NOT navigate — see
   * endSession() for a session that ended on its own, and logout() for one
   * the visitor asked for.
   */
  private clearAuth() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      } catch (err) {
        console.error('Failed to clear auth tokens from localStorage', err);
      }
    }
    this._sessionGeneration++;
    this.cancelProfileRetry();
    this._isAuthenticated.set(false);
    this._user.set(null);
    this.fetchedForToken = null;
    // Clear GA4 user identity on logout
    this.ga.setUserId(null);
    this.ga.clearUserProperties();
  }

  private _sessionGeneration = 0;

  /**
   * Changes, synchronously, every time a session ends. A response that was
   * requested under one generation and lands under another belongs to a
   * session that no longer exists, and must not be written anywhere shared —
   * see AccountService.getMyProfile(). Synchronous on purpose: an effect on
   * isAuthenticated() would run a scheduling step later, which is exactly the
   * window an in-flight response lands in.
   */
  get sessionGeneration(): number {
    return this._sessionGeneration;
  }

  /**
   * The session ended without the visitor asking for it: the access token
   * expired and the refresh was refused, or another tab signed out.
   *
   * Clears the session, then moves the visitor only when they are somewhere a
   * signed-out visitor cannot be. Staying put is the whole point. This used
   * to navigate unconditionally, which threw people off the *public* homepage
   * the moment the background bootstrap GET /auth/me/ failed to refresh a
   * stale token — the page had rendered, and then the backend's answer yanked
   * them to /login for no reason they could see.
   *
   * Where "cannot be" is decided is signed-out-redirect.ts: each guard
   * registers the destination it would itself have chosen, so /account still
   * goes to /login (now carrying a returnUrl, which the old unconditional
   * navigate threw away) and /admin still goes home.
   */
  endSession(): void {
    this.clearAuth();
    // Several requests can fail together on one page load (the bootstrap
    // /auth/me/ and the message hub token, then the anonymous retry of
    // /auth/me/), so this can run several times in a row. That needs no
    // bookkeeping: the first decision that redirects starts a navigation, and
    // every later one waits for it and then finds the visitor already on a page
    // they may see.
    this.afterNavigationSettles(() => this.leaveIfUnwelcome());
  }

  /**
   * "Where is the visitor?" has no answer while a navigation is under way.
   * routerState only advances when a navigation commits, which is after
   * canActivate AND after the lazy chunk has downloaded — every guarded route
   * here is loadComponent. In that window routerState still describes the page
   * being left (or, on a cold deep link, nothing at all), so reading it then
   * gets both directions wrong: a deep link into /account that already passed
   * authGuard on the stale token would be left to activate signed-out, and a
   * visitor leaving /account for a public page would be pulled back to /login.
   *
   * So wait for the navigation to finish, and decide against where it landed.
   * The re-check runs a macrotask after the terminal event because the router
   * emits NavigationEnd before clearing currentNavigation, and a guard that
   * redirects starts its follow-up navigation in between.
   */
  private afterNavigationSettles(decide: () => void): void {
    if (!this.router.currentNavigation()) {
      decide();
      return;
    }
    this.router.events.pipe(
      filter(e =>
        e instanceof NavigationEnd ||
        e instanceof NavigationCancel ||
        e instanceof NavigationError ||
        e instanceof NavigationSkipped
      ),
      take(1)
    ).subscribe(() => setTimeout(() => this.afterNavigationSettles(decide), 0));
  }

  private leaveIfUnwelcome(): void {
    // Signed back in while we waited for the navigation: nothing to leave.
    if (this.isAuthenticated()) {
      return;
    }

    const redirect = signedOutRedirectFor(this.router.routerState.snapshot.root);
    if (!redirect) {
      return;
    }

    const returnUrl = this.router.url;
    const target = runInInjectionContext(this.injector, () => redirect(returnUrl));
    // replaceUrl: Back would otherwise land on the page they just lost access
    // to, whose guard immediately bounces them out again.
    this.router.navigateByUrl(target, { replaceUrl: true });
  }

  getAccessToken(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('access_token');
    }
    return null;
  }

  getRefreshToken(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('refresh_token');
    }
    return null;
  }

  isVerifiedIn(regionCode: string): boolean {
    return isUserVerifiedIn(this.user()?.verifications, regionCode);
  }

  isLoggedIn() {
    return this.isAuthenticated();
  }

  getUser() {
    return this.user();
  }

  login(email: string, password: string): Observable<any> {
    return this.http.post<any>('/auth/token/', { email, password }).pipe(
      tap(response => {
        if (response.access && response.refresh) {
          this.setAuth(response);
          this.ga.trackLogin('Password');
        }
      })
    );
  }

  getAuthConfig(): Observable<any> {
    return this.http.get<any>('/auth/config/');
  }

  loginWithGoogle(credential: string): Observable<any> {
    return this.http.post<any>('/auth/google/', { credential }).pipe(
      tap(response => {
        if (response.access && response.refresh) {
          this.setAuth(response);
          this.ga.trackLogin('Google');
        }
      })
    );
  }

  register(email: string, password: string, firstName: string, lastName: string): Observable<any> {
    return this.http.post<any>('/auth/register/', {
      email,
      password,
      first_name: firstName,
      last_name: lastName
    }).pipe(
      tap(() => {
        this.ga.trackSignUp('Email');
      })
    );
  }

  requestEduVerification(eduEmail: string): Observable<any> {
    return this.http.post<any>('/auth/verify/request/', { edu_email: eduEmail }).pipe(
      tap(() => {
        this.ga.trackEduVerificationRequest();
      })
    );
  }

  verifyEmail(token: string): Observable<any> {
    return this.http.post<any>('/auth/verify/', { token });
  }

  verifyRegistration(token: string): Observable<any> {
    return this.http.post<any>('/auth/verify-registration/', { token }).pipe(
      tap(response => {
        if (response.access && response.refresh) {
          this.setAuth(response);
          this.ga.trackEvent('sign_up_verified');
        }
      })
    );
  }

  requestPasswordReset(email: string): Observable<any> {
    return this.http.post<any>('/auth/password/reset/request/', { email });
  }

  confirmPasswordReset(token: string, newPassword: string): Observable<any> {
    return this.http.post<any>('/auth/password/reset/confirm/', { token, new_password: newPassword });
  }

  logout(): Observable<any> {
    const refresh = this.getRefreshToken();
    if (refresh) {
      return this.http.post('/auth/logout/', { refresh }).pipe(
        tap({
          next: () => this.signOut(),
          error: () => this.signOut()
        }),
        catchError(() => of(null))
      );
    }
    this.signOut();
    return of(null);
  }

  /** Signing out is a deliberate act, so it always lands on the sign-in page —
   *  the same place the old /account login wall put them — whether or not the
   *  page they were on was one they could have stayed on. */
  private signOut(): void {
    this.clearAuth();
    this.router.navigate(this.regionLink.path(['/login']));
  }
}