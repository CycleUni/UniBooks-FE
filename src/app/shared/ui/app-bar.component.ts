import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TPipe } from '../../core/i18n.service';
import { SeoService } from '../../core/services/seo.service';
import { NavigationHistoryService } from '../../core/services/navigation-history.service';
import { RegionLinkService } from '../../core/region-link.service';

/**
 * The phone header of a page pushed over a tab (a book, a listing, a seller,
 * checkout...): back, and the page's name centred between equal-width sides.
 * The layout renders it in place of the logo header on those pages; on wide
 * screens it never shows.
 *
 * The title is the page's SEO name, so every page that sets its title gets
 * one here without doing anything else.
 */
@Component({
  selector: 'ui-app-bar',
  standalone: true,
  imports: [TPipe],
  template: `
    <button type="button" class="back" (click)="back()" [attr.aria-label]="'common.back' | t">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24" aria-hidden="true">
        <path d="M15 5l-7 7 7 7"/>
      </svg>
    </button>
    <span class="title">{{ seo.pageName() }}</span>
    <span aria-hidden="true"></span>
  `,
  styles: [`
    :host {
      display: none;
    }
    /* Same breakpoint as the layout's mobile header. */
    @media (max-width: 900px) {
      :host {
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr) 48px;
        align-items: center;
        min-height: 52px;
        padding: 0 4px;
      }
    }
    .back {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--ink);
      cursor: pointer;
    }
    .back:active {
      background: var(--paper-warm);
    }
    .title {
      font-size: var(--text-base);
      font-weight: 600;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `]
})
export class UiAppBar {
  readonly seo = inject(SeoService);
  private navHistory = inject(NavigationHistoryService);
  private router = inject(Router);
  private regionLink = inject(RegionLinkService);

  /** The previous in-app page, or Home when arriving from a shared link with
   *  nothing in the app to go back to. */
  back() {
    if (this.navHistory.canGoBack) {
      this.navHistory.goBack();
    } else {
      this.router.navigate(this.regionLink.path(['/']));
    }
  }
}
