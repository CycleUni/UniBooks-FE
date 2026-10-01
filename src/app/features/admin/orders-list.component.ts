import { RegionLinkDirective } from '../../core/region-link.directive';
import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminOrder } from '../../core/services/admin.service';
import { parseAdminError } from '../../core/admin-error.util';
import { TPipe, I18nService } from '../../core/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { UiSearchBarComponent } from '../../shared/ui/search-bar.component';
import { UiDropdown } from '../../shared/ui/dropdown.component';
import { UiPagination } from '../../shared/ui/pagination.component';
import { PricePipe } from '../../shared/pipes/price.pipe';
import { AuthStore } from '../../core/auth.store';
import { RegionService } from '../../core/region.service';

@Component({
  selector: 'app-admin-orders-list',
  standalone: true,
  imports: [RegionLinkDirective, CommonModule, RouterModule, FormsModule, TPipe, UiSearchBarComponent, UiDropdown, UiPagination, PricePipe],
  template: `
    <div class="admin-filters">
      <ui-search-bar [placeholder]="'admin.searchOrders' | t" [value]="q" (search)="onSearch($event)"></ui-search-bar>
      <ui-dropdown [label]="'admin.colStatus' | t" [options]="statusOptions" [(ngModel)]="statusFilter" (ngModelChange)="reload()" [searchable]="false"></ui-dropdown>
    </div>

    <div *ngIf="loading" class="empty-note">{{ 'common.loading' | t }}</div>

    <div class="table-container">


      <table class="admin-table admin-table-clickable" *ngIf="!loading">
      <thead>
        <tr>
          <th>{{ 'admin.colRegion' | t }}</th>
          <th>{{ 'admin.colBook' | t }}</th>
          <th>{{ 'order.buyer' | t }}</th>
          <th>{{ 'order.seller' | t }}</th>
          <th>{{ 'admin.colPrice' | t }}</th>
          <th>{{ 'admin.colStatus' | t }}</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let order of orders" [regionLink]="[order.id]">
          <td>{{ getRegionName(order.region) }}</td>
          <td>{{ order.listing?.book_title }}<span *ngIf="order.listing?.deleted" class="text-muted"> · {{ 'common.listingDeleted' | t }}</span></td>
          <td>{{ order.buyer?.email }}</td>
          <td>{{ order.seller?.email }}</td>
          <td>{{ order.total_amount | price: order.currency }}</td>
          <td><span class="admin-status-badge">{{ ('order.status.' + order.status) | t }}</span></td>
        </tr>
        <tr *ngIf="orders.length === 0">
          <td colspan="6" class="empty-note">{{ (hasFilters ? 'common.noMatches' : 'common.noData') | t }}</td>
        </tr>
      </tbody>
    </table>


    </div>

    <ui-pagination [total]="total" [pageSize]="pageSize" [currentPage]="page" (pageChange)="onPageChange($event)"></ui-pagination>
  `,
  styles: [`
  `]
})
export class AdminOrdersListComponent implements OnInit {
  private adminService = inject(AdminService);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);
  private authStore = inject(AuthStore);
  private regionService = inject(RegionService);

  orders: AdminOrder[] = [];
  total = 0;
  page = 1;
  pageSize = 20;
  q = '';
  statusFilter = '';
  loading = true;

  /** Whether the table the admin is looking at is narrowed by anything. An
   *  empty result then means "nothing matched", which is a different fact
   *  from "this table has no rows at all" — and only the second one should
   *  read as an empty-table message. */
  get hasFilters(): boolean {
    return !!(this.q || this.statusFilter);
  }

  getRegionName(code?: string): string {
    if (!code) return '';
    const reg = this.regionService.regions().find(r => r.code === code);
    return reg ? reg.localized_name : code;
  }

  get statusOptions() {
    return [
      { value: '', label: this.i18n.t('admin.filterAll') },
      { value: 'pending', label: this.i18n.t('order.status.pending') },
      { value: 'accepted', label: this.i18n.t('order.status.accepted') },
      { value: 'handed_over', label: this.i18n.t('order.status.handed_over') },
      { value: 'completed', label: this.i18n.t('order.status.completed') },
      { value: 'cancelled', label: this.i18n.t('order.status.cancelled') },
    ];
  }

  ngOnInit() {
    this.reload();
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
    this.loading = true;
    this.adminService.getOrders({ page: this.page, q: this.q, status: this.statusFilter, region: this.regionService.region().toUpperCase() }).subscribe({
      next: (res) => {
        this.orders = res.results;
        this.total = res.count;
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
}
