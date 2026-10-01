import { RegionLinkDirective } from '../../core/region-link.directive';
import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { AdminService, AdminOrder } from '../../core/services/admin.service';
import { parseAdminError } from '../../core/admin-error.util';
import { TPipe, I18nService } from '../../core/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { UiButton } from '../../shared/ui/button.component';
import { ForceCancelModalComponent } from './force-cancel-modal.component';
import { PricePipe } from '../../shared/pipes/price.pipe';

@Component({
  selector: 'app-admin-order-detail',
  standalone: true,
  imports: [RegionLinkDirective, CommonModule, RouterModule, TPipe, UiButton, ForceCancelModalComponent, PricePipe],
  template: `
    <a regionLink="../.." class="back-link">&larr; {{ 'admin.backToList' | t }}</a>

    <div *ngIf="loading" class="empty-note">{{ 'common.loading' | t }}</div>

    <div class="detail-card" *ngIf="!loading && order">
      <h2>{{ order.listing?.book_title }}<span *ngIf="order.listing?.deleted" class="text-muted"> · {{ 'common.listingDeleted' | t }}</span></h2>

      <div class="field-grid">
        <div class="field"><label>{{ 'order.buyer' | t }}</label><span>{{ order.buyer?.email }}</span></div>
        <div class="field"><label>{{ 'order.seller' | t }}</label><span>{{ order.seller?.email }}</span></div>
        <div class="field"><label>{{ 'admin.colPrice' | t }}</label><span>{{ order.total_amount | price: order.currency }}</span></div>
        <div class="field"><label>{{ 'admin.colStatus' | t }}</label><span class="admin-status-badge">{{ ('order.status.' + order.status) | t }}</span></div>
      </div>

      <p *ngIf="cancelledMsg" class="inline-msg ok">{{ cancelledMsg }}</p>

      <ui-button
        variant="ghost"
        (onClick)="showForceCancelModal = true"
        [disabled]="order.status === 'cancelled' || order.status === 'completed'"
      >{{ 'admin.forceCancelButton' | t }}</ui-button>
    </div>

    <app-force-cancel-modal
      *ngIf="showForceCancelModal && order"
      [orderId]="order.id"
      (closed)="showForceCancelModal = false"
      (submitted)="onForceCancelled()"
    ></app-force-cancel-modal>
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
export class AdminOrderDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private adminService = inject(AdminService);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  order: AdminOrder | null = null;
  loading = true;
  showForceCancelModal = false;
  cancelledMsg = '';

  ngOnInit() {
    this.load();
  }

  private load() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loading = true;
    this.adminService.getOrder(id).subscribe({
      next: (order) => {
        this.order = order;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toast.error(parseAdminError(err, this.i18n, 'admin.errLoadFailed'));
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onForceCancelled() {
    this.showForceCancelModal = false;
    this.cancelledMsg = this.i18n.t('admin.forceCancelSuccess');
    this.load();
  }
}
