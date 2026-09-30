import { Component, OnInit, inject, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminUser } from '../../core/services/admin.service';
import { parseAdminError } from '../../core/admin-error.util';
import { AccountService } from '../../core/services/account.service';
import { TPipe, I18nService } from '../../core/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { UiSearchBarComponent } from '../../shared/ui/search-bar.component';
import { UiDropdown } from '../../shared/ui/dropdown.component';
import { UiPagination } from '../../shared/ui/pagination.component';

@Component({
  selector: 'app-admin-managers-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TPipe, UiSearchBarComponent, UiDropdown, UiPagination],
  template: `
    <div class="admin-filters">
      <ui-search-bar [placeholder]="'admin.searchManagers' | t" [value]="q" (search)="onSearch($event)"></ui-search-bar>
      <ui-dropdown [label]="'admin.filterActive' | t" [options]="activeOptions" [(ngModel)]="isActiveFilter" (ngModelChange)="reload()" [searchable]="false"></ui-dropdown>
    </div>

    <div *ngIf="loading" class="empty-note">{{ 'common.loading' | t }}</div>

    <div class="table-container">


      <table class="admin-table" *ngIf="!loading">
      <thead>
        <tr>
          <th>{{ 'admin.colEmail' | t }}</th>
          <th>{{ 'admin.colName' | t }}</th>
          <th>{{ 'admin.colSchool' | t }}</th>
          <th>{{ 'admin.colAdmin' | t }}</th>
          <th>{{ 'admin.colActions' | t }}</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let user of users">
          <td>{{ user.email }}</td>
          <td>{{ user.display_name || (user.first_name + ' ' + user.last_name) }}</td>
          <td>{{ user.school_name }}</td>
          <td>
            <span class="admin-status-badge" [class.ok]="user.is_staff">{{ (user.is_staff ? 'admin.yes' : 'admin.no') | t }}</span>
            <span class="admin-status-badge superuser-badge" *ngIf="user.is_superuser">{{ 'admin.superuser' | t }}</span>
          </td>
          <td>
            <button 
              *ngIf="canManage(user)"
              class="btn-toggle" 
              [class.revoke]="user.is_staff" 
              (click)="toggleAdmin(user)">
              {{ (user.is_staff ? 'admin.revokeAdmin' : 'admin.grantAdmin') | t }}
            </button>
            <span *ngIf="!isSuperuser" class="text-muted text-sm">{{ 'admin.superuserOnly' | t }}</span>
          </td>
        </tr>
        <tr *ngIf="users.length === 0">
          <td colspan="5" class="empty-note">{{ (hasFilters ? 'common.noMatches' : 'common.noData') | t }}</td>
        </tr>
      </tbody>
    </table>


    </div>

    <ui-pagination [total]="total" [pageSize]="pageSize" [currentPage]="page" (pageChange)="onPageChange($event)"></ui-pagination>
  `,
  styles: [`
    .superuser-badge {
      background: var(--special-bg);
      color: var(--special-ink);
    }
    .btn-toggle {
      padding: 4px 10px;
      font-size: var(--text-sm);
      border-radius: 4px;
      /* --line-strong, not --line: a button's edge is an interactive
         boundary, and --line is 1.48:1 — below WCAG 1.4.11's 3:1. */
      border: 1px solid var(--line-strong);
      background: var(--paper);
      color: var(--ink);
      cursor: pointer;
      transition: background-color var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast);
    }
    .btn-toggle:hover {
      background: var(--paper-warm);
    }
    .btn-toggle.revoke {
      border-color: color-mix(in srgb, var(--danger) 30%, transparent);
      color: var(--danger);
    }
    .btn-toggle.revoke:hover {
      background: var(--danger-light);
    }
    .btn-toggle:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .text-muted {
      color: var(--muted);
    }
    .text-sm {
      font-size: var(--text-xs);
    }
  `]
})
export class AdminManagersListComponent implements OnInit {
  private adminService = inject(AdminService);
  private accountService = inject(AccountService);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private confirms = inject(ConfirmService);
  private cdr = inject(ChangeDetectorRef);

  users: AdminUser[] = [];
  total = 0;
  page = 1;
  pageSize = 20;
  q = '';
  isActiveFilter = 'true';
  loading = true;

  /** Whether the table the admin is looking at is narrowed by anything. An
   *  empty result then means "nothing matched", which is a different fact
   *  from "this table has no rows at all" — and only the second one should
   *  read as an empty-table message. */
  get hasFilters(): boolean {
    return !!(this.q || this.isActiveFilter);
  }
  isSuperuser = false;

  constructor() {
    effect(() => {
      const profile = this.accountService.profileCache();
      this.isSuperuser = profile?.is_superuser === true;
      this.cdr.markForCheck();
    });
  }

  get activeOptions() {
    return [
      { value: '', label: this.i18n.t('admin.filterAll') },
      { value: 'true', label: this.i18n.t('admin.filterActiveOnly') },
      { value: 'false', label: this.i18n.t('admin.filterInactiveOnly') },
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
    this.adminService.getUsers({ page: this.page, q: this.q, is_active: this.isActiveFilter }).subscribe({
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

  canManage(targetUser: AdminUser): boolean {
    return this.isSuperuser && !targetUser.is_superuser;
  }

  async toggleAdmin(user: AdminUser) {
    if (!this.canManage(user)) return;
    
    const newStaffStatus = !user.is_staff;
    const action = newStaffStatus ? this.i18n.t('admin.grantAdmin') : this.i18n.t('admin.revokeAdmin');
    // Granting can be walked back from this same screen; revoking can lock the
    // last other admin out of it, so only the revoke half gets the red button.
    const confirmed = await this.confirms.ask({
      message: this.i18n.t('admin.confirmToggleAdmin', { action, email: user.email }),
      confirmLabel: action,
      variant: newStaffStatus ? 'primary' : 'danger',
    });
    if (!confirmed) return;

    this.adminService.toggleManager(user.id, newStaffStatus).subscribe({
      next: (updatedUser) => {
        user.is_staff = updatedUser.is_staff;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to toggle admin status', err);
        this.toast.error(parseAdminError(err, this.i18n));
      }
    });
  }
}
