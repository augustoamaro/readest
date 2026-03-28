import { TranslationServiceError, isTranslationAbortError } from './service';
import { ErrorCodes, type TranslationRequestOptions } from './types';
import { VisibleTranslationBlock, VisibleTranslationBlockResult } from './facade';

export const DEFAULT_INLINE_TRANSLATION_BATCH_SIZE = 3;
export const DEFAULT_INLINE_TRANSLATION_CONCURRENCY = 2;
export const DEFAULT_INLINE_TRANSLATION_IDLE_DEBOUNCE_MS = 500;
export const DEFAULT_INLINE_TRANSLATION_RETRY_LIMIT = 1;
export const DEFAULT_INLINE_TRANSLATION_RETRY_DELAY_MS = 250;

const TRANSIENT_ERROR_PATTERNS = [
  'network',
  'failed to fetch',
  'fetch failed',
  'timeout',
  'timed out',
  'temporary',
  'temporarily',
  'internal server error',
  '500',
  '502',
  '503',
  '504',
  'econnreset',
  'eai_again',
  'enetunreach',
  'enotfound',
  'etimedout',
];

const NON_RETRYABLE_ERROR_PATTERNS = [
  ErrorCodes.DAILY_QUOTA_EXCEEDED.toLowerCase(),
  ErrorCodes.UNAUTHORIZED.toLowerCase(),
  '401',
  '403',
];

interface InlineTranslationTask {
  normalizedText: string;
  requestId: string;
  text: string;
  blocks: Map<string, VisibleTranslationBlock>;
  attempt: number;
}

export interface InlineTranslationCoordinatorMetrics {
  batchesEnqueued: number;
  batchesStarted: number;
  batchesSucceeded: number;
  batchesRetried: number;
  batchesFailed: number;
  dedupeHits: number;
  staleResultsIgnored: number;
  idleReached: number;
}

export interface InlineTranslationCoordinatorSnapshot {
  generation: number;
  queueSize: number;
  activeBatches: number;
  retryTimerCount: number;
  inFlightBatchCount: number;
  metrics: InlineTranslationCoordinatorMetrics;
}

export type InlineTranslationCoordinatorEvent =
  | {
      type: 'batchEnqueued';
      generation: number;
      taskCount: number;
      blockCount: number;
      queueSize: number;
    }
  | {
      type: 'batchStarted';
      generation: number;
      batchId: number;
      attempt: number;
      taskCount: number;
      blockCount: number;
    }
  | {
      type: 'batchSucceeded';
      generation: number;
      batchId: number;
      attempt: number;
      taskCount: number;
      blockCount: number;
      resultCount: number;
    }
  | {
      type: 'batchRetried';
      generation: number;
      batchId: number;
      nextAttempt: number;
      taskCount: number;
      blockCount: number;
      reason: string;
    }
  | {
      type: 'batchFailed';
      generation: number;
      batchId: number;
      attempt: number;
      taskCount: number;
      blockCount: number;
      reason: string;
    }
  | {
      type: 'dedupeHit';
      generation: number;
      blockId: string;
      normalizedText: string;
      source: 'queued' | 'completed';
    }
  | {
      type: 'staleResultIgnored';
      generation: number;
      batchId: number;
      phase: 'success' | 'error';
    }
  | {
      type: 'idleReached';
      generation: number;
    };

export interface InlineTranslationCoordinatorOptions {
  translateVisibleBlocks: (
    blocks: VisibleTranslationBlock[],
    options?: TranslationRequestOptions,
  ) => Promise<VisibleTranslationBlockResult[]>;
  onResults: (results: VisibleTranslationBlockResult[]) => void;
  onError?: (error: unknown, blocks: VisibleTranslationBlock[]) => void;
  onIdle?: () => void;
  onEvent?: (
    event: InlineTranslationCoordinatorEvent,
    snapshot: InlineTranslationCoordinatorSnapshot,
  ) => void;
  batchSize?: number;
  maxConcurrentBatches?: number;
  idleDebounceMs?: number;
  retryLimit?: number;
  retryDelayMs?: number;
}

