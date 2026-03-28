import { getTranslator, getTranslators, TranslatorName } from './providers';
import {
  resolveTranslatorSelection,
  translateTexts,
  TranslationServiceError,
  type TranslatorSelection,
} from './service';
import { TranslationProvider, TranslationRequestOptions, UseTranslatorOptions } from './types';

export interface TranslationBatchCommand extends UseTranslatorOptions, TranslationRequestOptions {
  texts: string[];
  provider?: TranslatorName;
  token?: string | null;
  useCache?: boolean;
}

export interface TranslateSelectionCommand extends UseTranslatorOptions, TranslationRequestOptions {
  text: string;
  provider?: TranslatorName;
  token?: string | null;
  useCache?: boolean;
}

export interface VisibleTranslationBlock {
  id: string;
  text: string;
}

export interface VisibleTranslationBlockResult {
  id: string;
  originalText: string;
  translatedText: string;
}

export interface TranslateVisibleBlocksCommand
  extends UseTranslatorOptions, TranslationRequestOptions {
  blocks: VisibleTranslationBlock[];
  provider?: TranslatorName;
  token?: string | null;
  useCache?: boolean;
}

export interface TranslateChapterCommand extends UseTranslatorOptions, TranslationRequestOptions {
  paragraphs: string[];
  provider?: TranslatorName;
  token?: string | null;
  useCache?: boolean;
}

export interface TranslationFacadeDependencies {
  getTranslator: typeof getTranslator;
  getTranslators: typeof getTranslators;
  resolveTranslatorSelection: typeof resolveTranslatorSelection;
  translateTexts: typeof translateTexts;
}

const defaultDependencies: TranslationFacadeDependencies = {
  getTranslator,
  getTranslators,
  resolveTranslatorSelection,
  translateTexts,
};

const DEFAULT_PROVIDER: TranslatorName = 'deepl';

export interface TranslationFacade {
  listProviders: () => TranslationProvider[];
  listSelectableProviders: (token?: string | null) => TranslationProvider[];
  getProvider: (name: TranslatorName) => TranslationProvider | undefined;
  resolveProviderSelection: (params: {
    provider: TranslatorName;
    token?: string | null;
  }) => TranslatorSelection;
  translateBatch: (command: TranslationBatchCommand) => Promise<string[]>;
  translateSelection: (command: TranslateSelectionCommand) => Promise<string>;
  translateVisibleBlocks: (
    command: TranslateVisibleBlocksCommand,
  ) => Promise<VisibleTranslationBlockResult[]>;
  translateChapter: (command: TranslateChapterCommand) => Promise<string[]>;
}

export const createTranslationFacade = (
  dependencies: TranslationFacadeDependencies = defaultDependencies,
): TranslationFacade => {
  const listProviders = () => dependencies.getTranslators();

  const listSelectableProviders = (token?: string | null) =>
    listProviders().filter((translator) => {
      const authSatisfied = translator.authRequired ? !!token : true;
      return authSatisfied && !translator.quotaExceeded;
    });

  const getProvider = (name: TranslatorName) => dependencies.getTranslator(name);

  const resolveProviderSelection = ({
    provider,
    token,
  }: {
    provider: TranslatorName;
    token?: string | null;
  }) =>
    dependencies.resolveTranslatorSelection({
      provider,
      token,
      translators: listProviders(),
    });

  const translateBatch = async ({
    texts,
    provider = DEFAULT_PROVIDER,
    sourceLang = 'AUTO',
    targetLang = 'EN',
    enablePolishing = true,
    enablePreprocessing = true,
    token,
    useCache = false,
    signal,
  }: TranslationBatchCommand) => {
    return await dependencies.translateTexts({
      input: texts,
      provider,
      sourceLang,
      targetLang,
      enablePolishing,
      enablePreprocessing,
      token,
      useCache,
      signal,
      translators: listProviders(),
    });
  };

  const translateSelection = async ({
    text,
    ...command
  }: TranslateSelectionCommand): Promise<string> => {
    const results = await translateBatch({
      ...command,
      texts: [text],
    });
    return results[0] || '';
  };

  const translateVisibleBlocks = async ({
    blocks,
    ...command
  }: TranslateVisibleBlocksCommand): Promise<VisibleTranslationBlockResult[]> => {
    if (blocks.length === 0) return [];

    const translatedTexts = await translateBatch({
      ...command,
      texts: blocks.map((block) => block.text),
    });

    return blocks.map((block, index) => ({
      id: block.id,
      originalText: block.text,
      translatedText: translatedTexts[index] || '',
    }));
  };

  const translateChapter = async ({
    paragraphs,
    ...command
  }: TranslateChapterCommand): Promise<string[]> => {
    return await translateBatch({
      ...command,
      texts: paragraphs,
    });
  };

  return {
    listProviders,
    listSelectableProviders,
    getProvider,
    resolveProviderSelection,
    translateBatch,
    translateSelection,
    translateVisibleBlocks,
    translateChapter,
  };
};

export const translationFacade = createTranslationFacade();

export { TranslationServiceError };
