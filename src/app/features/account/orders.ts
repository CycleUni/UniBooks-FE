import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { OrderService, Order } from '../../core/services/order.service';
import { AuthStore } from '../../core/auth.store';
import { TPipe, I18nService } from '../../core/i18n.service';
import { AccountService } from '../../core/services/account.service';
import { UiSkeleton } from '../../shared/ui/skeleton.component';
import { UiButton } from '../../shared/ui/button.component';
import { UiEmpty } from '../../shared/ui/empty.component';
import { UiSearchBarComponent } from '../../shared/ui/search-bar.component';
import { Router, ActivatedRoute } from '@angular/router';
import { ReviewModalComponent } from './review-modal.component';
import { MeetupModalComponent } from './meetup-modal.component';
import { DateTimeFormatPipe } from '../../shared/pipes/datetime-format.pipe';
import { PricePipe } from '../../shared/pipes/price.pipe';
import { GoogleAnalyticsService } from '../../core/services/google-analytics.service';
import { RegionLinkService } from '../../core/region-link.service';
import { ToastService } from '../../core/services/toast.service';
import { scrollBehavior } from '../../core/reduced-motion';
import { parseApiError } from '../../core/api-error.util';


@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, RouterModule, UiSkeleton, TPipe, UiButton, UiEmpty, ReviewModalComponent, MeetupModalComponent, DateTimeFormatPipe, PricePipe, UiSearchBarComponent],
  template: `
    <h2 class="section-heading">{{ 'acct.myOrders' | t }}</h2>

      <div class="tabs">
        <button class="tab" [class.active]="activeTab === 'buying'" (click)="setTab('buying')">{{ 'acct.buying' | t }}</button>
        <button class="tab" [class.active]="activeTab === 'selling'" (click)="setTab('selling')">{{ 'acct.selling' | t }}</button>
      </div>

      <ui-search-bar 
         class="mb-5" style="display: block;"
        [placeholder]="'acct.searchOrders' | t" 
        [value]="searchQuery" 
        (search)="onSearchQuery($event)">
      </ui-search-bar>

      <ui-skeleton *ngIf="isLoading" variant="order" [count]="3"></ui-skeleton>

      <div *ngIf="!isLoading">
        <div *ngIf="activeTab === 'buying'">
          <ui-empty *ngIf="filteredBoughtOrders.length === 0" [message]="'acct.noOrders' | t"></ui-empty>
          <div class="order-card" *ngFor="let order of filteredBoughtOrders" [id]="'order-' + order.id">
            <div *ngIf="hasExclusiveConflict(order)" class="exclusive-conflict">
              {{ 'order.exclusiveConflict' | t }}
              <ui-button variant="ghost" (onClick)="cancelOtherPending(order)">{{ 'order.cancelOtherPending' | t }}</ui-button>
            </div>
            <div class="order-header">
              <span class="order-id">#{{ order.id }}</span>
              <span class="order-status badge" [ngClass]="order.status">
                {{ order.status === 'cancelled' && order.cancel_reason ? ('order.cancel_reason.' + order.cancel_reason | t) : (('order.status.' + order.status) | t) }}
              </span>
            </div>
            <div class="order-body">
              <div class="info">
                <h3 class="book-title-serif">{{ order.listing_title }}</h3>
                <p>{{ 'order.seller' | t }}: {{ order.seller_name }}</p>
                <p *ngIf="order.meetup_time" class="meetup-detail">{{ 'order.meetupTime' | t }}: {{ order.meetup_time | dateTimeFormat }}</p>
                <p *ngIf="order.meetup_location" class="meetup-detail">{{ 'order.meetupLocation' | t:{location: order.meetup_location} }}</p>
              </div>
              <div class="price">
                {{ order.total_amount | price: order.currency }}
              </div>
            </div>
            <div class="order-actions" *ngIf="hasActions(order, 'buyer')">
              <ui-button *ngIf="order.status === 'pending' || order.status === 'accepted'" variant="ghost" (onClick)="updateStatus(order, 'cancelled', 'buyer_cancelled')">{{ 'order.cancel' | t }}</ui-button>
              <ui-button *ngIf="order.status === 'handed_over'" (onClick)="updateStatus(order, 'completed')">{{ 'order.confirmReceived' | t }}</ui-button>
              <ui-button *ngIf="order.status === 'completed' && !order.has_reviewed" variant="ghost" (onClick)="openReviewModal(order)">{{ 'order.reviewAndReport' | t }}</ui-button>
            </div>
          </div>
        </div>

        <div *ngIf="activeTab === 'selling'">
          <ui-empty *ngIf="filteredSoldOrders.length === 0" [message]="'acct.noSales' | t"></ui-empty>
          <div class="order-card" *ngFor="let order of filteredSoldOrders" [id]="'order-' + order.id">
            <div class="order-header">
              <span class="order-id">#{{ order.id }}</span>
              <span class="order-status badge" [ngClass]="order.status">
                {{ order.status === 'cancelled' && order.cancel_reason ? ('order.cancel_reason.' + order.cancel_reason | t) : (('order.status.' + order.status) | t) }}
              </span>
            </div>
            <div class="order-body">
              <div class="info">
                <h3 class="book-title-serif">{{ order.listing_title }}</h3>
                <p>{{ 'order.buyer' | t }}: {{ order.buyer_name }}</p>
                <p *ngIf="order.meetup_time" class="meetup-detail">{{ 'order.meetupTime' | t }}: {{ order.meetup_time | dateTimeFormat }}</p>
                <p *ngIf="order.meetup_location" class="meetup-detail">{{ 'order.meetupLocation' | t:{location: order.meetup_location} }}</p>
              </div>
              <div class="price">
                {{ order.total_amount | price: order.currency }}
              </div>
            </div>
            <div class="order-actions" *ngIf="hasActions(order, 'seller')">
              <ng-container *ngIf="order.status === 'pending'">
                <ui-button (onClick)="approveOrder(order)">{{ 'order.approve' | t }}</ui-button>
                <ui-button variant="ghost" (onClick)="updateStatus(order, 'cancelled', 'seller_rejected')">{{ 'order.reject' | t }}</ui-button>
              </ng-container>
              <ui-button *ngIf="order.status === 'accepted'" (onClick)="updateStatus(order, 'handed_over')">{{ 'order.markHandedOver' | t }}</ui-button>
              <ui-button variant="ghost" *ngIf="order.status === 'accepted'" (onClick)="updateStatus(order, 'cancelled', 'seller_cancelled')">{{ 'order.cancel' | t }}</ui-button>
              <ui-button *ngIf="order.status === 'completed' && !order.has_reviewed" variant="ghost" (onClick)="openReviewModal(order)">{{ 'order.reviewAndReport' | t }}</ui-button>
            </div>
          </div>
        </div>
      </div>
      
      <app-review-modal *ngIf="reviewingOrderId" [orderId]="reviewingOrderId" (onClosed)="onReviewModalClosed($event)"></app-review-modal>
      <app-meetup-modal *ngIf="showMeetupModal" [bookTitle]="meetupModalOrder?.listing_title || ''" (onConfirmed)="onMeetupConfirmed($event)" (onClosed)="onMeetupModalClosed()"></app-meetup-modal>
  `,
  styles: [`
    .tabs {
      display: flex;
      gap: 16px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--line);
    }
    .tab {
      background: none;
      border: none;
      padding: 8px 16px;
      font-size: var(--text-md);
      cursor: pointer;
      color: var(--muted);
      border-bottom: 2px solid transparent;
    }
    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      font-weight: 700;
    }
    .order-card {
      padding: 24px 0;
      border-bottom: 1px solid var(--line);
    }
    .order-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .order-id {
      font-weight: 500;
      color: var(--muted);
      font-size: var(--text-base);
    }
    .badge {
      padding: 3px 7px;
      border-radius: 12px;
      font-size: var(--text-xs);
      font-weight: 700;
    }
    .badge.pending { background: var(--paper-warm); color: var(--ink); border: 1px solid var(--line); }
    .badge.accepted { background: var(--warn-bg); color: var(--warn-ink); border: 1px solid color-mix(in srgb, var(--warn-ink) 40%, transparent); }
    .badge.handed_over { background: var(--accent-soft); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); }
    .badge.completed { background: var(--success-light); color: var(--success); border: 1px solid color-mix(in srgb, var(--success) 40%, transparent); }
    .badge.cancelled { background: var(--danger-light); color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent); }
    
    .exclusive-conflict {
      background: var(--warn-bg);
      color: var(--warn-ink);
      padding: 12px;
      border-radius: 4px;
      border: 1px solid color-mix(in srgb, var(--warn-ink) 40%, transparent);
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: var(--text-base);
    }
    .meetup-detail {
      font-size: var(--text-base);
      color: var(--accent) !important;
      font-weight: 500;
    }
    
    .order-body {
      display: flex;
      justify-content: space-between;
      gap: 16px;
    }
    .info {
      flex: 1;
      min-width: 0;
    }
    .info h3 {
      margin: 0 0 8px;
      font-size: var(--text-lg);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .info p {
      margin: 4px 0;
      font-size: var(--text-base);
      color: var(--muted);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .price {
      font-size: var(--text-xl);
      font-weight: 700;
      color: var(--accent);
      flex-shrink: 0;
    }
    .order-actions {
      display: flex;
      gap: 12px;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px dashed var(--line);
      justify-content: flex-end;
    }
    /* The tint fading out is not decoration: arriving here from a
       notification, it is the only thing saying *which* of these rows is the
       order you were sent to look at. */
    .highlight-pulse {
      animation: highlight 2s;
    }
    @keyframes highlight {
      0% { background-color: var(--accent-soft); }
      100% { background-color: transparent; }
    }
    /* ...so under reduced motion it must not go through the global
       animation-duration: 0.01ms, which does not calm the effect down, it
       deletes it — the row would be pointed at for four thousandths of a
       second and the user would be left scanning the list by hand. The same
       information is carried statically instead: a flat tint that holds for
       the same two seconds the class is on the element (see checkHighlight),
       then disappears when the class is removed. Inside the media query so it
       cannot leak into the animated path. */
    @media (prefers-reduced-motion: reduce) {
      .highlight-pulse {
        animation: none;
        background-color: var(--accent-soft);
      }
    }
  `]
})
export class OrdersComponent implements OnInit {
  activeTab: 'buying' | 'selling' = 'buying';
  isLoading = true;
  boughtOrders: Order[] = [];
  soldOrders: Order[] = [];
  reviewingOrderId: string | null = null;
  showMeetupModal = false;
  meetupModalOrder: Order | null = null;
  searchQuery = '';
  highlightOrderId: string | null = null;

