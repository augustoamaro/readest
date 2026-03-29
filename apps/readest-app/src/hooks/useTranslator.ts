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

  const handleTranslationError = useCallback(
    (err: unknown) => {
      if (err instanceof Error && err.message === ErrorCodes.LOCAL_SERVICE_UNAVAILABLE) {
        eventDispatcher.dispatch('toast', {
          timeout: 5000,
          message: _(
            'Local CTranslate2 service is offline. Start the local translation server and try again.',
          ),
          type: 'error',
        });
        void translationFacade.refreshProviderAvailability('local-ctranslate2', { force: true });
        return;
      }

      if (err instanceof TranslationServiceError && err.code === ErrorCodes.DAILY_QUOTA_EXCEEDED) {
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
    },
    [_, setSelectedProvider, setTransltor],
  );

  const translate = useCallback(
    async (
      input: string[],
      options?: { source?: string; target?: string; useCache?: boolean; signal?: AbortSignal },
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
          signal: options?.signal,
        });
      } catch (err) {
        handleTranslationError(err);
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedProvider, sourceLang, targetLang, translator, token, handleTranslationError],
  );

  const translateVisibleBlocks = useCallback(
    async (
      blocks: Array<{ id: string; text: string }>,
      options?: { source?: string; target?: string; useCache?: boolean; signal?: AbortSignal },
    ) => {
      if (blocks.length === 0) return [];

      setLoading(true);

      try {
        return await translationFacade.translateVisibleBlocks({
          blocks,
          provider: selectedProvider,
          sourceLang: options?.source || sourceLang,
          targetLang: options?.target || targetLang || getLocale(),
          enablePolishing,
          enablePreprocessing,
          token,
          useCache: options?.useCache ?? false,
          signal: options?.signal,
        });
      } catch (err) {
        handleTranslationError(err);
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        setLoading(false);
      }
    },
    [
      selectedProvider,
      sourceLang,
      targetLang,
      enablePolishing,
      enablePreprocessing,
      token,
      handleTranslationError,
    ],
  );

  return {
    translate,
    translateVisibleBlocks,
    translator,
    translators,
    loading,
  };
}
