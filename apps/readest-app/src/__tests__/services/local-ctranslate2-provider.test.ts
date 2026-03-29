import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/environment', () => ({
  getLocalCTranslate2BaseUrl: () => 'http://127.0.0.1:8765',
  isTauriAppPlatform: () => false,
}));

describe('localCTranslate2Provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts batched texts to the local HTTP service', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        translations: [{ text: 'ola mundo' }, { text: 'bom dia' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    const result = await localCTranslate2Provider.translate(
      ['hello world', 'good morning'],
      'EN',
      'PT',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/translate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: ['hello world', 'good morning'],
          source_lang: 'EN',
          target_lang: 'PT',
        }),
      }),
    );
    expect(result).toEqual(['ola mundo', 'bom dia']);
  });

  it('forwards AbortSignal to the local HTTP service request', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ translations: ['ola'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    await localCTranslate2Provider.translate(
      ['hello'],
      'AUTO',
      'PT-BR',
      undefined,
      undefined,
      signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/translate',
      expect.objectContaining({ signal }),
    );
  });

  it('surfaces a backend error message when the local service rejects the language pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Unsupported language pair. Local CTranslate2 currently supports EN -> PT only.',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { localCTranslate2Provider } =
      await import('@/services/translators/providers/local-ctranslate2');

    await expect(localCTranslate2Provider.translate(['hola'], 'ES', 'PT')).rejects.toThrow(
      'Unsupported language pair. Local CTranslate2 currently supports EN -> PT only.',
    );
  });
});
