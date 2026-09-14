import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient, HttpParams, HttpContext } from '@angular/common/http';
import { Observable, shareReplay, tap, catchError, throwError } from 'rxjs';
import { I18nService } from '../i18n.service';
import { Lang } from '../i18n';
import { AuthStore } from '../auth.store';
import { SKIP_AUTH } from '../auth.interceptor';
import { isSameRegion } from '../region-path';
export interface ChatReportItem {
  id: string;
  conversation?: {
    id: string;
    listing_title?: string;
  };
  reporter?: {
    id: string;
    email: string;
  };
  reported_party?: {
    id: string;
    email: string;
  };
  reason: string;
  detail?: string;
  flagged_message_ids?: string[];
  status: 'open' | 'actioned' | 'dismissed';
  created_at: string;
}

export interface ListingReportItem {
  id: string;
  listing?: {
    id: string;
    title?: string;
  };
  reporter?: {
    id: string;
    email: string;
  };
  reason: string;
  detail?: string;
  status: 'open' | 'actioned' | 'dismissed';
  created_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** 'auto' follows the language the site was last used in. */
export type EmailLanguage = 'auto' | Lang;

/** The account page's Notifications section. */
export interface NotificationSettings {
  /** Email about a chat message that arrives while not on the site. */
  new_message_email: boolean;
  /** The one language notification emails are written in. */
  email_language: EmailLanguage;
  /** Read-only: the site language 'auto' currently resolves to. */
  site_language: string;
}

export interface UserProfile {
  id: string | number;
  email: string;
  edu_email?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  school?: string | number | null;
  school_name?: string;
  is_active?: boolean;
  verified_at?: string | null;
  average_rating?: number;
  review_count?: number;
  no_show_count?: number;
  has_password?: boolean;
  avatar_url?: string;
  is_google_linked?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  last_seen_bought_orders_at?: string | null;
  last_seen_sold_orders_at?: string | null;
  [key: string]: unknown;
}

/**
 * AccountService — thin wrapper over /auth/me/ and related endpoints.
 *
 * The canonical "logged-in user" state is now owned by AuthStore.user
 * (auto-fetched on every login and on bootstrap when a persisted token
 * exists). This service still exposes getMyProfile() for components that
 * need the latest profile at a specific moment, but its cache acts only as
 * a short-lived deduplication layer, not the primary source of truth.
 */
@Injectable({
  providedIn: 'root'
})
export class AccountService {
  private http = inject(HttpClient);

  // Lightweight dedup cache: holds the last successful /auth/me/ response
  // for the current login session so multiple concurrent consumers don't
  // each fire separate requests. Cleared on language switch.
  readonly profileCache = signal<UserProfile | null>(null);
  private profileLoading = signal(false);
  private profileRequest: Observable<UserProfile> | null = null;
  private cacheTimestamp = 0;
  private static readonly PROFILE_CACHE_TTL = 60_000; // 60 秒
  private i18n = inject(I18nService);

  private authStore = inject(AuthStore);

  constructor() {
    // The AuthStore now manages the lifecycle of /auth/me/ — it fetches on
    // bootstrap (if a token exists) and on every login. That value flows
    // into AuthStore.user. This service's cache merely mirrors it for
    // compatibility with existing components that read profileCache().
    // We keep this function as a convenience; calling getMyProfile() when
    // AuthStore.user already has data will return the cached copy.

    // Drop the cache when the session ends. It is keyed to nothing but "the
    // current login", and adminGuard/superuserGuard read profileCache()
    // directly with no TTL check (the 60s TTL lives inside getMyProfile only) —
    // so a cache surviving into the next sign-in would judge a different user
    // on the previous one's is_staff / is_superuser. This clears what is
    // already cached; a response still in flight at sign-out is dropped by the
    // session-generation check in getMyProfile(), which this effect alone
    // could not catch.
    effect(() => {
      if (!this.authStore.isAuthenticated()) {
        this.clearProfileCache();
      }
    });

    // Tell the backend which language the site is being used in, so the
    // notification emails it sends on its own (a chat message while away, a
    // book request listed overnight) can follow it. Only when it differs
    // from what the profile says: a page load in an unchanged language sends
    // nothing, while switching language, or signing in on a device set to
    // another one, is reported once.
    effect(() => {
      const lang = this.i18n.lang();
      const user = this.authStore.user();
      if (!user || user.site_language === lang) return;
      const reporting = `${user.id}:${lang}`;
      if (this.siteLanguageReported === reporting) return;
      this.siteLanguageReported = reporting;
      untracked(() => this.http.put('/auth/me/site-language/', { language: lang }).subscribe({
        next: () => this.authStore.updateUser(u => ({ ...u, site_language: lang })),
        // Best effort; the next page load or language change tries again.
        error: () => {
          if (this.siteLanguageReported === reporting) this.siteLanguageReported = null;
        },
      }));
    });
  }

  private siteLanguageReported: string | null = null;

