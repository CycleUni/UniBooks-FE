import { UiButton } from '../../shared/ui/button.component';
import { RegionLinkDirective } from '../../core/region-link.directive';
import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminSchool, Paginated } from '../../core/services/admin.service';
import { TPipe, I18nService } from '../../core/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { parseAdminError } from '../../core/admin-error.util';
import { TranslationEditorComponent, TranslationField } from './translation-editor.component';

@Component({
  selector: 'app-admin-school-detail',
  standalone: true,
  imports: [RegionLinkDirective, CommonModule, RouterModule, FormsModule, TPipe, TranslationEditorComponent, UiButton],
  template: `
    <div class="header-actions">
      <div>
        <h2>{{ 'common.edit' | t }}: {{ school?.name }} <code *ngIf="school?.code">{{ school?.code }}</code></h2>
        <ui-button size="sm" variant="outline" regionLink="..">‹ {{ 'admin.backToList' | t }}</ui-button>
      </div>
    </div>

    <div class="detail-grid" *ngIf="school">
      <div class="panel">
        <h3>{{ 'admin.schoolName' | t }}</h3>
        
        <div class="form-group">
          <label>{{ 'admin.schoolName' | t }}</label>
          <input type="text" class="admin-form-control" [(ngModel)]="editData.name">
        </div>
        
        <div class="form-group">
          <label>{{ 'admin.colDomain' | t }}</label>
          <input type="text" class="admin-form-control" [(ngModel)]="editData.email_domain">
        </div>

        <div class="form-group">
          <label for="school-code">{{ 'admin.schoolCode' | t }}</label>
          <input id="school-code" type="text" class="admin-form-control code-input" maxlength="20" [(ngModel)]="editData.code">
          <small class="hint">{{ 'admin.schoolCodeDesc' | t }}</small>
        </div>

        <div class="form-group">
          <label>{{ 'admin.translationsSection' | t }}</label>
          <app-translation-editor 
            [fields]="translationFields"
            [translations]="editData.translations"
            (translationsChange)="editData.translations = $event">
          </app-translation-editor>
        </div>

        <ui-button variant="primary" (onClick)="saveSchool()">{{ 'admin.save' | t }}</ui-button>
      </div>
    </div>
  `,
  styles: [`
    .header-actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .header-actions h2 { margin-bottom: 8px; }
    .header-actions a { text-decoration: none; }
    .detail-grid { max-width: 600px; }
    .panel { background: var(--surface-card); padding: 24px; border-radius: 8px; border: 1px solid var(--line); box-shadow: var(--shadow-card-lg); }
    .panel h3 { margin-top: 0; margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; margin-bottom: 8px; font-weight: 600; }
    .code-input { text-transform: uppercase; }
    .hint { display: block; margin-top: 4px; color: var(--muted); font-size: var(--text-xs); }
  `]
})
export class AdminSchoolDetailComponent implements OnInit {
  private adminService = inject(AdminService);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);

  schoolId!: string;
  school?: AdminSchool;
  editData: Partial<AdminSchool> = { name: '', email_domain: '', code: '' };
  
  translationFields: TranslationField[] = [
    { key: 'name', placeholder: 'admin.schoolName', type: 'text' }
  ];

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.schoolId = params.get('id')!;
      this.loadSchool();
    });
  }

  loadSchool() {
    this.adminService.getSchool(this.schoolId).subscribe(data => {
      this.school = data;
      this.editData = { name: data.name, email_domain: data.email_domain, code: data.code, translations: data.translations || {} };
      this.cdr.markForCheck();
    });
  }

  saveSchool() {
    const payload = { ...this.editData, code: (this.editData.code || '').trim().toUpperCase() };
    this.adminService.updateSchool(this.schoolId, payload).subscribe({
      next: data => {
        this.school = data;
        this.editData = { name: data.name, email_domain: data.email_domain, code: data.code, translations: data.translations || {} };
        this.cdr.markForCheck();
      },
      // Silently doing nothing left the old code on the page looking saved;
      // a code already used in this region is the likely reason, and says so.
      error: err => {
        this.toast.error(parseAdminError(err, this.i18n));
        this.cdr.markForCheck();
      }
    });
  }
}
