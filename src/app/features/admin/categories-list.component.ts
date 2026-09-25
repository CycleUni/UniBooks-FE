import { UiButton } from '../../shared/ui/button.component';
import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiPagination } from '../../shared/ui/pagination.component';
import { UiCheckbox } from '../../shared/ui/checkbox.component';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminCategory, Paginated } from '../../core/services/admin.service';
import { parseAdminError } from '../../core/admin-error.util';
import { TPipe, I18nService } from '../../core/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { TranslationEditorComponent, TranslationField } from './translation-editor.component';
import { BulkImportModalComponent } from './bulk-import-modal.component';
import { UiTextarea } from '../../shared/ui/textarea.component';
import { AuthStore } from '../../core/auth.store';
import { RegionService } from '../../core/region.service';

@Component({
  selector: 'app-admin-categories-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TPipe, TranslationEditorComponent, BulkImportModalComponent, UiPagination, UiCheckbox, UiTextarea, UiButton],
  template: `
    <ng-container *ngIf="!showModal">
      <div class="section-head-row">
        <h2>{{ 'admin.navCategories' | t }}</h2>
        <div class="section-head-actions">
          <ui-button variant="outline" (onClick)="showImportModal = true">{{ 'admin.bulkImport' | t }}</ui-button>
          <ui-button variant="primary" (onClick)="openCreateModal()">{{ 'admin.addCollege' | t }}</ui-button>
        </div>
      </div>

      <div class="admin-filters">
      </div>

      <div class="table-container" *ngIf="categoriesData">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>{{ 'admin.colRegion' | t }}</th>
              <th>{{ 'admin.catSlug' | t }}</th>
              <th>{{ 'admin.catTitle' | t }}</th>
              <th>{{ 'admin.catSort' | t }}</th>
              <th>{{ 'admin.colActive' | t }}</th>
              <th>{{ 'admin.colActions' | t }}</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let cat of categoriesData.results">
              <td>{{ cat.id }}</td>
              <td>{{ getRegionName(cat.region) }}</td>
              <td>{{ cat.slug }}</td>
              <td>{{ cat.title }}</td>
              <td>{{ cat.sort_order }}</td>
              <td>
                <span class="admin-status-badge" [class.active]="cat.is_active">{{ (cat.is_active ? 'common.yes' : 'common.no') | t }}</span>
              </td>
              <td>
                <ui-button size="sm" variant="outline" (onClick)="openEditModal(cat)">{{ 'common.edit' | t }}</ui-button>
                <ui-button size="sm" variant="danger"  style="margin-left: 8px;" (onClick)="deleteCategory(cat.id)">{{ 'common.delete' | t }}</ui-button>
              </td>
            </tr>
            <tr *ngIf="categoriesData.results.length === 0">
              <td colspan="7" class="empty-note">{{ 'common.noMatches' | t }}</td>
            </tr>
          </tbody>
        </table>

        <ui-pagination [total]="total" [pageSize]="pageSize" [currentPage]="currentPage" (pageChange)="loadPage($event)"></ui-pagination>
      </div>
    </ng-container>

    <ng-container *ngIf="showModal">
      <div class="section-head-row">
        <div>
          <h2>{{ editingId ? ('common.edit' | t) : ('common.create' | t) }}: {{ form.title || form.slug }}</h2>
          <ui-button size="sm" variant="outline" (onClick)="showModal = false">‹ {{ 'admin.backToList' | t }}</ui-button>
        </div>
      </div>

      <div class="detail-grid">
        <div class="panel">
          <div class="form-group">
            <label>{{ 'admin.catSlug' | t }}</label>
            <input type="text" class="admin-form-control" [(ngModel)]="form.slug">
          </div>

          <div class="form-group">
            <label>{{ 'admin.catTitle' | t }}</label>
            <input type="text" class="admin-form-control" [(ngModel)]="form.title">
          </div>

          <div class="form-group">
            <label>{{ 'admin.catDesc' | t }}</label>
            <ui-textarea [(ngModel)]="form.description"></ui-textarea>
          </div>

          <div class="form-group row-group">
            <div class="col">
              <label>{{ 'admin.catSort' | t }}</label>
              <input type="number" class="admin-form-control" [(ngModel)]="form.sort_order">
            </div>
            <div class="col checkbox-col">
              <ui-checkbox [(ngModel)]="form.is_active" [label]="'admin.colActive' | t"></ui-checkbox>
            </div>
          </div>

          <div class="form-group">
            <label>{{ 'admin.translationsSection' | t }}</label>
            <app-translation-editor 
              [fields]="translationFields"
              [translations]="form.translations"
              (translationsChange)="form.translations = $event">
            </app-translation-editor>
          </div>

          <ui-button variant="primary" (onClick)="saveCategory()">{{ 'admin.save' | t }}</ui-button>
        </div>
      </div>
    </ng-container>
    
    <app-bulk-import-modal 
      [show]="showImportModal"
      [endpoint]="'categories'"
      (close)="showImportModal = false"
      (imported)="showImportModal = false; loadPage(1)">
    </app-bulk-import-modal>
  `,
  styles: [`
    .section-head-row h2 { margin-bottom: 8px; }
    .section-head-row a { text-decoration: none; cursor: pointer; }
    .detail-grid { max-width: 600px; }
    .panel { background: var(--surface-card); padding: 24px; border-radius: 8px; border: 1px solid var(--line); box-shadow: var(--shadow-card-lg); }
    .panel h3 { margin-top: 0; margin-bottom: 24px; }

    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; margin-bottom: 8px; font-weight: 600; font-size: var(--text-base); }
    .row-group { display: flex; gap: 16px; }
    .row-group .col { flex: 1; }
    .checkbox-col label { display: flex; align-items: center; gap: 8px; font-weight: normal; margin-top: 32px; cursor: pointer; }
  `]
})
export class AdminCategoriesListComponent implements OnInit {
  private adminService = inject(AdminService);
  private cdr = inject(ChangeDetectorRef);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private confirms = inject(ConfirmService);
  private authStore = inject(AuthStore);
  private regionService = inject(RegionService);

