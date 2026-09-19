import { Component, OnInit, inject, effect, DestroyRef, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { UiInput } from '../../shared/ui/input.component';
import { UiButton } from '../../shared/ui/button.component';
import { UiListingRow } from '../../shared/ui/listing-row.component';
import { UiSkeleton } from '../../shared/ui/skeleton.component';
import { FormsModule } from '@angular/forms';
import { BookService, CourseFacet, SearchEngine, engineForSource, parseSearchEngine } from '../../core/services/book.service';
import { AuthStore } from '../../core/auth.store';
import { ChangeDetectorRef } from '@angular/core';
import { I18nService, TPipe } from '../../core/i18n.service';
import { SchoolStateService } from '../../core/services/school-state.service';
import { MetadataService } from '../../core/services/metadata.service';
import { GoogleAnalyticsService } from '../../core/services/google-analytics.service';
import { UiRecentListings } from '../../shared/ui/recent-listings.component';
import { UiPagination } from '../../shared/ui/pagination.component';
import { UiBookTile } from '../../shared/ui/book-tile.component';
import { UiRadioGroup } from '../../shared/ui/radio-group.component';
import { UiFacetList, FacetOption } from '../../shared/ui/facet-list.component';
import { combineLatest, Subscription } from 'rxjs';
import { map, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { RegionLinkService } from '../../core/region-link.service';
import { ToastService } from '../../core/services/toast.service';
import { bookPreviewState, bookQueryParams } from '../../core/book-preview';
import { SeoService } from '../../core/services/seo.service';

type ConditionKey = 'new' | 'like_new' | 'noted' | 'damaged';
const CONDITION_KEYS: ConditionKey[] = ['new', 'like_new', 'noted', 'damaged'];

/**
 * 搜尋條件的完整形狀。存在的理由是「網址就是唯一狀態來源」：每個 handler 都
 * 以目前這一整組狀態為底、只覆寫自己那幾格，才不會像以前各自 `const params:
 * any = {}` 重建一份時把沒寫到的條件無聲清掉。
 */
interface SearchUrlState {
  q: string;
  category: string;
  course: string;
  /** null = no source asked for, so the backend runs its fallback chain. */
  engine: SearchEngine | null;
  page: number;
  /** 已勾選的書況。四個全勾等於沒有篩選。 */
  conditions: ConditionKey[];
  priceMin: string;
  priceMax: string;
  inStock: boolean;
}

/** 「一個書況都沒勾」的哨兵值 —— 空字串在網址裡和「沒有這個參數」分不出來，
 *  但兩者的意思相反（沒有參數＝全選，沒有勾＝結果為空）。 */
const CONDITION_NONE = 'none';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, UiInput, UiButton, UiSkeleton, UiRecentListings, UiPagination, UiBookTile, UiFacetList, UiRadioGroup, TPipe],
  template: `
      <div class="search-header">
        <div class="header-inner container">
          <div class="search-page-input-wrap">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5"/>
              <line x1="20" y1="20" x2="15.4" y2="15.4"/>
            </svg>
            <!-- No visible label: the placeholder was the only name, and it
                 stops naming anything once text is typed. -->
            <ui-input
              [ariaLabel]="'common.search' | t"
              [placeholder]="'common.searchPlaceholder' | t"
              [(ngModel)]="searchQuery"
              (keyup.enter)="onSearch()"
              class="search-page-input"
            ></ui-input>
          </div>
          <ui-button (onClick)="onSearch()" class="search-button"><span class="submit-label sr-only-mobile">{{ 'common.search' | t }}</span><svg class="submit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="20" y1="20" x2="15.4" y2="15.4"/></svg></ui-button>
        </div>
      </div>

      <div class="container search-layout">
        <button
          type="button"
          class="filter-toggle"
          (click)="filtersOpen = !filtersOpen"
          [attr.aria-expanded]="filtersOpen"
        >
          <span>{{ 'search.filters' | t }}</span>
          <svg class="filter-toggle-caret" [class.open]="filtersOpen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <aside class="sidebar" [class.mobile-collapsed]="!filtersOpen">
          <div class="filter-group">
            <ui-facet-list
              [title]="'common.condition' | t"
              [options]="conditionFacetOptions"
              selectionMode="multiple"
              (optionToggle)="toggleCondition($event)"
            ></ui-facet-list>
          </div>
          <div class="filter-group">
            <ui-facet-list
              [title]="'search.categoryTitle' | t"
              [options]="categoryFacetOptions"
              selectionMode="single"
              (optionToggle)="onCategoryChange($event)"
            ></ui-facet-list>
          </div>
          <div class="filter-group">
            <ui-facet-list
              [title]="'search.courseTitle' | t"
              [options]="courseFacetOptions"
              selectionMode="single"
              (optionToggle)="onCourseChange($event)"
            ></ui-facet-list>
          </div>
          <div class="filter-group">
            <h4 class="filter-title">{{ 'search.stockTitle' | t }}</h4>
            <!-- 單向綁定 + 明確的 handler：狀態由網址還原，radio 只負責發動導頁。 -->
            <ui-radio-group [options]="stockOptions" [ngModel]="stockFilter" (ngModelChange)="onStockChange($event)"></ui-radio-group>
          </div>
          <div class="filter-group">
            <h4 class="filter-title">{{ 'search.priceTitle' | t }}</h4>
            <!-- ngModel 留著讓輸入當下就能重排目前這頁，但只有離開欄位或按
                 Enter 才寫進網址 —— 每個字元都 navigate 一次會塞爆上一頁紀錄，
                 而且 "1" / "12" / "120" 會各觸發一次狀態還原。
                 blur 不會冒泡，所以聽的是 ui-input 主機元素上的 focusout。 -->
            <div class="price-range">
              <ui-input [placeholder]="'search.priceMinPlaceholder' | t" [(ngModel)]="priceMin" (focusout)="commitPriceRange()" (keyup.enter)="commitPriceRange()" class="price-input"></ui-input>
              <span>-</span>
              <ui-input [placeholder]="'search.priceMaxPlaceholder' | t" [(ngModel)]="priceMax" (focusout)="commitPriceRange()" (keyup.enter)="commitPriceRange()" class="price-input"></ui-input>
            </div>
          </div>
        </aside>

        <main class="results">
          <!-- 保留在結果欄而不是側欄：這不是使用者選出來的條件，是後端自動降級
               後的通知，跟哪個篩選器都無關。 -->
          <p class="fallback-hint" *ngIf="googleUnavailable">{{ 'search.googleUnavailable' | t }}</p>
          <p class="fallback-hint" *ngIf="resultsTruncated">{{ 'search.resultsTruncated' | t }}</p>
          <h2 class="section-heading" *ngIf="activeQuery">{{ 'search.resultsFor' | t:{q: activeQuery} }}</h2>
          <h2 class="section-heading" *ngIf="!activeQuery && category">{{ 'search.categoryResults' | t }}</h2>
          <p class="scoped-count" *ngIf="(activeQuery || category) && !loading && !fetchError && filteredResults.length > 0">
            <!-- The scoped count is books with a copy at this school. When that
                 is zero while catalogue matches are listed right below,
                 "Found 0 matching books" contradicted the page. -->
            <ng-container *ngIf="currentSchool && localResultsCount > 0">{{ 'search.foundCountScoped' | t:{school: currentSchoolLabel, n: localResultsCount} }}</ng-container>
            <ng-container *ngIf="currentSchool && localResultsCount === 0">{{ 'search.foundCountNoneAtSchool' | t:{school: currentSchoolLabel, n: filteredResults.length} }}</ng-container>
            <ng-container *ngIf="!currentSchool">{{ 'search.foundCountAll' | t:{n: filteredResults.length} }}</ng-container>
          </p>

          <!-- No active query/category → recent listings. Only once the URL's
               parameters and the school are in: before that activeQuery is
               still empty, and the grid used to fetch "all schools" for a
               page that turned out to be a search. -->
          <ng-container *ngIf="paramsReady && !activeQuery && !category">
            <ui-recent-listings [school]="currentSchool"></ui-recent-listings>
          </ng-container>

          <!-- Loading state with animation -->
          <ng-container *ngIf="loading">
            <ui-skeleton variant="discover-grid" [count]="8"></ui-skeleton>
          </ng-container>

          <!-- Results loaded successfully -->
          <ng-container *ngIf="!loading && !fetchError">
            <div *ngIf="filteredResults.length > 0" class="discover-grid has-feature">
              <ui-book-tile
                *ngFor="let item of filteredResults; let i = index"
                [class.feature-tile]="i === 0"
                [coverUrl]="item.coverUrl"
                [title]="item.title"
                [author]="item.author"
                [isbn]="item.isbn"
                [feature]="i === 0"
                [mode]="item.activeListings > 0 ? 'sellers' : 'waitlist'"
                [minPrice]="item.minPrice"
                [sellerCount]="item.activeListings"
                [waitingCount]="item.waitlistCount"
                [link]="['/book']"
                [linkParams]="bookLinkParams(item)"
                [linkState]="previewState"
                (tileClick)="goToBook(item)"
              >
                <div tile-actions class="tile-actions-inner">
                  <ng-container *ngIf="item.activeListings === 0">
                    <ui-button *ngIf="!item.is_subscribed" variant="ghost" (onClick)="$event.stopPropagation(); subscribeBook(item)">{{ 'search.notifyMe' | t }}</ui-button>
                    <ui-button *ngIf="item.is_subscribed" variant="ghost"  style="color: var(--muted); border-color: var(--muted);" (onClick)="$event.stopPropagation(); unsubscribeBook(item)">{{ 'search.cancelNotify' | t }}</ui-button>
                  </ng-container>
                  <ng-container *ngIf="item.activeListings > 0">
                    <ui-button>{{ 'search.viewAll' | t }}</ui-button>
                    <span class="local-badge" *ngIf="currentSchool && item.localActiveListings === 0">
                      {{ 'search.noLocalListings' | t:{school: currentSchoolLabel} }}
                    </span>
                  </ng-container>
                </div>
              </ui-book-tile>
            </div>

            <ui-pagination *ngIf="totalCount > 20" [total]="totalCount" [pageSize]="20" [currentPage]="currentPage" (pageChange)="onPageChange($event)"></ui-pagination>

            <div *ngIf="results.length === 0 && activeQuery" class="empty-state">
              <h3>{{ 'search.notFound' | t }}</h3>
              <p>{{ 'search.notFoundDesc' | t }}</p>
            </div>

            <div *ngIf="results.length > 0 && filteredResults.length === 0" class="empty-state">
              <h3>{{ 'search.noFilterMatch' | t }}</h3>
              <p>{{ 'search.adjustFilters' | t }}</p>
            </div>
          </ng-container>

          <!-- Error state after load failure -->
          <div class="error-box" *ngIf="!loading && fetchError">
            <h3>{{ 'search.errorTitle' | t }}</h3>
            <p>{{ 'search.errorDesc' | t }}</p>
            <ui-button variant="ghost" (onClick)="fetchResults()">{{ 'common.retry' | t }}</ui-button>
          </div>
        </main>
      </div>
  `,
  styles: [`
    /* The band is full-bleed and its inner element carries .container, so the
       gutter is the shared one rather than a second 16px added on top of it. */
    .search-header { background-color: var(--paper-warm); border-bottom: 1px solid var(--line); padding-block: 24px; margin-bottom: 32px; }
    .header-inner { display: flex; gap: 8px; }
    .search-page-input-wrap { position: relative; width: 400px; max-width: 100%; }
    .search-page-input-wrap .search-icon { position: absolute; left: 2px; bottom: 10px; color: var(--muted); pointer-events: none; }
    .search-page-input { display: inline-block !important; width: 100%; }
    .search-page-input ::ng-deep .input-wrapper { margin-bottom: 0; }
    .search-page-input ::ng-deep input {
      border: none;
      border-bottom: 1.5px solid var(--ink);
      border-radius: 0;
      background: none;
      padding-left: 24px;
      font-size: var(--text-md);
    }
    .search-page-input ::ng-deep input:focus {
      border-bottom-color: var(--accent);
      box-shadow: none;
    }
    .search-button { flex-shrink: 0; }
    .search-button .submit-icon { display: none; }
    /* Layout only. This used to redeclare .container at 1120px, which with
       border-box padding yields a 1088px column — 16px narrower than the
       header above it, so the filter rail started 16px inside the logo. */
    .search-layout { display: flex; gap: 48px; }
    .filter-toggle { display: none; }
    .sidebar { width: 240px; flex-shrink: 0; }
    .filter-group { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
    .filter-group:last-of-type { border-bottom: none; }
    .filter-title { font-size: var(--text-base); font-weight: 500; margin-top: 0; margin-bottom: 12px; color: var(--ink); }
    .filter-label { display: block; margin-bottom: 12px; font-size: var(--text-base); color: var(--ink); cursor: pointer; }
    .filter-label input { margin-right: 8px; }
    .fallback-hint { margin: 0 0 16px; font-size: var(--text-xs); color: var(--flag); }
    .price-range { display: flex; gap: 8px; align-items: center; }
    /* Price stays a plain numeric range, not a facet list — strip ui-input's
       boxed border for an underline look consistent with the lighter facet
       treatment above it. */
    .price-input { width: 80px; }
    .price-input ::ng-deep .input-wrapper { margin-bottom: 0; }
    .price-input ::ng-deep input { border: none; border-bottom: 1px solid var(--line); border-radius: 0; padding: 4px 0; background: transparent; }
    .price-input ::ng-deep input:focus { border-color: var(--accent); }
    .results { flex: 1; }
    .scoped-count { margin: -16px 0 24px; font-size: var(--text-base); color: var(--muted); }

    .tile-actions-inner { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 8px; }
    .local-badge { display:inline-block; padding:4px 8px; font-size: var(--text-xs); font-weight:500; color:var(--danger); background-color:var(--danger-light); border-radius:4px; }

    .error-box { padding: 32px 24px; text-align: center; border: 1px solid var(--flag); border-radius: var(--radius-sm); background-color: var(--warn-bg); }
    .error-box h3 { margin-top: 0; margin-bottom: 12px; color: var(--warn-ink); }
    .error-box p { color: var(--muted); margin-bottom: 24px; }

    @media (max-width: 1024px) {
      .header-inner { flex-wrap:wrap; } .search-page-input-wrap { flex:1; width:auto; min-width:200px; }
    }
    @media (max-width: 768px) {
      /* Stays a row. With flex-direction:column the main axis turns vertical,
         so the button's flex-basis sized its height and align-items:stretch
         pulled both children to full width — which is what made the button a
         343px block instead of a 44px square. */
      .header-inner { align-items: stretch; }
      /* Same collapse as the home hero: a full-width filled button for an
         action Enter already performs is the biggest thing on the screen. */
      .search-page-input-wrap { flex:1; width:auto; min-width:0; max-width:100%; }
      .search-page-input-wrap .search-icon { display: none; }
      .search-page-input ::ng-deep input { padding-left: var(--space-3); }
      .search-button { flex: 0 0 44px; }
      .search-button ::ng-deep .ui-btn.md { padding-inline: 0; }
      .search-button .submit-icon { display: block; }
      .search-layout { flex-direction:column; gap:0; }
      /* --line-strong, not --line: this is a real button, i.e. an
         interactive boundary, and --line is 1.48:1 — below the 3:1
         WCAG 1.4.11 asks of non-text UI. */
      .filter-toggle { display:flex; align-items:center; justify-content:space-between; width:100%; padding:12px 16px; margin-bottom:16px; border:1px solid var(--line-strong); border-radius:4px; background-color:var(--paper); color:var(--ink); font-size: var(--text-base); font-weight:500; font-family:inherit; cursor:pointer; }
      .filter-toggle-caret { flex-shrink:0; color:var(--muted); transition:transform var(--motion-base); }
      .filter-toggle-caret.open { transform:rotate(180deg); }
      .sidebar { width:100%; display:flex; flex-wrap:wrap; gap:0 24px; border-bottom:1px solid var(--line); margin-bottom:24px; }
      .sidebar.mobile-collapsed { display:none; }
      .filter-group { flex:1 1 40%; min-width:150px; margin-bottom:16px; padding-bottom:0; border-bottom:none; }
    }
  `]
})
export class Search implements OnInit {
  searchQuery = ''; activeQuery = ''; category = ''; course = '';
  engine: SearchEngine | null = null;
  googleUnavailable = false;
  /** Browsing a category reads the local catalogue up to a cap; past it the
   *  pages simply stop, so say so rather than let the list end unexplained. */
  resultsTruncated = false;
  loading = true; fetchError = false;
  filtersOpen = false;
  results: any[] = []; categories: any[] = []; courses: CourseFacet[] = []; currentSchool = ''; currentPage = 1; totalCount = 0;
  /** Set once the query parameters and the opening school have both arrived. */
  paramsReady = false;
  private searchSub?: Subscription;
  /** 上一次真的送進 API 的那組欄位。書況／價格／庫存純前端過濾，現在也會寫進
   *  網址，若不比對這個 key，每勾一個書況都會多打一次回傳完全相同的請求。 */
  private lastFetchKey?: string;

