import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { UiListingCard } from './listing-card.component';
import { I18nService } from '../../core/i18n.service';
import { RegionService } from '../../core/region.service';

describe('UiListingCard', () => {
  let fixture: ComponentFixture<UiListingCard>;
  let component: UiListingCard;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [UiListingCard],
      providers: [
        { provide: RegionService, useValue: { regions: () => [{ code: 'tw', currency: { code: 'TWD', decimal_places: 0 } }], currency: () => ({ code: 'TWD', decimal_places: 0 }), region: () => 'tw' } },
        provideRouter([]),
        { provide: I18nService, useValue: { lang: () => 'en', t: (key: string) => key } },
      ],
    });
    fixture = TestBed.createComponent(UiListingCard);
    component = fixture.componentInstance;
    component.item = { id: 'l1', price: 100, currency: 'TWD', condition: 'new', seller: 7, seller_name: 'Seller' };
  });

  it("offers a buyer contact and meetup", () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('book.contactSeller');
    expect(text).toContain('checkout.arrangeMeetup');
    expect(text).not.toContain('listing.manageOwn');
  });

  it("offers the seller a way to manage their own copy instead of messaging themselves", () => {
    component.isOwn = true;
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).not.toContain('book.contactSeller');
    expect(text).not.toContain('checkout.arrangeMeetup');
    const manage = fixture.debugElement.query(By.css('.own-listing a'));
    expect(manage.nativeElement.textContent).toContain('listing.manageOwn');
    expect(manage.nativeElement.getAttribute('href')).toContain('/account/listings');
  });
});
