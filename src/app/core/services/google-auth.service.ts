import { ApplicationRef, Injectable, inject, PLATFORM_ID, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthStore } from '../auth.store';
import { I18nService } from '../i18n.service';
import { ThemeService } from './theme.service';
import { ToastService } from './toast.service';
import { parseApiError } from '../api-error.util';
import { whenPageSettled } from '../page-settled';


@Injectable({
  providedIn: 'root'
})
export class GoogleAuthService {
  private authStore = inject(AuthStore);
  private i18n = inject(I18nService);
  private themeService = inject(ThemeService);
  private toast = inject(ToastService);
  private platformId = inject(PLATFORM_ID);
  private appRef = inject(ApplicationRef);
  
  private googleClientId = '';
  private isScriptLoaded = false;
  private isInitializing = false;
  private isGoogleInitialized = false;
  private loadedLang = '';
  /** Set once the Google button is pressed; see setupGoogle(). */
  private buttonPressed = false;

  constructor() {
    effect(() => {
      // Re-initialize or re-prompt when auth state or language changes
      this.i18n.lang();
      const isAuth = this.authStore.isAuthenticated();
      
      if (isAuth && isPlatformBrowser(this.platformId)) {
        // User just logged in (via Google or password) — mark session
        // so One Tap won't show again. Cancel any in-flight prompt.
        sessionStorage.setItem('google_one_tap_done', '1');
        if ((window as any).google?.accounts?.id) {
          (window as any).google.accounts.id.cancel();
        }
      }
      
      // One Tap waits for the first page to be up (see whenPageSettled): it
      // fetches the auth config and Google's script, and a prompt a moment
      // later costs nothing. initializeGoogleAuth checks the session again.
      if (!isAuth && isPlatformBrowser(this.platformId)) {
        whenPageSettled(this.appRef).then(() => this.initializeGoogleAuth());
      }
    });
  }

  private loadGoogleScript(): Promise<void> {
    const currentLang = this.i18n.lang();
    if (this.isScriptLoaded && (window as any).google && this.loadedLang === currentLang) {
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      const existingScript = document.getElementById('google-jssdk');
      if (existingScript) {
        existingScript.remove();
      }
      
      // We must remove google object to force a clean re-initialization if language changes
      delete (window as any).google;
      this.isGoogleInitialized = false;

      const script = document.createElement('script');
      script.id = 'google-jssdk';
      script.src = `https://accounts.google.com/gsi/client?hl=${this.i18n.lang()}`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        this.isScriptLoaded = true;
        this.loadedLang = currentLang;
        resolve();
      };
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }

  public initializeGoogleAuth() {
    if (!isPlatformBrowser(this.platformId) || this.isInitializing) return;
    
    // If user already completed a login this session, skip One Tap entirely
    if (sessionStorage.getItem('google_one_tap_done')) return;
    
    // If logged in, we shouldn't prompt One Tap
    if (this.authStore.isAuthenticated()) return;

    this.isInitializing = true;
    
    // Bind global handler
    (window as any).handleGoogleCredential = (response: any) => this.handleGoogleCredential(response);

    if (!this.googleClientId) {
      this.authStore.getAuthConfig().subscribe({
        next: (config) => {
          if (config && config.google_client_id) {
            this.googleClientId = config.google_client_id;
            this.setupGoogle();
          } else {
            this.isInitializing = false;
          }
        },
        error: (err) => {
          console.error('Failed to load Google Auth config', err);
          this.isInitializing = false;
        }
      });
    } else {
      this.setupGoogle();
    }
  }

  private setupGoogle() {
    this.loadGoogleScript().then(() => {
      if ((window as any).google && this.googleClientId) {
        if (!this.isGoogleInitialized) {
          (window as any).google.accounts.id.initialize(this.initOptions());
          this.isGoogleInitialized = true;
        }
        
        // Show One Tap prompt — unless the button was pressed while the script
        // loaded. Under FedCM the browser runs one sign-in dialog at a time, and
        // a prompt arriving late cancelled the account chooser the button had
        // just opened.
        if (!this.buttonPressed) {
          (window as any).google.accounts.id.prompt();
        }
      }
      this.isInitializing = false;
    }).catch(err => {
      console.error('Failed to load Google SDK', err);
      this.isInitializing = false;
    });
  }

