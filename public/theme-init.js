// Applies the saved theme choice before first paint so there's no flash
// of the wrong theme while Angular boots. Mirrors ThemeService's own
// logic/storage key (src/app/core/services/theme.service.ts) — keep
// both in sync if that key or the light/dark values ever change.
//
// Served as its own file rather than inline in index.html so the
// Content-Security-Policy can keep script-src to 'self'.
(function () {
  try {
    var stored = localStorage.getItem('unibooks_theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {}
})();
