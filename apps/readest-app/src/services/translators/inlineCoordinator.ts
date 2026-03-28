import { VisibleTranslationBlock, VisibleTranslationBlockResult } from './facade';

export const DEFAULT_INLINE_TRANSLATION_BATCH_SIZE = 3;
export const DEFAULT_INLINE_TRANSLATION_CONCURRENCY = 2;
export const DEFAULT_INLINE_TRANSLATION_IDLE_DEBOUNCE_MS = 500;

export interface InlineTranslationCoordinatorOptions {
  translateVisibleBlocks: (
    blocks: VisibleTranslationBlock[],
  ) => Promise<VisibleTranslationBlockResult[]>;
  onResults: (results: VisibleTranslationBlockResult[]) => void;
  onError?: (error: unknown, blocks: VisibleTranslationBlock[]) => void;
  onIdle?: () => void;
  batchSize?: number;
  maxConcurrentBatches?: number;
  idleDebounceMs?: number;
}

export interface InlineTranslationCoordinator {
  enqueue: (blocks: VisibleTranslationBlock[]) => void;
  cancel: () => void;
  dispose: () => void;
}

export const createInlineTranslationCoordinator = ({
  translateVisibleBlocks,
  onResults,
  onError,
  onIdle,
  batchSize = DEFAULT_INLINE_TRANSLATION_BATCH_SIZE,
  maxConcurrentBatches = DEFAULT_INLINE_TRANSLATION_CONCURRENCY,
  idleDebounceMs = DEFAULT_INLINE_TRANSLATION_IDLE_DEBOUNCE_MS,
}: InlineTranslationCoordinatorOptions): InlineTranslationCoordinator => {
  let generation = 0;
  let activeBatches = 0;
  let queue: VisibleTranslationBlock[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const queuedIds = new Map<string, number>();
  const inFlightIds = new Map<string, number>();

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const scheduleIdle = () => {
    if (!onIdle || queue.length > 0 || activeBatches > 0) return;

    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (queue.length === 0 && activeBatches === 0) {
        onIdle();
      }
    }, idleDebounceMs);
  };

  const drainQueue = () => {
    while (activeBatches < maxConcurrentBatches && queue.length > 0) {
      const batch = queue.splice(0, batchSize);
      const batchGeneration = generation;

      batch.forEach((block) => {
        if (queuedIds.get(block.id) === batchGeneration) {
          queuedIds.delete(block.id);
        }
        inFlightIds.set(block.id, batchGeneration);
      });

      activeBatches++;

      translateVisibleBlocks(batch)
        .then((results) => {
          if (batchGeneration !== generation) return;
          onResults(results);
        })
        .catch((error) => {
          if (batchGeneration !== generation) return;
          onError?.(error, batch);
        })
        .finally(() => {
          batch.forEach((block) => {
            if (inFlightIds.get(block.id) === batchGeneration) {
              inFlightIds.delete(block.id);
            }
          });

          if (batchGeneration !== generation) return;

          activeBatches--;
          drainQueue();
          scheduleIdle();
        });
    }

    scheduleIdle();
  };

  const enqueue = (blocks: VisibleTranslationBlock[]) => {
    clearIdleTimer();

    blocks.forEach((block) => {
      const text = block.text.trim();
      if (!text) return;
      if (queuedIds.get(block.id) === generation || inFlightIds.get(block.id) === generation) {
        return;
      }

      const normalizedBlock = text === block.text ? block : { ...block, text };
      queue.push(normalizedBlock);
      queuedIds.set(normalizedBlock.id, generation);
    });

    drainQueue();
  };

  const cancel = () => {
    generation++;
    activeBatches = 0;
    queue = [];
    queuedIds.clear();
    inFlightIds.clear();
    clearIdleTimer();
  };

  const dispose = () => {
    cancel();
  };

  return {
    enqueue,
    cancel,
    dispose,
  };
};
