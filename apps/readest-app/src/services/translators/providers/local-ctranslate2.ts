import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getLocalCTranslate2BaseUrl, isTauriAppPlatform } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { normalizeToShortLang } from '@/utils/lang';
import { TranslationProvider } from '../types';

const LOCAL_CTRANSLATE2_TRANSLATE_PATH = '/translate';

const buildLocalCTranslate2Endpoint = () => {
  return new URL(LOCAL_CTRANSLATE2_TRANSLATE_PATH, getLocalCTranslate2BaseUrl()).toString();
};

const getLocalServiceError = (message?: string) => {
  return new Error(message || 'Local CTranslate2 service is unavailable.');
};

export const localCTranslate2Provider: TranslationProvider = {
  name: 'local-ctranslate2',
  label: _('Local CTranslate2 (en->pt)'),
  translate: async (
    texts: string[],
    sourceLang: string,
    targetLang: string,
    _token?: string | null,
    _useCache?: boolean,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    if (!texts.length) return [];

    const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
    const response = await fetch(buildLocalCTranslate2Endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts,
        source_lang: normalizeToShortLang(sourceLang).toUpperCase() || 'AUTO',
        target_lang: normalizeToShortLang(targetLang).toUpperCase(),
      }),
      signal,
    });

    if (!response.ok) {
      let errorMessage = `Local CTranslate2 request failed with status ${response.status}`;
      try {
        const data = await response.json();
        if (data && typeof data.error === 'string') {
          errorMessage = data.error;
        }
      } catch {
        // Best effort only; keep the status-based message when body parsing fails.
      }

      throw getLocalServiceError(errorMessage);
    }

    const data = (await response.json()) as {
      translations?: Array<{ text?: string } | string>;
      error?: string;
    };

    if (!data?.translations || !Array.isArray(data.translations)) {
      throw getLocalServiceError(data?.error || 'Invalid response from local CTranslate2 service.');
    }

    return texts.map((line, index) => {
      if (!line?.trim().length) {
        return line;
      }

      const translation = data.translations?.[index];
      if (typeof translation === 'string') {
        return translation || line;
      }

      return translation?.text || line;
    });
  },
};