  categoriesData?: Paginated<AdminCategory>;
  currentPage = 1;
  total = 0;
  pageSize = 20;

  showModal = false;
  showImportModal = false;
  editingId: number | null = null;
  form: Partial<AdminCategory> = { slug: '', title: '', description: '', sort_order: 0, is_active: true };
  
  translationFields: TranslationField[] = [
    { key: 'title', placeholder: 'admin.collegeName', type: 'text' },
    { key: 'description', placeholder: 'admin.catDesc', type: 'textarea' }
  ];

  getRegionName(code?: string): string {
    if (!code) return '';
    const reg = this.regionService.regions().find(r => r.code === code);
    return reg ? reg.localized_name : code;
  }

  ngOnInit() {
    this.loadPage(1);
  }

  loadPage(page: number) {
    this.currentPage = page;
    const opts: any = { page: this.currentPage, region: this.regionService.region().toUpperCase() };
    
    this.adminService.getCategories(opts).subscribe({
      next: (data) => {
        this.categoriesData = data;
        this.total = data.count;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toast.error(parseAdminError(err, this.i18n, 'admin.errLoadFailed'));
        this.cdr.markForCheck();
      }
    });
  }
  
  openCreateModal() {
    this.form = { slug: '', title: '', description: '', sort_order: 0, is_active: true, translations: {} };
    this.editingId = null;
    this.showModal = true;
  }

  openEditModal(category: AdminCategory) {
    this.form = {
      slug: category.slug,
      title: category.title,
      description: category.description,
      sort_order: category.sort_order,
      is_active: category.is_active,
      translations: category.translations || {}
    };
    this.editingId = category.id;
    this.showModal = true;
  }

  saveCategory() {
    if (!this.form.slug || !this.form.title) return;
    const payload = { ...this.form };

    if (this.editingId) {
      this.adminService.updateCategory(this.editingId, payload).subscribe(() => {
        this.showModal = false;
        this.loadPage(this.currentPage);
        this.cdr.markForCheck();
      });
    } else {
      this.adminService.createCategory(payload).subscribe(() => {
        this.showModal = false;
        this.loadPage(1);
        this.cdr.markForCheck();
      });
    }
  }

  
  async deleteCategory(id: number) {
    const confirmed = await this.confirms.askDanger(this.i18n.t('admin.deleteCategoryConfirm'), {
      confirmLabel: this.i18n.t('common.delete'),
    });
    if (confirmed) {
      this.adminService.deleteCategory(id).subscribe(() => {
        this.loadPage(this.currentPage);
        this.cdr.markForCheck();
      });
    }
  }
}
