import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TPipe, I18nService } from '../../core/i18n.service';
import { AccountService, EmailLanguage, NotificationSettings } from '../../core/services/account.service';
import { LANG_LABELS } from '../../core/i18n';
import { UiDropdown } from '../../shared/ui/dropdown.component';
import { ToastService } from '../../core/services/toast.service';
import { parseApiError } from '../../core/api-error.util';
import { UiErrorState } from '../../shared/ui/error-state.component';
import { UiSkeleton } from '../../shared/ui/skeleton.component';

/**
 * /account/notifications — the account page's Notifications section.
 *
 * Its own page rather than a block inside Settings so that further switches
 * (other emails the site sends) have somewhere to go.
 */
@Component({
  selector: 'app-account-notifications',
  standalone: true,
  imports: [CommonModule, FormsModule, TPipe, UiErrorState, UiSkeleton, UiDropdown],
  template: `
    <h2 class="section-heading">{{ 'acct.notificationsTitle' | t }}</h2>

    <ui-skeleton *ngIf="loading()" variant="row" [count]="1"></ui-skeleton>

    <ui-error-state
      *ngIf="loadFailed()"
      [message]="'acct.notifyLoadFailed' | t"
      (retry)="load()"
    ></ui-error-state>

    <ul class="notification-list" *ngIf="settings() as current">
      <li class="notification-row">
        <div class="notification-text">
          <span class="notification-label" id="notify-new-message-label">{{ 'acct.notifyNewMessageEmail' | t }}</span>
          <p class="notification-desc" id="notify-new-message-desc">{{ 'acct.notifyNewMessageEmailDesc' | t }}</p>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            [checked]="current.new_message_email"
            [disabled]="saving()"
            [attr.aria-checked]="current.new_message_email"
            aria-labelledby="notify-new-message-label"
            aria-describedby="notify-new-message-desc"
            (change)="setNewMessageEmail($any($event.target))"
          />
          <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
        </label>
      </li>
      <li class="notification-row">
        <div class="notification-text">
          <span class="notification-label" id="email-language-label">{{ 'acct.emailLanguage' | t }}</span>
          <p class="notification-desc">{{ 'acct.emailLanguageDesc' | t }}</p>
        </div>
        <ui-dropdown
          #emailLanguageDropdown
          class="email-language"
          [options]="emailLanguageOptions()"
          [ngModel]="current.email_language"
          (ngModelChange)="setEmailLanguage($event)"
          [searchable]="false"
          [triggerAriaLabel]="'acct.emailLanguage' | t"
        ></ui-dropdown>
      </li>
    </ul>
  `,
  styles: [`
    .notification-list {
      list-style: none;
      margin: 0;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--surface-card);
    }
    .notification-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      padding: var(--space-4) var(--space-5);
    }
    .notification-row + .notification-row {
      border-top: 1px solid var(--line);
    }
    .email-language {
      flex-shrink: 0;
      min-width: 12rem;
    }
    .notification-label {
      font-weight: 600;
      color: var(--ink);
    }
    .notification-desc {
      margin: var(--space-2) 0 0;
      font-size: var(--text-sm);
      color: var(--ink-soft);
      max-width: 60ch;
    }

    /* A native checkbox with role="switch", so keyboard, focus and screen
       readers behave as they do for any form control; only its look changes. */
    .switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
      min-height: var(--tap-min);
      cursor: pointer;
    }
    .switch input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      opacity: 0;
      cursor: inherit;
    }
    .switch input:disabled {
      cursor: progress;
    }
    .switch-track {
      width: 40px;
      height: 22px;
      border-radius: 11px;
      background: var(--line-strong);
      display: inline-flex;
      align-items: center;
      padding: 2px;
      box-sizing: border-box;
      transition: background-color 0.15s ease;
    }
    .switch-thumb {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--paper);
      transition: transform 0.15s ease;
    }
    .switch input:checked + .switch-track {
      background: var(--accent);
    }
    .switch input:checked + .switch-track .switch-thumb {
      transform: translateX(18px);
    }
    .switch input:disabled + .switch-track {
      opacity: 0.6;
    }
    .switch input:focus-visible + .switch-track {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .switch-track, .switch-thumb { transition: none; }
    }
  `]
})
export class NotificationsComponent implements OnInit {
  private accountService = inject(AccountService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  readonly settings = signal<NotificationSettings | null>(null);
  readonly loading = signal(false);
  readonly loadFailed = signal(false);
  readonly saving = signal(false);

  @ViewChild('emailLanguageDropdown') private emailLanguageDropdown?: UiDropdown;

  /** "Follow the site" says which language that is right now, on this device. */
  readonly emailLanguageOptions = computed(() => [
    { value: 'auto', label: this.i18n.t('acct.emailLanguageAuto', { lang: LANG_LABELS[this.i18n.lang()] }) },
    ...Object.entries(LANG_LABELS).map(([value, label]) => ({ value, label })),
  ]);

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.accountService.getNotificationSettings().subscribe({
      next: (settings) => {
        this.settings.set(settings);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadFailed.set(true);
      },
    });
  }

  setEmailLanguage(language: EmailLanguage) {
    const previous = this.settings();
    if (!previous || previous.email_language === language) return;

    this.settings.set({ ...previous, email_language: language });
    this.saving.set(true);
    this.accountService.updateNotificationSettings({ email_language: language }).subscribe({
      next: (saved) => {
        this.settings.set(saved);
        this.saving.set(false);
        this.toast.success(this.i18n.t('acct.notifySaved'));
      },
      error: (err) => {
        this.settings.set(previous);
        // Same reason as the switch below: the binding may not see a change
        // to put back, so tell the dropdown directly.
        this.emailLanguageDropdown?.writeValue(previous.email_language);
        this.saving.set(false);
        this.toast.error(parseApiError(err, this.i18n, 'acct.notifySaveFailed'));
      },
    });
  }

  setNewMessageEmail(input: HTMLInputElement) {
    const enabled = input.checked;
    const previous = this.settings();
    if (!previous || previous.new_message_email === enabled) return;

    // Show the new position straight away; put it back if the save fails, so
    // the switch never claims a setting the server does not have.
    this.settings.set({ ...previous, new_message_email: enabled });
    this.saving.set(true);
    this.accountService.updateNotificationSettings({ new_message_email: enabled }).subscribe({
      next: (saved) => {
        this.settings.set(saved);
        this.saving.set(false);
        this.toast.success(this.i18n.t('acct.notifySaved'));
      },
      error: (err) => {
        this.settings.set(previous);
        // The binding alone may not move the switch back: if nothing rendered
        // the optimistic value, [checked] sees no change and leaves the box
        // where the click put it.
        input.checked = previous.new_message_email;
        this.saving.set(false);
        this.toast.error(parseApiError(err, this.i18n, 'acct.notifySaveFailed'));
      },
    });
  }
}
