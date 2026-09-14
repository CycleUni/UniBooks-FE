import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import {
  HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse,
  HttpBackend, HttpClient, HttpContextToken
} from '@angular/common/http';

/** Set on public endpoints (AllowAny views) so the interceptor does NOT attach
 * the Bearer token. An expired/invalid token causes SimpleJWT to raise
 * AuthenticationFailed before DRF checks permission_classes, so AllowAny views
 * would return 401 instead of serving data anonymously. */
export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);
import { Observable, throwError, of, timer } from 'rxjs';
import { catchError, switchMap, map, finalize, shareReplay, retry } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';
import { AuthStore } from './auth.store';
import { environment } from '../../environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  // In-flight refresh request; concurrent 401s within this tab share the same
  // observable so the one-time-use refresh token is not sent to /auth/refresh/ twice
  private refreshInProgress$: Observable<string> | null = null;

  // Use HttpBackend directly for the token-refresh flow so we don't create a
  // circular dependency: AuthInterceptor → HttpClient → HTTP_INTERCEPTORS → AuthInterceptor.
  // HttpBackend is the raw XHR/fetch layer; it skips the entire interceptor chain.
  private http: HttpClient;

  /** Deduplicate the /auth/refresh/ call (one-time-use refresh token). */
  private readonly refreshBackendUrl = `${environment.backendUrl}/auth/refresh/`;

  constructor(
    private authStore: AuthStore,
    backend: HttpBackend,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.http = new HttpClient(backend);
  }

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Requests to other origins (e.g. CFEdgeChat) carry their own,
    // separately-scoped bearer token set by the caller — attaching or
    // refreshing the Django JWT for them would just clobber it.
    if (!request.url.startsWith(environment.backendUrl)) {
      return next.handle(request);
    }

    const isAuthEndpoint = this.isAuthEndpoint(request.url);

    const skipAuth = request.context.get(SKIP_AUTH);
    if (isPlatformBrowser(this.platformId) && !isAuthEndpoint && !skipAuth) {
      const token = this.authStore.getAccessToken();
      if (token) {
        request = this.addToken(request, token);
      }
    }

    const shouldHandle401 = !isAuthEndpoint && !skipAuth;

    return next.handle(request).pipe(
      catchError(error => {
        if (
          error instanceof HttpErrorResponse &&
          error.status === 401 &&
          shouldHandle401 &&
          isPlatformBrowser(this.platformId)
        ) {
          return this.handle401Error(request, next);
        }
        return throwError(() => error);
      })
    );
  }

  private isAuthEndpoint(url: string): boolean {
    return url.includes('/auth/token/') ||
           url.includes('/auth/register/') ||
           url.includes('/auth/refresh/');
  }

  private addToken(request: HttpRequest<any>, token: string) {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  private handle401Error(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Another tab may have already rotated the tokens: if the access token in
    // localStorage differs from the one this request used, retry with the new
    // token instead of refreshing again
    const usedToken = request.headers.get('Authorization')?.replace('Bearer ', '') ?? null;
    const currentToken = this.authStore.getAccessToken();
    if (currentToken && currentToken !== usedToken) {
      return next.handle(this.addToken(request, currentToken)).pipe(
        catchError(err => {
          if (err instanceof HttpErrorResponse && err.status === 401) {
            return this.refreshAndRetry(request, next);
          }
          return throwError(() => err);
        })
      );
    }

    return this.refreshAndRetry(request, next);
  }

  private refreshAndRetry(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return this.refreshAccessToken().pipe(
      switchMap(access => next.handle(this.addToken(request, access))),
      catchError(err => {
        // Refresh definitively failed and local auth was cleared (e.g. stale
        // tokens for a deleted account): retry once anonymously so public
        // endpoints keep working instead of dying with the bad token.
        // Only when there WAS a token to strip — a request that went out
        // anonymous and got a 401 would just be sent again, byte for byte,
        // to be refused again.
        if (
          err instanceof HttpErrorResponse &&
          (err.status === 401 || err.status === 403) &&
          !this.authStore.getAccessToken() &&
          request.headers.has('Authorization')
        ) {
          return next.handle(request.clone({ headers: request.headers.delete('Authorization') }));
        }
        return throwError(() => err);
      })
    );
  }

  private refreshAccessToken(): Observable<string> {
    if (!this.refreshInProgress$) {
      const refreshToken = this.authStore.getRefreshToken();
      if (!refreshToken) {
        this.authStore.endSession();
        // An HttpErrorResponse, not a bare Error: refreshAndRetry's fallback
        // below tests `instanceof HttpErrorResponse`, so a bare Error skipped
        // the anonymous retry entirely and the request died with an error
        // object none of the app's error formatters can read. That was masked
        // for as long as clearAuth() navigated away from the page.
        return throwError(() => new HttpErrorResponse({
          status: 401,
          statusText: 'Unauthorized',
          error: { detail: 'No refresh token available' }
        }));
      }

      this.refreshInProgress$ = this.http.post<any>(this.refreshBackendUrl, { refresh: refreshToken }).pipe(
        // A refresh that fails for a reason unrelated to the session is retried
        // straight away, not left for "a later request". Two cases matter:
        //  - status 0 / 502 / 504: the response was lost, often after the
        //    server had already rotated the token. The rotated pair is handed
        //    back for the same refresh token only inside the backend's 60s
        //    grace window, so waiting for the visitor's next click would
        //    usually miss it and turn a network blip into a sign-out.
        //  - 503: the backend could not reach its token store, and says so
        //    instead of pretending the token is unknown.
        // The backoff is fixed rather than read from Retry-After: that header
        // is not in the API's CORS expose list, so the browser hides it.
        retry({
          count: AuthInterceptor.REFRESH_RETRY_DELAYS_MS.length,
          delay: (err, attempt) => AuthInterceptor.isTransient(err)
            ? timer(AuthInterceptor.REFRESH_RETRY_DELAYS_MS[attempt - 1])
            : throwError(() => err),
        }),
        map(tokens => {
          this.authStore.setAuth(tokens);
          return tokens.access as string;
        }),
        catchError(err => {
          const isAuthFailure = err instanceof HttpErrorResponse &&
                                (err.status === 401 || err.status === 403);
          if (isAuthFailure) {
            // The refresh token may have been revoked because another tab
            // rotated it first: if that tab already stored new tokens in
            // localStorage, adopt them instead of logging out
            const latestRefresh = this.authStore.getRefreshToken();
            const latestAccess = this.authStore.getAccessToken();
            if (latestRefresh && latestRefresh !== refreshToken && latestAccess) {
              return of(latestAccess);
            }
            this.authStore.endSession();
          }
          // Transient failures (e.g. network errors, status 0) keep the tokens
          // so a later request can trigger another refresh
          return throwError(() => err);
        }),
        finalize(() => {
          this.refreshInProgress$ = null;
        }),
        // refCount: false — with refCount:true, the last subscriber going away
        // (a component torn down by navigation, say) unsubscribes the shared
        // source and ABORTS the in-flight POST /auth/refresh/. The server may
        // already have rotated the token by then, so the next 401 re-sends a
        // refresh token that no longer exists and the visitor is signed out for
        // no reason. Letting the request run to completion costs nothing: the
        // finalize above still clears the field when it settles.
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.refreshInProgress$;
  }

  /** Both well inside the backend's REFRESH_ROTATION_GRACE (60s). */
  private static readonly REFRESH_RETRY_DELAYS_MS = [1000, 2000];

  private static isTransient(err: unknown): boolean {
    return err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 500);
  }
}
