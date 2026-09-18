import { UiFocusTrapDirective } from '../../shared/ui/focus-trap.directive';
import { UiButton } from '../../shared/ui/button.component';
import { parseAdminError } from '../../core/admin-error.util';
import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiPagination } from '../../shared/ui/pagination.component';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminSchool, Paginated } from '../../core/services/admin.service';
import { TPipe, I18nService } from '../../core/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { RegionService } from '../../core/region.service';
import { UiSearchBarComponent } from '../../shared/ui/search-bar.component';
import { BulkImportModalComponent } from './bulk-import-modal.component';

@Component({
  selector: 'app-admin-schools-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TPipe, UiSearchBarComponent, BulkImportModalComponent, UiPagination, UiButton, UiFocusTrapDirective],
  template: `
    <div class="header-actions">
      <h2>{{ 'admin.navSchools' | t }}</h2>
      <div>
        <ui-button variant="outline"  class="mr-3" (onClick)="showImportModal = true">{{ 'admin.bulkImport' | t }}</ui-button>
        <ui-button variant="primary" (onClick)="openCreateModal()">{{ 'admin.addSchool' | t }}</ui-button>
      </div>
    </div>

    <div class="admin-filters">
      <ui-search-bar [placeholder]="'admin.searchSchools' | t" [value]="q" (search)="onSearch($event)"></ui-search-bar>
    </div>

    <div class="table-container" *ngIf="schoolsData">
      <table class="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>{{ 'admin.schoolCode' | t }}</th>
            <th>{{ 'admin.schoolName' | t }}</th>
            <!-- The name in each of the region's own languages, read from the
                 translations: zh-TW in Taiwan, zh-HK in Hong Kong. -->
            <th *ngFor="let lang of languages()">{{ 'admin.schoolNameIn' | t:{ lang: lang } }}</th>
            <th>{{ 'admin.colDomain' | t }}</th>
            <th>{{ 'admin.colActions' | t }}</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let school of schoolsData.results">
            <td>{{ school.id }}</td>
            <td><code>{{ school.code }}</code></td>
            <td>{{ school.name }}</td>
            <td *ngFor="let lang of languages()" [class.missing]="!school.translations?.[lang]?.name">{{ school.translations?.[lang]?.name || ('admin.translationMissing' | t) }}</td>
            <td>{{ school.email_domain }}</td>
            <td>
              <ui-button size="sm" variant="outline" [link]="[school.id]">{{ 'common.edit' | t }}</ui-button>
              <ui-button size="sm" variant="danger" (onClick)="deleteSchool(school)"  style="margin-left: 8px;" [hostClass]="!!school.user_count ? 'is-blocked' : ''" [attr.aria-disabled]="school.user_count ? 'true' : null">{{ 'common.delete' | t }}</ui-button>
            </td>
          </tr>
        </tbody>
      </table>

      <ui-pagination [total]="total" [pageSize]="pageSize" [currentPage]="currentPage" (pageChange)="loadPage($event)"></ui-pagination>
    </div>

    <div class="app-modal-overlay" *ngIf="showCreateModal" (click)="showCreateModal = false">
      <div class="app-modal"  style="width: 400px; max-width: 90%;" (click)="$event.stopPropagation()" uiFocusTrap="schools-modal-title" (escape)="showCreateModal = false">
        <h3 id="schools-modal-title" class="app-modal-title">{{ 'admin.addSchool' | t }}</h3>
        <div class="app-modal-body">
          <div class="form-group">
            <label>{{ 'admin.schoolName' | t }}</label>
            <input type="text" class="admin-form-control" [(ngModel)]="newSchool.name">
          </div>
          <div class="form-group">
            <label>{{ 'admin.colDomain' | t }}</label>
            <input type="text" class="admin-form-control" [(ngModel)]="newSchool.email_domain" [placeholder]="'admin.domainDesc' | t">
          </div>
          <div class="form-group">
            <label for="new-school-code">{{ 'admin.schoolCode' | t }}</label>
            <input id="new-school-code" type="text" class="admin-form-control code-input" maxlength="20" [(ngModel)]="newSchool.code" [placeholder]="'admin.schoolCodeDesc' | t">
          </div>
          <div class="form-group">
            <label>{{ 'admin.translationsSection' | t }}</label>
            <!-- One field per language of the region the school is added to;
                 this used to be a fixed zh-TW, which filed Hong Kong schools'
                 Chinese names under the Taiwanese key. -->
            <div class="translation-row" *ngFor="let lang of languages()">
              <label class="lang-tag" [for]="'new-school-name-' + lang">{{ lang }}</label>
              <input [id]="'new-school-name-' + lang" type="text" class="admin-form-control" [(ngModel)]="newSchoolNames[lang]" [placeholder]="'admin.schoolName' | t">
            </div>
          </div>
        </div>
        <div class="app-modal-actions">
          <ui-button variant="secondary" (onClick)="showCreateModal = false">{{ 'common.cancel' | t }}</ui-button>
          <ui-button variant="primary" (onClick)="createSchool()">{{ 'admin.save' | t }}</ui-button>
        </div>
      </div>
    </div>

    <app-bulk-import-modal 
      [show]="showImportModal"
      endpoint="schools"
      (close)="showImportModal = false"
      (imported)="showImportModal = false; loadPage(1)">
    </app-bulk-import-modal>
  `,
  styles: [`
    .header-actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; margin-bottom: 8px; font-weight: 600; }
    .translation-row { display: flex; align-items: center; gap: 8px; }
    .translation-row + .translation-row { margin-top: 8px; }
    .form-group .translation-row label.lang-tag { display: inline-block; margin-bottom: 0; }
    td.missing { color: var(--muted); }
    .code-input { text-transform: uppercase; }
    .lang-tag { flex: 0 0 auto; padding: 4px 8px; border-radius: 4px; background: var(--paper-warm); font-size: var(--text-xs); font-weight: 600; }
  `]
})
export class AdminSchoolsListComponent implements OnInit {
  private adminService = inject(AdminService);
  private cdr = inject(ChangeDetectorRef);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private confirms = inject(ConfirmService);
  private regionService = inject(RegionService);

