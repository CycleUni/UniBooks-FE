import { RegionLinkDirective } from '../../core/region-link.directive';
import { Component, Input, Output, EventEmitter, inject, ChangeDetectorRef, effect, DestroyRef, TemplateRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { UiBookTile } from './book-tile.component';
import { UiPromoBanner } from './promo-banner.component';
import { UiSkeleton } from './skeleton.component';
import { UiPagination } from './pagination.component';
import { UiErrorState } from './error-state.component';
import { ListingService } from '../../core/services/listing.service';
import { I18nService, TPipe } from '../../core/i18n.service';
import { bookPreviewState, bookQueryParams } from '../../core/book-preview';

/**
 * Books per page of recent_books/. The backend paginates this endpoint at its
 * REST_FRAMEWORK PAGE_SIZE (20) and `limit` only trims within that page, so
 * asking for more never returned more: the search page's `limit=4000` (and
 * the old default of 200, the backend's cap) were requests for 20 books that
 * also minted their own server cache keys. Ask for exactly what is shown.
 */
export const RECENT_BOOKS_PAGE_SIZE = 20;

@Component({
  selector: 'ui-recent-listings',
  standalone: true,
  imports: [RegionLinkDirective, CommonModule, RouterModule, UiBookTile, UiSkeleton, TPipe, UiPagination, UiErrorState, UiPromoBanner],
  template: `
    <h2 class="section-heading" [id]="headingId">{{ (school ? 'home.recentTitle' : 'home.recentTitleAll') | t }}</h2>
    <ng-container *ngIf="loading">
      <ui-skeleton variant="discover-grid" [count]="4"></ui-skeleton>
    </ng-container>
    <ng-container *ngIf="!loading">
      <ui-error-state
        *ngIf="errorMessage"
        [message]="errorMessage"
        (retry)="reload()"
      ></ui-error-state>
      <div class="discover-grid" [class.has-feature]="showFeatureTile" *ngIf="!errorMessage">
        <ng-container *ngFor="let item of gridItems; let i = index">
          <ng-container *ngIf="item.type === 'ad'">
            <ui-promo-banner [ad]="item.data" [feature]="showFeatureTile && i === 0" (adClick)="adClick.emit($event)"></ui-promo-banner>
          </ng-container>
          <ng-container *ngIf="item.type === 'book'">
            <ui-book-tile
              [feature]="showFeatureTile && i === 0"
              [title]="item.data.title || ('home.unknownBook' | t)"
              [author]="item.data.authors"
              [isbn]="item.data.isbn"
              [coverUrl]="item.data.cover_url"
              [sellerCount]="sellerCountFor(item.data.conditions)"
              [conditions]="item.data.conditions"
              [minPrice]="item.data.min_price"
              [isFromPrice]="item.data.max_price > item.data.min_price"
              [link]="['/book']"
              [linkParams]="bookLinkParams(item.data)"
              [linkState]="previewState"
              (tileClick)="cacheBook(item.data)"
            ></ui-book-tile>
          </ng-container>
        </ng-container>

        <!-- Cold start: a grid with two books in it reads as "nobody is here".
             Filling the remaining columns with a supply-side invitation turns
             the emptiest part of the page into the one CTA the marketplace
             most needs, and keeps the grid from ending in ragged holes. -->
        <a class="seed-tile hover-card hover-card-surface" regionLink="/sell" *ngFor="let slot of seedSlots">
          <span class="seed-mark" aria-hidden="true">+</span>
          <span class="seed-text">{{ 'home.seedSlot' | t }}</span>
        </a>
      </div>
      <p *ngIf="recentBooks.length === 0 && !errorMessage" class="empty-note">{{ 'home.noListings' | t }}</p>
      <ui-pagination *ngIf="totalCount > pageSize" [total]="totalCount" [pageSize]="pageSize" [currentPage]="currentPage" (pageChange)="onPageChange($event)"></ui-pagination>
    </ng-container>
  `,
  styles: [`
    /* A query container so the feature tile can react to the width of the
       grid itself rather than the viewport — the same grid is 715px wide
       beside the waitlist and 1120px wide once that column stacks. */
    :host { display: block; container-type: inline-size; }
    /* Auto-fill rather than a fixed 4 columns. At 1120px, 'repeat(4, 1fr)' in
       the two-thirds-width home column produced 153px covers — too small to
       read a spine title on a desktop screen — and any book count that isn't
       a multiple of 4 left visible holes in the grid. Sizing by a 180px
       minimum instead lets the column count follow the space available. */
    .seed-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      aspect-ratio: 5 / 7;
      border: 1px dashed var(--line-strong);
      border-radius: var(--radius-xs);
      text-decoration: none;
      color: var(--muted);
      background-color: var(--paper-warm);
      transition: border-color var(--motion-base), color var(--motion-base), background-color var(--motion-base);
    }
    .seed-mark {
      font-family: 'Noto Serif TC', serif;
      font-size: var(--text-3xl);
      line-height: 1;
    }
    .seed-text {
      font-size: var(--text-sm);
      text-align: center;
      padding-inline: var(--space-3);
    }
  `]
})
export class UiRecentListings {
  @Input() set school(val: string) {
    this._school = val;
    this.fetchRecentBooks();
  }
  get school() { return this._school; }
  private _school = '';

  @Input() set limit(val: number) {
    this._limit = val;
    this.fetchRecentBooks();
  }
  get limit() { return this._limit; }
  private _limit = RECENT_BOOKS_PAGE_SIZE;

  /** What one page of the grid shows; see RECENT_BOOKS_PAGE_SIZE. */
  readonly pageSize = RECENT_BOOKS_PAGE_SIZE;

  @Input() ads: any[] = [];
  @Output() adClick = new EventEmitter<any>();

  recentBooks: any[] = [];
  loading = true;
  errorMessage: string = '';
  totalCount = 0;
  currentPage = 1;

  /** Stable id so the parent <section> can point aria-labelledby at this heading. */
  readonly headingId = 'recent-listings-heading';

  /**
   * The span-2 feature tile needs enough siblings around it to read as
   * emphasis rather than as a broken cell. Below this count every tile is
   * the same size.
   */
  private static readonly FEATURE_MIN_BOOKS = 5;

  /** Target number of cells in the grid while the catalogue is still small.
      Three keeps the desktop row full without spilling a lone filler cell
      onto a second row. */
  private static readonly COLD_START_SLOTS = 3;

  get gridItems(): any[] {
    const items: any[] = [...this.recentBooks];
    if (this.ads && this.ads.length) {
      const sortedAds = [...this.ads].sort((a, b) => (a.slot_index || 1) - (b.slot_index || 1));
      for (const ad of sortedAds) {
        let insertIndex = (ad.slot_index || 1) - 1;
        if (insertIndex < 0) insertIndex = 0;
        if (insertIndex > items.length) insertIndex = items.length;
        items.splice(insertIndex, 0, { type: 'ad', data: ad });
      }
    }
    return items.map(item => item.type === 'ad' ? item : { type: 'book', data: item });
  }

  get showFeatureTile(): boolean {
    return this.recentBooks.length >= UiRecentListings.FEATURE_MIN_BOOKS;
  }

  /** Filler "list your book" cells, only while the catalogue is nearly empty. */
  get seedSlots(): number[] {
    if (this.loading || this.errorMessage) return [];
    const missing = UiRecentListings.COLD_START_SLOTS - this.recentBooks.length;
    return missing > 0 && this.recentBooks.length > 0
      ? Array.from({ length: missing }, (_, i) => i)
      : [];
  }

  private listingService = inject(ListingService);
  private cdr = inject(ChangeDetectorRef);
  private i18n = inject(I18nService);
  private destroyRef = inject(DestroyRef);

  // `school`/`limit` inputs can each fire their own fetch in quick succession
  // (e.g. `school` starts as '' and is then updated once the user's actual
  // school resolves asynchronously). Routing every fetch through switchMap
  // guarantees an older, still-in-flight request can never overwrite the UI
  // after a newer one has already resolved.
  private fetchTrigger$ = new Subject<void>();

  constructor() {
    this.fetchTrigger$.pipe(
      switchMap(() => {
        this.loading = true;
        this.cdr.markForCheck();
        return this.listingService.getRecentBooks(this.school, this.currentPage, this.limit).pipe(
          catchError(() => of(null))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((data) => {
      if (data === null) {
        this.recentBooks = [];
        this.errorMessage = this.i18n.t('common.error') || 'Error loading listings';
      } else {
        this.recentBooks = data.results || data;
        this.totalCount = data.count || this.recentBooks.length;
        this.errorMessage = '';
      }
      this.loading = false;
      this.cdr.markForCheck();
    });

    effect(() => {
      // Re-fetch when language changes so localized error/titles update if needed
      this.i18n.lang();
      this.fetchRecentBooks();
    });
  }

  private fetchRecentBooks() {
    this.fetchTrigger$.next();
  }

  onPageChange(page: number) {
    this.currentPage = page;
    this.fetchRecentBooks();
  }

  sellerCountFor(conditions: any): number {
    if (!conditions) return 0;
    return Object.values(conditions).reduce((sum: number, count: any) => sum + (Number(count) || 0), 0);
  }

  trackById(index: number, item: any): any {
    return item.id;
  }

  /** Anchors carry the navigation now; this only primes the detail-page cache. */
  cacheBook(item: any) {
    if (typeof sessionStorage === 'undefined') return;
    const cached = {
      id: item.id,
      title: item.title,
      author: item.authors,
      isbn: item.isbn,
      coverUrl: item.cover_url,
      activeListings: 1
    };
    sessionStorage.setItem(`cachedBook_${item.isbn || item.id}`, JSON.stringify(cached));
  }

  /** Lets the book page show what cacheBook() stashed; carried outside the URL. */
  readonly previewState = bookPreviewState();

  bookLinkParams(item: any): Record<string, any> {
    return bookQueryParams(item);
  }

  reload() {
    this.fetchRecentBooks();
  }
}