  private orderService = inject(OrderService);
  private authStore = inject(AuthStore);
  private accountService = inject(AccountService);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  private regionLink = inject(RegionLinkService);
  private route = inject(ActivatedRoute);
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private ga = inject(GoogleAnalyticsService);

  get filteredBoughtOrders() {
    if (!this.searchQuery) return this.boughtOrders;
    const rawQ = this.searchQuery.toLowerCase().trim();
    const cleanQ = rawQ.replace(/^#/, '').trim();
    return this.boughtOrders.filter(o => 
      (o.listing_title && o.listing_title.toLowerCase().includes(rawQ)) ||
      (o.id && String(o.id).includes(cleanQ))
    );
  }

  get filteredSoldOrders() {
    if (!this.searchQuery) return this.soldOrders;
    const rawQ = this.searchQuery.toLowerCase().trim();
    const cleanQ = rawQ.replace(/^#/, '').trim();
    return this.soldOrders.filter(o => 
      (o.listing_title && o.listing_title.toLowerCase().includes(rawQ)) ||
      (o.id && String(o.id).includes(cleanQ))
    );
  }

  hasActions(order: Order, role: 'buyer' | 'seller'): boolean {
    if (order.status === 'completed' && !order.has_reviewed) return true;
    if (role === 'buyer') {
      return order.status === 'pending' || order.status === 'accepted' || order.status === 'handed_over';
    } else {
      return order.status === 'pending' || order.status === 'accepted';
    }
  }

  onSearchQuery(query: string) {
    this.searchQuery = query;
  }

  ngOnInit() {
    if (!this.authStore.isLoggedIn()) {
      this.router.navigate(this.regionLink.path(['/login']));
      return;
    }
    this.route.queryParams.subscribe(params => {
      if (params['orderId']) {
        this.highlightOrderId = params['orderId'];
      }
    });
    this.loadOrders();
  }

  currentUserId: string | null = null;
  lastSeenBought: string | null | undefined = null;
  lastSeenSold: string | null | undefined = null;

  setTab(tab: 'buying' | 'selling') {
    this.activeTab = tab;
    if (this.currentUserId) {
      this.markTabAsSeen(this.currentUserId);
    }
  }

  markTabAsSeen(userId: string) {
    let shouldUpdate = false;
    let payload: any = {};
    
    if (this.activeTab === 'buying') {
      const maxBought = this.boughtOrders.reduce((max, o) => Math.max(max, new Date(o.updated_at || o.created_at || 0).getTime()), 0);
      if (maxBought > 0) {
        this.lastSeenBought = new Date(maxBought).toISOString();
        payload.last_seen_bought_orders_at = this.lastSeenBought;
        shouldUpdate = true;
      }
    } else {
      const maxSold = this.soldOrders.reduce((max, o) => Math.max(max, new Date(o.updated_at || o.created_at || 0).getTime()), 0);
      if (maxSold > 0) {
        this.lastSeenSold = new Date(maxSold).toISOString();
        payload.last_seen_sold_orders_at = this.lastSeenSold;
        shouldUpdate = true;
      }
    }
    
    if (shouldUpdate) {
      this.accountService.updateProfile(payload).subscribe();
    }
    this.orderService.checkUnreadOrders(userId, this.lastSeenBought, this.lastSeenSold);
  }

  loadOrders() {
    this.isLoading = true;
    this.accountService.getMyProfile().subscribe({
      next: (profile) => {
        const userId = profile.id;
        this.currentUserId = userId;
        this.lastSeenBought = profile.last_seen_bought_orders_at;
        this.lastSeenSold = profile.last_seen_sold_orders_at;
        
        this.orderService.getOrders().subscribe({
          next: (orders) => {
            this.boughtOrders = orders.filter(o => String(o.buyer) === String(userId));
            this.soldOrders = orders.filter(o => String(o.seller) === String(userId));
            
            if (this.boughtOrders.length > 0 && this.soldOrders.length === 0) {
              this.activeTab = 'buying';
            } else if (this.boughtOrders.length === 0 && this.soldOrders.length > 0) {
              this.activeTab = 'selling';
            } else if (this.boughtOrders.length > 0 && this.soldOrders.length > 0) {
              const newestBought = Math.max(...this.boughtOrders.map(o => new Date(o.updated_at || o.created_at || 0).getTime()));
              const newestSold = Math.max(...this.soldOrders.map(o => new Date(o.updated_at || o.created_at || 0).getTime()));
              this.activeTab = newestBought >= newestSold ? 'buying' : 'selling';
            }
            
            this.markTabAsSeen(userId);
            this.isLoading = false;
            this.cdr.markForCheck();
            this.checkHighlight();
          },
          error: (err) => {
            console.error('Failed to load orders', err);
            this.isLoading = false;
            this.cdr.markForCheck();
          }
        });
      },
      error: (err) => {
        console.error('Failed to load profile', err);
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  checkHighlight() {
    if (!this.highlightOrderId) return;
    
    const isBought = this.boughtOrders.some(o => String(o.id) === this.highlightOrderId);
    const isSold = this.soldOrders.some(o => String(o.id) === this.highlightOrderId);
    
    if (isBought) this.activeTab = 'buying';
    else if (isSold) this.activeTab = 'selling';
    
    setTimeout(() => {
      const el = document.getElementById('order-' + this.highlightOrderId);
      if (el) {
        el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
        el.classList.add('highlight-pulse');
        setTimeout(() => el.classList.remove('highlight-pulse'), 2000);
      }
    }, 100);
  }

  updateStatus(order: Order, status: string, cancelReason?: string, meetupTime?: string, meetupLocation?: string) {
    if (!order.id) return;
    this.orderService.updateOrderStatus(order.id, status, cancelReason, meetupTime, meetupLocation).subscribe({
      next: (updatedOrder) => {
        if (status === 'cancelled') {
          this.ga.trackCancelOrder(order.id, cancelReason);
        }
        // Find and replace - MERGE updated fields with existing order
        if (this.activeTab === 'buying') {
          const idx = this.boughtOrders.findIndex(o => o.id === order.id);
          if (idx !== -1) this.boughtOrders[idx] = { ...this.boughtOrders[idx], ...updatedOrder };
        } else {
          const idx = this.soldOrders.findIndex(o => o.id === order.id);
          if (idx !== -1) this.soldOrders[idx] = { ...this.soldOrders[idx], ...updatedOrder };
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        // This subscribe had no error branch at all, so a refused transition
        // was invisible: the seller pressed Accept and nothing whatsoever
        // happened. The backend now takes a row lock and refuses an accept
        // whose listing is no longer active — another buyer's order reserved
        // it first, or the seller has since marked it sold — and this list is
        // simply out of date about that.
        this.toast.error(parseApiError(err, this.i18n, 'acct.updateFailed'));
        // Only the codes that mean "your copy of this row is out of date".
        // A 401 is the interceptor's business and re-reading on it would just
        // fail again; a dropped connection says nothing about the row at all.
        if ([400, 403, 404, 409].includes(err?.status)) {
          this.loadOrders();
        }
        this.cdr.markForCheck();
      }
    });
  }

  approveOrder(order: Order) {
    this.meetupModalOrder = order;
    this.showMeetupModal = true;
  }

  onMeetupConfirmed(result: { time: string; location: string }) {
    const order = this.meetupModalOrder;
    this.meetupModalOrder = null;
    this.showMeetupModal = false;
    if (!order) return;
    this.updateStatus(order, 'accepted', undefined, result.time || undefined, result.location || undefined);
  }

  onMeetupModalClosed() {
    this.meetupModalOrder = null;
    this.showMeetupModal = false;
  }

  hasExclusiveConflict(order: Order): boolean {
    if (order.status !== 'accepted' && order.status !== 'handed_over') return false;
    return this.boughtOrders.some(o => 
      o.listing_title === order.listing_title && o.status === 'pending'
    );
  }

  cancelOtherPending(acceptedOrder: Order) {
    const toCancel = this.boughtOrders.filter(o => 
      o.listing_title === acceptedOrder.listing_title && o.status === 'pending'
    );
    toCancel.forEach(o => {
      this.updateStatus(o, 'cancelled', 'buyer_cancelled');
    });
  }

  onReviewModalClosed(success: boolean) {
    this.reviewingOrderId = null;
    if (success) {
      if (this.currentReviewOrderRef) {
        this.currentReviewOrderRef.has_reviewed = true;
      }
      this.ga.trackSubmitReview(this.currentReviewOrderRef?.id);
      this.toast.success(this.i18n.t('order.reviewSubmitted'));
      this.cdr.markForCheck();
    }
  }

  private currentReviewOrderRef: Order | null = null;

  openReviewModal(order: Order) {
    this.currentReviewOrderRef = order;
    this.reviewingOrderId = order.id || null;
  }
}