  get currentSchoolLabel(): string {
    return this.schoolStateService.getSchoolLabel(this.currentSchool);
  }

  get categoryOptions() {
    return [
      { label: this.i18n.t('search.allCategories'), value: '' },
      ...this.categories.map(c => ({ label: c.title, value: c.slug }))
    ];
  }

  get courseOptions(): Array<{ label: string; value: string; count?: number }> {
    return [
      { label: this.i18n.t('search.allCourses'), value: '' },
      ...this.courses.map(c => ({ label: c.value, value: c.value, count: c.count }))
    ];
  }

  conditionFilters = { new: true, like_new: true, noted: true, damaged: true };
  stockFilter: 'all' | 'inStock' = 'all';
  priceMin = ''; priceMax = '';

  get stockOptions() {
    return [
      { label: this.i18n.t('search.all'), value: 'all' },
      { label: this.i18n.t('search.inStockOnly'), value: 'inStock' }
    ];
  }

  get conditionFacetOptions(): FacetOption[] {
    return [
      { label: this.i18n.t('cond.new'), value: 'new', selected: this.conditionFilters.new },
      { label: this.i18n.t('cond.like_new'), value: 'like_new', selected: this.conditionFilters.like_new },
      { label: this.i18n.t('cond.noted'), value: 'noted', selected: this.conditionFilters.noted },
      { label: this.i18n.t('cond.damaged'), value: 'damaged', selected: this.conditionFilters.damaged },
    ];
  }

