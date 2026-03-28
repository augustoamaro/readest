import { DEFAULT_TRANSLATOR_CONFIG } from '@/services/constants';
import { EnvConfigType } from '@/services/environment';
import { ViewSettings } from '@/types/book';
import { saveViewSettings } from './settings';

export type TranslationPreferenceKey = 'translationProvider' | 'translateTargetLang';

export type TranslationPreferences = Pick<ViewSettings, TranslationPreferenceKey>;

export const getTranslationPreferences = (
  viewSettings?: Partial<TranslationPreferences> | null,
): TranslationPreferences => ({
  translationProvider:
    viewSettings?.translationProvider ?? DEFAULT_TRANSLATOR_CONFIG.translationProvider,
  translateTargetLang:
    viewSettings?.translateTargetLang ?? DEFAULT_TRANSLATOR_CONFIG.translateTargetLang,
});

export const saveTranslationPreference = async <K extends TranslationPreferenceKey>(
  envConfig: EnvConfigType,
  bookKey: string,
  key: K,
  value: TranslationPreferences[K],
) => {
  await saveViewSettings(envConfig, bookKey, key, value, false, false);
};
