import { aboutUrl } from './about-site';

describe('aboutUrl', () => {
  it('points at the CycleUni About site, not the renamed address that 404s', () => {
    expect(aboutUrl('zh-TW')).toBe('https://cycleuni.github.io/About/');
  });

  it('sends English readers to the English edition', () => {
    expect(aboutUrl('en')).toBe('https://cycleuni.github.io/About/en/');
    expect(aboutUrl('en', 'about/terms')).toBe('https://cycleuni.github.io/About/en/about/terms');
  });

  it('sends both Chinese languages to the Chinese pages, which have no zh-HK edition', () => {
    expect(aboutUrl('zh-TW', 'about/privacy')).toBe('https://cycleuni.github.io/About/about/privacy');
    expect(aboutUrl('zh-HK', 'about/privacy')).toBe('https://cycleuni.github.io/About/about/privacy');
  });
});
