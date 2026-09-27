import { Component } from '@angular/core';

/**
 * A page's primary actions. On wide screens a plain row of buttons where the
 * page puts it; on phones pinned to the bottom of the screen, where the thumb
 * is, with an optional lead (the price) on the left and the buttons on the
 * right at the width of their labels — the product-screen layout of
 * marketplace apps.
 *
 * The route that shows one declares `data: { actionBar: true }`, and the
 * layout then drops the bottom tab bar and reserves this bar's height. That
 * is decided at navigation time rather than when this component renders, so
 * the tab bar is already gone while the page loads and during the page
 * transition, instead of vanishing when the data arrives.
 *
 *   <ui-action-bar>
 *     <span actionBarLead>{{ price }}</span>
 *     <ui-button>…</ui-button>
 *   </ui-action-bar>
 */
@Component({
  selector: 'ui-action-bar',
  standalone: true,
  template: `
    <span class="lead"><ng-content select="[actionBarLead]"></ng-content></span>
    <ng-content></ng-content>
  `,
  styles: [`
    :host {
      display: flex;
      gap: 16px;
      margin-top: auto;
    }
    /* The lead repeats what the page shows larger beside its title; only the
       phone bar, where that is scrolled away, needs it. */
    .lead {
      display: none;
    }

    @media (max-width: 900px) {
      :host {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 100;
        align-items: center;
        gap: 8px;
        margin: 0;
        padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
        background: var(--paper);
        border-top: 1px solid var(--line);
      }
      .lead {
        display: block;
        flex-shrink: 0;
        margin-right: auto;
        font-family: 'Noto Serif TC', serif;
        font-size: var(--text-lg);
        font-weight: 700;
        color: var(--accent);
        font-variant-numeric: tabular-nums;
      }
      /* Label-width buttons, not the equal halves (flex-1) or full width
         (block) the pages ask for on desktop; the !important beats the
         inline padding and font size those pages set for that layout. */
      :host ::ng-deep > ui-button {
        flex: 0 0 auto;
        display: inline-block !important;
        width: auto !important;
        padding: 0 !important;
        font-size: var(--text-base) !important;
      }
    }
  `]
})
export class UiActionBar {}
