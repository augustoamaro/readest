import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  ErrorCodes,
  TranslationServiceError,
  UseTranslatorOptions,
  translationFacade,
} from '@/services/translators';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';
import { useTranslation } from './useTranslation';

export function useTranslator({
  provider = 'deepl',
  sourceLang = 'AUTO',
  targetLang = 'EN',
  enablePolishing = true,
  enablePreprocessing = true,
}: UseTranslatorOptions = {}) {
  const _ = useTranslation();
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(provider);
  const [translator, setTransltor] = useState(() => translationFacade.getProvider(provider));
  const [translators] = useState(() => translationFacade.listProviders());

  useEffect(() => {
    setLoading(false);
  }, [provider, sourceLang, targetLang]);

  useEffect(() => {
    const selection = translationFacade.resolveProviderSelection({
      provider,
      token,
    });
    setTransltor(selection.translator);
    setSelectedProvider(selection.selectedProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const translate = useCallback(
    async (
      input: string[],
      options?: { source?: string; target?: string; useCache?: boolean },
    ): Promise<string[]> => {
      if (input.length === 0 || input.every((text) => !text?.trim())) {
        return input;
      }

      setLoading(true);

      try {
        return await translationFacade.translateBatch({
          texts: input,
          provider: selectedProvider,
          sourceLang: options?.source || sourceLang,
          targetLang: options?.target || targetLang || getLocale(),
          enablePolishing,
          enablePreprocessing,
          token,
          useCache: options?.useCache ?? false,
        });
      } catch (err) {
        if (
          err instanceof TranslationServiceError &&
          err.code === ErrorCodes.DAILY_QUOTA_EXCEEDED
        ) {
          eventDispatcher.dispatch('toast', {
            timeout: 5000,
            message: _(
              'Daily translation quota reached. Upgrade your plan to continue using AI translations.',
            ),
            type: 'error',
          });
          if (err.fallbackProvider) {
            setSelectedProvider(err.fallbackProvider);
            setTransltor(translationFacade.getProvider(err.fallbackProvider));
          }
        }
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedProvider, sourceLang, targetLang, translator, token],
  );

  return {
    translate,
    translator,
    translators,
    loading,
  };
}
