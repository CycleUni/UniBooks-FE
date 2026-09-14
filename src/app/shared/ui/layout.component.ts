import { RegionLinkDirective } from '../../core/region-link.directive';
import { stripRegionPrefix, isSameRegion } from '../../core/region-path';
import { Component, effect, inject, ChangeDetectorRef, OnDestroy, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { UiDropdown } from './dropdown.component';
import { UiPrefsSelector } from './prefs-selector.component';
import { RegionService } from '../../core/region.service';
import { MetadataService } from '../../core/services/metadata.service';
import { AuthStore } from '../../core/auth.store';
import { AccountService } from '../../core/services/account.service';
import { SchoolStateService, MANUAL_SCHOOL_KEY } from '../../core/services/school-state.service';
import { MessageService } from '../../core/services/message.service';
import { I18nService, TPipe } from '../../core/i18n.service';
import { Lang } from '../../core/i18n';
import { Subscription } from 'rxjs';
import { ThemeService, ThemeMode } from '../../core/services/theme.service';
import { MobileLayoutService } from '../../core/services/mobile-layout.service';

@Component({
  selector: 'ui-layout',
  standalone: true,
  imports: [RegionLinkDirective, CommonModule, RouterModule, FormsModule, UiDropdown, TPipe, UiPrefsSelector],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css']
})
export class UiLayout implements OnDestroy {
  selectedSchool = '';
  schools: { value: string, label: string }[] = [];
  rawSchools: any[] = [];
  unreadCount = 0;
  readonly theme = inject(ThemeService);
  readonly mobileLayout = inject(MobileLayoutService);

  get themeOptions() {
    return [
      { value: 'system', label: this.i18n.t('nav.themeSystem') || 'System' },
      { value: 'light', label: this.i18n.t('nav.themeLight') || 'Light' },
      { value: 'dark', label: this.i18n.t('nav.themeDark') || 'Dark' }
    ];
  }

  private metadataService = inject(MetadataService);
  private authStore = inject(AuthStore);
  private accountService = inject(AccountService);
  private schoolStateService = inject(SchoolStateService);
  private messageService = inject(MessageService);
  private cdr = inject(ChangeDetectorRef);

  readonly i18n = inject(I18nService);
  readonly regionService = inject(RegionService);
  private router = inject(Router);

  /**
   * Routes that own the whole viewport rather than sitting inside the page.
   * Messages is a two-pane app surface with its own internal scrolling: the
   * site footer underneath it pushed that surface into a boxed panel with the
   * page scrolling around it, so the chat read as a small page inside a page.
   */
  private static readonly FULL_BLEED_ROUTES = ['/messages'];

  /** Routes on which the site footer bar is shown at all. */
  private static readonly FOOTER_ROUTES = ['/', '/search'];

  /** True while a full-bleed route is active; suppresses the footer. */
  fullBleed = false;

  /** True on routes that show the footer bar (home and search). */
  showFooter = false;

  private unreadCountSubscription: Subscription;
  private routerSubscription?: Subscription;

  get selectedSchoolLabel(): string {
    const found = this.schools.find(s => s.value === this.selectedSchool);
    return found?.label || this.i18n.t('layout.allSchools') || '全部大學';
  }

  get userName(): string {
    if (!this.authStore.isAuthenticated()) return '';
    // AuthStore.user is now auto-fetched on bootstrap and after login —
    // it's the canonical source of truth for the current user
    const profile = this.authStore.user();
    if (!profile) return '';
    return profile.display_name || profile.email || '';
  }

  /** Signed in, but the profile has not arrived (or failed and is being
   *  retried). Rendering the plain account label here made the header look
   *  exactly like a signed-out one, most visibly for staff, whose admin link
   *  also waits on the profile. */
  get profilePending(): boolean {
    return this.authStore.isAuthenticated() && !this.authStore.user();
  }

  get isStaff(): boolean {
    if (!this.authStore.isAuthenticated()) return false;
    return this.authStore.user()?.is_staff === true;
  }

  constructor() {
    // Set for the initial URL as well as every later navigation: NavigationEnd
    // does not fire for the route the app boots on.
    this.applyFullBleed();
    this.applyFooterVisibility();
    this.routerSubscription = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.applyFullBleed();
        this.applyFooterVisibility();
        this.mobileLayout.setHideBottomNav(false);
        this.cdr.markForCheck();
        this.messageService.retryHubIfOwed();
      }
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    // Runs on init and again whenever the language changes, so school labels
    // are re-fetched in the newly selected language
    effect(() => {
      this.i18n.lang();
      this.loadMetadata();
    });

    // The single per-user notification connection lives here (the persistent
    // app shell, never destroyed by route navigation) rather than in the
    // Messages page component, so it survives switching to any other page —
    // "logged in" is the only thing that should start/stop it, not which
    // route is active. Re-runs whenever isAuthenticated changes (login/logout
    // in this tab, or in another tab via AuthStore's storage-event sync).
    effect(() => {
      if (this.authStore.isAuthenticated()) {
        untracked(() => this.messageService.openHub());
      } else {
        untracked(() => this.messageService.closeHub());
        // Clear manual school selection on logout - next session uses bound school
        this.schoolStateService.clearManualSchool();
      }
    });

    this.unreadCountSubscription = this.messageService.unreadCount$.subscribe(count => {
      this.unreadCount = count;
      this.cdr.markForCheck();
    });

    // Automatically set the school to the user's verified school once the profile loads
    // (if they haven't manually chosen a school yet).
    effect(() => {
      const profile = this.authStore.user();
      const region = this.regionService.region();
      const verification = profile?.verifications?.find(v => isSameRegion(v.region, region) && !!v.verified_at);
      const userSchoolId = verification?.school;
      if (userSchoolId && this.rawSchools.length > 0 && this.schoolStateService.getManualSchool() === null) {
        const userSchool = this.rawSchools.find(s => s.id === userSchoolId);
        if (userSchool && this.selectedSchool !== userSchool.name) {
          this.selectedSchool = userSchool.name;
          this.schoolStateService.setSchool(this.selectedSchool);
          this.cdr.markForCheck();
        }
      }
    });
  }

  private applyFullBleed() {
    const url = stripRegionPrefix(this.router.url);
    this.fullBleed = UiLayout.FULL_BLEED_ROUTES.some(r => url === r || url.startsWith(r + '/'));
  }

  private applyFooterVisibility() {
    const url = stripRegionPrefix(this.router.url);
    this.showFooter = UiLayout.FOOTER_ROUTES.some(r => url === r || (r !== '/' && url.startsWith(r + '/')));
  }

  ngOnDestroy() {
    this.routerSubscription?.unsubscribe();
    this.unreadCountSubscription.unsubscribe();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /** A hub that failed to open gets another chance when the visitor returns. */
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.messageService.retryHubIfOwed();
    }
  };

  onThemeChange(mode: string) {
    this.theme.setMode(mode as ThemeMode);
  }

  private loadMetadata() {
    this.metadataService.getMetadata().subscribe({
      next: (data) => {
        if (data.schools && data.schools.length > 0) {
          this.schoolStateService.setSchools(data.schools);
          this.rawSchools = data.schools;
          this.schools = [
            { value: '', label: this.i18n.t('layout.allSchools') || '全部大學' },
            ...data.schools.map((s: any) => ({
              value: s.name,
              label: s.display_name || s.name
            }))
          ];

          // Keep the user's current selection across language switches
          const current = this.schoolStateService.currentSchool;
          if (this.schoolStateService.hasInitialized) {
            if (this.schools.some(s => s.value === current)) {
              this.selectedSchool = current;
              this.cdr.markForCheck();
            }
            return;
          }

          this.schoolStateService.hasInitialized = true;

          // Check for manual school selection from sessionStorage (single-session memory)
          const manualSchool = this.schoolStateService.getManualSchool();
          if (manualSchool !== null && this.schools.some(s => s.value === manualSchool)) {
            this.selectedSchool = manualSchool;
            this.schoolStateService.setSchool(this.selectedSchool);
            this.cdr.markForCheck();
            return;
          }

          // Default to "All Schools" — unless the user's profile has already
          // resolved by now. The effect below only re-runs when the profile
          // signal itself changes, so if the profile arrived *before* this
          // metadata call finished, that effect already ran once with an
          // empty `rawSchools` and did nothing — it will never fire again to
          // correct us. Checking the signal directly here closes that gap
          // regardless of which of the two requests happens to resolve first.
          const profile = this.authStore.user();
          const region = this.regionService.region();
          const verification = profile?.verifications?.find(v => isSameRegion(v.region, region) && !!v.verified_at);
          const userSchoolId = verification?.school;
          const userSchool = userSchoolId ? this.rawSchools.find(s => s.id === userSchoolId) : undefined;
          this.selectedSchool = userSchool ? userSchool.name : '';
          this.schoolStateService.setSchool(this.selectedSchool);
          this.cdr.markForCheck();
        }
      }
    });
  }

  onSchoolChange(school: string) {
    // User manually changed school - save to sessionStorage for this session
    if (school !== this.schoolStateService.currentSchool) {
      this.schoolStateService.setManualSchool(school);
    }
  }
}
