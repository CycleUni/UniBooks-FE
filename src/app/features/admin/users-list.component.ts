import { RegionLinkDirective } from '../../core/region-link.directive';
import { Component, inject, ChangeDetectorRef, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminUser } from '../../core/services/admin.service';
import { parseAdminError } from '../../core/admin-error.util';
import { TPipe, I18nService } from '../../core/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { UiSearchBarComponent } from '../../shared/ui/search-bar.component';
import { UiDropdown } from '../../shared/ui/dropdown.component';
import { UiPagination } from '../../shared/ui/pagination.component';
import { AuthStore } from '../../core/auth.store';
import { RegionService } from '../../core/region.service';

@Component({
  selector: 'app-admin-users-list',
  standalone: true,
  imports: [RegionLinkDirective, CommonModule, RouterModule, FormsModule, TPipe, UiSearchBarComponent, UiDropdown, UiPagination],
  template: `
    <div class="admin-filters">
      <ui-search-bar [placeholder]="'admin.searchUsers' | t" [value]="q" (search)="onSearch($event)"></ui-search-bar>
      <ui-dropdown [label]="'admin.filterActive' | t" [options]="activeOptions" [(ngModel)]="isActiveFilter" (ngModelChange)="reload()" [searchable]="false"></ui-dropdown>
    </div>

    <div *ngIf="loading" class="empty-note">{{ 'common.loading' | t }}</div>

    <div class="table-container">


      <table class="admin-table admin-table-clickable" *ngIf="!loading">
      <thead>
        <tr>
          <th>{{ 'admin.colRegion' | t }}</th>
          <th>{{ 'admin.colEmail' | t }}</th>
          <th>{{ 'admin.colName' | t }}</th>
          <th>{{ 'admin.colSchool' | t }}</th>
          <th>{{ 'admin.colVerified' | t }}</th>
          <th>{{ 'admin.colActive' | t }}</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let user of users" [regionLink]="[user.id]">
          <td>{{ formatRegions(user.regions) }}</td>
          <td>{{ user.email }}</td>
          <td>{{ user.display_name || (user.first_name + ' ' + user.last_name) }}</td>
          <td>{{ formatSchools(user) }}</td>
          <td>
            <span class="admin-status-badge" [class.ok]="user.is_verified">{{ (user.is_verified ? 'admin.yes' : 'admin.no') | t }}</span>
          </td>
          <td>
            <span class="admin-status-badge" [class.ok]="user.is_active">{{ (user.is_active ? 'admin.yes' : 'admin.no') | t }}</span>
          </td>
        </tr>
        <tr *ngIf="users.length === 0">
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
export class AdminUsersListComponent {
  private adminService = inject(AdminService);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);
  private authStore = inject(AuthStore);
  private regionService = inject(RegionService);

  users: AdminUser[] = [];
  total = 0;
  page = 1;
  pageSize = 20;
  q = '';
  isActiveFilter = '';
  loading = true;

  /** Whether the table the admin is looking at is narrowed by anything. An
   *  empty result then means "nothing matched", which is a different fact
   *  from "this table has no rows at all" — and only the second one should
   *  read as an empty-table message. */
  get hasFilters(): boolean {
    return !!(this.q || this.isActiveFilter);
  }

  getRegionName(code?: string): string {
    if (!code) return '';
    const reg = this.regionService.regions().find(r => r.code === code);
    return reg ? reg.localized_name : code;
  }

  formatRegions(regions?: string[]): string {
    if (!regions || regions.length === 0) return this.i18n.t('admin.noRegion');
    return regions.map(r => this.getRegionName(r)).join(', ');
  }

  formatSchools(user: AdminUser): string {
    if (user.verifications && user.verifications.length > 0) {
      if (user.verifications.length > 1) {
        return user.verifications.map(v => `${this.getRegionName(v.region)}: ${v.school_name}`).join(', ');
      }
      return user.verifications[0].school_name;
    }
    return user.school_name || '';
  }


  get activeOptions() {
    return [
      { value: '', label: this.i18n.t('admin.filterAll') },
      { value: 'true', label: this.i18n.t('admin.filterActiveOnly') },
      { value: 'false', label: this.i18n.t('admin.filterInactiveOnly') },
    ];
  }

  constructor() {
    // school_name is localized server-side, and every filter/header label
    // here goes through the i18n `t` pipe — but none of that re-fetches the
    // already-loaded rows. Re-run the query on language change so the table
    // actually reflects the new language instead of staying stuck on
    // whatever was active when the page first loaded (same fix as the user
    // detail page's school dropdown).
    effect(() => {
      this.i18n.lang();
      untracked(() => this.reload());
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
    this.loading = true;
    this.adminService.getUsers({ page: this.page, q: this.q, is_active: this.isActiveFilter, region: this.regionService.region().toUpperCase() }).subscribe({
      next: (res) => {
        this.users = res.results;
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
