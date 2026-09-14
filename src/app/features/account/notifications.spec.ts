import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';

import { NotificationsComponent } from './notifications';
import { AccountService } from '../../core/services/account.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/i18n.service';
import { UiDropdown } from '../../shared/ui/dropdown.component';

describe('NotificationsComponent', () => {
  let fixture: ComponentFixture<NotificationsComponent>;
  let account: { getNotificationSettings: ReturnType<typeof vi.fn>; updateNotificationSettings: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  const el = () => fixture.nativeElement as HTMLElement;
  const toggle = () => el().querySelector('input[role="switch"]') as HTMLInputElement | null;
  const click = () => {
    const input = toggle()!;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  function create() {
    fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    account = {
      getNotificationSettings: vi.fn(() => of({ new_message_email: true, email_language: 'auto', site_language: 'zh-TW' })),
      updateNotificationSettings: vi.fn((changes: any) => of({ new_message_email: true, email_language: 'auto', site_language: 'zh-TW', ...changes })),
    };
    toast = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        { provide: AccountService, useValue: account },
        { provide: ToastService, useValue: toast },
        {
          provide: I18nService,
          useValue: {
            t: (k: string, params?: Record<string, string>) => (params ? `${k}|${JSON.stringify(params)}` : k),
            tOrNull: () => null,
            lang: signal('zh-TW'),
          },
        },
      ],
    });
  });

  it('shows the new-message email switch in its saved position, as an accessible switch', () => {
    create();

    const input = toggle()!;
    expect(input).not.toBeNull();
    expect(input.checked).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('true');
    expect(el().querySelector('#' + input.getAttribute('aria-labelledby'))?.textContent).toContain('acct.notifyNewMessageEmail');
  });

  it('saves the switch when it is turned off', () => {
    create();

    click();

    expect(account.updateNotificationSettings).toHaveBeenCalledWith({ new_message_email: false });
    expect(toggle()!.checked).toBe(false);
    expect(toggle()!.getAttribute('aria-checked')).toBe('false');
    expect(toast.success).toHaveBeenCalledWith('acct.notifySaved');
  });

  it('puts the switch back and says so when saving fails', () => {
    account.updateNotificationSettings.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    create();

    click();

    expect(toggle()!.checked).toBe(true);
    expect(toggle()!.getAttribute('aria-checked')).toBe('true');
    expect(toast.error).toHaveBeenCalledWith('acct.notifySaveFailed');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('holds the switch still while a save is in progress', () => {
    const pending = new Subject<any>();
    account.updateNotificationSettings.mockReturnValue(pending);
    create();

    click();
    expect(toggle()!.disabled).toBe(true);

    pending.next({ new_message_email: false });
    pending.complete();
    fixture.detectChanges();
    expect(toggle()!.disabled).toBe(false);
  });

  it('offers a retry when the settings cannot be loaded', () => {
    account.getNotificationSettings.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    create();

    expect(toggle()).toBeNull();
    const retry = el().querySelector('ui-error-state button') as HTMLButtonElement;
    expect(retry).not.toBeNull();

    retry.click();
    fixture.detectChanges();

    expect(account.getNotificationSettings).toHaveBeenCalledTimes(2);
    expect(toggle()!.checked).toBe(true);
  });

  describe('email language', () => {
    const dropdown = () => fixture.debugElement.query(By.directive(UiDropdown)).componentInstance as UiDropdown;
    const pick = (value: string) => {
      dropdown().selectOption({ value, label: value });
      fixture.detectChanges();
    };

    it('offers following the site, naming the language that means right now, and each language', async () => {
      create();
      // ngModel hands the initial value to the control a microtask later.
      await fixture.whenStable();

      const options = dropdown().options;
      expect(options.map(o => o.value)).toEqual(['auto', 'zh-TW', 'zh-HK', 'en']);
      expect(options[0].label).toBe('acct.emailLanguageAuto|{"lang":"中文 (繁體)"}');
      expect(dropdown().value).toBe('auto');
    });

    it('saves a chosen language', () => {
      create();

      pick('en');

      expect(account.updateNotificationSettings).toHaveBeenCalledWith({ email_language: 'en' });
      expect(dropdown().value).toBe('en');
      expect(toast.success).toHaveBeenCalledWith('acct.notifySaved');
    });

    it('puts the choice back and says so when saving fails', () => {
      account.updateNotificationSettings.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      create();

      pick('en');

      expect(dropdown().value).toBe('auto');
      expect(toast.error).toHaveBeenCalledWith('acct.notifySaveFailed');
    });
  });
});

