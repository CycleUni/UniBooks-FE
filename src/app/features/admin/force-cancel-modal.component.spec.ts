import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ForceCancelModalComponent } from './force-cancel-modal.component';
import { AdminService } from '../../core/services/admin.service';
import { I18nService } from '../../core/i18n.service';

describe('ForceCancelModalComponent', () => {
  it('shows why the cancel was refused once the request fails', () => {
    const response = new Subject<void>();
    TestBed.configureTestingModule({
      imports: [ForceCancelModalComponent],
      providers: [
        { provide: AdminService, useValue: { forceCancelOrder: () => response } },
        { provide: I18nService, useValue: { t: (k: string) => k, lang: () => 'en' } },
      ],
    });
    const fixture = TestBed.createComponent(ForceCancelModalComponent);
    fixture.componentInstance.orderId = 'o1';
    fixture.componentInstance.reason = 'duplicate';
    fixture.detectChanges();

    fixture.componentInstance.submit();
    fixture.detectChanges();
    // The answer arrives later, outside any event in this component.
    response.error({ error: { error: { code: 'admin.errOrderAlreadyFinal' } } });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('admin.errOrderAlreadyFinal');
  });
});