  schoolsData?: Paginated<AdminSchool>;
  currentPage = 1;
  total = 0;
  pageSize = 20;
  q = '';

  showCreateModal = false;
  showImportModal = false;
  newSchool: Partial<AdminSchool> = { name: '', email_domain: '', code: '' };
  /** Localized names for a new school, keyed by language. */
  newSchoolNames: Record<string, string> = {};
  readonly languages = this.regionService.translationLanguages;

  ngOnInit() {
    this.loadPage(1);
  }

  loadPage(page: number) {
    this.currentPage = page;
    this.adminService.getSchools({ page: this.currentPage, q: this.q }).subscribe({
      next: (data) => {
        this.schoolsData = data;
        this.total = data.count;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.cdr.markForCheck();
      }
    });
  }

  onSearch(q: string) {
    this.q = q;
    this.loadPage(1);
  }

  async deleteSchool(school: AdminSchool) {
    if (school.user_count) {
      this.toast.error(this.i18n.t('admin.deleteSchoolBlocked', { n: school.user_count }));
      return;
    }
    const confirmed = await this.confirms.askDanger(this.i18n.t('admin.deleteSchoolConfirm'), {
      confirmLabel: this.i18n.t('common.delete'),
    });
    if (!confirmed) return;
    this.adminService.deleteSchool(school.id).subscribe({
      next: () => {
        this.loadPage(this.currentPage);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toast.error(err?.error?.detail || this.i18n.t('admin.errDeleteFailed'));
        this.cdr.markForCheck();
      }
    });
  }

  openCreateModal() {
    this.newSchool = { name: '', email_domain: '', code: '' };
    this.newSchoolNames = {};
    this.showCreateModal = true;
  }

  createSchool() {
    if (!this.newSchool.name || !this.newSchool.email_domain) return;
    // The region is part of the school's identity now — its code only has
    // to be unique inside it — so it is sent rather than left for the
    // backend to reject as missing.
    const payload: Partial<AdminSchool> = {
      ...this.newSchool,
      code: (this.newSchool.code || '').trim().toUpperCase(),
      region: this.regionService.region().toUpperCase(),
    };
    const translations: Record<string, { name: string }> = {};
    for (const [lang, name] of Object.entries(this.newSchoolNames)) {
      if (name && name.trim()) translations[lang] = { name: name.trim() };
    }
    if (Object.keys(translations).length) {
      payload.translations = translations;
    }
    this.adminService.createSchool(payload).subscribe({
      next: () => {
        this.showCreateModal = false;
        this.cdr.markForCheck();
        this.loadPage(1);
      },
      // Kept open on failure so a clashing code can be corrected in place.
      error: (err) => {
        this.toast.error(parseAdminError(err, this.i18n));
        this.cdr.markForCheck();
      }
    });
  }
}
