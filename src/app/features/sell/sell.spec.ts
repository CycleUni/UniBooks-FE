import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Sell, SELL_DRAFT_STORAGE_KEY, SELL_DRAFT_MAX_AGE_MS, cleanAndValidateIsbn, clean_and_validate_isbn, isValidIsbnChecksum, selectBestRearCamera } from './sell';
import { unsavedChangesGuard } from '../../core/unsaved-changes.guard';
import { provideRouter } from '@angular/router';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { I18nService } from '../../core/i18n.service';
import { AuthStore } from '../../core/auth.store';
import { AccountService } from '../../core/services/account.service';
import { BookService } from '../../core/services/book.service';
import { ListingService } from '../../core/services/listing.service';
import { MetadataService } from '../../core/services/metadata.service';
import { GoogleAnalyticsService } from '../../core/services/google-analytics.service';
import { of } from 'rxjs';
import { RegionService } from '../../core/region.service';


describe('selectBestRearCamera', () => {
  it('returns null for empty or null camera list', () => {
    expect(selectBestRearCamera([])).toBeNull();
    expect(selectBestRearCamera(null)).toBeNull();
    expect(selectBestRearCamera(undefined)).toBeNull();
  });

  it('selects normal back camera avoiding ultra wide and telephoto', () => {
    const devices = [
      { id: 'cam-front', label: 'Front Camera' },
      { id: 'cam-ultra', label: 'Back Ultra Wide Camera (0.5x)' },
      { id: 'cam-main', label: 'Back Camera' },
      { id: 'cam-tele', label: 'Back Telephoto Camera (3x)' }
    ];
    expect(selectBestRearCamera(devices)).toBe('cam-main');
  });

  it('handles localized Chinese camera labels correctly', () => {
    const devices = [
      { id: 'cam1', label: '前置相機' },
      { id: 'cam2', label: '後置超廣角鏡頭' },
      { id: 'cam3', label: '後置廣角主相機' }
    ];
    expect(selectBestRearCamera(devices)).toBe('cam3');
  });

  it('returns null if labels are unspecific (falls back to facingMode: environment)', () => {
    const devices = [
      { id: 'cam1', label: 'camera2 0, facing back' },
      { id: 'cam2', label: 'camera2 1, facing front' }
    ];
    expect(selectBestRearCamera(devices)).toBeNull();
  });

  it('returns null if labels are empty/opaque (falls back to facingMode: environment)', () => {
    const devices = [
      { id: 'cam1', label: '' },
      { id: 'cam2', label: '' }
    ];
    expect(selectBestRearCamera(devices)).toBeNull();
  });
});

describe('isValidIsbnChecksum', () => {
  it('accepts real ISBN-13 and ISBN-10 check digits', () => {
    expect(isValidIsbnChecksum('9786264140720')).toBe(true);
    expect(isValidIsbnChecksum('0306406152')).toBe(true);
    expect(isValidIsbnChecksum('000000006X')).toBe(true);
  });

  it('rejects a same-length, all-digit misread with the wrong check digit', () => {
    // Right shape (13 digits), wrong content — e.g. a garbled camera scan.
    expect(isValidIsbnChecksum('9786264140721')).toBe(false);
    expect(isValidIsbnChecksum('0123456788')).toBe(false);
  });
});

