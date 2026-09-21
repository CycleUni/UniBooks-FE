import { Injectable, Pipe, PipeTransform, inject, signal, effect } from '@angular/core';
import { Lang, TRANSLATIONS, SUPPORTED_LANGS } from './i18n/index';

const STORAGE_KEY = 'lang';

@Injectable({
  providedIn: 'root'
})
export class I18nService {
  readonly lang = signal<Lang>(this.initialLang());
  private loadPromises = new Map<Lang, Promise<void>>();

  constructor() {
    effect(() => this.syncDocumentLang(this.lang()));
  }

  private syncDocumentLang(lang: Lang) {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }

  private initialLang(): Lang {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY) as Lang;
      if (SUPPORTED_LANGS.includes(stored)) {
        return stored;
      }
    }
    if (typeof navigator !== 'undefined') {
      const lang = navigator.language?.toLowerCase() || '';
      if (lang.includes('hk') || lang.includes('yue')) return 'zh-HK';
      if (lang.startsWith('zh')) return 'zh-TW';
    }
    return 'en';
  }

  async loadLang(lang: Lang): Promise<void> {
    if (lang === 'en' || TRANSLATIONS[lang]) return;

    if (this.loadPromises.has(lang)) {
      return this.loadPromises.get(lang)!;
    }

    const promise = (async () => {
      try {
        if (lang === 'zh-TW') {
          const m = await import('./i18n/zh-TW');
          TRANSLATIONS['zh-TW'] = m.zhTW;
        } else if (lang === 'zh-HK') {
          const m = await import('./i18n/zh-HK');
          TRANSLATIONS['zh-HK'] = m.zhHK;
        }
      } catch (e) {
        console.error('Failed to load i18n dict for', lang, e);
      }
    })();
    
    this.loadPromises.set(lang, promise);
    await promise;
  }

  async setLang(lang: Lang) {
    await this.loadLang(lang);
    this.lang.set(lang);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, lang);
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    const table = TRANSLATIONS[this.lang()] ?? TRANSLATIONS['en'];
    let text = table[key] ?? TRANSLATIONS['en'][key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  }

  /**
   * `t()`, but null instead of the key when there is no translation.
   *
   * Use this for anything whose key comes from outside the app — chiefly the
   * `error.code` the backend returns. `t()` echoes an unknown key back, which
   * is a reasonable default while developing a template (you see immediately
   * what is missing) and a bad one for a value the frontend does not control:
   * the backend can emit a code no locale declares, and the user is then shown
   * `listing.errFileTooLarge` where a sentence should be.
   */
  tOrNull(key: unknown, params?: Record<string, string | number>): string | null {
    if (typeof key !== 'string' || !key) return null;
    const text = this.t(key, params);
    return text === key ? null : text;
  }
}

@Pipe({
  name: 't',
  standalone: true,
  pure: false
})
export class TPipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
