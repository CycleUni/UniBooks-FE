import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { UiRecentListings, RECENT_BOOKS_PAGE_SIZE } from './recent-listings.component';
import { ListingService } from '../../core/services/listing.service';
import { I18nService } from '../../core/i18n.service';
import { RegionService } from '../../core/region.service';
import { hasBookPreviewState } from '../../core/book-preview';

@Component({ template: '' })
class Blank {}

describe('UiRecentListings', () => {
  let listingService: { getRecentBooks: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    listingService = {
      getRecentBooks: vi.fn().mockReturnValue(of({
        count: 2,
        results: [
          { id: 2, isbn: '9781449319793', title: 'Python for Data Analysis', authors: 'Wes McKinney', conditions: { new: 2 }, min_price: 100 },
          { id: 5, isbn: '', title: 'No ISBN', authors: '', conditions: { good: 1 }, min_price: 50 },
        ],
      })),
    };
    TestBed.configureTestingModule({
      imports: [UiRecentListings],
      providers: [
        provideRouter([{ path: 'tw/book', component: Blank }]),
        { provide: ListingService, useValue: listingService },
        { provide: I18nService, useValue: { lang: () => 'en', t: (key: string) => key } },
        { provide: RegionService, useValue: { region: () => 'tw', currency: () => ({ code: 'TWD', decimal_places: 0 }), regions: () => [] } },
      ],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(UiRecentListings);
    fixture.detectChanges();
    return fixture;
  }

  it('asks the backend for one page of the size it paginates by', () => {
    render();
    expect(RECENT_BOOKS_PAGE_SIZE).toBe(20);
    for (const call of listingService.getRecentBooks.mock.calls) {
      expect(call[2]).toBe(20);
    }
    expect(listingService.getRecentBooks).toHaveBeenCalled();
  });

  it('links each book by isbn or id, with no internal flag in the href', () => {
    const fixture = render();
    const hrefs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a.tile-body'),
      a => a.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/tw/book?isbn=9781449319793', '/tw/book?id=5']);
  });

  it('still lets the book page use the preview it primes, through router state', async () => {
    const fixture = render();
    const router = TestBed.inject(Router);
    const anchor = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a.tile-body')!;

    anchor.click();
    await fixture.whenStable();

    expect(sessionStorage.getItem('cachedBook_9781449319793')).toContain('Python for Data Analysis');
    expect(router.url).toBe('/tw/book?isbn=9781449319793');
    expect(hasBookPreviewState(router.lastSuccessfulNavigation()?.extras.state)).toBe(true);
    sessionStorage.removeItem('cachedBook_9781449319793');
  });
});
