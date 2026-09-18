import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ListingsComponent } from './listings';
import { en } from '../../core/i18n/en';

describe('ListingsComponent.submitEdit', () => {
  let component: ListingsComponent;
  let updateListing: ReturnType<typeof vi.fn>;
  let toastError: ReturnType<typeof vi.fn>;

  const manualListing = {
    id: 'l1',
    book_source: 'manual',
    book_title: 'Linear Algebra',
    book_authors: 'Strang',
    isbn: '9780980232714',
    price: 300,
    condition: 'good',
    description: '',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListingsComponent, HttpClientTestingModule, RouterTestingModule],
    });
    component = TestBed.createComponent(ListingsComponent).componentInstance;

    updateListing = vi.fn().mockReturnValue(of({}));
    toastError = vi.fn();
    (component as any).listingService = { updateListing };
    (component as any).toast = { error: toastError, success: vi.fn() };
    (component as any).accountService = { clearProfileCache: vi.fn() };
    component.loadMyListings = vi.fn();

    component.editingListing = { ...manualListing };
    component.editForm = {
      price: 300,
      condition: 'good',
      category: '',
      course_name: '',
      professor_name: '',
      private_note: '',
      description: '',
      photos: [],
      book_title: manualListing.book_title,
      book_authors: manualListing.book_authors,
      isbn: manualListing.isbn,
    } as any;
  });

  it('leaves the book fields out when the seller only touched the listing', () => {
    // A Book row is shared by every listing of that title, so the backend
    // refuses book-field edits once a second seller lists the same manual
    // book. Sending the unchanged title/authors/ISBN with a price edit made
    // that refusal apply to edits that changed no book field at all.
    component.editForm.price = 250;
    component.submitEdit();

    const payload = updateListing.mock.calls[0][1];
    expect(payload.price).toBe(250);
    expect('book_title' in payload).toBe(false);
    expect('book_authors' in payload).toBe(false);
    expect('isbn' in payload).toBe(false);
  });

  it('still sends the book fields the seller actually changed', () => {
    component.editForm.book_title = 'Linear Algebra, 5th ed.';
    component.submitEdit();

    const payload = updateListing.mock.calls[0][1];
    expect(payload.book_title).toBe('Linear Algebra, 5th ed.');
    expect('book_authors' in payload).toBe(false);
    expect('isbn' in payload).toBe(false);
  });

  it('treats null and empty-string as the same ISBN', () => {
    component.editingListing = { ...manualListing, isbn: null };
    component.editForm.isbn = '';
    component.submitEdit();

    expect('isbn' in updateListing.mock.calls[0][1]).toBe(false);
  });

  it('shows the reason the backend gave instead of a blanket failure', () => {
    updateListing.mockReturnValue(throwError(() => ({
      status: 403,
      error: { error: { code: 'listing.errBookShared' } },
    })));

    component.submitEdit();

    expect(toastError).toHaveBeenCalledWith(en['listing.errBookShared']);
  });
});

describe('ListingsComponent listing management', () => {
  let component: ListingsComponent;
  let getMyProfile: ReturnType<typeof vi.fn>;
  let updateListing: ReturnType<typeof vi.fn>;
  let deleteListing: ReturnType<typeof vi.fn>;
  let askDanger: ReturnType<typeof vi.fn>;
  let toast: { success: any; error: any; info: any };

  const listing = (over: Record<string, any> = {}) => ({
    id: 'l1', book_title: 'Calculus', price: 300, condition: 'new', status: 'active', ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListingsComponent, HttpClientTestingModule, RouterTestingModule],
    });
    component = TestBed.createComponent(ListingsComponent).componentInstance;

    getMyProfile = vi.fn().mockReturnValue(of({
      myListings: { count: 3, results: [listing()] },
      myListingCounts: { all: 3, active: 1, reserved: 0, sold: 1, removed: 1 },
    }));
    updateListing = vi.fn().mockReturnValue(of({}));
    deleteListing = vi.fn().mockReturnValue(of({}));
    askDanger = vi.fn().mockResolvedValue(true);
    toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

    (component as any).accountService = { getMyProfile, clearProfileCache: vi.fn() };
    (component as any).listingService = { updateListing, deleteListing };
    (component as any).confirms = { askDanger };
    (component as any).toast = toast;
    (component as any).syncUrl = vi.fn();
    (component as any).i18n = { t: (k: string) => k };
  });

  it('asks the server for the chosen status and order', () => {
    component.onStatusChange('sold');
    expect(getMyProfile).toHaveBeenLastCalledWith(1, '', { status: 'sold', sort: 'newest' });

    component.onSortChange('price_desc');
    expect(getMyProfile).toHaveBeenLastCalledWith(1, '', { status: 'sold', sort: 'price_desc' });
  });

  it('starts over at page one whenever the list changes shape', () => {
    component.currentPage = 3;
    component.onStatusChange('active');
    expect(component.currentPage).toBe(1);

    component.currentPage = 3;
    component.onSearchQuery('calc');
    expect(component.currentPage).toBe(1);

    component.currentPage = 3;
    component.onSortChange('oldest');
    expect(component.currentPage).toBe(1);
  });

  it('keeps the tab counts, which describe the whole shelf', () => {
    component.loadMyListings();
    expect(component.counts).toEqual({ all: 3, active: 1, reserved: 0, sold: 1, removed: 1 });
    expect(component.totalListings).toBe(3);
  });

  /** Taking a listing down is reversible, so it must not ask; deleting must. */
  it('takes a listing down without a confirmation, and says so', async () => {
    await component.onListingAction({ type: 'unlist', id: 'l1' });
    expect(askDanger).not.toHaveBeenCalled();
    expect(updateListing).toHaveBeenCalledWith('l1', { status: 'removed' });
    expect(toast.success).toHaveBeenCalledWith('acct.unlisted');
  });

  it('confirms before deleting, and does nothing when refused', async () => {
    askDanger.mockResolvedValueOnce(false);
    await component.onListingAction({ type: 'delete', id: 'l1' });
    expect(deleteListing).not.toHaveBeenCalled();

    await component.onListingAction({ type: 'delete', id: 'l1' });
    expect(deleteListing).toHaveBeenCalledWith('l1');
    expect(toast.success).toHaveBeenCalledWith('acct.listingDeleted');
  });

  it('reports the outcome of putting a listing back up', async () => {
    await component.onListingAction({ type: 'mark_active', id: 'l1' });
    expect(updateListing).toHaveBeenCalledWith('l1', { status: 'active' });
    expect(toast.success).toHaveBeenCalledWith('acct.markedActive');
  });

  it('copies the public link of a listing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    (component as any).regionLink = { path: () => ['/', 'tw', 'listing', 'l1'] };

    await component.onListingAction({ type: 'copy_link', id: 'l1' });

    expect(writeText).toHaveBeenCalledWith(`${location.origin}/tw/listing/l1`);
    expect(toast.success).toHaveBeenCalledWith('acct.linkCopied');
  });

  it('offers to clear the filters when a filtered list comes back empty', () => {
    expect(component.hasFilters).toBe(false);
    component.status = 'sold';
    expect(component.hasFilters).toBe(true);
    component.clearFilters();
    expect(component.status).toBe('');
    expect(component.searchQuery).toBe('');
  });
});
