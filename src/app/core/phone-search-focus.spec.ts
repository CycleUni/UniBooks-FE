import { Router } from '@angular/router';
import {
  prepareSearchFocusTransfer,
  cleanupSearchFocus,
  navigateWithSearchFocus,
  consumeSearchFocusIntent
} from './phone-search-focus';

describe('phone-search-focus', () => {
  afterEach(() => {
    cleanupSearchFocus();
  });

  describe('prepareSearchFocusTransfer & cleanupSearchFocus', () => {
    it('appends a visually hidden input to document.body and cleans it up', () => {
      const cleanup = prepareSearchFocusTransfer();
      const input = document.body.querySelector('input[aria-hidden="true"]') as HTMLInputElement;

      expect(input).not.toBeNull();
      expect(input.style.position).toBe('fixed');
      expect(input.style.opacity).toBe('0');

      cleanup();
      expect(document.body.querySelector('input[aria-hidden="true"]')).toBeNull();
    });
  });

  describe('navigateWithSearchFocus', () => {
    it('navigates with focusSearch state and retains temporary input on success', async () => {
      const mockRouter = {
        navigate: vi.fn().mockResolvedValue(true),
      } as unknown as Router;

      const success = await navigateWithSearchFocus(mockRouter, ['/tw/search']);

      expect(success).toBe(true);
      expect(mockRouter.navigate).toHaveBeenCalledWith(
        ['/tw/search'],
        expect.objectContaining({
          state: expect.objectContaining({ focusSearch: true })
        })
      );
      // Temporary input remains for focus transfer
      expect(document.body.querySelector('input[aria-hidden="true"]')).not.toBeNull();
    });

    it('cleans up temporary input if router navigation fails', async () => {
      const mockRouter = {
        navigate: vi.fn().mockResolvedValue(false),
      } as unknown as Router;

      const success = await navigateWithSearchFocus(mockRouter, ['/tw/search']);

      expect(success).toBe(false);
      expect(document.body.querySelector('input[aria-hidden="true"]')).toBeNull();
    });

    it('cleans up temporary input if router navigation throws', async () => {
      const mockRouter = {
        navigate: vi.fn().mockRejectedValue(new Error('Navigation rejected')),
      } as unknown as Router;

      await expect(navigateWithSearchFocus(mockRouter, ['/tw/search'])).rejects.toThrow('Navigation rejected');
      expect(document.body.querySelector('input[aria-hidden="true"]')).toBeNull();
    });
  });

  describe('consumeSearchFocusIntent', () => {
    const router = (navigated: boolean, nav: unknown) =>
      ({ navigated, currentNavigation: () => nav }) as unknown as Router;
    const tap = { trigger: 'imperative', extras: { state: { focusSearch: true } } };

    it('is true for a tap on the home search bar in the running app', () => {
      expect(consumeSearchFocusIntent(router(true, tap))).toBe(true);
    });

    it('is false on the page load, where a reload restores the flag from history', () => {
      expect(consumeSearchFocusIntent(router(false, tap))).toBe(false);
    });

    it('is false on Back/Forward, which restore it as well', () => {
      expect(consumeSearchFocusIntent(router(true, { ...tap, trigger: 'popstate' }))).toBe(false);
    });

    it('is false for any other way in, and removes the keyboard primer', () => {
      prepareSearchFocusTransfer();
      expect(consumeSearchFocusIntent(router(true, { trigger: 'imperative', extras: {} }))).toBe(false);
      expect(document.body.querySelector('input[aria-hidden="true"]')).toBeNull();
    });

    it('still counts after an earlier reload of the page', () => {
      // The old check read performance's navigation entry, which says
      // "reload" for the whole session once the page has been refreshed.
      const original = performance.getEntriesByType;
      performance.getEntriesByType = vi.fn().mockReturnValue([{ type: 'reload' }]);
      try {
        expect(consumeSearchFocusIntent(router(true, tap))).toBe(true);
      } finally {
        performance.getEntriesByType = original;
      }
    });
  });
});
