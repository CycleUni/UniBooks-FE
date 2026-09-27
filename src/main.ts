

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// iOS Safari only applies :active to a tapped element when a touchstart
// listener exists; this empty one turns on the press styles in styles.css.
document.addEventListener('touchstart', () => {}, { passive: true });

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
