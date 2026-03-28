import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInlineTranslationCoordinator,
  ErrorCodes,
  TranslationServiceError,
  type InlineTranslationCoordinatorEvent,
  type VisibleTranslationBlock,
  type VisibleTranslationBlockResult,
} from '@/services/translators';

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const getEventTypes = (onEvent: ReturnType<typeof vi.fn>) => {
  return onEvent.mock.calls.map(([event]) => (event as InlineTranslationCoordinatorEvent).type);
};

describe('createInlineTranslationCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches queued blocks and only starts new batches when concurrency allows it', async () => {
    const firstBatch = createDeferred<VisibleTranslationBlockResult[]>();
    const secondBatch = createDeferred<VisibleTranslationBlockResult[]>();
    const thirdBatch = createDeferred<VisibleTranslationBlockResult[]>();
    const translateVisibleBlocks = vi
      .fn()
      .mockReturnValueOnce(firstBatch.promise)
      .mockReturnValueOnce(secondBatch.promise)
      .mockReturnValueOnce(thirdBatch.promise);
    const onResults = vi.fn();

    const coordinator = createInlineTranslationCoordinator({
      translateVisibleBlocks,
      onResults,
      batchSize: 2,
      maxConcurrentBatches: 2,
      idleDebounceMs: 1,
    });

    coordinator.enqueue([
      { id: '1', text: 'one' },
      { id: '2', text: 'two' },
      { id: '3', text: 'three' },
      { id: '4', text: 'four' },
      { id: '5', text: 'five' },
    ]);

    expect(translateVisibleBlocks).toHaveBeenCalledTimes(2);
    expect(
      translateVisibleBlocks.mock.calls[0]?.[0].map((block: VisibleTranslationBlock) => block.id),
    ).toEqual(['1', '2']);
    expect(
      translateVisibleBlocks.mock.calls[1]?.[0].map((block: VisibleTranslationBlock) => block.id),
    ).toEqual(['3', '4']);

    firstBatch.resolve([
      { id: '1', originalText: 'one', translatedText: 'um' },
      { id: '2', originalText: 'two', translatedText: 'dois' },
    ]);
    await flushPromises();

    expect(onResults).toHaveBeenCalledWith([
      { id: '1', originalText: 'one', translatedText: 'um' },
      { id: '2', originalText: 'two', translatedText: 'dois' },
    ]);
    expect(translateVisibleBlocks).toHaveBeenCalledTimes(3);
    expect(
      translateVisibleBlocks.mock.calls[2]?.[0].map((block: VisibleTranslationBlock) => block.id),
    ).toEqual(['5']);

    secondBatch.resolve([
      { id: '3', originalText: 'three', translatedText: 'tres' },
      { id: '4', originalText: 'four', translatedText: 'quatro' },
    ]);
    thirdBatch.resolve([{ id: '5', originalText: 'five', translatedText: 'cinco' }]);
    await flushPromises();

    coordinator.dispose();
  });

  it('ignores obsolete results after cancellation and allows a new generation to proceed', async () => {
    const staleBatch = createDeferred<VisibleTranslationBlockResult[]>();
    const freshBatch = createDeferred<VisibleTranslationBlockResult[]>();
    let staleSignal: AbortSignal | undefined;
    const onEvent = vi.fn();
    const translateVisibleBlocks = vi
      .fn<
        (
          blocks: VisibleTranslationBlock[],
          options?: { signal?: AbortSignal },
        ) => Promise<VisibleTranslationBlockResult[]>
      >()
      .mockImplementationOnce((_blocks, options) => {
        staleSignal = options?.signal;
        return staleBatch.promise;
      })
      .mockImplementationOnce(() => freshBatch.promise);
    const onResults = vi.fn();

    const coordinator = createInlineTranslationCoordinator({
      translateVisibleBlocks,
      onResults,
      onEvent,
      batchSize: 1,
      maxConcurrentBatches: 1,
      idleDebounceMs: 1,
    });

    coordinator.enqueue([{ id: 'stale', text: 'old' }]);
    coordinator.cancel();
    coordinator.enqueue([{ id: 'fresh', text: 'new' }]);

    expect(staleSignal?.aborted).toBe(true);

    staleBatch.resolve([{ id: 'stale', originalText: 'old', translatedText: 'velho' }]);
    freshBatch.resolve([{ id: 'fresh', originalText: 'new', translatedText: 'novo' }]);
    await flushPromises();

    expect(onResults).toHaveBeenCalledTimes(1);
    expect(onResults).toHaveBeenCalledWith([
      { id: 'fresh', originalText: 'new', translatedText: 'novo' },
    ]);
    expect(getEventTypes(onEvent)).toContain('staleResultIgnored');

    coordinator.dispose();
  });

  it('deduplicates equivalent normalized texts while in flight and after completion', async () => {
    const batch = createDeferred<VisibleTranslationBlockResult[]>();
    const translateVisibleBlocks = vi.fn().mockReturnValue(batch.promise);
    const onResults = vi.fn();
    const onEvent = vi.fn();

    const coordinator = createInlineTranslationCoordinator({
      translateVisibleBlocks,
      onResults,
      onEvent,
      batchSize: 2,
      maxConcurrentBatches: 1,
      idleDebounceMs: 1,
    });

    coordinator.enqueue([{ id: 'first', text: 'Hello   world' }]);
    coordinator.enqueue([{ id: 'second', text: 'Hello world' }]);

    expect(translateVisibleBlocks).toHaveBeenCalledTimes(1);
    expect(translateVisibleBlocks).toHaveBeenCalledWith(
      [{ id: 'first', text: 'Hello   world' }],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    batch.resolve([{ id: 'first', originalText: 'Hello   world', translatedText: 'Ola mundo' }]);
    await flushPromises();

    expect(onResults).toHaveBeenCalledWith([
      { id: 'first', originalText: 'Hello   world', translatedText: 'Ola mundo' },
      { id: 'second', originalText: 'Hello world', translatedText: 'Ola mundo' },
    ]);

    coordinator.enqueue([{ id: 'third', text: ' Hello world ' }]);

    expect(translateVisibleBlocks).toHaveBeenCalledTimes(1);
    expect(onResults).toHaveBeenLastCalledWith([
      { id: 'third', originalText: 'Hello world', translatedText: 'Ola mundo' },
    ]);
    expect(getEventTypes(onEvent)).toEqual(
      expect.arrayContaining(['batchEnqueued', 'batchStarted', 'batchSucceeded', 'dedupeHit']),
    );

    coordinator.dispose();
  });

  it('retries transient failures once before succeeding', async () => {
    vi.useFakeTimers();

    const firstBatch = createDeferred<VisibleTranslationBlockResult[]>();
    const secondBatch = createDeferred<VisibleTranslationBlockResult[]>();
    const translateVisibleBlocks = vi
      .fn()
      .mockReturnValueOnce(firstBatch.promise)
      .mockReturnValueOnce(secondBatch.promise);
    const onResults = vi.fn();
    const onError = vi.fn();
    const onEvent = vi.fn();

    const coordinator = createInlineTranslationCoordinator({
      translateVisibleBlocks,
      onResults,
      onError,
      onEvent,
      batchSize: 1,
      maxConcurrentBatches: 1,
      idleDebounceMs: 1,
      retryLimit: 1,
      retryDelayMs: 10,
    });

    coordinator.enqueue([{ id: 'retry', text: 'text' }]);
    firstBatch.reject(new Error('Failed to fetch'));
    await flushPromises();

    expect(translateVisibleBlocks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);

    expect(translateVisibleBlocks).toHaveBeenCalledTimes(2);

    secondBatch.resolve([{ id: 'retry', originalText: 'text', translatedText: 'texto' }]);
    await flushPromises();

    expect(onResults).toHaveBeenCalledWith([
      { id: 'retry', originalText: 'text', translatedText: 'texto' },
    ]);
    expect(onError).not.toHaveBeenCalled();
    expect(getEventTypes(onEvent)).toEqual(
      expect.arrayContaining(['batchStarted', 'batchRetried', 'batchSucceeded']),
    );

    coordinator.dispose();
  });

  it('does not retry non-transient quota failures', async () => {
    const batch = createDeferred<VisibleTranslationBlockResult[]>();
    const translateVisibleBlocks = vi.fn().mockReturnValue(batch.promise);
    const onError = vi.fn();
    const onEvent = vi.fn();

    const coordinator = createInlineTranslationCoordinator({
      translateVisibleBlocks,
      onResults: vi.fn(),
      onError,
      onEvent,
      batchSize: 1,
      maxConcurrentBatches: 1,
      idleDebounceMs: 1,
      retryLimit: 1,
      retryDelayMs: 10,
    });

    coordinator.enqueue([{ id: 'quota', text: 'text' }]);
    batch.reject(
      new TranslationServiceError(ErrorCodes.DAILY_QUOTA_EXCEEDED, {
        code: ErrorCodes.DAILY_QUOTA_EXCEEDED,
      }),
    );
    await flushPromises();

    expect(translateVisibleBlocks).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(TranslationServiceError), [
      { id: 'quota', text: 'text' },
    ]);
    expect(getEventTypes(onEvent)).toContain('batchFailed');

    coordinator.dispose();
  });

  it('notifies idle only after the queue fully drains', async () => {
    vi.useFakeTimers();

    const batch = createDeferred<VisibleTranslationBlockResult[]>();
    const onIdle = vi.fn();
    const onEvent = vi.fn();

    const coordinator = createInlineTranslationCoordinator({
      translateVisibleBlocks: vi.fn().mockReturnValue(batch.promise),
      onResults: vi.fn(),
      onIdle,
      onEvent,
      batchSize: 1,
      maxConcurrentBatches: 1,
      idleDebounceMs: 20,
    });

    coordinator.enqueue([{ id: 'idle', text: 'text' }]);
    batch.resolve([{ id: 'idle', originalText: 'text', translatedText: 'texto' }]);
    await flushPromises();

    expect(onIdle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20);

    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(getEventTypes(onEvent)).toContain('idleReached');
    expect(coordinator.getSnapshot().metrics.idleReached).toBe(1);

    coordinator.dispose();
  });
});
