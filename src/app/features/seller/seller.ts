import { Component, OnInit, inject, ChangeDetectorRef, effect, untracked } from '@angular/core';
import { SeoService } from '../../core/services/seo.service';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RegionService } from '../../core/region.service';

import { AccountService } from '../../core/services/account.service';
import { ListingService } from '../../core/services/listing.service';
import { UiSkeleton } from '../../shared/ui/skeleton.component';
import { UiListingRow } from '../../shared/ui/listing-row.component';
import { UiPagination } from '../../shared/ui/pagination.component';
import { UiBreadcrumb, BreadcrumbItem } from '../../shared/ui/breadcrumb.component';
import { TPipe, I18nService } from '../../core/i18n.service';
import { RegionLinkService } from '../../core/region-link.service';
import { isSameRegion } from '../../core/region-path';
import { isUserVerifiedIn } from '../../core/verification';

@Component({
  selector: 'app-seller-page',
  standalone: true,
  imports: [CommonModule, UiSkeleton, UiListingRow, UiPagination, UiBreadcrumb, TPipe],
  template: `
    <div class="container container--narrow seller-page" *ngIf="seller">
      <ui-breadcrumb [items]="breadcrumbItems"></ui-breadcrumb>

      <div class="seller-header">
        <div class="seller-avatar" *ngIf="!avatarUrl">
          {{ getAvatarInitial() }}
        </div>
        <div class="seller-avatar-image-container" *ngIf="avatarUrl">
          <img [src]="avatarUrl" [attr.alt]="seller.display_name ? (seller.display_name + ' ' + ('acct.avatarAlt' | t)) : ('acct.avatarAlt' | t)" class="seller-avatar-image" referrerpolicy="no-referrer">
        </div>
        <div class="seller-info">
          <h1 class="seller-name">{{ seller.display_name }}</h1>
          <div class="seller-meta">
            <span class="seller-school">
              {{ seller.school_name }}
              <span class="verified-badge" *ngIf="isSellerVerified()" [title]="'seller.verifiedBadge' | t">✓</span>
            </span>
            <span class="seller-joined">
              {{ 'seller.joined' | t }}{{ getFormattedDate(seller.created_at) }}
            </span>
          </div>
          <div class="seller-stats mt-2"  style="font-size: var(--text-base); color: var(--ink); display: flex; gap: 16px;">
            <span *ngIf="seller.review_count > 0">⭐️ {{ seller.average_rating }} ({{ seller.review_count }})</span>
            <span *ngIf="seller.review_count === 0" class="muted">{{ 'seller.noReviews' | t }}</span>
            <span *ngIf="seller.no_show_count > 0" style="color: var(--flag); font-weight: 500;">⚠️ {{ 'seller.noShowCount' | t:{n: seller.no_show_count} }}</span>
          </div>
        </div>
      </div>

      <div class="seller-listings">
        <h2>{{ 'seller.listingsTitle' | t:{name: seller.display_name} }}</h2>
        
        <div class="listings-grid" *ngIf="!loadingListings && listings.length > 0">
          <ui-listing-row
            *ngFor="let listing of listings"
            [title]="listing.book_title || listing.book?.title"
            [metaInfo]="listing.book_authors || listing.book?.authors || ('home.unknownAuthor' | t)"
            [courseInfo]="getCourseOrNoteInfo(listing)"
            [noteInfo]="listing.description ? (('sell.note' | t) + ': ' + listing.description) : undefined"
            [price]="listing.price"
            [coverUrl]="(listing.photos && listing.photos.length > 0) ? listing.photos[0] : (listing.book_cover_url || listing.book?.cover_url)"
            [condition]="listing.condition"
            [waitlistCount]="listing.waitlist_count"
            (click)="goToListing(listing.id)"
          ></ui-listing-row>
        </div>
        
        <ui-pagination *ngIf="totalListings > 20" [total]="totalListings" [pageSize]="20" [currentPage]="currentPage" (pageChange)="onPageChange($event)"></ui-pagination>

        <div class="empty-state" *ngIf="!loadingListings && listings.length === 0">
          <p>{{ 'seller.noListings' | t }}</p>
        </div>
        
        <ui-skeleton *ngIf="loadingListings" [count]="5"></ui-skeleton>
      </div>
    </div>
    
    <div class="not-found" *ngIf="error">
      <h2>{{ 'seller.notFound' | t }}</h2>
      <p>{{ 'seller.notFoundDesc' | t }}</p>
      <button (click)="goHome()">{{ 'checkout.backHome' | t }}</button>
    </div>
  `,
  styles: [`
    /* Width comes from .container--narrow: a seller profile is one subject
       plus its listings, the same shape as a book or a listing page. */
    .seller-page {
      padding-block: var(--space-5);
    }
    
    .seller-header {
      display: flex;
      align-items: center;
      gap: 24px;
      background: var(--paper-warm);
      border: 1px solid var(--line);
      padding: 32px;
      border-radius: 12px;
      margin-bottom: 32px;
    }

    .seller-avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background-color: var(--accent);
      color: var(--on-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--text-2xl);
      font-weight: 700;
    }
    .seller-avatar-image-container {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      overflow: hidden;
    }
    .seller-avatar-image {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .seller-name {
      margin: 0 0 8px 0;
      font-size: var(--text-3xl);
      font-weight: 700;
      color: var(--ink);
    }

    .seller-meta {
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: var(--muted);
      font-size: var(--text-base);
    }

    .seller-school {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .verified-badge {
      background: var(--success);
      color: var(--on-success);
      border-radius: 50%;
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: var(--text-xs);
      margin-left: 4px;
    }

    .seller-listings h2 {
      font-size: var(--text-xl);
      font-weight: 600;
      margin-bottom: 20px;
      color: var(--ink);
    }

    .listings-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .empty-state, .loading, .not-found {
      text-align: center;
      padding: 60px 20px;
      color: var(--muted);
    }
    
    .not-found button {
      margin-top: 16px;
      padding: 8px 24px;
      border: none;
      border-radius: 20px;
      background: var(--accent);
      color: var(--on-accent);
      cursor: pointer;
    }
  `]
})
export class SellerPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private regionLink = inject(RegionLinkService);
  private accountService = inject(AccountService);
  private listingService = inject(ListingService);
  private seo = inject(SeoService);
  public regionService = inject(RegionService);
  private i18n = inject(I18nService);
  private cdr = inject(ChangeDetectorRef);

  seller: any = null;
  listings: any[] = [];
  loadingListings = false;
  error = false;
  totalListings = 0;
  currentPage = 1;
  averageRating = 0;
  reviewCount = 0;
  noShowCount = 0;
  avatarUrl = '';
  
  private currentId: string | null = null;

  /** Home › <seller name>. */
  get breadcrumbItems(): BreadcrumbItem[] {
    if (!this.seller) return [];
    return [
      { labelKey: 'nav.home', link: '/' },
      { label: this.seller.display_name }
    ];
  }

  constructor() {
    effect(() => {
      this.i18n.lang();
      untracked(() => {
        if (this.currentId) {
          this.loadSeller(this.currentId);
        }
      });
    });
  }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      this.currentId = id;
      if (id) {
        this.loadSeller(id);
      }
    });
  }

  loadSeller(id: string) {
    this.accountService.getPublicUserProfile(id).subscribe({
      next: (profile) => {
        this.seller = profile;
        this.averageRating = profile.average_rating || 0;
        this.reviewCount = profile.review_count || 0;
        this.noShowCount = profile.no_show_count || 0;
        this.avatarUrl = profile.avatar_url || '';
        // A key, not a resolved string, so a language switch re-titles the tab.
        this.seo.setPage({ titleKey: 'seller.pageTitle', titleParams: { name: this.seller.display_name } });
        this.cdr.detectChanges();
        this.loadListings(id);
      },
      error: (err) => {
        this.error = true;
        this.cdr.detectChanges();
      }
    });
  }

  loadListings(sellerId: string) {
    this.loadingListings = true;
    this.cdr.detectChanges();
    this.listingService.getListings(undefined, sellerId, this.currentPage).subscribe({
      next: (data: any) => {
        if (data.results) {
          this.listings = data.results;
          this.totalListings = data.count || this.listings.length;
        } else {
          this.listings = data || [];
          this.totalListings = this.listings.length;
        }
        this.loadingListings = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingListings = false;
        this.cdr.detectChanges();
      }
    });
  }

  onPageChange(page: number) {
    this.currentPage = page;
    if (this.currentId) {
      this.loadListings(this.currentId);
    }
  }

  goToListing(id: string) {
    this.router.navigate(this.regionLink.path(['/listing', id]));
  }

  goHome() {
    this.router.navigate(this.regionLink.path(['/']));
  }

  isSellerVerified(): boolean {
    return isUserVerifiedIn(this.seller?.verifications, this.regionService.region());
  }

  getAvatarInitial(): string {
    const last = this.seller?.last_name || '';
    const first = this.seller?.first_name || '';
    if (/[A-Za-z]/.test(last) || /[A-Za-z]/.test(first)) {
      return (first.charAt(0) || last.charAt(0) || this.i18n.t('acct.avatarFallback')).toUpperCase();
    }
    return (last.charAt(0) || first.charAt(0) || this.i18n.t('acct.avatarFallback')).toUpperCase();
  }

  getFormattedDate(dateString: string): string {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      const lang = this.i18n.lang() === 'zh-TW' ? 'zh-TW' : 'en-US';
      return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
    } catch (e) {
      return dateString.substring(0, 10);
    }
  }

  getCourseOrNoteInfo(listing: any): string {
    if (listing.course_name) {
      return `${this.i18n.t('sell.course')}: ${listing.course_name}`;
    }
    return '';
  }
}
