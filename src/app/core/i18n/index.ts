import { en } from './en';

export type Lang = 'en' | 'zh-TW' | 'zh-HK';

export const SUPPORTED_LANGS: readonly Lang[] = ['en', 'zh-TW', 'zh-HK'];

/** Maps URL region prefixes to their corresponding language. */
export const REGION_TO_LANG: Record<string, Lang> = {
 tw: 'zh-TW',
 hk: 'zh-HK',
};

/** Each language named in itself, the same in every locale. */
export const LANG_LABELS: Record<Lang, string> = {
  'zh-TW': '中文 (繁體)',
  'zh-HK': '中文 (香港)',
  'en': 'English',
};

export const TRANSLATIONS: Partial<Record<Lang, Record<string, string>>> & { en: Record<string, string> } = {
  en,
};