  getMyProfile(page: number = 1, q: string = ''): Observable<any> {
    // For backwards-compat callers that still use this directly,
    // leave the existing logic intact but always call /auth/me/
    const cached = this.profileCache();
    const cacheValid = cached
      && page === 1
      && !q
      && (Date.now() - this.cacheTimestamp) < AccountService.PROFILE_CACHE_TTL;
    if (cacheValid) {
      return new Observable(subscriber => {
        subscriber.next(cached);
        subscriber.complete();
      });
    }

    if (this.profileLoading() && this.profileRequest && page === 1 && !q) {
      return this.profileRequest;
    }

    if (!q) this.profileLoading.set(true);
    let params = new HttpParams().set('page', page.toString());
    if (q) {
      params = params.set('q', q);
    }
    // Two separate questions when a response lands, answered separately:
    //  - May it fill the cache? Only if the session that asked for it still
    //    exists. Otherwise it re-fills the cache a sign-out just cleared.
    //  - May it release the flight-lock? Only if the lock is still its own.
    //    A newer request may hold it by now, and must not be clobbered; but a
    //    request whose session ended while it was out must still let go, or
    //    every later call replays it forever. That is not hypothetical: a
    //    request that 401s while signed out ends the session itself (the
    //    interceptor has no refresh token to try), which moves the generation
    //    with no signed-in -> signed-out change for the effect above to see.
    const generation = this.authStore.sessionGeneration;
    const stillCurrent = () => generation === this.authStore.sessionGeneration;
    const ownsLock = () => this.profileRequest === req;
    const req: Observable<any> = this.http.get<any>('/auth/me/', { params }).pipe(
      tap(profile => {
        if (page !== 1 || q) return;
        if (stillCurrent()) {
          this.profileCache.set(profile);
          this.cacheTimestamp = Date.now();
        }
        if (ownsLock()) {
          this.profileLoading.set(false);
          this.profileRequest = null;
        }
      }),
      catchError(err => {
        // Reset flight-lock and cache on error so the next call retries
        // instead of re-subscribing to the same failed Observable forever.
        if (page === 1 && !q && ownsLock()) {
          this.profileLoading.set(false);
          this.profileRequest = null;
          this.cacheTimestamp = 0;
        }
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    if (!q) this.profileRequest = req;
    return req;
  }

  getNotificationSettings(): Observable<NotificationSettings> {
    return this.http.get<NotificationSettings>('/auth/me/notifications/');
  }

  updateNotificationSettings(changes: Partial<NotificationSettings>): Observable<NotificationSettings> {
    return this.http.patch<NotificationSettings>('/auth/me/notifications/', changes);
  }

  clearProfileCache() {
    this.profileCache.set(null);
    this.profileLoading.set(false);
    this.profileRequest = null;
    this.cacheTimestamp = 0;
  }

  updateProfile(data: { first_name?: string, last_name?: string, email?: string, last_seen_bought_orders_at?: string, last_seen_sold_orders_at?: string }): Observable<any> {
    return this.http.patch<any>('/auth/me/', data).pipe(
      tap(profile => {
        // A request to change the sign-in email answers with the pending
        // address instead of the profile, since nothing has changed yet —
        // caching that as the profile would blank the account out.
        if (!profile || profile.id === undefined) return;
        // PATCH answers with the bare user, without the myListings,
        // myListingCounts and mySubscriptions a GET carries. Replacing the
        // cache with it left the account page reading zero listings and
        // requests for the next minute — which the orders tab, marking its
        // orders seen on every visit, did every time it opened.
        const cached = this.profileCache();
        if (!cached) return;
        this.profileCache.set({ ...cached, ...profile });
      })
    );
  }

  /** Apply a pending sign-in-email change. The token comes from the link in
   *  the mail sent to the new address; no session is needed to follow it. */
  confirmEmailChange(token: string): Observable<any> {
    return this.http.post<any>('/auth/email/change/confirm/', { token });
  }

  cancelEmailChange(): Observable<any> {
    return this.http.post<any>('/auth/email/change/cancel/', {});
  }

  changePassword(data: { old_password?: string, new_password?: string }): Observable<any> {
    return this.http.post<any>('/auth/password/', data);
  }

  removePassword(data: { password?: string }): Observable<any> {
    return this.http.post<any>('/auth/password/remove/', data);
  }

  requestEduVerification(eduEmail: string): Observable<any> {
    return this.http.post<any>('/auth/verify/request/', { edu_email: eduEmail });
  }

  autoVerifyEduEmail(): Observable<any> {
    return this.http.post<any>('/auth/verify/auto/', {}).pipe(
      tap(() => this.profileCache.set(null))
    );
  }

  getPublicUserProfile(userId: string): Observable<any> {
    return this.http.get<any>(`/auth/users/${userId}/`, {
      context: new HttpContext().set(SKIP_AUTH, true)
    });
  }

  unbindEduEmail(regionCode: string): Observable<any> {
    return this.http.post<any>('/auth/verify/unbind/', { region: regionCode }).pipe(
      tap(() => {
        this.profileCache.update(p => p ? { ...p, verifications: (p['verifications'] as any[] || []).filter((v: any) => !isSameRegion(v.region, regionCode)) } : null);
        this.authStore.updateUser(u => ({ ...u, verifications: (u.verifications || []).filter((v: any) => !isSameRegion(v.region, regionCode)) }));
      })
    );
  }

  unsubscribe(subscriptionId: string): Observable<any> {
    return this.http.delete(`/subscriptions/${subscriptionId}/`);
  }

  unsubscribeAll(): Observable<any> {
    return this.http.delete('/subscriptions/');
  }

  getMySubscriptions(): Observable<any[]> {
    return this.http.get<any[]>('/subscriptions/');
  }

  getMyListingReports(page: number = 1): Observable<PaginatedResponse<ListingReportItem>> {
    const params = new HttpParams().set('page', page.toString());
    return this.http.get<PaginatedResponse<ListingReportItem>>('/moderation/mine/', { params });
  }

  getMyChatReports(page: number = 1): Observable<PaginatedResponse<ChatReportItem>> {
    const params = new HttpParams().set('page', page.toString());
    return this.http.get<PaginatedResponse<ChatReportItem>>('/moderation/chat-reports/mine/', { params });
  }

  deleteAccount(): Observable<any> {
    return this.http.delete<any>('/auth/me/');
  }
}