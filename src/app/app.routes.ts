import { superuserGuard } from './features/admin/superuser.guard';
import { Routes } from '@angular/router';
import { authGuard, accountIndexGuard, guestGuard } from './core/auth.guard';
import { adminGuard } from './features/admin/admin.guard';
import { regionGuard, rootRedirectGuard } from './core/region.guard';
import { unsavedChangesGuard } from './core/unsaved-changes.guard';

const featureRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },
  {
    path: 'search',
    data: { seo: { titleKey: 'nav.search' } },
    loadComponent: () => import('./features/search/search').then((m) => m.Search),
  },
  {
    path: 'book',
    loadComponent: () => import('./features/book/book').then((m) => m.Book),
  },
  {
    path: 'sell',
    data: { seo: { titleKey: 'nav.sell' } },
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/sell/sell').then((m) => m.Sell),
  },
  {
    path: 'login',
    data: { seo: { titleKey: 'auth.login' } },
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    data: { seo: { titleKey: 'auth.registerTitle' } },
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register').then((m) => m.RegisterPage),
  },
  {
    path: 'account',
    data: { seo: { titleKey: 'nav.account' } },
    // Guarded at the parent now that /account is the dashboard only — the
    // login wall it used to render on the same URL moved to /login.
    canActivate: [authGuard],
    loadComponent: () => import('./features/account/account').then((m) => m.Account),
    children: [
      { path: '', canActivate: [accountIndexGuard], loadComponent: () => import('./features/account/account-index.component').then(m => m.AccountIndexComponent) },
      { path: 'listings', canActivate: [authGuard], loadComponent: () => import('./features/account/listings').then(m => m.ListingsComponent) },
      { path: 'subscriptions', canActivate: [authGuard], loadComponent: () => import('./features/account/subscriptions').then(m => m.SubscriptionsComponent) },
      { path: 'orders', canActivate: [authGuard], loadComponent: () => import('./features/account/orders').then(m => m.OrdersComponent) },
      { path: 'reports', canActivate: [authGuard], loadComponent: () => import('./features/account/reports').then(m => m.ReportsComponent) },
      { path: 'notifications', canActivate: [authGuard], loadComponent: () => import('./features/account/notifications').then(m => m.NotificationsComponent) },
      { path: 'settings', canActivate: [authGuard], loadComponent: () => import('./features/account/settings').then(m => m.SettingsComponent) }
    ]
  },
  { path: 'checkout/success', data: { seo: { titleKey: 'checkout.successTitle' } }, loadComponent: () => import('./features/checkout/success').then(m => m.OrderSuccessComponent) },
  // Guarded, though it never used to be: placing an order needs a session.
  // Its entrances already assume one — listing-detail's canStartTransaction and
  // book's buy buttons bounce a signed-out visitor to /login themselves, and
  // messages' goToCheckout sits behind /messages' own authGuard. Saying so on
  // the route means a session that dies *while* the visitor is on checkout gets
  // the same answer, instead of leaving them on a page whose only button fails.
  { path: 'checkout/:id', data: { seo: { titleKey: 'checkout.title' } }, canActivate: [authGuard], loadComponent: () => import('./features/checkout/checkout').then(m => m.CheckoutComponent) },
  { path: 'listing/:id', loadComponent: () => import('./features/listing-detail/listing-detail').then(m => m.ListingDetail) },
  { path: 'seller/:id', loadComponent: () => import('./features/seller/seller').then(m => m.SellerPageComponent) },
  {
    path: 'messages',
    data: { seo: { titleKey: 'nav.messages' } },
    canActivate: [authGuard],
    loadComponent: () => import('./features/messages/messages').then((m) => m.Messages),
  },
  {
    path: 'verify',
    data: { seo: { titleKey: 'verify.title' } },
    loadComponent: () => import('./features/auth/verify').then((m) => m.VerifyEmail),
  },
  {
    path: 'forgot-password',
    data: { seo: { titleKey: 'auth.forgotPassword' } },
    loadComponent: () => import('./features/auth/forgot-password').then((m) => m.ForgotPassword),
  },
  {
    path: 'admin',
    data: { seo: { titleKey: 'admin.title' } },
    canActivate: [adminGuard],
    loadComponent: () => import('./features/admin/admin-shell.component').then((m) => m.AdminShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'users' },
      { path: 'regions', canActivate: [superuserGuard], loadComponent: () => import('./features/admin/regions-list.component').then(m => m.AdminRegionsListComponent) },
      { path: 'regions/:id', canActivate: [superuserGuard], loadComponent: () => import('./features/admin/region-detail.component').then(m => m.AdminRegionDetailComponent) },
      { path: 'currencies', canActivate: [superuserGuard], loadComponent: () => import('./features/admin/currencies-list.component').then(m => m.AdminCurrenciesListComponent) },
      { path: 'currencies/:id', canActivate: [superuserGuard], loadComponent: () => import('./features/admin/currency-detail.component').then(m => m.AdminCurrencyDetailComponent) },
      { path: 'users', loadComponent: () => import('./features/admin/users-list.component').then(m => m.AdminUsersListComponent) },
      { path: 'users/:id', loadComponent: () => import('./features/admin/user-detail.component').then(m => m.AdminUserDetailComponent) },
      { path: 'schools', loadComponent: () => import('./features/admin/schools-list.component').then(m => m.AdminSchoolsListComponent) },
      { path: 'categories', loadComponent: () => import('./features/admin/categories-list.component').then(m => m.AdminCategoriesListComponent) },
      { path: 'schools/:id', loadComponent: () => import('./features/admin/school-detail.component').then(m => m.AdminSchoolDetailComponent) },
      { path: 'listings', loadComponent: () => import('./features/admin/listings-list.component').then(m => m.AdminListingsListComponent) },
      { path: 'listings/:id', loadComponent: () => import('./features/admin/listing-detail-admin.component').then(m => m.AdminListingDetailComponent) },
      { path: 'orders', loadComponent: () => import('./features/admin/orders-list.component').then(m => m.AdminOrdersListComponent) },
      { path: 'orders/:id', loadComponent: () => import('./features/admin/order-detail-admin.component').then(m => m.AdminOrderDetailComponent) },
      { path: 'reports', loadComponent: () => import('./features/admin/reports-list.component').then(m => m.AdminReportsListComponent) },
      { path: 'chat-reports', loadComponent: () => import('./features/admin/chat-reports-list.component').then(m => m.AdminChatReportsListComponent) },
      { path: 'managers', loadComponent: () => import('./features/admin/managers-list.component').then(m => m.AdminManagersListComponent) },
      { path: 'advertisers', loadComponent: () => import('./features/admin/advertisers-list.component').then(m => m.AdminAdvertisersListComponent) },
      { path: 'promotions', loadComponent: () => import('./features/admin/ads-list.component').then(m => m.AdminAdsListComponent) },
    ]
  },
  {
    path: '**',
    // Cloudflare Pages serves the app shell with HTTP 200 for every path it
    // has no file for, so a mistyped or dead link is a "soft 404" a search
    // engine would index as a real page. The status cannot be changed without
    // running a Function on every navigation; noindex is the cheap signal.
    data: { seo: { titleKey: 'notfound.title', noindex: true } },
    loadComponent: () => import('./features/not-found/not-found').then(m => m.NotFoundComponent),
  }
];

export const routes: Routes = [
  {
    path: ':region',
    canActivate: [regionGuard],
    children: featureRoutes
  },
  {
    path: '**',
    canActivate: [rootRedirectGuard],
    children: []
  }
];
