import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RegionLinkDirective } from '../../core/region-link.directive';
import { UiButton } from './button.component';
import { I18nService, TPipe } from '../../core/i18n.service';
import { PricePipe } from '../pipes/price.pipe';

/**
 * `ui-listing-card`: one real per-seller Listing, with marketplace chrome.
 * Contrast with `ui-book-tile`, which only ever represents a Book.
 *
 * The card body is a real anchor whenever the caller supplies `link`, and a
 * `<button>` otherwise. It used to be a bare `<div (click)>`, which on the
 * Book page — where every seller's listing is one of these — meant a keyboard
 * user could not open a single listing, and a screen reader was told nothing
 * was interactive at all.
 *
 * The two actions (contact seller / arrange meetup) are deliberately
 * *siblings* of that body, not children: they are real buttons, and an
 * interactive element nested inside a link or button is invalid HTML that
 * browsers resolve inconsistently and keyboards cannot traverse. Everything
 * inside the body is phrasing content (span, not div) for the same reason —
 * a `<button>` may not contain flow content.
 */
@Component({
  selector: 'ui-listing-card',
  standalone: true,
  imports: [CommonModule, RegionLinkDirective, UiButton, TPipe, PricePipe],
  template: `
    <div class="listing-card hover-card hover-card-surface">
      <a
        *ngIf="link"
        class="listing-body"
        [regionLink]="link"
        (click)="onClickCard.emit(item.id)"
      >
        <ng-container *ngTemplateOutlet="body"></ng-container>
      </a>

      <button *ngIf="!link" type="button" class="listing-body" (click)="onClickCard.emit(item.id)">
        <ng-container *ngTemplateOutlet="body"></ng-container>
      </button>

      <ng-template #body>
        <span class="listing-photo-container">
          <img *ngIf="(item.photo_url || item.photos?.[0]) && !imageBroken" [src]="item.photo_url || item.photos?.[0]" alt="" (error)="onImageError()" />
          <span *ngIf="!item.photo_url && !item.photos?.length || imageBroken">{{ 'book.noPhoto' | t }}</span>
        </span>
        <span class="listing-header">
          <span class="price">{{ item.price | price: item.currency }}</span>
          <span class="condition-badge" [ngClass]="item.condition">{{ getConditionLabel(item.condition) }}</span>
        </span>
        <span class="seller-info">
          <strong>{{ item.seller_name }}</strong> ({{ item.school_name || ('acct.noSchool' | t) }})
        </span>
        <span class="course-info" *ngIf="item.course_name">
          {{ 'book.coursePrefix' | t:{course: item.course_name} }}
        </span>
        <span class="listing-note" *ngIf="item.description">
          {{ item.description }}
        </span>
      </ng-template>

      <!-- Contacting the seller leads, and the meetup request follows. The
           order used to be reversed, but the backend rejects an order from a
           buyer with no conversation on this listing (checkout.errNoChat), so
           the leading button was sending every first-time buyer into a page
           that could only fail. -->
      <div class="button-group">
        <ui-button  class="flex-1" (onClick)="onContactSeller.emit(item.id)">{{ 'book.contactSeller' | t }}</ui-button>
        <ui-button variant="ghost"  class="flex-1" (onClick)="onBuyNow.emit(item.id)">{{ 'checkout.arrangeMeetup' | t }}</ui-button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
    /* --line-strong, not --line: the whole card is a click target, and
       --line is 1.48:1 — below WCAG 1.4.11's 3:1 for non-text UI. */
    .listing-card {
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-xs);
      padding: 16px;
      background-color: var(--surface-card);
      display: flex;
      flex-direction: column;
    }
    /* Resets so the anchor/button carrying the body still looks like the old
       div: both ship UA styles (centred text, a border, their own font) that
       would otherwise redraw the card. */
    .listing-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      text-align: left;
      width: 100%;
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      color: inherit;
      text-decoration: none;
      cursor: pointer;
    }
    .button-group {
      display: flex;
      gap: 8px;
      padding-top: 16px;
    }
    .listing-photo-container {
      width: 100%;
      aspect-ratio: 5 / 7;
      background-color: var(--paper-warm);
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-size: var(--text-base);
      border-radius: var(--radius-xs);
      overflow: hidden;
      flex-shrink: 0;
    }
    .listing-photo-container img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .listing-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .price {
      font-family: 'Noto Serif TC', serif;
      font-variant-numeric: tabular-nums;
      font-size: var(--text-2xl);
      font-weight: 700;
      color: var(--accent);
    }
    .condition-badge {
      display: inline-flex;
      align-items: center;
      font-size: var(--text-xs);
      color: var(--muted);
    }
    .condition-badge::before {
      content: '●';
      color: var(--accent);
      font-size: 8px;
      margin-right: 5px;
    }
    .condition-badge.noted::before,
    .condition-badge.damaged::before {
      color: var(--flag);
    }
    .seller-info {
      display: block;
      font-size: var(--text-base);
      margin-bottom: 8px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .course-info {
      display: block;
      font-size: var(--text-base);
      color: var(--muted);
      margin-bottom: 8px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .listing-note {
      display: block;
      font-size: var(--text-base);
      color: var(--muted);
      font-style: italic;
      margin-top: 12px;
      padding: 12px;
      background-color: var(--paper-warm);
      border-left: 3px solid var(--line);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
  `]
})
export class UiListingCard {
  @Input({ required: true }) item!: any;

  /**
   * Router target for the card body. When set the body renders as a real
   * anchor with an href (middle-click, open-in-new-tab, SEO); when omitted it
   * falls back to a `<button>` and the caller navigates in `(onClickCard)`.
   */
  @Input() link?: any[] | string;

  @Output() onClickCard = new EventEmitter<string>();
  @Output() onBuyNow = new EventEmitter<string>();
  @Output() onContactSeller = new EventEmitter<string>();

  private i18n = inject(I18nService);
  imageBroken = false;

  onImageError() {
    this.imageBroken = true;
  }

  getConditionLabel(cond: string): string {
    const translated = this.i18n.t(`cond.${cond}`);
    return translated === `cond.${cond}` ? cond : translated;
  }
}