describe('cleanAndValidateIsbn', () => {
  it('should accept valid 13-digit ISBNs', () => {
    expect(cleanAndValidateIsbn('9786264140720')).toBe('9786264140720');
    expect(cleanAndValidateIsbn('978-626-414-072-0')).toBe('9786264140720');
    expect(cleanAndValidateIsbn(' 978 626 414 072 0 ')).toBe('9786264140720');
    expect(cleanAndValidateIsbn('9791234567890')).toBe('9791234567890');
  });

  it('should accept valid 10-digit ISBNs including trailing X check digit', () => {
    expect(cleanAndValidateIsbn('0306406152')).toBe('0306406152');
    expect(cleanAndValidateIsbn('0-306-40615-2')).toBe('0306406152');
    expect(cleanAndValidateIsbn('012345678X')).toBe('012345678X');
    expect(cleanAndValidateIsbn('0-1234-5678-x')).toBe('012345678X');
    expect(cleanAndValidateIsbn(' 012345678X ')).toBe('012345678X');
  });

  it('should reject invalid QR codes and URLs', () => {
    expect(cleanAndValidateIsbn('https://example.com/some-qr-payload')).toBeNull();
    expect(cleanAndValidateIsbn('WIFI:S:MyNetwork;T:WPA;P:password;;')).toBeNull();
    expect(cleanAndValidateIsbn('invalid barcode')).toBeNull();
  });

  it('should reject strings with invalid lengths', () => {
    expect(cleanAndValidateIsbn('123')).toBeNull();
    expect(cleanAndValidateIsbn('123456789')).toBeNull();
    expect(cleanAndValidateIsbn('12345678901')).toBeNull(); // 11 digits
    expect(cleanAndValidateIsbn('123456789012')).toBeNull(); // 12 digits
    expect(cleanAndValidateIsbn('12345678901234')).toBeNull(); // 14 digits
  });

  it('should reject strings with non-digits in invalid positions', () => {
    expect(cleanAndValidateIsbn('97862641407XX')).toBeNull();
    expect(cleanAndValidateIsbn('978626A140720')).toBeNull();
    expect(cleanAndValidateIsbn('978-0-1234-5678-X')).toBeNull(); // ISBN-13 with X is invalid
    expect(cleanAndValidateIsbn('X123456789')).toBeNull(); // X at start of 10-char
    expect(cleanAndValidateIsbn('01234567X9')).toBeNull(); // X in middle of 10-char
  });

  it('should reject empty or null inputs', () => {
    expect(cleanAndValidateIsbn('')).toBeNull();
    expect(cleanAndValidateIsbn(null)).toBeNull();
    expect(cleanAndValidateIsbn(undefined)).toBeNull();
  });

  it('should expose clean_and_validate_isbn alias matching backend naming', () => {
    expect(clean_and_validate_isbn('9786264140720')).toBe('9786264140720');
  });
});

