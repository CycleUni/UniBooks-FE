import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { Observable, BehaviorSubject } from 'rxjs';

export interface Order {
  id?: string;
  buyer?: string;
  seller?: string;
  buyer_name?: string;
  seller_name?: string;
  listing_title?: string;
  listing: string;
  status?: string;
  cancel_reason?: string;
  total_amount?: number;
  /** ISO 4217 code; total_amount is in this currency's minor units. */
  currency?: string;
  meetup_time?: string;
  meetup_location?: string;
  created_at?: string;
  updated_at?: string;
  has_reviewed?: boolean;
}

@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);
  private url = '/orders/';

  public unreadOrders$ = new BehaviorSubject<boolean>(false);

  checkUnreadOrders(userId: string, lastSeenBoughtAt: string | null | undefined, lastSeenSoldAt: string | null | undefined) {
    this.getOrders().subscribe(orders => {
      const boughtOrders = orders.filter(o => String(o.buyer) === String(userId));
      const soldOrders = orders.filter(o => String(o.seller) === String(userId));
      
      const lastSeenBought = lastSeenBoughtAt ? new Date(lastSeenBoughtAt).getTime() : 0;
      const lastSeenSold = lastSeenSoldAt ? new Date(lastSeenSoldAt).getTime() : 0;
      
      const maxBought = boughtOrders.reduce((max, o) => Math.max(max, new Date(o.updated_at || o.created_at || 0).getTime()), 0);
      const maxSold = soldOrders.reduce((max, o) => Math.max(max, new Date(o.updated_at || o.created_at || 0).getTime()), 0);
      
      this.unreadOrders$.next(maxBought > lastSeenBought || maxSold > lastSeenSold);
    });
  }

  getOrders(): Observable<Order[]> {
    return this.http.get<any>(this.url).pipe(
      map(res => res.results ? res.results : res)
    );
  }

  getOrder(id: string) {
    return this.http.get<Order>(this.url + id + '/');
  }

  createOrder(order: Order) {
    return this.http.post<Order>(this.url, order);
  }

  updateOrderStatus(id: string, status: string, cancelReason?: string, meetupTime?: string, meetupLocation?: string) {
    const body: any = { status };
    if (cancelReason) body.cancel_reason = cancelReason;
    if (meetupTime) body.meetup_time = meetupTime;
    if (meetupLocation) body.meetup_location = meetupLocation;
    return this.http.patch<Order>(this.url + id + '/', body);
  }

  submitReview(orderId: string, rating: number | null, comment: string, isNoShow: boolean = false) {
    const body = {
      order: orderId,
      rating: rating,
      comment: comment,
      is_no_show: isNoShow
    };
    return this.http.post<any>(this.url + 'reviews/', body);
  }
}