  // Whichever of setupGoogle / loadAndRenderButton runs first initializes
  // GIS, and GIS keeps that first configuration, so both share one set of
  // options. use_fedcm_for_prompt shows One Tap as the browser's own FedCM
  // dialog ("Sign in to … with google.com") instead of Google's iframe, which
  // keeps working once third-party cookies are gone; use_fedcm_for_button
  // does the same for the "Continue with Google" button, which opens the
  // browser's account chooser in place of Google's popup window. Browsers
  // without FedCM fall back to the iframe and the popup. Under FedCM the
  // browser owns the dialog, so cancel_on_tap_outside only affects that
  // fallback.
  private initOptions() {
    return {
      client_id: this.googleClientId,
      callback: (window as any).handleGoogleCredential,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
      use_fedcm_for_button: true
    };
  }

  public renderButton(elementId: string) {
    if (!isPlatformBrowser(this.platformId)) return;
    
    // Bind global handler just in case
    (window as any).handleGoogleCredential = (response: any) => this.handleGoogleCredential(response);
    
    if (this.googleClientId) {
      this.loadAndRenderButton(elementId);
    } else {
      this.authStore.getAuthConfig().subscribe(config => {
        if (config?.google_client_id) {
          this.googleClientId = config.google_client_id;
          this.loadAndRenderButton(elementId);
        }
      });
    }
  }

  private get isDarkTheme(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    // resolved() already collapses 'system' to the OS preference, and does so
    // as a signal — the previous inline matchMedia read here was imperative,
    // so an OS appearance change while the page was open recoloured the site
    // but left the Google button rendered in the old variant.
    return this.themeService.resolved() === 'dark';
  }

  private loadAndRenderButton(elementId: string) {
    this.loadGoogleScript().then(() => {
      if ((window as any).google && this.googleClientId) {
        if (!this.isGoogleInitialized) {
          (window as any).google.accounts.id.initialize(this.initOptions());
          this.isGoogleInitialized = true;
        }
        const container = document.getElementById(elementId);
        if (container) {
          container.innerHTML = '';
          const langCode = this.i18n.lang() === 'en' ? 'en' : 'zh-TW';
          const btnTheme = this.isDarkTheme ? 'filled_black' : 'outline';
          
          let targetWidth = container.clientWidth || 280;
          targetWidth = Math.max(200, Math.min(targetWidth, 400));

          (window as any).google.accounts.id.renderButton(
            container,
            {
              theme: btnTheme, size: 'large', type: 'standard', text: 'continue_with', locale: langCode, width: targetWidth,
              click_listener: () => { this.buttonPressed = true; }
            }
          );
        }
      }
    });
  }

  private handleGoogleCredential(response: any) {
    if (response && response.credential) {
      this.authStore.loginWithGoogle(response.credential).subscribe({
        next: () => {
          // Mark session so One Tap won't show again this session
          sessionStorage.setItem('google_one_tap_done', '1');
          // Cancel One Tap UI immediately
          if ((window as any).google?.accounts?.id) {
            (window as any).google.accounts.id.cancel();
          }
          // No navigation here. This used to compare against '/account',
          // which stopped matching the moment routes gained their /:region
          // prefix — so One Tap left the user sitting on the login wall.
          // AuthFormComponent now watches AuthStore instead and owns the
          // "we are signed in, leave the auth page" decision, which is the
          // only place that knows about returnUrl anyway.
        },
        error: (err) => {
          console.error('Google login failed', err);
          // The button lives outside any one page, so a failure here used to
          // reach nobody but the console — the user pressed "continue with
          // Google" and the page simply sat there. The backend refuses a
          // Google account whose address it has not verified
          // (auth.errEmailNotVerified, 403), which is exactly the case that
          // needs explaining.
          this.toast.error(parseApiError(err, this.i18n, 'auth.errGoogleLoginFailed'));
        }
      });
    }
  }
}
