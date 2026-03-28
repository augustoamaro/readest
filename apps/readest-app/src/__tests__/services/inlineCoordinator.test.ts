import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInlineTranslationCoordinator,
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
    const translateVisibleBlocks = vi
      .fn()
      .mockReturnValueOnce(staleBatch.promise)
      .mockReturnValueOnce(freshBatch.promise);
    const onResults = vi.fn();

    const coordinator = createInlineTranslationCoordinator({
      translateVisibleBlocks,
      onResults,
      batchSize: 1,
      maxConcurrentBatches: 1,
      idleDebounceMs: 1,
    });

    coordinator.enqueue([{ id: 'stale', text: 'old' }]);
    coordinator.cancel();
    coordinator.enqueue([{ id: 'fresh', text: 'new' }]);

    staleBatch.resolve([{ id: 'stale', originalText: 'old', translatedText: 'velho' }]);
    freshBatch.resolve([{ id: 'fresh', originalText: 'new', translatedText: 'novo' }]);
    await flushPromises();

    expect(onResults).toHaveBeenCalledTimes(1);
    expect(onResults).toHaveBeenCalledWith([
      { id: 'fresh', originalText: 'new', translatedText: 'novo' },
    ]);

    coordinator.dispose();
  });

  it('deduplicates queued and in-flight blocks for the same generation', async () => {
    const firstBatch = createDeferred<VisibleTranslationBlockResult[]>();
    const secondBatch = createDeferred<VisibleTranslationBlockResult[]>();
    const translateVisibleBlocks = vi
      .fn()
      .mockReturnValueOnce(firstBatch.promise)
      .mockReturnValueOnce(secondBatch.promise);

    const coordinator = createInlineTranslationCoordinator({
      translateVisibleBlocks,
      onResults: vi.fn(),
      batchSize: 1,
      maxConcurrentBatches: 1,
      idleDebounceMs: 1,
    });

    coordinator.enqueue([{ id: 'same', text: 'text' }]);
    coordinator.enqueue([{ id: 'same', text: 'text' }]);

    expect(translateVisibleBlocks).toHaveBeenCalledTimes(1);

    firstBatch.resolve([{ id: 'same', originalText: 'text', translatedText: 'texto' }]);
    await flushPromises();

    coordinator.enqueue([{ id: 'same', text: 'text' }]);

    expect(translateVisibleBlocks).toHaveBeenCalledTimes(2);

    secondBatch.resolve([{ id: 'same', originalText: 'text', translatedText: 'texto' }]);
    await flushPromises();

    coordinator.dispose();
  });

  it('notifies idle only after the queue fully drains', async () => {
    vi.useFakeTimers();

    const batch = createDeferred<VisibleTranslationBlockResult[]>();
    const onIdle = vi.fn();

    const coordinator = createInlineTranslationCoordinator({
      translateVisibleBlocks: vi.fn().mockReturnValue(batch.promise),
      onResults: vi.fn(),
      onIdle,
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

    coordinator.dispose();
  });
});
