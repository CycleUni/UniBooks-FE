export type Lang = 'en' | 'zh-TW' | 'zh-HK';

/** Each language named in itself, the same in every locale. */
export const LANG_LABELS: Record<Lang, string> = {
  'zh-TW': '中文 (繁體)',
  'zh-HK': '中文 (香港)',
  'en': 'English',
};

import { en } from './en';

export const TRANSLATIONS: Partial<Record<Lang, Record<string, string>>> & { en: Record<string, string> } = {
  en,
};