  toggleCondition(value: string) {
    const key = value as ConditionKey;
    if (!CONDITION_KEYS.includes(key)) return;
    // 刻意不直接改 conditionFilters：勾選狀態一律由網址還原回來，元件自己先
    // 改一份會讓兩邊各有一個真相，重整後又對不起來。
    const next = { ...this.conditionFilters, [key]: !this.conditionFilters[key] };
    this.navigateWithState({ conditions: CONDITION_KEYS.filter(k => next[k]) });
  }

  onStockChange(value: 'all' | 'inStock') {
    this.navigateWithState({ inStock: value === 'inStock' });
  }

  /** 價格改由 blur / Enter 提交，見樣板中的說明。 */
  commitPriceRange() {
    const min = this.normalizePrice(this.priceMin);
    const max = this.normalizePrice(this.priceMax);
    const current = this.route.snapshot.queryParams;
    // 只是點進點出輸入框不算改條件。少了這道判斷，使用者在第 3 頁碰一下價格
    // 欄就會因為「改條件回第 1 頁」的規則被丟回第 1 頁。
    if (min === (current['price_min'] || '') && max === (current['price_max'] || '')) return;
    this.navigateWithState({ priceMin: min, priceMax: max });
  }

  /** 只有真的是數字才進網址：打到一半的 "1a" 沒有篩選意義，寫進去只是噪音。 */
  private normalizePrice(value: string): string {
    const n = parseInt((value || '').trim(), 10);
    return isNaN(n) || n < 0 ? '' : String(n);
  }

