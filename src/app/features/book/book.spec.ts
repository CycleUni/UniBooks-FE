import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Book, BOOK_SOURCE_LABEL_KEYS, bookSourceLabelKey } from './book';
import { BookService } from '../../core/services/book.service';
import { I18nService } from '../../core/i18n.service';
import { AuthStore } from '../../core/auth.store';
import { RegionService } from '../../core/region.service';
import { SchoolStateService } from '../../core/services/school-state.service';
import { GoogleAnalyticsService } from '../../core/services/google-analytics.service';
import { zhTW } from '../../core/i18n/zh-TW';
import { en } from '../../core/i18n/en';
import { zhHK } from '../../core/i18n/zh-HK';

describe('bookSourceLabelKey', () => {
  it('names every source the backend records', () => {
    expect(bookSourceLabelKey('google_api')).toBe('book.sourceGoogle');
    expect(bookSourceLabelKey('openlibrary_api')).toBe('book.sourceOpenLibrary');
    expect(bookSourceLabelKey('isbnnet_api')).toBe('book.sourceIsbnnet');
    expect(bookSourceLabelKey('manual')).toBe('book.sourceManual');
    expect(bookSourceLabelKey('listed')).toBe('book.sourceListed');
    expect(bookSourceLabelKey('preseed')).toBe('book.sourcePreseed');
  });

  it('has nothing to say for a missing or unknown source', () => {
    expect(bookSourceLabelKey(undefined)).toBeNull();
    expect(bookSourceLabelKey(null)).toBeNull();
    expect(bookSourceLabelKey('')).toBeNull();
    expect(bookSourceLabelKey('amazon_api')).toBeNull();
    // Not fooled by keys every object inherits.
    expect(bookSourceLabelKey('toString')).toBeNull();
  });

  it('points only at keys every language defines', () => {
    for (const key of [...Object.values(BOOK_SOURCE_LABEL_KEYS), 'book.dataSource']) {
      expect(zhTW[key], key).toBeTruthy();
      expect(zhHK[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
  });
});

describe('Book page data source footer', () => {
  let fixture: ComponentFixture<Book>;
  let getBook: ReturnType<typeof vi.fn>;

  const i18n = {
    lang: () => 'zh-TW',
    t: (key: string, params?: Record<string, string | number>) => {
      let text = zhTW[key] ?? key;
      for (const [name, value] of Object.entries(params ?? {})) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
      return text;
    },
  };

  const render = (source: unknown) => {
    getBook.mockReturnValue(of({
      id: 'b1', isbn13: '9786264140720', title: '微積分', authors: 'Stewart',
      publisher: '', published_date: '2020', cover_url: '', source,
      listings: { count: 0, results: [] }, waiting_count: 0, is_subscribed: false,
    }));
    fixture = TestBed.createComponent(Book);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(async () => {
    getBook = vi.fn();
    await TestBed.configureTestingModule({
      imports: [Book, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ isbn: '9786264140720' })) } },
        { provide: BookService, useValue: { getBook } },
        { provide: I18nService, useValue: i18n },
        { provide: AuthStore, useValue: { isLoggedIn: () => false, user: () => null } },
        { provide: RegionService, useValue: { region: () => 'tw', currency: () => ({ code: 'TWD', decimal_places: 0, symbol: 'NT$' }) } },
        {
          provide: SchoolStateService,
          useValue: { selectedSchool$: of(''), resolvedSchool$: of(''), ready: true, schools$: of([]), getSchoolLabel: (s: string) => s, getSchoolId: () => null },
        },
        { provide: GoogleAnalyticsService, useValue: { trackViewBook: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('names the catalogue the details came from, below everything else', () => {
    const page = render('google_api');
    const footer = page.querySelector('.book-page > .data-source');
    expect(footer?.textContent?.trim()).toBe('書目資料來源：Google Books');
    // The last thing on the page, after the listings section.
    expect(page.querySelector('.book-page')?.lastElementChild).toBe(footer);
  });

  it('describes a user-added book in words, not as a source code', () => {
    expect(render('manual').querySelector('.data-source')?.textContent?.trim()).toBe('書目資料來源：使用者手動新增');
  });

  it('gives books created by a listing or the preset list their own wording', () => {
    expect(render('listed').querySelector('.data-source')?.textContent?.trim()).toBe('書目資料來源：賣家上架時建立');
    fixture.destroy();
    expect(render('preseed').querySelector('.data-source')?.textContent?.trim()).toBe('書目資料來源：平台預建書單');
  });

  it('shows nothing for an unknown or missing source', () => {
    expect(render('amazon_api').querySelector('.data-source')).toBeNull();
    fixture.destroy();
    expect(render(undefined).querySelector('.data-source')).toBeNull();
  });
});
