import { RegionLinkDirective } from '../../core/region-link.directive';
import { Component, ChangeDetectorRef, effect, inject, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AdminService, AdminBook } from '../../core/services/admin.service';
import { parseAdminError } from '../../core/admin-error.util';
import { TPipe, I18nService } from '../../core/i18n.service';
import { UiSkeleton } from '../../shared/ui/skeleton.component';
import { UiErrorState } from '../../shared/ui/error-state.component';
import { ToastService } from '../../core/services/toast.service';
import { RegionService } from '../../core/region.service';
import { UiSearchBarComponent } from '../../shared/ui/search-bar.component';
import { UiPagination } from '../../shared/ui/pagination.component';
import { BookCoverPipe } from '../../shared/pipes/book-cover.pipe';

/**
 * Every book of the region, sold or not. The stats ranking only reaches
 * books with transactions, so a misread ISBN on a book nobody bought could
 * not be found to be corrected.
 */
@Component({
  selector: 'app-admin-books-list',
  standalone: true,
  imports: [
    RegionLinkDirective,
    CommonModule,
    RouterModule,
    TPipe, UiSkeleton, UiErrorState,
    UiSearchBarComponent,
    UiPagination,
    BookCoverPipe,
  ],
  template: `
    <div class="admin-filters">
      <ui-search-bar
        [placeholder]="'admin.searchBooks' | t"
        [value]="q"
        (search)="onSearch($event)"
      ></ui-search-bar>
    </div>

    <ui-skeleton *ngIf="loading" variant="table" [count]="5"></ui-skeleton>

    <ui-error-state *ngIf="!loading && loadError" [message]="loadError" (retry)="reload()"></ui-error-state>

    <div class="table-container">
      <table class="admin-table admin-table-clickable" *ngIf="!loading && !loadError">
        <thead>
          <tr>
            <th>{{ 'admin.colBook' | t }}</th>
            <th>{{ 'admin.book.authors' | t }}</th>
            <th>ISBN</th>
            <th class="num">{{ 'admin.stats.activeListings' | t }}</th>
            <th class="num">{{ 'admin.stats.requestCount' | t }}</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let book of books" [regionLink]="[book.id]">
            <td>
              <div class="book-cell">
                <img
                  *ngIf="book.cover_url; else noCover"
                  class="cover"
                  [src]="book.cover_url | bookCover: 1"
                  alt=""
                  loading="lazy"
                />
                <ng-template #noCover><span class="cover"></span></ng-template>
                <span class="title">{{ book.title }}</span>
              </div>
            </td>
            <td>{{ book.authors || '—' }}</td>
            <td class="isbn">{{ book.isbn13 || '—' }}</td>
            <td class="num">{{ book.active_listings }}</td>
            <td class="num">{{ book.request_count }}</td>
          </tr>
          <tr *ngIf="books.length === 0">
            <td colspan="5" class="empty-note">
              {{ (q ? 'common.noMatches' : 'common.noData') | t }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ui-pagination
      [total]="total"
      [pageSize]="pageSize"
      [currentPage]="page"
      (pageChange)="onPageChange($event)"
    ></ui-pagination>
  `,
  styles: [
    `
      .book-cell {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .cover {
        width: 32px;
        height: 44px;
        flex-shrink: 0;
        object-fit: cover;
        border-radius: 3px;
        border: 1px solid var(--line);
        background: var(--paper-warm);
      }
      .title {
        overflow-wrap: anywhere;
      }
      .isbn {
        font-family: monospace;
        white-space: nowrap;
      }
      .num {
        text-align: right;
      }
    `,
  ],
})
export class AdminBooksListComponent {
  private adminService = inject(AdminService);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);
  private regionService = inject(RegionService);

  books: AdminBook[] = [];
  total = 0;
  page = 1;
  pageSize = 20;
  q = '';
  loading = true;
  /** Why the last load failed; the table would otherwise read as empty. */
  loadError = '';
  private sub?: Subscription;

  constructor() {
    effect(() => {
      this.regionService.region();
      untracked(() => {
        this.page = 1;
        this.reload();
      });
    });
  }

  onSearch(q: string) {
    this.q = q;
    this.page = 1;
    this.reload();
  }

  onPageChange(page: number) {
    this.page = page;
    this.reload();
  }

  reload() {
    this.sub?.unsubscribe();
    this.loading = true;
    this.loadError = '';
    this.sub = this.adminService
      .getBooks({ page: this.page, q: this.q, region: this.regionService.region().toUpperCase() })
      .subscribe({
        next: (res) => {
          this.books = res.results;
          this.total = res.count;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadError = parseAdminError(err, this.i18n, 'admin.errLoadFailed');
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }
}
