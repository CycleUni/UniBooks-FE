import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, NavigationEnd, ResolveStart, Router } from '@angular/router';
import { I18nService } from '../i18n.service';

/**
 * What a page says about itself to the tab, to search engines and to link
 * previews. Every field is optional; whatever is left out falls back to the
 * route's `data.seo`, then to the site-wide defaults.
 */
export interface PageSeo {
  /** i18n key for the page name; resolved on every language change. */
  titleKey?: string;
  titleParams?: Record<string, string | number>;
  /** A page name that is data rather than copy (a book's title). Wins over titleKey. */
  title?: string;
  descriptionKey?: string;
  descriptionParams?: Record<string, string | number>;
  /** Region-prefixed path plus the query that identifies the page, e.g.
   *  `/tw/book?isbn=9781449319793`. Defaults to the current path with no query. */
  canonicalPath?: string;
  /** Absolute or root-relative image URL for og:image. */
  image?: string;
  noindex?: boolean;
}

export const SITE_NAME = 'UniBooks';

/**
 * Owns <title>, the meta description, the canonical link and the og:/twitter:
 * tags for the whole app.
 *
 * Every page used to share one title — App set `seo.title` once — so every
 * tab, bookmark and search result read "UniBooks". Pages now describe
 * themselves in two layers: routes declare a static `data.seo`, and a page
 * whose name comes from data (a book, a search term) calls setPage() once it
 * knows it.
 *
 * The page layer is cleared on ResolveStart rather than NavigationStart:
 * that event only fires once guards have let the navigation through, so a
 * navigation a guard cancels (unsaved changes on /sell) leaves the page it
 * stayed on described as it was. A reused component re-emits its query
 * params during activation, which is after this point, so a search for a
 * new term re-titles itself rather than being wiped.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private title = inject(Title);
  private meta = inject(Meta);
  private router = inject(Router);
  private i18n = inject(I18nService);
  private document = inject(DOCUMENT);

  private routeSeo = signal<PageSeo>({});
  private pageSeo = signal<PageSeo>({});
  private path = signal('/');

  constructor() {
    this.router.events.subscribe(event => {
      if (event instanceof ResolveStart) {
        this.pageSeo.set({});
      } else if (event instanceof NavigationEnd) {
        this.routeSeo.set(deepestSeo(this.router.routerState.snapshot.root));
        this.path.set(event.urlAfterRedirects.split(/[?#]/)[0]);
      }
    });

    effect(() => {
      this.i18n.lang();
      this.render({ ...this.routeSeo(), ...this.pageSeo() }, this.path());
    });
  }

  /** Describe the page currently shown. Replaces any earlier call for it. */
  setPage(seo: PageSeo): void {
    this.pageSeo.set(seo);
  }

  private render(seo: PageSeo, path: string): void {
    const pageName = seo.title || (seo.titleKey ? this.i18n.t(seo.titleKey, seo.titleParams) : '');
    const fullTitle = pageName ? `${pageName} · ${SITE_NAME}` : this.i18n.t('seo.homeTitle');
    const description = seo.descriptionKey
      ? this.i18n.t(seo.descriptionKey, seo.descriptionParams)
      : this.i18n.t('seo.description');
    const origin = this.document.location?.origin ?? '';
    const canonical = origin + (seo.canonicalPath || path);

    this.title.setTitle(fullTitle);
    this.meta.updateTag({ name: 'description', content: description });

    this.setCanonical(canonical);

    this.meta.updateTag({ property: 'og:site_name', content: SITE_NAME });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:title', content: fullTitle });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    if (seo.image) {
      const image = new URL(seo.image, origin || undefined).toString();
      this.meta.updateTag({ property: 'og:image', content: image });
      this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    } else {
      this.meta.removeTag('property="og:image"');
      this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    }

    if (seo.noindex) {
      this.meta.updateTag({ name: 'robots', content: 'noindex' });
    } else {
      this.meta.removeTag('name="robots"');
    }
  }

  private setCanonical(href: string): void {
    const head = this.document.head;
    if (!head) return;
    let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      head.appendChild(link);
    }
    link.setAttribute('href', href);
  }
}

/** The `data.seo` of the most specific route that declares one. */
function deepestSeo(snapshot: ActivatedRouteSnapshot): PageSeo {
  let found: PageSeo = {};
  let node: ActivatedRouteSnapshot | null = snapshot;
  while (node) {
    const seo = node.routeConfig?.data?.['seo'] as PageSeo | undefined;
    if (seo) found = seo;
    node = node.firstChild;
  }
  return found;
}
