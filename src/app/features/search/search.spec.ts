import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { Search } from './search';
import { BookService } from '../../core/services/book.service';
import { I18nService } from '../../core/i18n.service';
import { AuthStore } from '../../core/auth.store';
import { RegionService } from '../../core/region.service';
import { SchoolStateService } from '../../core/services/school-state.service';
import { MetadataService } from '../../core/services/metadata.service';
import { GoogleAnalyticsService } from '../../core/services/google-analytics.service';
import { SeoService } from '../../core/services/seo.service';
import { en } from '../../core/i18n/en';

describe('Search page', () => {
  let fixture: ComponentFixture<Search>;
  let component: Search;
  let queryParams: BehaviorSubject<Record<string, string>>;
  let searchBooks: ReturnType<typeof vi.fn>;
  let getTopCourses: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;

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

  const book = (i: number, local = true) => ({
    id: `b${i}`, title: `Book ${i}`, author: '', isbn: '', coverUrl: '',
    activeListings: 1, localActiveListings: local ? 1 : 0, minPrice: 100,
    waitlistCount: 0, conditions: ['new'],
  });

  // The URL the page navigated to last, as query params.
  const lastQueryParams = () => navigate.mock.calls.at(-1)?.[1]?.queryParams;

  const setUp = async (params: Record<string, string>, response: unknown = { count: 0, results: [] }) => {
    queryParams = new BehaviorSubject(params);
    searchBooks = vi.fn().mockReturnValue(of(response));
    getTopCourses = vi.fn().mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [Search, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams, snapshot: { get queryParams() { return queryParams.value; } } } },
        { provide: BookService, useValue: { searchBooks, getTopCourses } },
        { provide: I18nService, useValue: i18n },
        { provide: AuthStore, useValue: { isLoggedIn: () => false, user: () => null } },
        { provide: RegionService, useValue: { region: () => 'tw', currency: () => ({ code: 'TWD', decimal_places: 0, symbol: 'NT$' }) } },
        {
          provide: SchoolStateService,
          useValue: {
            selectedSchool$: of('NTU'), resolvedSchool$: of('NTU'), ready: true, schools$: of([]),
            currentSchool: 'NTU', getSchoolLabel: () => 'NTU', getSchoolId: () => null,
          },
        },
        { provide: MetadataService, useValue: { getMetadata: () => of({ categories: [{ slug: 'engineering', title: 'Engineering' }] }) } },
        { provide: GoogleAnalyticsService, useValue: { trackSearch: vi.fn() } },
        { provide: SeoService, useValue: { setPage: vi.fn() } },
      ],
    }).compileComponents();

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(Search);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  describe('filter sheet (phones)', () => {
    beforeEach(() => setUp({ q: 'calculus' }));

    it('keeps choices in a draft until Show results applies them together', () => {
      component.openFilters();
      component.toggleCondition('new');
      component.onCategoryChange('engineering');
      component.setPrice('priceMin', '100');
      component.commitPriceRange();

      expect(navigate).not.toHaveBeenCalled();
      // The page behind the sheet still shows what is applied.
      expect(component.conditionFilters.new).toBe(true);
      expect(component.category).toBe('');
      expect(component.priceMin).toBe('');

      component.applyFilters();

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(lastQueryParams()).toEqual({
        q: 'calculus',
        category: 'engineering',
        condition: 'like_new,noted,damaged',
        price_min: '100',
      });
      expect(component.filtersOpen).toBe(false);
    });

    it('shows the draft in the controls while the sheet is open', () => {
      component.openFilters();
      component.toggleCondition('damaged');

      const damaged = component.conditionFacetOptions.find(o => o.value === 'damaged');
      expect(damaged?.selected).toBe(false);
    });

    it('drops the draft when the sheet is closed another way', () => {
      component.openFilters();
      component.toggleCondition('new');
      component.discardFilters();

      expect(navigate).not.toHaveBeenCalled();
      component.openFilters();
      expect(component.conditionFacetOptions.every(o => o.selected)).toBe(true);
    });

    it('lists the courses of the category picked in the draft', () => {
      component.openFilters();
      component.onCategoryChange('engineering');

      expect(getTopCourses).toHaveBeenLastCalledWith('NTU', 'engineering');
    });

    it('applies each change at once from the sidebar, with no sheet open', () => {
      component.toggleCondition('new');

      expect(lastQueryParams()).toEqual({ q: 'calculus', condition: 'like_new,noted,damaged' });
    });
  });

  describe('listing filters without a keyword', () => {
    it('searches when only a condition is chosen, sending it to the API', async () => {
      await setUp({ condition: 'damaged' }, { count: 1, local_count: 1, results: [book(1)] });

      expect(searchBooks).toHaveBeenCalledWith('', '', '', 'NTU', 1, null, { condition: 'damaged' });
      expect(component.searching).toBe(true);
    });

    it('shows the suggestions, not a search, with nothing chosen', async () => {
      await setUp({});

      expect(searchBooks).not.toHaveBeenCalled();
      expect(component.searching).toBe(false);
    });
  });

  describe('found count', () => {
    it('counts every page, not just the one shown', async () => {
      const page = Array.from({ length: 20 }, (_, i) => book(i));
      await setUp({ q: 'calculus' }, { count: 45, local_count: 30, results: page });

      const text = (fixture.nativeElement as HTMLElement).querySelector('.scoped-count')?.textContent;
      expect(text).toContain('Found 30 matching books at NTU');
    });

    it('gives the total when none is listed at the school', async () => {
      const page = Array.from({ length: 20 }, (_, i) => book(i, false));
      await setUp({ q: 'calculus' }, { count: 45, local_count: 0, results: page });

      const text = (fixture.nativeElement as HTMLElement).querySelector('.scoped-count')?.textContent;
      expect(text).toContain('Found 45 matching books');
    });
  });
});
