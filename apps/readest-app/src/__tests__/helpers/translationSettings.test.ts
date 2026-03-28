import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRANSLATOR_CONFIG } from '@/services/constants';
import {
  getTranslationPreferences,
  saveTranslationPreference,
} from '@/helpers/translationSettings';
import { saveViewSettings } from '@/helpers/settings';

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));

describe('translationSettings helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads translation preferences from view settings when present', () => {
    expect(
      getTranslationPreferences({
        translationProvider: 'azure',
        translateTargetLang: 'PT',
      }),
    ).toEqual({
      translationProvider: 'azure',
      translateTargetLang: 'PT',
    });
  });

  it('falls back to translator defaults when view settings are missing', () => {
    expect(getTranslationPreferences(undefined)).toEqual({
      translationProvider: DEFAULT_TRANSLATOR_CONFIG.translationProvider,
      translateTargetLang: DEFAULT_TRANSLATOR_CONFIG.translateTargetLang,
    });
  });

  it('persists translation preferences through saveViewSettings', async () => {
    const envConfig = {} as Parameters<typeof saveTranslationPreference>[0];

    await saveTranslationPreference(envConfig, 'book-1', 'translationProvider', 'azure');

    expect(saveViewSettings).toHaveBeenCalledWith(
      envConfig,
      'book-1',
      'translationProvider',
      'azure',
      false,
      false,
    );
  });
});
