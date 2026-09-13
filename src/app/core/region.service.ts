import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { I18nService } from './i18n.service';
import { SchoolStateService } from './services/school-state.service';
import { tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../../environments/environment';
import { regionSwitchUrl } from './region-path';

export interface Currency {
  code: string;
  symbol: string;
  decimal_places: number;
  symbol_position: 'prefix' | 'suffix';
}

export interface Region {
  code: string;
  name: string;
  localized_name: string;
  currency: Currency;
  languages: string[];
  default_language: string;
  timezone: string;
  search_engines: string[];
  edu_email_suffix: string[];
}

const STORAGE_KEY = 'region';

@Injectable({ providedIn: 'root' })
export class RegionService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private i18n = inject(I18nService);
  private schoolState = inject(SchoolStateService);

  readonly region = signal<string>(this.initialRegion());
  readonly regions = signal<Region[]>([]);
  
  readonly currentRegionObj = computed(() => {
    const regs = this.regions();
    const code = this.region().toUpperCase();
    return regs.find(r => r.code === code) || null;
  });

  readonly currency = computed(() => {
    return this.currentRegionObj()?.currency || { code: 'TWD', symbol: 'NT$', decimal_places: 0, symbol_position: 'prefix' };
  });

  constructor() {
    // Deferred by a microtask, not called inline. fetchRegions() issues an
    // HTTP request, which runs ApiUrlInterceptor, which resolves this very
    // service — from inside its own constructor. DI hands back the
    // half-built instance and the request never leaves, so regions() stayed
    // empty and currency() silently fell back to TWD, printing NT$ prices in
    // Hong Kong. By the time the microtask runs, construction is finished.
    effect(() => {
      const currentLang = this.i18n.lang();
      queueMicrotask(() => this.fetchRegions(currentLang));
    });
  }

  private initialRegion(): string {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return stored.toLowerCase();
    }
    if (typeof navigator !== 'undefined') {
      if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Hong_Kong') {
        return 'hk';
      }
    }
    return 'tw';
  }

  private lastFetchedLang: string | null = null;

  private fetchRegions(lang: string) {
    if (this.lastFetchedLang === lang && this.regions().length > 0) return;
    
    // Relative path only. ApiUrlInterceptor prepends environment.backendUrl,
    // which already ends in /api/v1 — spelling it again here produced
    // /api/v1/api/v1/core/regions/, a silent 404 that left regions() empty
    // and the region picker with nothing to show.
    this.http.get<Region[]>('/core/regions/').pipe(
      tap(regs => {
        const isFirst = this.regions().length === 0;
        this.regions.set(regs);
        if (isFirst) {
          this.setRegion(this.region(), true);
        }
        this.lastFetchedLang = lang;
      }),
      // Swallowing this silently is what made the earlier failures so hard to
      // place: the only visible symptom was prices rendering in the wrong
      // currency, several layers away from the request that actually failed.
      catchError(err => {
        console.error('Failed to load regions — falling back to defaults', err);
        return of([]);
      })
    ).subscribe();
  }

  setRegion(code: string, isInit = false) {
    code = code.toLowerCase();
    const regs = this.regions();
    if (regs.length > 0 && !regs.some(r => r.code.toLowerCase() === code)) {
        code = regs[0].code.toLowerCase();
    }
    
    const oldRegion = this.region();
    this.region.set(code);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, code);
    }

    if (oldRegion !== code || isInit) {
      if (!isInit) {
        this.schoolState.setSchool('');
        this.schoolState.clearManualSchool();
      }
      
      const newRegionObj = regs.find(r => r.code.toLowerCase() === code);
      if (newRegionObj) {
        const currentLang = this.i18n.lang();
        if (!newRegionObj.languages.includes(currentLang)) {
           this.i18n.setLang(newRegionObj.default_language as any);
        }
      }
      
      if (!isInit && typeof window !== 'undefined') {
        // `code` is about to be interpolated into a URL that is then
        // navigated to. It has usually already been checked against the
        // loaded region list above — but that check is skipped entirely when
        // the list is empty, which is a real state: the regions request has a
        // catchError that yields []. A code of `/evil.example` would make
        // `/${code}` a protocol-relative URL, i.e. a full navigation off this
        // origin. Nothing reaches here with a hostile value today (the route
        // guard validates first, and passes isInit=true, which skips this
        // branch), so this is the second lock rather than the first.
        if (!/^[a-z0-9-]{1,16}$/.test(code)) return;

        const target = regionSwitchUrl(this.router.url, code);
        // A full document load, not router.navigateByUrl. Every route lives
        // under the `:region` segment, so switching TW→HK only changes a
        // parameter: Angular reuses the component, ngOnInit never re-runs and
        // the page keeps showing the previous region's data even though the
        // URL and the picker both say otherwise.
        //
        // Reloading is also the honest thing here rather than a workaround —
        // a region switch invalidates every list on screen, the selected
        // school, and possibly the display language. Re-entering the app is
        // cheaper to reason about than teaching each feature to re-fetch.
        window.location.assign(target);
      }
    }
  }
}
