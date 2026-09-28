import { NavigationExtras, Router } from '@angular/router';

let tempInput: HTMLInputElement | null = null;
let cleanupTimer: any = null;

/**
 * Creates and synchronously focuses a visually-hidden temporary `<input>`
 * appended to `document.body`. This primes iOS Safari's software keyboard
 * inside the user's direct tap gesture before an async route transition.
 */
export function prepareSearchFocusTransfer(): () => void {
  cleanupSearchFocus();

  if (typeof document === 'undefined') return () => {};

  const input = document.createElement('input');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  input.style.left = '0';
  input.style.top = '0';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.fontSize = '16px'; // Avoids iOS viewport auto-zoom
  document.body.appendChild(input);
  input.focus();

  tempInput = input;

  // Safety fallback in case navigation hangs or is never completed
  cleanupTimer = setTimeout(() => {
    cleanupSearchFocus();
  }, 3000);

  return cleanupSearchFocus;
}

/**
 * Removes the temporary focus transfer `<input>` from the DOM.
 */
export function cleanupSearchFocus(): void {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
  if (tempInput) {
    if (tempInput.parentNode) {
      tempInput.parentNode.removeChild(tempInput);
    }
    tempInput = null;
  }
}

/**
 * Synchronously sets up focus transfer for iOS Safari, sets router navigation
 * state `{ focusSearch: true }`, and triggers navigation. Cleans up the temporary
 * input if navigation fails or is cancelled.
 */
export function navigateWithSearchFocus(
  router: Router,
  commands: any[],
  extras?: NavigationExtras
): Promise<boolean> {
  prepareSearchFocusTransfer();

  const state = { ...(extras?.state || {}), focusSearch: true };
  const navExtras: NavigationExtras = { ...extras, state };

  return router.navigate(commands, navExtras).then(
    success => {
      if (!success) {
        cleanupSearchFocus();
      }
      return success;
    },
    error => {
      cleanupSearchFocus();
      throw error;
    }
  );
}

/**
 * Whether the navigation now creating the search page came from the home
 * search bar (navigateWithSearchFocus), so its input should take focus.
 *
 * Only a navigation made in the running app counts. The page load itself is
 * excluded (router.navigated is still false): a reload restores
 * history.state, flag included, and would open the keyboard on every refresh
 * of a search reached this way. Back/Forward (popstate) restores it too.
 * Reading the flag off the navigation, never off history, is what keeps both
 * out; there is nothing to strip from history afterwards.
 */
export function consumeSearchFocusIntent(router: Router): boolean {
  const nav = router.currentNavigation();
  const intended = router.navigated
    && nav?.trigger === 'imperative'
    && nav.extras.state?.['focusSearch'] === true;
  if (!intended) cleanupSearchFocus();
  return intended;
}
