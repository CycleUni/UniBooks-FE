import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

// Initialised before Angular so errors thrown during bootstrap are captured.
// With no DSN configured Sentry stays off.
if (environment.sentryDsn) {
  Sentry.init({
    dsn: environment.sentryDsn,
    environment: environment.production ? 'production' : 'development',
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: environment.production ? 0.1 : 1.0,
    // Empty on purpose: trace headers on API calls would need the backend's
    // CORS allow-list to accept sentry-trace and baggage.
    tracePropagationTargets: [],
    // Replays mask all text and block media by default; chats and order
    // details stay masked. Sample sessions lightly, but keep every error.
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
  });
}

// iOS Safari only applies :active to a tapped element when a touchstart
// listener exists; this empty one turns on the press styles in styles.css.
document.addEventListener('touchstart', () => {}, { passive: true });

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
