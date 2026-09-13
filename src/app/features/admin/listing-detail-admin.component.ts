import { parseAdminError } from '../../core/admin-error.util';
import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminListing } from '../../core/services/admin.service';
import { TPipe, I18nService } from '../../core/i18n.service';
import { UiButton } from '../../shared/ui/button.component';
import { UiDropdown } from '../../shared/ui/dropdown.component';
import { PricePipe } from '../../shared/pipes/price.pipe';

@Component({
  selector: 'app-admin-listing-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TPipe, UiButton, UiDropdown, PricePipe],
  template: `
    <a routerLink="../.." class="back-link">&larr; {{ 'admin.backToList' | t }}</a>

    <div *ngIf="loading" class="empty-note">{{ 'common.loading' | t }}</div>

    <div class="detail-card" *ngIf="!loading && listing">
      <h2>{{ listing.book?.title }}</h2>

      <div class="field-grid">
        <div class="field"><label>{{ 'admin.colSeller' | t }}</label><span>{{ listing.seller?.email }}</span></div>
        <div class="field"><label>{{ 'admin.colSchool' | t }}</label><span>{{ listing.school?.name || '—' }}</span></div>
        <div class="field"><label>{{ 'admin.colPrice' | t }}</label><span>{{ listing.price | price: listing.currency }}</span></div>
        <div class="field"><label>{{ 'admin.colCondition' | t }}</label><span>{{ ('cond.' + listing.condition) | t }}</span></div>
      </div>

      <ui-dropdown [label]="'admin.colStatus' | t" [options]="statusOptions" [(ngModel)]="status"></ui-dropdown>

      <div *ngIf="errorMsg" class="inline-msg error">{{ errorMsg }}</div>
      <div *ngIf="savedMsg" class="inline-msg ok">{{ savedMsg }}</div>

      <ui-button (onClick)="save()" [disabled]="saving">{{ (saving ? 'admin.saving' : 'admin.save') | t }}</ui-button>
    </div>
  `,
  styles: [`

    .detail-card { background: var(--surface-card); border: 1px solid var(--line); border-radius: 8px; padding: 24px; max-width: 520px; box-shadow: var(--shadow-card-lg); }
    .detail-card h2 { margin-top: 0; }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .field { display: flex; flex-direction: column; gap: 2px; }
    .field label { font-size: var(--text-xs); color: var(--muted); }
    .field span { font-size: var(--text-base); color: var(--ink); }
  `]
})
export class AdminListingDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private adminService = inject(AdminService);
  private i18n = inject(I18nService);
  private cdr = inject(ChangeDetectorRef);

  listing: AdminListing | null = null;
  loading = true;
  saving = false;
  errorMsg = '';
  savedMsg = '';
  status = '';

  get statusOptions() {
    return [
      { value: 'active', label: this.i18n.t('admin.listingStatus.active') },
      { value: 'reserved', label: this.i18n.t('admin.listingStatus.reserved') },
      { value: 'sold', label: this.i18n.t('admin.listingStatus.sold') },
      { value: 'removed', label: this.i18n.t('admin.listingStatus.removed') },
    ];
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.adminService.getListing(id).subscribe({
      next: (listing) => {
        this.listing = listing;
        this.status = listing.status;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  save() {
    if (!this.listing) return;
    this.saving = true;
    this.errorMsg = '';
    this.savedMsg = '';

    this.adminService.updateListingStatus(this.listing.id, this.status).subscribe({
      next: (updated) => {
        this.listing = updated;
        this.saving = false;
        this.savedMsg = this.i18n.t('admin.saved');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.saving = false;
        this.errorMsg = parseAdminError(err, this.i18n, 'admin.errGeneric');
        this.cdr.markForCheck();
      }
    });
  }
}
