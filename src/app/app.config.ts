import { ApplicationConfig, provideZoneChangeDetection, isDevMode, APP_INITIALIZER } from '@angular/core';
import { provideRouter, withInMemoryScrolling, withRouterConfig, withPreloading, withViewTransitions } from '@angular/router';
import { IdlePreloadingStrategy } from './core/idle-preloading.strategy';
import { onViewTransitionCreated } from './core/view-transitions';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';

import { routes } from './app.routes';
import { AuthInterceptor } from './core/auth.interceptor';
import { ApiUrlInterceptor } from './core/api-url.interceptor';
import { RetryInterceptor } from './core/retry.interceptor';
import { provideServiceWorker } from '@angular/service-worker';
import { I18nService } from './core/i18n.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // The layout persists across navigations, so restore scroll-to-top
    // manually to keep page switches feeling like page loads
    // canceledNavigationResolution: a CanDeactivate guard that asks the user
    // answers after the browser has already moved the address bar on a back
    // gesture; 'computed' puts the URL back when the answer is "stay".
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      withRouterConfig({ canceledNavigationResolution: 'computed' }),
      // The pages a visitor opens next, fetched in idle time; see the strategy.
      withPreloading(IdlePreloadingStrategy),
      // App-style page changes; which animation each one gets is decided in
      // core/view-transitions.ts. Browsers without the API just swap pages.
      withViewTransitions({ skipInitialTransition: true, onViewTransitionCreated }),
    ),
    provideHttpClient(withInterceptorsFromDi()),
    { provide: HTTP_INTERCEPTORS, useClass: ApiUrlInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: RetryInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }, 
    {
      provide: APP_INITIALIZER,
      useFactory: (i18n: I18nService) => () => i18n.loadLang(i18n.lang()),
      deps: [I18nService],
      multi: true
    },
    // sw.js wraps ngsw-worker.js, leaving other origins to the browser.
    provideServiceWorker('sw.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