export interface InlineTranslationCoordinator {
  enqueue: (blocks: VisibleTranslationBlock[]) => void;
  cancel: () => void;
  dispose: () => void;
  getSnapshot: () => InlineTranslationCoordinatorSnapshot;
}

export const normalizeInlineTranslationText = (text: string) => {
  return text.replace(/\s+/g, ' ').trim();
};

const createEmptyMetrics = (): InlineTranslationCoordinatorMetrics => ({
  batchesEnqueued: 0,
  batchesStarted: 0,
  batchesSucceeded: 0,
  batchesRetried: 0,
  batchesFailed: 0,
  dedupeHits: 0,
  staleResultsIgnored: 0,
  idleReached: 0,
});

const getInlineTranslationErrorReason = (error: unknown) => {
  if (error instanceof Error) {
    return error.message || error.name;
  }

  return String(error);
};

export const isRetryableInlineTranslationError = (error: unknown) => {
  if (isTranslationAbortError(error)) {
    return false;
  }

  if (error instanceof TranslationServiceError) {
    if (error.code === ErrorCodes.DAILY_QUOTA_EXCEEDED || error.code === ErrorCodes.UNAUTHORIZED) {
      return false;
    }

    if (error.code === ErrorCodes.INTERNAL_SERVER_ERROR) {
      return true;
    }
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
    return false;
  }

  return TRANSIENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};

