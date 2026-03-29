import { describe, expect, it, vi } from 'vitest';
import {
  createTranslationFacade,
  type TranslationFacadeDependencies,
  type TranslationBatchCommand,
  type TranslationProvider,
} from '@/services/translators';

const createTranslator = (
  name: string,
  overrides: Partial<TranslationProvider> = {},
): TranslationProvider => ({
  name,
  label: name,
  translate: vi.fn(async (texts: string[]) => texts),
  ...overrides,
});

const createDependencies = (
  translators: TranslationProvider[] = [createTranslator('deepl'), createTranslator('azure')],
): TranslationFacadeDependencies => ({
  getTranslator: vi.fn((name: string) =>
    translators.find((translator) => translator.name === name),
  ),
  getTranslators: vi.fn(() => translators),
  resolveTranslatorSelection: vi.fn(({ provider }) => ({
    selectedProvider: provider,
    translator: translators.find((translator) => translator.name === provider) || translators[0]!,
  })),
  translateTexts: vi.fn(async ({ input }: { input: string[] }) =>
    input.map((text) => `tx:${text}`),
  ),
});

describe('translationFacade', () => {
  it('lists only selectable providers for the current token and quota state', () => {
    const dependencies = createDependencies([
      createTranslator('deepl', { authRequired: true }),
      createTranslator('azure'),
      createTranslator('google', { quotaExceeded: true }),
    ]);
    const facade = createTranslationFacade(dependencies);

    expect(facade.listSelectableProviders(null).map((translator) => translator.name)).toEqual([
      'azure',
    ]);
    expect(facade.listSelectableProviders('token').map((translator) => translator.name)).toEqual([
      'deepl',
      'azure',
    ]);
  });

  it('delegates provider resolution through the underlying service selection', () => {
    const dependencies = createDependencies();
    const facade = createTranslationFacade(dependencies);

    const selection = facade.resolveProviderSelection({
      provider: 'azure',
      token: 'token',
    });

    expect(dependencies.resolveTranslatorSelection).toHaveBeenCalledWith({
      provider: 'azure',
      token: 'token',
      translators: dependencies.getTranslators(),
    });
    expect(selection.selectedProvider).toBe('azure');
  });

  it('sends translateBatch commands to the service with the expected normalized shape', async () => {
    const dependencies = createDependencies();
    const facade = createTranslationFacade(dependencies);
    const signal = new AbortController().signal;

    const command: TranslationBatchCommand = {
      texts: ['one', 'two'],
      provider: 'azure',
      sourceLang: 'AUTO',
      targetLang: 'PT',
      token: 'token',
      useCache: true,
      signal,
    };

    const result = await facade.translateBatch(command);

    expect(dependencies.translateTexts).toHaveBeenCalledWith({
      input: ['one', 'two'],
      provider: 'azure',
      sourceLang: 'AUTO',
      targetLang: 'PT',
      enablePolishing: true,
      enablePreprocessing: true,
      token: 'token',
      useCache: true,
      signal,
      translators: dependencies.getTranslators(),
    });
    expect(result).toEqual(['tx:one', 'tx:two']);
  });

  it('provides a selection-oriented command without exposing batch details to callers', async () => {
    const dependencies = createDependencies();
    const facade = createTranslationFacade(dependencies);

    const result = await facade.translateSelection({
      text: 'selected text',
      provider: 'azure',
    });

    expect(dependencies.translateTexts).toHaveBeenCalledWith(
      expect.objectContaining({
        input: ['selected text'],
      }),
    );
    expect(result).toBe('tx:selected text');
  });

  it('prepares visible-block and chapter commands as stable aliases over batch translation', async () => {
    const dependencies = createDependencies();
    const facade = createTranslationFacade(dependencies);

    const blocks = await facade.translateVisibleBlocks({
      blocks: [
        { id: 'a', text: 'first block' },
        { id: 'b', text: 'second block' },
      ],
      provider: 'deepl',
    });
    const chapter = await facade.translateChapter({
      paragraphs: ['p1', 'p2'],
      provider: 'deepl',
    });

    expect(blocks).toEqual([
      { id: 'a', originalText: 'first block', translatedText: 'tx:first block' },
      { id: 'b', originalText: 'second block', translatedText: 'tx:second block' },
    ]);
    expect(chapter).toEqual(['tx:p1', 'tx:p2']);
    expect(dependencies.translateTexts).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ input: ['first block', 'second block'] }),
    );
    expect(dependencies.translateTexts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ input: ['p1', 'p2'] }),
    );
  });

  it('caches provider availability when a provider exposes an explicit healthcheck', async () => {
    const checkAvailability = vi.fn(async () => ({
      status: 'available' as const,
      checkedAt: Date.now(),
      details: { device: 'cuda' },
    }));
    const dependencies = createDependencies([
      createTranslator('local-ctranslate2', { checkAvailability }),
    ]);
    const facade = createTranslationFacade(dependencies);

    expect(facade.getProviderAvailability('local-ctranslate2').status).toBe('unknown');

    const first = await facade.refreshProviderAvailability('local-ctranslate2');
    const second = await facade.refreshProviderAvailability('local-ctranslate2');

    expect(checkAvailability).toHaveBeenCalledTimes(1);
    expect(first.status).toBe('available');
    expect(second.details?.device).toBe('cuda');
    expect(facade.getProviderAvailability('local-ctranslate2').status).toBe('available');
  });
});
