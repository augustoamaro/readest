import { describe, expect, it } from 'vitest';
import { applyTranslationStyle } from '@/utils/style';

describe('translation inline styles', () => {
  it('includes the dimmed source text rule and preserves target text color', () => {
    applyTranslationStyle({
      showTranslateSource: true,
    } as Parameters<typeof applyTranslationStyle>[0]);

    const styleElement = document.getElementById('translation-style');

    expect(styleElement?.textContent).toContain('.translation-source.translation-source-dimmed');
    expect(styleElement?.textContent).toContain(
      '.translation-source.translation-source-dimmed .translation-target *',
    );
    expect(styleElement?.textContent).toContain('color: var(--theme-fg-color) !important;');
  });
});
