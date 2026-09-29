import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { REGION_TO_LANG, SUPPORTED_LANGS, type Lang } from '../src/app/core/i18n/index';


const SITE_NAME = 'UniBooks';
const DIST_DIR = path.join(__dirname, '../dist/unibooks-fe/browser');
const INDEX_HTML_PATH = path.join(DIST_DIR, 'index.html');
const REDIRECTS_PATH = path.join(DIST_DIR, '_redirects');
const NGSW_PATH = path.join(DIST_DIR, 'ngsw.json');
const SITEMAP_PATH = path.join(DIST_DIR, 'sitemap.xml');
const SITE_ORIGIN = 'https://unibooks.app';

/**
 * The region the bare origin sends a visitor to when nothing says otherwise
 * (rootRedirectGuard in src/app/core/region.guard.ts). "/" never renders a
 * page of its own, so its HTML speaks this region's language: crawlers that
 * read it before the redirect runs were indexing the English copy instead.
 */
const DEFAULT_REGION = 'tw';

/**
 * The pages every region has and anyone can open, for the static sitemap.
 * Book and listing pages come and go with the data, so the backend serves
 * those (UniBooks-BE listings/sitemap.py); robots.txt names both files.
 * Anything behind a login, the auth flow, checkout and admin stay out.
 */
const SITEMAP_PAGES = ['', '/search', '/sell'];
const I18N_DIR = path.resolve(__dirname, '../src/app/core/i18n');

type Strings = Record<string, string>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadStrings(lang: Lang): Promise<Strings> {
  if (!SUPPORTED_LANGS.includes(lang)) {
    throw new Error(`Unsupported language configured for region: ${lang}`);
  }

  // Language codes are allowlisted above before they are used to form a path.
  const modulePath = path.resolve(I18N_DIR, `${lang}.ts`);
  if (!modulePath.startsWith(`${I18N_DIR}${path.sep}`)) {
    throw new Error(`Invalid translation module path for language: ${lang}`);
  }
  if (!fs.existsSync(modulePath)) {
    throw new Error(`Translation file not found for language: ${lang}`);
  }

  const module = await import(modulePath) as Record<string, unknown>;
  const exportedStrings = Object.values(module).filter(
    (value): value is Strings =>
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every((entry) => typeof entry === 'string'),
  );

  if (exportedStrings.length !== 1) {
    throw new Error(`Expected exactly one translation map in ${modulePath}`);
  }
  return exportedStrings[0];
}

function ogLocaleFor(lang: Lang): string {
  return lang === 'en' ? 'en_US' : lang.replace('-', '_');
}

