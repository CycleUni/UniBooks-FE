import { RegionLinkDirective } from '../../core/region-link.directive';
import { Component, inject, effect, ChangeDetectorRef, ElementRef, NgZone, AfterViewInit, OnDestroy, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiButton } from '../../shared/ui/button.component';

import { AuthStore } from '../../core/auth.store';
import { AccountService } from '../../core/services/account.service';
import { OrderService } from '../../core/services/order.service';
import { I18nService, TPipe } from '../../core/i18n.service';

import { RouterModule } from '@angular/router';
import { scrollBehavior } from '../../core/reduced-motion';

/** The signed-in dashboard. It used to double as the login wall on the same
 *  URL; that half now lives at /login and /register, and the route's authGuard
 *  means everything below can assume there is a user. */
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [RegionLinkDirective, CommonModule, RouterModule, UiButton, TPipe],
  templateUrl: './account.html',
  styleUrls: ['./account.css']
})
export class Account implements AfterViewInit, OnDestroy {
  activeTab = 'listings';
  hasUnreadOrders = false;

  firstName = '';
  lastName = '';
  displayName = '';
  eduEmail = '';
  schoolName = '';
  verifiedAt: string | null = null;
  avatarUrl = '';
  showConfirmUnbindModal = false;

  // Profile-card stats line — sourced from the same /auth/me/ payload
  // loadProfile() already fetches, so these reflect real counts rather
  // than invented placeholders. Listing counts are derived from the
  // (paginated, first-page) `myListings.results` status field, so they
  // may undercount for accounts with 20+ listings; subscription count
  // comes from the unpaginated `mySubscriptions` list and is exact.
  activeListingsCount = 0;
  soldListingsCount = 0;
  subscriptionsCount = 0;

  private accountService = inject(AccountService);
  private orderService = inject(OrderService);
  private cdr = inject(ChangeDetectorRef);
  private i18n = inject(I18nService);
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private zone = inject(NgZone);
  private stopWatchingNav?: () => void;

  /**
   * On a phone the tabs are one scrolling row, so the one you are on can start
   * outside the viewport — land on Account settings and the strip shows the
   * first two tabs and no sign of where you are. Bring it into view.
   *
   * Nearest, not start: it moves only when the tab is actually off-screen, so
   * arriving on the first tab does not shift a strip that was already correct.
   */
  ngAfterViewInit(): void {
    const nav = this.host.nativeElement.querySelector<HTMLElement>('.dashboard-nav');
    const active = nav?.querySelector<HTMLElement>('a.active');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() });
    if (nav) {
      this.watchNavOverflow(nav);
    }
  }

  ngOnDestroy(): void {
    this.stopWatchingNav?.();
  }

  /**
   * Drives the fades at the two ends of the tab strip. Each says "there is
   * more this way" and nothing else, so each is on only while its own side is
   * genuinely hiding something — neither at the end of the travel it belongs
   * to, and neither at the widths where the tabs fit outright.
   *
   * Measured rather than expressed in CSS because no selector can ask whether
   * an element overflows. Outside the zone and touching only classList: this
   * runs on every scroll frame, and a change detection pass per frame would
   * cost the page far more than the fades are worth.
   *
   * The 1px slack absorbs the fractional scrollLeft a zoomed or scaled
   * viewport produces, which would otherwise leave a fade on at rest.
   */
  private watchNavOverflow(nav: HTMLElement): void {
    const sync = () => {
      const remaining = nav.scrollWidth - nav.clientWidth - nav.scrollLeft;
      nav.classList.toggle('has-more', remaining > 1);
      nav.classList.toggle('has-previous', nav.scrollLeft > 1);
    };
    this.zone.runOutsideAngular(() => {
      nav.addEventListener('scroll', sync, { passive: true });
      const observer = new ResizeObserver(sync);
      observer.observe(nav);
      sync();
      this.stopWatchingNav = () => {
        nav.removeEventListener('scroll', sync);
        observer.disconnect();
      };
    });
  }

  constructor(public auth: AuthStore) {
    // Reload the profile when the language changes so localized fields
    // (e.g. the school name) come back in the new language
    // untracked: loadProfile reads AccountService's profile signals, and a
    // tracked read made every loading/cached change re-run this effect — each
    // run fetching the whole order list again for the unread dot.
    effect(() => {
      this.i18n.lang();
      untracked(() => this.loadProfile());
    });

    this.orderService.unreadOrders$.subscribe(unread => {
      this.hasUnreadOrders = unread;
      this.cdr.markForCheck();
    });
  }

  getAvatarInitial(): string {
    const last = this.lastName || '';
    const first = this.firstName || '';
    if (/[A-Za-z]/.test(last) || /[A-Za-z]/.test(first)) {
      return (first.charAt(0) || last.charAt(0) || this.i18n.t('acct.avatarFallback')).toUpperCase();
    }
    return (last.charAt(0) || first.charAt(0) || this.i18n.t('acct.avatarFallback')).toUpperCase();
  }

  doLogout() {
    this.auth.logout().subscribe();
  }

  confirmUnbindEduEmail() {
    this.showConfirmUnbindModal = true;
  }

  loadProfile() {
    this.accountService.getMyProfile().subscribe({
      next: (data) => {
        this.firstName = data.first_name || '';
        this.lastName = data.last_name || '';
        this.displayName = data.display_name || '';
        this.eduEmail = data.edu_email || '';
        this.schoolName = data.school_name || '';
        this.verifiedAt = data.verified_at || null;
        this.avatarUrl = data.avatar_url || '';
        const counts = data.myListingCounts;
        const listingResults = data.myListings?.results || [];
        this.activeListingsCount = counts?.active ?? listingResults.filter((l: any) => l.status === 'active').length;
        this.soldListingsCount = counts?.sold ?? listingResults.filter((l: any) => l.status === 'sold').length;
        this.subscriptionsCount = (data.mySubscriptions || []).length;
        this.orderService.checkUnreadOrders(String(data.id), data.last_seen_bought_orders_at, data.last_seen_sold_orders_at);
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load profile', err);
        this.cdr.markForCheck();
      }
    });
  }
}