  get categoryFacetOptions(): FacetOption[] {
    return this.categoryOptions.map(o => ({ label: o.label, value: o.value, selected: o.value === this.category }));
  }

  get courseFacetOptions(): FacetOption[] {
    return this.courseOptions.map(o => ({ label: o.label, value: o.value, count: o.count, selected: o.value === this.course }));
  }

  // Template getters run on every change-detection pass (each keystroke,
  // scroll and pointer move), and this one filters the whole result set.
  // Memoised on the inputs it actually reads: the results array identity and
  // the filter controls. `results` is only ever reassigned, never mutated in
  // place, so identity is a sound key.
  private filteredMemo: { results: any[]; key: string; value: any[] } | null = null;

  get filteredResults(): any[] {
    const key = `${this.stockFilter}|${this.priceMin}|${this.priceMax}|${JSON.stringify(this.conditionFilters)}`;
    if (this.filteredMemo && this.filteredMemo.results === this.results && this.filteredMemo.key === key) {
      return this.filteredMemo.value;
    }
    const allChecked = Object.values(this.conditionFilters).every(v => v);
    const min = parseInt(this.priceMin, 10);
    const max = parseInt(this.priceMax, 10);
    const filterPrice = !isNaN(min) || !isNaN(max);
    const value = this.results.filter(item => {
      const inStock = item.activeListings > 0;
      if (this.stockFilter === 'inStock' && !inStock) return false;
      if (filterPrice) {
        if (!inStock) return false;
        if (!isNaN(min) && (item.minPrice === null || item.minPrice === undefined || item.minPrice < min)) return false;
        if (!isNaN(max) && (item.minPrice === null || item.minPrice === undefined || item.minPrice > max)) return false;
      }
      if (!allChecked) {
        const checked = this.conditionFilters as Record<string, boolean>;
        const conds: string[] = item.conditions || [];
        if (!conds.some(c => checked[c])) return false;
      }
      return true;
    });
    this.filteredMemo = { results: this.results, key, value };
    return value;
  }

