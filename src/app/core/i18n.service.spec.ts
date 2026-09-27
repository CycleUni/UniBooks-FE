import { langFromBrowserTag } from './i18n.service';

describe('langFromBrowserTag', () => {
  it('keeps English speakers in Hong Kong on English', () => {
    expect(langFromBrowserTag('en-HK')).toBe('en');
    expect(langFromBrowserTag('en_HK')).toBe('en');
  });

  it('picks Hong Kong Chinese for Hong Kong and Cantonese tags', () => {
    expect(langFromBrowserTag('zh-HK')).toBe('zh-HK');
    expect(langFromBrowserTag('zh-Hant-HK')).toBe('zh-HK');
    expect(langFromBrowserTag('yue')).toBe('zh-HK');
    expect(langFromBrowserTag('yue-Hant-HK')).toBe('zh-HK');
    expect(langFromBrowserTag('zh-yue')).toBe('zh-HK');
  });

  it('picks Taiwan Chinese for other Chinese tags', () => {
    expect(langFromBrowserTag('zh-TW')).toBe('zh-TW');
    expect(langFromBrowserTag('zh-Hant')).toBe('zh-TW');
    expect(langFromBrowserTag('zh')).toBe('zh-TW');
  });

  it('falls back to English for anything else', () => {
    expect(langFromBrowserTag('en-US')).toBe('en');
    expect(langFromBrowserTag('ja-JP')).toBe('en');
    expect(langFromBrowserTag('')).toBe('en');
    expect(langFromBrowserTag(undefined)).toBe('en');
  });
});