function validateRegion(region: string): void {
  if (!/^[a-z0-9-]{1,16}$/.test(region)) {
    throw new Error(`Invalid region code configured: ${region}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * A region page's URL. The region home carries its trailing slash because
 * Pages 308s /tw to /tw/, and a canonical or hreflang target must not
 * redirect.
 */
function regionUrl(region: string, page: string): string {
  return page ? `${SITE_ORIGIN}/${region}${page}` : `${SITE_ORIGIN}/${region}/`;
}

/**
 * hreflang pairs for one page: each region's copy in its language, and the
 * bare origin as x-default, since it forwards a visitor to their region.
 * There is no "en" entry: English is a display preference, not a URL.
 */
function alternatesFor(page: string): Array<{ hreflang: string; href: string }> {
  return [
    ...Object.entries(REGION_TO_LANG).map(([region, lang]) => ({ hreflang: lang, href: regionUrl(region, page) })),
    { hreflang: 'x-default', href: `${SITE_ORIGIN}${page || '/'}` },
  ];
}

function replaceRequired(html: string, pattern: RegExp, replacement: string, label: string): string {
  if (!pattern.test(html)) {
    throw new Error(`Could not find ${label} in index.html`);
  }
  return html.replace(pattern, replacement);
}

/**
 * Rewrite title, description and inject og:* tags.
 * Pass `null` as region for the root index.html (og:url = https://unibooks.app).
 */
function buildHtml(
  originalHtml: string,
  region: string | null,
  locale: Lang,
  strings: Strings,
): string {
  let html = originalHtml;

  const title = strings['seo.homeTitle'] ?? SITE_NAME;
  const description = strings['seo.description'] ?? '';

  html = replaceRequired(
    html,
    /<html\b([^>]*)\blang=["'][^"']*["']([^>]*)>/i,
    `<html$1lang="${locale}"$2>`,
    'the root html language attribute',
  );

  // Replace <title>
  html = replaceRequired(
    html,
    /<title>.*?<\/title>/,
    `<title>${escapeHtml(title)}</title>`,
    'the title element',
  );

  // Replace <meta name="description" ...>
  html = replaceRequired(
    html,
    /<meta\s+name=["']description["'][^>]*>/i,
    `<meta name="description" content="${escapeHtml(description)}">`,
    'the description meta tag',
  );

  const ogUrl = region ? regionUrl(region, '') : `${SITE_ORIGIN}/`;
  const ogImage = `${SITE_ORIGIN}/icons/icon-512x512.png`;
  const ogLocale = ogLocaleFor(locale);

  // The root only forwards, so it names no canonical of its own; each region
  // home is canonical to itself.
  const alternates = [
    ...(region ? [`<link rel="canonical" href="${escapeHtml(ogUrl)}">`] : []),
    ...alternatesFor('').map(
      (alt) => `<link rel="alternate" hreflang="${alt.hreflang}" href="${escapeHtml(alt.href)}">`,
    ),
  ];

  // Organization.logo is what Google shows beside the site in results.
  // A data block, not script, so the CSP's script-src does not apply.
  const searchBase = region ? `${SITE_ORIGIN}/${region}` : `${SITE_ORIGIN}/${DEFAULT_REGION}`;
  const ldJson = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "name": SITE_NAME,
        "url": `${SITE_ORIGIN}/`,
        "logo": ogImage
      },
      {
        "@type": "WebSite",
        "name": SITE_NAME,
        "url": ogUrl,
        "potentialAction": {
          "@type": "SearchAction",
          "target": `${searchBase}/search?q={search_term_string}`,
          "query-input": "required name=search_term_string"
        }
      }
    ]
  };

  const tags = [
    ...alternates,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(ogUrl)}">`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}">`,
    `<meta property="og:locale" content="${ogLocale}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    // "<" escaped so no string in the block can close the script element.
    `<script type="application/ld+json">${JSON.stringify(ldJson).replace(/</g, '\\u003c')}</script>`,
  ].join('\n  ');

  // Insert tags before </head>
  html = replaceRequired(html, /<\/head>/i, `  ${tags}\n</head>`, 'the closing head tag');
  return html;
}

function updateServiceWorkerHash(html: string): void {
  if (!fs.existsSync(NGSW_PATH)) {
    // A build without a service worker (the smoke configuration) has no
    // manifest to keep in step with the patched HTML. A missing manifest
    // beside the worker itself, though, means a broken production build.
    if (!fs.existsSync(path.join(DIST_DIR, 'ngsw-worker.js'))) return;
    throw new Error('ngsw.json not found after Angular build');
  }

  const manifest = JSON.parse(fs.readFileSync(NGSW_PATH, 'utf-8')) as {
    hashTable?: Record<string, string>;
  };
  if (!manifest.hashTable || typeof manifest.hashTable['/index.html'] !== 'string') {
    throw new Error('ngsw.json does not contain a hash for /index.html');
  }

  manifest.hashTable['/index.html'] = createHash('sha1').update(html).digest('hex');
  fs.writeFileSync(NGSW_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Inject region redirect rules into the dist copy of _redirects.
 *
 * The source public/_redirects only contains static rules (SPA fallback etc.).
 * Region rules are derived entirely from REGION_TO_LANG, so adding a
 * region never requires editing _redirects by hand.
 *
 * Idempotent: any existing region rules are stripped before re-injecting,
 * so running the build script twice never produces duplicate entries.
 *
 * Desired order in the final file:
 *   /index.html  /  200          ← already in source file (must stay first)
 *   /<region>/*  /<region>/index.html  200   ← injected here, one per region
 *   /*  /index.html  200         ← SPA fallback (must stay last)
 */
function injectRedirects(regions: string[]): void {
  if (!fs.existsSync(REDIRECTS_PATH)) {
    throw new Error('_redirects not found in dist');
  }

  const original = fs.readFileSync(REDIRECTS_PATH, 'utf-8');

  // Strip any previously injected region rules to ensure idempotency.
  const stripped = original.replace(
    /^\/[a-z0-9-]+\/\*\s+\/[a-z0-9-]+\/index\.html\s+200\n?/gmi,
    '',
  );

  const regionLines = regions.map((r) => `/${r}/*  /${r}/index.html  200`).join('\n');

  // Insert region lines just before the catch-all "/* /index.html 200" rule.
  const updated = stripped.replace(
    /(\/\*\s+\/index\.html\s+200)/,
    `${regionLines}\n$1`,
  );

  if (updated === stripped) {
    throw new Error('Could not find the SPA fallback rule in dist/_redirects');
  }

  fs.writeFileSync(REDIRECTS_PATH, updated);
  console.log(`Injected redirect rules for: ${regions.join(', ')}`);
}

/** Write dist/sitemap.xml with each region's fixed public pages. */
function writeSitemap(regions: string[]): void {
  // Only the region copies are listed: the bare-origin URLs just forward to
  // one of them. Each entry names every language version of itself.
  const urls = regions.flatMap((region) =>
    SITEMAP_PAGES.map((page) => [
      '  <url>',
      `    <loc>${regionUrl(region, page)}</loc>`,
      ...alternatesFor(page).map(
        (alt) => `    <xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${alt.href}"/>`,
      ),
      '  </url>',
    ].join('\n')),
  );
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
  fs.writeFileSync(SITEMAP_PATH, xml);
  console.log(`Wrote sitemap.xml (${urls.length} URLs)`);
}


// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  if (!fs.existsSync(INDEX_HTML_PATH)) {
    console.error('index.html not found at', INDEX_HTML_PATH);
    process.exit(1);
  }

  const originalHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');

  // Patch the root index.html in the default region's language; see
  // DEFAULT_REGION.
  const defaultLanguage: Lang = REGION_TO_LANG[DEFAULT_REGION];
  const rootHtml = buildHtml(originalHtml, null, defaultLanguage, await loadStrings(defaultLanguage));
  fs.writeFileSync(INDEX_HTML_PATH, rootHtml);
  updateServiceWorkerHash(rootHtml);
  console.log(`Patched root index.html (${defaultLanguage})`);

  // Generate per-region index.html files.
  const regions = Object.keys(REGION_TO_LANG);
  for (const [region, lang] of Object.entries(REGION_TO_LANG)) {
    validateRegion(region);
    const regionDir = path.join(DIST_DIR, region);
    if (!fs.existsSync(regionDir)) {
      fs.mkdirSync(regionDir, { recursive: true });
    }

    const strings = await loadStrings(lang);

    const regionHtml = buildHtml(originalHtml, region, lang, strings);
    fs.writeFileSync(path.join(regionDir, 'index.html'), regionHtml);
    console.log(`Generated ${region}/index.html (${lang})`);
  }

  injectRedirects(regions);
  writeSitemap(regions);
}

run().catch((error: unknown) => {
  console.error('Failed to build regional HTML:', error);
  process.exitCode = 1;
});