describe('Sell Component Barcode Scanner Validation', () => {
  let fixture: ComponentFixture<Sell>;
  let component: Sell;
  let mockBookService: any;
  let mockI18n: any;

  beforeEach(async () => {
    mockBookService = {
      getEngineOptions: vi.fn().mockReturnValue([
        { label: 'Google Books', value: 'googlebooks' },
        { label: 'Open Library', value: 'openlibrary' }
      ]),
      searchBooks: vi.fn().mockReturnValue(of({ results: [] })),
      createManualBook: vi.fn().mockReturnValue(of({ id: 'book-1' }))
    };

    mockI18n = {
      t: vi.fn((key: string) => {
        const translations: Record<string, string> = {
          'sell.invalidBarcodeScanned': "Scanned code doesn't look like a valid ISBN, try again.",
          'sell.cameraPermission': 'Cannot access camera. Please check your permissions.'
        };
        return translations[key] || key;
      }),
      lang: () => 'en'
    };

    await TestBed.configureTestingModule({
      imports: [Sell, HttpClientTestingModule],
      providers: [
        { provide: RegionService, useValue: { regions: () => [{ code: 'tw', currency: { code: 'TWD', decimal_places: 0 } }], currency: () => ({ code: 'TWD', decimal_places: 0 }), region: () => 'tw', currentRegionObj: () => ({ search_engines: ['googlebooks'] }) } },
        provideRouter([]),
        { provide: BookService, useValue: mockBookService },
        { provide: I18nService, useValue: mockI18n },
        {
          provide: AuthStore,
          useValue: {
            isLoggedIn: () => true,
            user: () => ({ id: 'user-1' })
          }
        },
        {
          provide: AccountService,
          useValue: {
            getMyProfile: vi.fn().mockReturnValue(of({ verified_at: '2026-01-01' }))
          }
        },
        {
          provide: ListingService,
          useValue: {
            uploadPhoto: vi.fn(),
            deletePhoto: vi.fn(),
            createListing: vi.fn()
          }
        },
        {
          provide: MetadataService,
          useValue: {
            getMetadata: vi.fn().mockReturnValue(of({ categories: [] }))
          }
        },
        {
          provide: GoogleAnalyticsService,
          useValue: {
            trackEvent: vi.fn(),
            trackPublishListing: vi.fn()
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Sell);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    component.ngOnDestroy();
  });

  it('should delegate cleanAndValidateIsbn method to validation function', () => {
    expect(component.cleanAndValidateIsbn('9786264140720')).toBe('9786264140720');
    expect(component.cleanAndValidateIsbn('invalid')).toBeNull();
  });

  it('should accept valid ISBN-13 scan, assign searchQuery, stop scanner, and search', async () => {
    const stopScannerSpy = vi.spyOn(component, 'stopScanner').mockResolvedValue();
    const searchBookSpy = vi.spyOn(component, 'searchBook').mockImplementation(() => {});
    const onSearchQueryChangeSpy = vi.spyOn(component, 'onSearchQueryChange');

    component.cameraError = "Scanned code doesn't look like a valid ISBN, try again.";

    const result = component.handleScanResult('978-626-414-072-0');

    expect(result).toBe(true);
    expect(component.searchQuery).toBe('9786264140720');
    expect(component.cameraError).toBe('');
    expect(onSearchQueryChangeSpy).toHaveBeenCalled();
    expect(stopScannerSpy).toHaveBeenCalled();

    // Await promise microtask for searchBook invocation
    await Promise.resolve();
    expect(searchBookSpy).toHaveBeenCalled();
  });

  it('should accept valid ISBN-10 scan with check digit X', async () => {
    const stopScannerSpy = vi.spyOn(component, 'stopScanner').mockResolvedValue();
    const searchBookSpy = vi.spyOn(component, 'searchBook').mockImplementation(() => {});

    const result = component.handleScanResult('0-0000-0006-x');

    expect(result).toBe(true);
    expect(component.searchQuery).toBe('000000006X');
    expect(component.cameraError).toBe('');
    expect(stopScannerSpy).toHaveBeenCalled();

    await Promise.resolve();
    expect(searchBookSpy).toHaveBeenCalled();
  });

  it('should reject a correctly-shaped but checksum-invalid scan (garbled misread)', () => {
    const stopScannerSpy = vi.spyOn(component, 'stopScanner');
    const searchBookSpy = vi.spyOn(component, 'searchBook');

    component.searchQuery = '';

    // 13 digits, passes the format check, but the check digit is wrong —
    // the shape a camera misread often produces.
    const result = component.handleScanResult('9786264140721');

    expect(result).toBe(false);
    expect(component.searchQuery).toBe('');
    expect(stopScannerSpy).not.toHaveBeenCalled();
    expect(searchBookSpy).not.toHaveBeenCalled();
    expect(component.cameraError).toBe("Scanned code doesn't look like a valid ISBN, try again.");
  });

  it('should reject non-ISBN scan, keep scanner running, and set cameraError', () => {
    const stopScannerSpy = vi.spyOn(component, 'stopScanner');
    const searchBookSpy = vi.spyOn(component, 'searchBook');

    component.searchQuery = '';
    component.isScanning = true;

    const result = component.handleScanResult('https://example.com/qr-code');

    expect(result).toBe(false);
    expect(component.searchQuery).toBe('');
    expect(stopScannerSpy).not.toHaveBeenCalled();
    expect(searchBookSpy).not.toHaveBeenCalled();
    expect(component.cameraError).toBe("Scanned code doesn't look like a valid ISBN, try again.");
    expect(mockI18n.t).toHaveBeenCalledWith('sell.invalidBarcodeScanned');
  });

  it('should not repeatedly trigger change detection on consecutive identical invalid scans', () => {
    const cdrSpy = vi.spyOn((component as any).cdr, 'markForCheck');

    component.handleScanResult('https://example.com/qr-code');
    const firstCallCount = cdrSpy.mock.calls.length;

    // Second invalid scan with same resulting error message
    component.handleScanResult('123');
    const secondCallCount = cdrSpy.mock.calls.length;

    expect(secondCallCount).toBe(firstCallCount);
  });

  it('should clear invalidBarcodeScanned cameraError when stopScanner is called', async () => {
    component.cameraError = "Scanned code doesn't look like a valid ISBN, try again.";
    component.isScanning = true;

    await component.stopScanner();

    expect(component.cameraError).toBe('');
    expect(component.isScanning).toBe(false);
  });

  it('should clear cameraError when succeeding after a previous invalid scan', async () => {
    vi.spyOn(component, 'stopScanner').mockResolvedValue();
    vi.spyOn(component, 'searchBook').mockImplementation(() => {});

    // First scan is invalid
    component.handleScanResult('invalid-qr');
    expect(component.cameraError).toBe("Scanned code doesn't look like a valid ISBN, try again.");

    // Second scan is valid
    component.handleScanResult('9786264140720');
    expect(component.cameraError).toBe('');
    expect(component.searchQuery).toBe('9786264140720');
  });

  it('shows the sign-in state when the session ends while the page is open', () => {
    expect(component.isLoggedIn).toBe(true);

    // The session dies in the background: nothing navigates, the store flips.
    (TestBed.inject(AuthStore) as any).isLoggedIn = () => false;

    expect(component.isLoggedIn).toBe(false);
  });
});

describe('unsavedChangesGuard', () => {
  const call = (component: any) =>
    unsavedChangesGuard(component, null as any, null as any, null as any);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets navigation through when the component reports nothing unsaved', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    expect(call({ hasUnsavedChanges: () => false, unsavedChangesMessage: () => 'msg' })).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('asks for confirmation with the component message when there are unsaved changes', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const result = call({ hasUnsavedChanges: () => true, unsavedChangesMessage: () => 'leave?' });
    expect(confirmSpy).toHaveBeenCalledWith('leave?');
    expect(result).toBe(false);
  });

  it('allows the navigation when the user confirms', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(call({ hasUnsavedChanges: () => true, unsavedChangesMessage: () => 'leave?' })).toBe(true);
  });

  it('never traps the user when the component does not implement the interface', () => {
    expect(call(null)).toBe(true);
    expect(call({})).toBe(true);
  });
});

describe('Sell listing form guarding, drafts and field validation', () => {
  let fixture: ComponentFixture<Sell>;
  let component: Sell;

  const mockI18n = {
    t: vi.fn((key: string) => key),
    lang: () => 'en'
  };

  /** Builds a fixture on demand so a test can seed localStorage first. */
  const create = () => {
    fixture = TestBed.createComponent(Sell);
    component = fixture.componentInstance;
    fixture.detectChanges();
    return component;
  };

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Sell, HttpClientTestingModule],
      providers: [
        { provide: RegionService, useValue: { regions: () => [{ code: 'tw', currency: { code: 'TWD', decimal_places: 0 } }], currency: () => ({ code: 'TWD', decimal_places: 0, symbol: 'NT$' }), region: () => 'tw', currentRegionObj: () => ({ search_engines: ['googlebooks'] }) } },
        provideRouter([]),
        {
          provide: BookService,
          useValue: {
            getEngineOptions: vi.fn().mockReturnValue([{ label: 'Google Books', value: 'googlebooks' }]),
            searchBooks: vi.fn().mockReturnValue(of({ results: [] })),
            createManualBook: vi.fn().mockReturnValue(of({ id: 'book-1' }))
          }
        },
        { provide: I18nService, useValue: mockI18n },
        { provide: AuthStore, useValue: { isLoggedIn: () => true, user: () => ({ id: 'user-1' }), isVerifiedIn: () => true } },
        { provide: AccountService, useValue: { getMyProfile: vi.fn().mockReturnValue(of({ verified_at: '2026-01-01' })) } },
        { provide: ListingService, useValue: { uploadPhoto: vi.fn(), deletePhoto: vi.fn().mockReturnValue(of({})), createListing: vi.fn() } },
        { provide: MetadataService, useValue: { getMetadata: vi.fn().mockReturnValue(of({ categories: [{ title: 'Engineering', slug: 'engineering' }] })) } },
        { provide: GoogleAnalyticsService, useValue: { trackEvent: vi.fn(), trackPublishListing: vi.fn() } }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    component?.ngOnDestroy();
    localStorage.clear();
  });

  describe('hasUnsavedChanges', () => {
    it('does not intercept an untouched step 1', () => {
      create();
      expect(component.step).toBe(1);
      expect(component.hasUnsavedChanges()).toBe(false);
    });

    it('does not intercept a typed-but-unselected ISBN', () => {
      create();
      component.searchQuery = '9786264140720';
      component.onSearchQueryChange();
      expect(component.hasUnsavedChanges()).toBe(false);
    });

    it('does not intercept manual entry that is still completely blank', () => {
      create();
      component.enterManually();
      expect(component.hasUnsavedChanges()).toBe(false);
    });

    it('intercepts once a book has been selected', () => {
      create();
      component.selectBook({ id: 'b1', title: 'Clean Code', author: 'Robert C. Martin' });
      expect(component.hasUnsavedChanges()).toBe(true);
    });

    it('intercepts once manual entry has any content', () => {
      create();
      component.enterManually();
      component.bookPreview.title = 'Untitled draft';
      expect(component.hasUnsavedChanges()).toBe(true);
    });

    it('intercepts on step 2 details and uploaded photos', () => {
      create();
      component.course = 'CS101';
      expect(component.hasUnsavedChanges()).toBe(true);

      component.course = '';
      component.uploadedPhotos = ['https://cdn.example/photo.jpg'];
      expect(component.hasUnsavedChanges()).toBe(true);
    });

    it('intercepts once a price has been entered, free included', () => {
      create();
      component.setFree();
      expect(component.price).toBe(0);
      expect(component.hasUnsavedChanges()).toBe(true);
    });

    it('does not intercept the success screen even with a full form', () => {
      create();
      component.selectBook({ id: 'b1', title: 'Clean Code' });
      component.course = 'CS101';
      component.price = 300;
      component.step = 4;
      expect(component.hasUnsavedChanges()).toBe(false);
    });

    it('uses the sell.leaveConfirm key for the confirmation message', () => {
      create();
      expect(component.unsavedChangesMessage()).toBe('sell.leaveConfirm');
      expect(mockI18n.t).toHaveBeenCalledWith('sell.leaveConfirm');
    });
  });

  describe('draft persistence', () => {
    it('stores nothing for an empty form', () => {
      create();
      component.saveDraft();
      expect(localStorage.getItem(SELL_DRAFT_STORAGE_KEY)).toBeNull();
    });

    it('stores the form state once there is something to keep', () => {
      create();
      component.selectBook({ id: 'b1', title: 'Clean Code', author: 'Robert C. Martin' });
      component.course = 'CS101';
      component.professor = 'Chen';
      component.uploadedPhotos = ['https://cdn.example/photo.jpg'];
      component.price = 250;
      component.step = 3;
      component.saveDraft();

      const stored = JSON.parse(localStorage.getItem(SELL_DRAFT_STORAGE_KEY)!);
      expect(stored.step).toBe(3);
      expect(stored.course).toBe('CS101');
      expect(stored.professor).toBe('Chen');
      expect(stored.price).toBe(250);
      expect(stored.uploadedPhotos).toEqual(['https://cdn.example/photo.jpg']);
      expect(stored.bookPreview.title).toBe('Clean Code');
    });

    it('offers a found draft instead of restoring it silently', () => {
      localStorage.setItem(SELL_DRAFT_STORAGE_KEY, JSON.stringify({
        version: 1, savedAt: Date.now(), step: 2, searchQuery: '', engine: 'googlebooks',
        bookPreview: { title: 'Clean Code', authors: 'Robert C. Martin', isManual: false },
        condition: 'like_new', category: 'engineering', course: 'CS101', professor: 'Chen',
        privateNote: '', description: '', price: 250, uploadedPhotos: ['https://cdn.example/photo.jpg']
      }));

      create();
      expect(component.showDraftPrompt).toBe(true);
      // Nothing applied until the user chooses.
      expect(component.course).toBe('');
      expect(component.step).toBe(1);

      component.resumeDraft();
      expect(component.showDraftPrompt).toBe(false);
      expect(component.step).toBe(2);
      expect(component.course).toBe('CS101');
      expect(component.condition).toBe('like_new');
      expect(component.category).toBe('engineering');
      expect(component.price).toBe(250);
      expect(component.uploadedPhotos).toEqual(['https://cdn.example/photo.jpg']);
    });

    it('drops a category that no longer exists in this region', () => {
      localStorage.setItem(SELL_DRAFT_STORAGE_KEY, JSON.stringify({
        version: 1, savedAt: Date.now(), step: 2, searchQuery: '', engine: 'googlebooks',
        bookPreview: null, condition: 'new', category: 'retired-slug', course: 'CS101',
        professor: '', privateNote: '', description: '', price: null, uploadedPhotos: []
      }));

      create();
      component.resumeDraft();
      expect(component.category).toBe('');
      expect(component.course).toBe('CS101');
    });

    it('discards the draft on "start over"', () => {
      localStorage.setItem(SELL_DRAFT_STORAGE_KEY, JSON.stringify({
        version: 1, savedAt: Date.now(), step: 2, searchQuery: '', engine: 'googlebooks',
        bookPreview: null, condition: 'new', category: '', course: 'CS101',
        professor: '', privateNote: '', description: '', price: null, uploadedPhotos: []
      }));

      create();
      component.discardDraft();
      expect(component.showDraftPrompt).toBe(false);
      expect(component.course).toBe('');
      expect(localStorage.getItem(SELL_DRAFT_STORAGE_KEY)).toBeNull();
    });

    it('ignores and clears an expired draft', () => {
      localStorage.setItem(SELL_DRAFT_STORAGE_KEY, JSON.stringify({
        version: 1, savedAt: Date.now() - SELL_DRAFT_MAX_AGE_MS - 1000, step: 2,
        searchQuery: '', engine: 'googlebooks', bookPreview: null, condition: 'new',
        category: '', course: 'CS101', professor: '', privateNote: '', description: '',
        price: null, uploadedPhotos: []
      }));

      create();
      expect(component.showDraftPrompt).toBe(false);
      expect(localStorage.getItem(SELL_DRAFT_STORAGE_KEY)).toBeNull();
    });

    it('ignores and clears unparseable draft data', () => {
      localStorage.setItem(SELL_DRAFT_STORAGE_KEY, 'not json');
      create();
      expect(component.showDraftPrompt).toBe(false);
      expect(localStorage.getItem(SELL_DRAFT_STORAGE_KEY)).toBeNull();
    });

    it('treats typing into a fresh form as an implicit "start over"', () => {
      localStorage.setItem(SELL_DRAFT_STORAGE_KEY, JSON.stringify({
        version: 1, savedAt: Date.now(), step: 2, searchQuery: '', engine: 'googlebooks',
        bookPreview: null, condition: 'new', category: '', course: 'Old course',
        professor: '', privateNote: '', description: '', price: null, uploadedPhotos: []
      }));

      create();
      expect(component.showDraftPrompt).toBe(true);

      component.course = 'New course';
      component.onFormChange();

      expect(component.showDraftPrompt).toBe(false);
      expect(JSON.parse(localStorage.getItem(SELL_DRAFT_STORAGE_KEY)!).course).toBe('New course');
    });

    it('marks a photo broken rather than breaking the layout, and drops it from the payload', () => {
      create();
      component.uploadedPhotos = ['https://cdn.example/gone.jpg', 'https://cdn.example/ok.jpg'];
      component.onPhotoError('https://cdn.example/gone.jpg');

      expect(component.isPhotoBroken('https://cdn.example/gone.jpg')).toBe(true);
      expect(component.isPhotoBroken('https://cdn.example/ok.jpg')).toBe(false);
      expect(component.uploadedPhotos.length).toBe(2);
    });
  });

  describe('inline field validation', () => {
    it('stays quiet until the field is touched or the step is attempted', () => {
      create();
      component.enterManually();
      expect(component.titleErrorKey).toBe('');
      expect(component.authorErrorKey).toBe('');

      component.markTouched('title');
      expect(component.titleErrorKey).toBe('sell.errTitleRequired');
      expect(component.authorErrorKey).toBe('');
    });

    it('blocks step 1 and reveals both messages when the manual fields are empty', () => {
      create();
      component.enterManually();
      component.nextStep();

      expect(component.step).toBe(1);
      expect(component.titleErrorKey).toBe('sell.errTitleRequired');
      expect(component.authorErrorKey).toBe('sell.errAuthorRequired');
    });

    it('clears the messages and advances once the manual fields are filled', () => {
      create();
      component.enterManually();
      component.nextStep();
      component.bookPreview.title = 'Clean Code';
      component.bookPreview.authors = 'Robert C. Martin';

      expect(component.titleErrorKey).toBe('');
      expect(component.authorErrorKey).toBe('');

      component.nextStep();
      expect(component.step).toBe(2);
    });

    it('does not validate title/author for a book picked from search results', () => {
      create();
      component.selectBook({ id: 'b1', title: 'Clean Code', author: 'Robert C. Martin' });
      component.nextStep();
      expect(component.step).toBe(2);
      expect(component.titleErrorKey).toBe('');
    });

    it('reports an empty price as required and a negative price as invalid', () => {
      create();
      component.step = 3;
      expect(component.priceErrorKey).toBe('');

      component.markTouched('price');
      expect(component.priceErrorKey).toBe('sell.errPriceRequired');

      component.price = -5;
      expect(component.priceErrorKey).toBe('sell.errPriceInvalid');
    });

    it('accepts free (0) as a valid price', () => {
      create();
      component.step = 3;
      component.markTouched('price');
      component.setFree();
      expect(component.price).toBe(0);
      expect(component.priceErrorKey).toBe('');
    });
  });
});