export const createInlineTranslationCoordinator = ({
  translateVisibleBlocks,
  onResults,
  onError,
  onIdle,
  onEvent,
  batchSize = DEFAULT_INLINE_TRANSLATION_BATCH_SIZE,
  maxConcurrentBatches = DEFAULT_INLINE_TRANSLATION_CONCURRENCY,
  idleDebounceMs = DEFAULT_INLINE_TRANSLATION_IDLE_DEBOUNCE_MS,
  retryLimit = DEFAULT_INLINE_TRANSLATION_RETRY_LIMIT,
  retryDelayMs = DEFAULT_INLINE_TRANSLATION_RETRY_DELAY_MS,
}: InlineTranslationCoordinatorOptions): InlineTranslationCoordinator => {
  let generation = 0;
  let activeBatches = 0;
  let queue: InlineTranslationTask[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let nextBatchId = 0;

  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  const inFlightControllers = new Map<number, AbortController>();
  const scheduledIds = new Map<string, number>();
  const tasksByText = new Map<string, InlineTranslationTask>();
  const completedTranslations = new Map<string, string>();
  const metrics = createEmptyMetrics();

  const getSnapshot = (): InlineTranslationCoordinatorSnapshot => ({
    generation,
    queueSize: queue.length,
    activeBatches,
    retryTimerCount: retryTimers.size,
    inFlightBatchCount: inFlightControllers.size,
    metrics: { ...metrics },
  });

  const emitEvent = (event: InlineTranslationCoordinatorEvent) => {
    onEvent?.(event, getSnapshot());
  };

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const clearRetryTimers = () => {
    retryTimers.forEach((timer) => clearTimeout(timer));
    retryTimers.clear();
  };

  const abortInFlightControllers = () => {
    inFlightControllers.forEach((controller) => controller.abort());
    inFlightControllers.clear();
  };

  const scheduleIdle = () => {
    if (!onIdle || queue.length > 0 || activeBatches > 0 || retryTimers.size > 0) return;

    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (queue.length === 0 && activeBatches === 0 && retryTimers.size === 0) {
        metrics.idleReached++;
        emitEvent({
          type: 'idleReached',
          generation,
        });
        onIdle();
      }
    }, idleDebounceMs);
  };

  const expandTaskResults = (
    tasks: InlineTranslationTask[],
    resultsByRequestId: Map<string, VisibleTranslationBlockResult>,
  ) => {
    return tasks.flatMap((task) => {
      const translatedText = resultsByRequestId.get(task.requestId)?.translatedText || '';
      completedTranslations.set(task.normalizedText, translatedText);
      tasksByText.delete(task.normalizedText);

      return Array.from(task.blocks.values()).map((block) => ({
        id: block.id,
        originalText: block.text,
        translatedText,
      }));
    });
  };

  const releaseFailedTasks = (tasks: InlineTranslationTask[]) => {
    tasks.forEach((task) => {
      tasksByText.delete(task.normalizedText);
      task.blocks.forEach((block) => {
        if (scheduledIds.get(block.id) === generation) {
          scheduledIds.delete(block.id);
        }
      });
    });
  };

  const flattenTaskBlocks = (tasks: InlineTranslationTask[]) => {
    return tasks.flatMap((task) => Array.from(task.blocks.values()));
  };

  const scheduleRetry = (
    tasks: InlineTranslationTask[],
    batchGeneration: number,
    batchId: number,
    reason: string,
  ) => {
    const nextAttempt = Math.max(...tasks.map((task) => task.attempt)) + 1;

    metrics.batchesRetried++;
    emitEvent({
      type: 'batchRetried',
      generation: batchGeneration,
      batchId,
      nextAttempt,
      taskCount: tasks.length,
      blockCount: flattenTaskBlocks(tasks).length,
      reason,
    });

    const timer = setTimeout(() => {
      retryTimers.delete(timer);

      if (batchGeneration !== generation || tasks.length === 0) {
        scheduleIdle();
        return;
      }

      queue = tasks.concat(queue);
      drainQueue();
    }, retryDelayMs);

    retryTimers.add(timer);
  };

  const handleBatchFailure = (
    error: unknown,
    tasks: InlineTranslationTask[],
    batchGeneration: number,
    batchId: number,
  ) => {
    const retryableError = isRetryableInlineTranslationError(error);
    const retryableTasks =
      retryableError && retryLimit > 0 ? tasks.filter((task) => task.attempt < retryLimit) : [];
    const failedTasks =
      retryableTasks.length === tasks.length
        ? []
        : tasks.filter((task) => !retryableTasks.includes(task));
    const reason = getInlineTranslationErrorReason(error);
    const currentAttempt = Math.max(...tasks.map((task) => task.attempt)) + 1;

    if (failedTasks.length > 0) {
      releaseFailedTasks(failedTasks);
      metrics.batchesFailed++;
      emitEvent({
        type: 'batchFailed',
        generation: batchGeneration,
        batchId,
        attempt: currentAttempt,
        taskCount: failedTasks.length,
        blockCount: flattenTaskBlocks(failedTasks).length,
        reason,
      });
      onError?.(error, flattenTaskBlocks(failedTasks));
    }

    if (retryableTasks.length > 0) {
      retryableTasks.forEach((task) => {
        task.attempt += 1;
      });
      scheduleRetry(retryableTasks, batchGeneration, batchId, reason);
      return;
    }

    if (failedTasks.length === 0) {
      releaseFailedTasks(tasks);
      metrics.batchesFailed++;
      emitEvent({
        type: 'batchFailed',
        generation: batchGeneration,
        batchId,
        attempt: currentAttempt,
        taskCount: tasks.length,
        blockCount: flattenTaskBlocks(tasks).length,
        reason,
      });
      onError?.(error, flattenTaskBlocks(tasks));
    }
  };

  const drainQueue = () => {
    while (activeBatches < maxConcurrentBatches && queue.length > 0) {
      const tasks = queue.splice(0, batchSize);
      const batchGeneration = generation;
      const batchId = nextBatchId++;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const batch = tasks.map((task) => ({
        id: task.requestId,
        text: task.text,
      }));
      const currentAttempt = Math.max(...tasks.map((task) => task.attempt)) + 1;

      activeBatches++;

      if (controller) {
        inFlightControllers.set(batchId, controller);
      }

      metrics.batchesStarted++;
      emitEvent({
        type: 'batchStarted',
        generation: batchGeneration,
        batchId,
        attempt: currentAttempt,
        taskCount: tasks.length,
        blockCount: batch.length,
      });

      translateVisibleBlocks(batch, {
        signal: controller?.signal,
      })
        .then((results) => {
          if (batchGeneration !== generation) {
            metrics.staleResultsIgnored++;
            emitEvent({
              type: 'staleResultIgnored',
              generation: batchGeneration,
              batchId,
              phase: 'success',
            });
            return;
          }

          const resultsByRequestId = new Map(results.map((result) => [result.id, result]));
          const expandedResults = expandTaskResults(tasks, resultsByRequestId);
          metrics.batchesSucceeded++;
          emitEvent({
            type: 'batchSucceeded',
            generation: batchGeneration,
            batchId,
            attempt: currentAttempt,
            taskCount: tasks.length,
            blockCount: batch.length,
            resultCount: expandedResults.length,
          });
          if (expandedResults.length > 0) {
            onResults(expandedResults);
          }
        })
        .catch((error) => {
          if (batchGeneration !== generation) {
            metrics.staleResultsIgnored++;
            emitEvent({
              type: 'staleResultIgnored',
              generation: batchGeneration,
              batchId,
              phase: 'error',
            });
            return;
          }
          handleBatchFailure(error, tasks, batchGeneration, batchId);
        })
        .finally(() => {
          inFlightControllers.delete(batchId);

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

    const immediateResults: VisibleTranslationBlockResult[] = [];
    let enqueuedTaskCount = 0;
    let enqueuedBlockCount = 0;

    blocks.forEach((block) => {
      const text = block.text.trim();
      if (!text) return;
      if (scheduledIds.get(block.id) === generation) return;

      const normalizedBlock = text === block.text ? block : { ...block, text };
      const normalizedText = normalizeInlineTranslationText(normalizedBlock.text);
      if (!normalizedText) return;

      scheduledIds.set(normalizedBlock.id, generation);

      if (completedTranslations.has(normalizedText)) {
        metrics.dedupeHits++;
        emitEvent({
          type: 'dedupeHit',
          generation,
          blockId: normalizedBlock.id,
          normalizedText,
          source: 'completed',
        });
        immediateResults.push({
          id: normalizedBlock.id,
          originalText: normalizedBlock.text,
          translatedText: completedTranslations.get(normalizedText) || '',
        });
        return;
      }

      const existingTask = tasksByText.get(normalizedText);
      if (existingTask) {
        metrics.dedupeHits++;
        emitEvent({
          type: 'dedupeHit',
          generation,
          blockId: normalizedBlock.id,
          normalizedText,
          source: 'queued',
        });
        existingTask.blocks.set(normalizedBlock.id, normalizedBlock);
        return;
      }

      const task: InlineTranslationTask = {
        normalizedText,
        requestId: normalizedBlock.id,
        text: normalizedBlock.text,
        blocks: new Map([[normalizedBlock.id, normalizedBlock]]),
        attempt: 0,
      };

      tasksByText.set(normalizedText, task);
      queue.push(task);
      enqueuedTaskCount++;
      enqueuedBlockCount += task.blocks.size;
    });

    if (enqueuedTaskCount > 0) {
      metrics.batchesEnqueued++;
      emitEvent({
        type: 'batchEnqueued',
        generation,
        taskCount: enqueuedTaskCount,
        blockCount: enqueuedBlockCount,
        queueSize: queue.length,
      });
    }

    if (immediateResults.length > 0) {
      onResults(immediateResults);
    }

    drainQueue();
  };

  const cancel = () => {
    generation++;
    activeBatches = 0;
    queue = [];
    scheduledIds.clear();
    tasksByText.clear();
    completedTranslations.clear();
    clearIdleTimer();
    clearRetryTimers();
    abortInFlightControllers();
  };

  const dispose = () => {
    cancel();
  };

  return {
    enqueue,
    cancel,
    dispose,
    getSnapshot,
  };
};
