import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SellerPageComponent } from './seller';
import { AccountService } from '../../core/services/account.service';
import { ListingService } from '../../core/services/listing.service';
import { I18nService } from '../../core/i18n.service';
import { RegionService } from '../../core/region.service';
import { SeoService } from '../../core/services/seo.service';
import { en } from '../../core/i18n/en';

describe('SellerPageComponent', () => {
  let fixture: ComponentFixture<SellerPageComponent>;
  let component: SellerPageComponent;
  let getPublicUserProfile: ReturnType<typeof vi.fn>;
  let getListings: ReturnType<typeof vi.fn>;

  const i18n = {
    lang: () => 'en',
    t: (key: string, params?: Record<string, string | number>) => {
      let text = en[key] ?? key;
      for (const [name, value] of Object.entries(params ?? {})) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
      return text;
    },
  };

  beforeEach(async () => {
    getPublicUserProfile = vi.fn().mockReturnValue(of({
      id: 'seller1',
      display_name: 'Alice',
      school_name: 'NTU',
      created_at: '2025-01-01',
    }));
    getListings = vi.fn().mockReturnValue(of({
      count: 2,
      results: [{ id: 'l1', price: 100 }],
    }));

    await TestBed.configureTestingModule({
      imports: [SellerPageComponent, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'seller1' })) } },
        { provide: AccountService, useValue: { getPublicUserProfile } },
        { provide: ListingService, useValue: { getListings } },
        { provide: I18nService, useValue: i18n },
        { provide: RegionService, useValue: { region: () => 'tw', currency: () => ({ code: 'TWD', symbol: 'NT$', decimal_places: 0 }) } },
        { provide: SeoService, useValue: { setPage: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SellerPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads seller and listings initially', () => {
    expect(getPublicUserProfile).toHaveBeenCalledWith('seller1');
    expect(getListings).toHaveBeenCalledWith(undefined, 'seller1', 1);
    expect(component.seller?.display_name).toBe('Alice');
    expect(component.listings.length).toBe(1);
  });

  it('appends listings on onLoadMore on phones', () => {
    component.isPhone = true;
    fixture.detectChanges();

    expect(component.hasMoreListings).toBe(true);

    getListings.mockReturnValue(of({
      count: 2,
      results: [{ id: 'l2', price: 200 }],
    }));

    component.onLoadMore();

    expect(getListings).toHaveBeenCalledWith(undefined, 'seller1', 2);
    expect(component.listings.length).toBe(2);
    expect(component.hasMoreListings).toBe(false);
  });
});