  get localResultsCount(): number {
    return this.filteredResults.filter(item => item.localActiveListings > 0).length;
  }

  private bookService = inject(BookService);
  private auth = inject(AuthStore);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private schoolStateService = inject(SchoolStateService);
  private metadataService = inject(MetadataService);
  private ga = inject(GoogleAnalyticsService);

  private regionLink = inject(RegionLinkService);
  private seo = inject(SeoService);

  constructor(private route: ActivatedRoute, private router: Router) {
    effect(() => { this.i18n.lang(); untracked(() => this.loadMetadata()); });
  }

  loadMetadata() {
    this.metadataService.getMetadata().subscribe({
      next: data => { if (data.categories) { this.categories = data.categories; this.cdr.markForCheck(); } },
      error: err => console.error('Failed to load metadata', err)
    });
  }

  ngOnInit() {
    this.schoolStateService.schools$.subscribe(() => {
      this.cdr.markForCheck();
    });

    combineLatest([
      // resolvedSchool$: waits for the opening school rather than asking for
      // "all schools" first and then again for the settled one.
      this.schoolStateService.resolvedSchool$.pipe(distinctUntilChanged()),
      this.route.queryParams.pipe(
        map(params => params['category'] || ''),
        distinctUntilChanged()
      )
    ]).pipe(
      switchMap(([school, category]) => this.bookService.getTopCourses(school, category)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: data => { this.courses = data; this.cdr.markForCheck(); },
      error: err => console.error('Failed to load courses', err)
    });

    // queryParams and selectedSchool$ both outlive this routed component, so
    // without this every visit to /search left another live subscription
    // calling markForCheck() on a destroyed view.
    combineLatest([this.route.queryParams, this.schoolStateService.resolvedSchool$]).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([params, school]) => {
      this.paramsReady = true;
      this.currentSchool = school;
      this.restoreStateFromParams(params);
      this.describePage();

      // 書況／價格／庫存只在 filteredResults 裡做前端過濾，重打 API 會拿回
      // 一模一樣的那頁資料。只有真正送進 searchBooks() 的欄位變了才重查。
      // 用 JSON 而不是 join()：關鍵字本身可能含有分隔字元，"a b" 配沒有分類
      // 和 "a" 配分類 "b" 會串成同一個 key，然後該重查的時候不重查。
      const fetchKey = JSON.stringify([school, this.activeQuery, this.category, this.course, this.engine, this.currentPage]);
      if (fetchKey === this.lastFetchKey) { this.cdr.markForCheck(); return; }
      this.lastFetchKey = fetchKey;

      if (this.activeQuery || this.category || this.course) {
        this.fetchResults();
      } else {
        this.results = []; this.totalCount = 0; this.loading = false; this.fetchError = false;
        this.cdr.markForCheck();
      }
    });
  }

  /**
   * Tab title and canonical for the search being shown. The canonical keeps
   * only what changes the result set — q, category, course — so filter,
   * paging and engine variants of one search are not indexed as separate
   * pages.
   */
  private describePage() {
    const queryParams: Record<string, string> = {};
    if (this.activeQuery) queryParams['q'] = this.activeQuery;
    if (this.category) queryParams['category'] = this.category;
    if (this.course) queryParams['course'] = this.course;
    const canonicalPath = this.router.serializeUrl(
      this.router.createUrlTree(this.regionLink.path(['/search']), { queryParams })
    );
    this.seo.setPage(this.activeQuery
      ? { titleKey: 'seo.searchTitle', titleParams: { q: this.activeQuery }, canonicalPath }
      : { titleKey: 'nav.search', canonicalPath });
  }

  /**
   * 網址 → 元件狀態。這條路徑只讀不導頁（navigate 一律由使用者操作的 handler
   * 發動），所以「寫入網址 → 訂閱觸發 → 還原狀態」不會繞回自己形成迴圈。
   */
  private restoreStateFromParams(params: Record<string, any>) {
    const q = params['q'] || '';
    // 只有 q 真的變了才覆寫輸入框。現在勾書況、改價格也會導頁，若無條件覆寫，
    // 使用者打到一半還沒按 Enter 的字會被自己按下的篩選吃掉。
    if (q !== this.activeQuery) this.searchQuery = q;
    this.activeQuery = q;
    this.category = params['category'] || '';
    this.course = params['course'] || '';
    this.engine = parseSearchEngine(params['engine']);
    // 壞掉的 ?page=abc 當第 1 頁，別讓 NaN 一路傳到 API。
    this.currentPage = Math.max(1, parseInt(params['page'], 10) || 1);

    // 沒有 condition 參數＝四個全選＝不篩選；有參數就只認得出來的值，因此
    // 序列化時用的 'none' 會如預期還原成「一個都沒勾」。
    const raw = params['condition'];
    const picked: string[] = (raw === undefined || raw === null)
      ? [...CONDITION_KEYS]
      : String(raw).split(',').filter(v => (CONDITION_KEYS as string[]).includes(v));
    CONDITION_KEYS.forEach(k => { this.conditionFilters[k] = picked.includes(k); });

    this.priceMin = params['price_min'] || '';
    this.priceMax = params['price_max'] || '';
    this.stockFilter = params['in_stock'] === '1' ? 'inStock' : 'all';
  }

  /** 目前畫面上完整的搜尋條件，navigateWithState() 以它為底。 */
  private get urlState(): SearchUrlState {
    return {
      q: this.activeQuery,
      category: this.category,
      course: this.course,
      engine: this.engine,
      page: this.currentPage,
      conditions: CONDITION_KEYS.filter(k => this.conditionFilters[k]),
      priceMin: this.normalizePrice(this.priceMin),
      priceMax: this.normalizePrice(this.priceMax),
      inStock: this.stockFilter === 'inStock',
    };
  }

  /**
   * 所有導頁的唯一入口：以目前完整狀態為底，只覆寫呼叫端指名的欄位。
   *
   * 沒有指名 page 就一律回到第 1 頁 —— 換了篩選條件之後第 3 頁的內容跟原本
   * 完全無關，留在第 3 頁只會看到空結果。這是刻意的決定，寫在這裡而不是散在
   * 各個 handler，才不會像以前那樣分不清是規則還是忘了帶 page。
   */
  private navigateWithState(patch: Partial<SearchUrlState>) {
    const state: SearchUrlState = { ...this.urlState, page: 1, ...patch };
    this.router.navigate(this.regionLink.path(['/search']), { queryParams: this.serializeState(state) });
  }

  /** 預設值不寫進網址：網址是要能貼給別人的，塞滿 page=1 之類的噪音只會讓人
   *  看不出哪些條件才是真的有在作用。engine 沒有預設值可省：寫了
   *  engine=googlebooks 就是只查 Google，跟不寫（依序換來源）意思不同。 */
  private serializeState(state: SearchUrlState): Record<string, string> {
    const params: Record<string, string> = {};
    if (state.q) params['q'] = state.q;
    if (state.category) params['category'] = state.category;
    if (state.course) params['course'] = state.course;
    if (state.engine) params['engine'] = state.engine;
    if (state.page > 1) params['page'] = String(state.page);
    if (state.conditions.length < CONDITION_KEYS.length) {
      params['condition'] = state.conditions.length ? state.conditions.join(',') : CONDITION_NONE;
    }
    if (state.priceMin) params['price_min'] = state.priceMin;
    if (state.priceMax) params['price_max'] = state.priceMax;
    if (state.inStock) params['in_stock'] = '1';
    return params;
  }

  fetchResults() {
    this.loading = true;
    this.fetchError = false;
    this.cdr.markForCheck();

    if (this.searchSub) {
      this.searchSub.unsubscribe();
    }

    this.searchSub = this.bookService.searchBooks(this.activeQuery, this.category, this.course, this.schoolStateService.currentSchool, this.currentPage, this.engine).subscribe({
      next: data => {
        this.results = data.results || data;
        this.totalCount = data.count || this.results.length;
        this.googleUnavailable = !!data.google_unavailable;
        this.resultsTruncated = !!data.results_truncated;
        this.loading = false;
        this.fetchError = false;
        if (this.activeQuery || this.category || this.course) {
          this.ga.trackSearch(this.activeQuery || `${this.category} ${this.course}`.trim(), this.totalCount, this.currentSchool);
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.fetchError = true;
        // Keep any previously-loaded results showing (don't blank them)
        this.cdr.markForCheck();
      }
    });
  }

  /** 換頁是唯一「不重設 page」的操作，所以它是唯一要明講 page 的呼叫端。 */
  onPageChange(page: number) {
    this.navigateWithState({ page });
  }

  onSearch() {
    const q = this.searchQuery.trim();
    // 保留 category / course：在某個分類底下再打關鍵字，使用者的預期是
    // 「在這個分類裡找」，而不是被丟回全站搜尋。
    if (q) this.navigateWithState({ q });
  }

  onCategoryChange(cat: string) {
    // course 仍然刻意清掉：課程清單是依 category 重新載入的，換了分類之後
    // 舊課程多半不在新清單裡，留著會變成一個選不掉的隱形條件。
    this.navigateWithState({ category: cat, course: '' });
  }

  onCourseChange(course: string) {
    this.navigateWithState({ course });
  }

  /** Route params for a result tile; the tile's own anchor does the navigating. */
  /** Lets the book page show what goToBook() stashed; carried outside the URL. */
  readonly previewState = bookPreviewState();

  bookLinkParams(item: any): Record<string, any> {
    const params: Record<string, any> = bookQueryParams(item);
    // Belt-and-suspenders alongside goToBook()'s sessionStorage priming:
    // if the cache entry is missing (cleared tab, private browsing) the
    // book page falls back to a live lookup, which must use the same
    // engine this tile's data came from — otherwise the two pages can show
    // different covers/titles for the same ISBN. Read off the result, not
    // this.engine: without an engine the backend picks the source per
    // search, so one found in the ISBN registry would otherwise be looked
    // up again in Google.
    const engine = engineForSource(item.source);
    if (engine) params['engine'] = engine;
    return params;
  }

  /** Cache priming only — must not navigate, or the anchor fires twice. */
  goToBook(item: any) {
    const key = item.isbn || item.id; if (!key) return;
    if (typeof sessionStorage !== 'undefined') {
      try { sessionStorage.setItem(`cachedBook_${key}`, JSON.stringify(item)); }
      catch (e) { /* ok — cache is optional */ }
    }
  }

  subscribeBook(item: any) {
    if (!this.auth.isLoggedIn()) {
      this.toast.info(this.i18n.t('alert.loginToSubscribe')); this.router.navigate(this.regionLink.path(['/login'])); return;
    }
    const doSubscribe = (id: string) => {
      this.bookService.subscribe(id).subscribe({
        next: res => {
          this.ga.trackRequestBook(id, 'search');
          this.toast.success(this.i18n.t('alert.subscribed'));
          item.waitlistCount++; item.is_subscribed = true; item.subscription_id = res.id; item.id = id;
          this.cdr.markForCheck();
        },
        error: () => this.toast.error(this.i18n.t('alert.unsubscribeFailed'))
      });
    };
    if (item.id) { doSubscribe(item.id); } else {
      const bookData = { isbn13: item.isbn || '', title: item.title, authors: item.author || '', publisher: item.publisher || '', published_date: item.published_date || '', cover_url: item.coverUrl || '', source: item.source || 'manual' };
      this.bookService.createManualBook(bookData).subscribe({
        next: created => doSubscribe(created.id),
        error: () => this.toast.error(this.i18n.t('alert.subscribeFailed'))
      });
    }
  }

  unsubscribeBook(item: any) {
    if (item.subscription_id) {
      this.bookService.unsubscribe(item.subscription_id).subscribe({
        next: () => {
          this.toast.success(this.i18n.t('alert.unsubscribed'));
          item.waitlistCount--; item.is_subscribed = false; item.subscription_id = null;
          this.cdr.markForCheck();
        },
        error: () => this.toast.error(this.i18n.t('alert.unsubscribeFailed'))
      });
    }
  }
}
