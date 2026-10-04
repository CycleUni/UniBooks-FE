import { RegionLinkDirective } from '../../core/region-link.directive';
import { Component, ChangeDetectorRef, DestroyRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminBook, AdminBookRecord, AdminService } from '../../core/services/admin.service';
import { parseAdminError } from '../../core/admin-error.util';
import { I18nService, TPipe } from '../../core/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { HasUnsavedChanges } from '../../core/unsaved-changes.guard';
import { BookCoverPipe } from '../../shared/pipes/book-cover.pipe';
import { AdminBookEditComponent } from './book-edit.component';
import { STATS_PAGE_STYLES } from './stats-widgets';

/** One book's catalogue record, to correct it; its sales are on the stats page. */
@Component({
  selector: 'app-admin-book-detail',
  standalone: true,
  imports: [
    RegionLinkDirective,
    CommonModule,
    RouterModule,
    TPipe,
    BookCoverPipe,
    AdminBookEditComponent,
  ],
  template: `
    <a [regionLink]="['/admin', 'books']" class="back-link">&larr; {{ 'admin.backToList' | t }}</a>

    <div *ngIf="!book && loading" class="empty-note">{{ 'common.loading' | t }}</div>
    <div *ngIf="!book && !loading" class="empty-note">{{ 'admin.errLoadFailed' | t }}</div>

    <div *ngIf="book as b" [class.stale]="loading">
      <div class="section-head-row">
        <h2 class="book-title">{{ b.title }}</h2>
        <a [regionLink]="['/admin', 'stats', 'books', b.id]" class="stats-link"
          >{{ 'admin.book.viewStats' | t }} &rarr;</a
        >
      </div>
      <div class="book-head">
        <img
          *ngIf="b.cover_url; else noCover"
          class="cover"
          [src]="b.cover_url | bookCover: 3"
          alt=""
        />
        <ng-template #noCover><span class="cover cover-empty"></span></ng-template>
        <div class="book-info">
          <p *ngIf="b.authors">{{ b.authors }}</p>
          <p class="meta">
            <span *ngIf="b.publisher">{{ b.publisher }}</span>
            <span *ngIf="b.isbn13">ISBN {{ b.isbn13 }}</span>
          </p>
          <p class="meta">
            <span>{{ 'admin.stats.activeListings' | t }} {{ b.active_listings }}</span>
            <span>{{ 'admin.stats.requestCount' | t }} {{ b.request_count }}</span>
          </p>
        </div>
      </div>

      <admin-book-edit
        *ngIf="record"
        [bookId]="b.id"
        [book]="record!"
        [initiallyOpen]="true"
        [currentSource]="b.source"
        (saved)="load()"
        (merged)="openMerged($event)"
      ></admin-book-edit>
    </div>
  `,
  styles: [
    STATS_PAGE_STYLES,
    `
      .book-title {
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .stats-link {
        color: var(--accent);
        text-decoration: none;
        font-size: var(--text-sm);
        white-space: nowrap;
      }
      .stats-link:hover {
        text-decoration: underline;
      }
      .book-head {
        display: flex;
        gap: 16px;
        align-items: flex-start;
        margin: 16px 0 24px;
      }
      .cover {
        width: 72px;
        height: 100px;
        flex-shrink: 0;
        object-fit: cover;
        border-radius: 4px;
        border: 1px solid var(--line);
        background: var(--paper-warm);
      }
      .cover-empty {
        display: inline-block;
      }
      .book-info {
        flex: 1;
        min-width: 0;
      }
      .book-info p {
        margin: 0 0 2px;
        color: var(--ink-soft);
      }
      .book-info .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: var(--text-sm);
        color: var(--muted);
      }
    `,
  ],
})
export class AdminBookDetailComponent implements HasUnsavedChanges {
  private admin = inject(AdminService);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  bookId = Number(this.route.snapshot.paramMap.get('id'));
  book: AdminBook | null = null;
  /** The book's details as the edit form takes them. */
  record: AdminBookRecord | null = null;
  loading = true;
  @ViewChild(AdminBookEditComponent) private editor?: AdminBookEditComponent;
  private sub?: Subscription;

  constructor() {
    this.load();
    // A merge sends this same component to the book it merged into.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = Number(params.get('id'));
      if (id === this.bookId) return;
      this.bookId = id;
      this.book = null;
      this.record = null;
      this.load();
    });
    this.destroyRef.onDestroy(() => this.sub?.unsubscribe());
  }

  hasUnsavedChanges(): boolean {
    return this.editor?.hasUnsavedChanges() ?? false;
  }

  unsavedChangesMessage(): string {
    return this.i18n.t('admin.book.unsavedChanges');
  }

  /** This book was folded into another; its page no longer exists. */
  openMerged(id: number) {
    this.router.navigate(['..', id], { relativeTo: this.route, replaceUrl: true });
  }

  load() {
    this.sub?.unsubscribe();
    this.loading = true;
    this.sub = this.admin.getBook(this.bookId).subscribe({
      next: (b) => {
        this.book = b;
        this.record = {
          isbn13: b.isbn13 || '',
          title: b.title,
          authors: b.authors || '',
          publisher: b.publisher || '',
          published_date: b.published_date || '',
          cover_url: b.cover_url || '',
        };
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.book = null;
        this.loading = false;
        this.toast.error(parseAdminError(err, this.i18n, 'admin.errLoadFailed'));
        this.cdr.markForCheck();
      },
    });
  }
}
