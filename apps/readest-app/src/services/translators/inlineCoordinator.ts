import { TranslationServiceError } from './service';
import { ErrorCodes } from './types';
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
  'abort',
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
  retryLimit?: number;
  retryDelayMs?: number;
}

export interface InlineTranslationCoordinator {
  enqueue: (blocks: VisibleTranslationBlock[]) => void;
  cancel: () => void;
  dispose: () => void;
}

export const normalizeInlineTranslationText = (text: string) => {
  return text.replace(/\s+/g, ' ').trim();
};

export const isRetryableInlineTranslationError = (error: unknown) => {
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

  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  const scheduledIds = new Map<string, number>();
  const tasksByText = new Map<string, InlineTranslationTask>();
  const completedTranslations = new Map<string, string>();

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

  const scheduleIdle = () => {
    if (!onIdle || queue.length > 0 || activeBatches > 0 || retryTimers.size > 0) return;

    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (queue.length === 0 && activeBatches === 0 && retryTimers.size === 0) {
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

  const scheduleRetry = (tasks: InlineTranslationTask[], batchGeneration: number) => {
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

  const flattenTaskBlocks = (tasks: InlineTranslationTask[]) => {
    return tasks.flatMap((task) => Array.from(task.blocks.values()));
  };

  const handleBatchFailure = (
    error: unknown,
    tasks: InlineTranslationTask[],
    batchGeneration: number,
  ) => {
    const retryableError = isRetryableInlineTranslationError(error);
    const retryableTasks =
      retryableError && retryLimit > 0 ? tasks.filter((task) => task.attempt < retryLimit) : [];
    const failedTasks =
      retryableTasks.length === tasks.length
        ? []
        : tasks.filter((task) => !retryableTasks.includes(task));

    if (failedTasks.length > 0) {
      releaseFailedTasks(failedTasks);
      onError?.(error, flattenTaskBlocks(failedTasks));
    }

    if (retryableTasks.length > 0) {
      retryableTasks.forEach((task) => {
        task.attempt += 1;
      });
      scheduleRetry(retryableTasks, batchGeneration);
      return;
    }

    if (failedTasks.length === 0) {
      releaseFailedTasks(tasks);
      onError?.(error, flattenTaskBlocks(tasks));
    }
  };

  const drainQueue = () => {
    while (activeBatches < maxConcurrentBatches && queue.length > 0) {
      const tasks = queue.splice(0, batchSize);
      const batchGeneration = generation;
      const batch = tasks.map((task) => ({
        id: task.requestId,
        text: task.text,
      }));

      activeBatches++;

      translateVisibleBlocks(batch)
        .then((results) => {
          if (batchGeneration !== generation) return;

          const resultsByRequestId = new Map(results.map((result) => [result.id, result]));
          const expandedResults = expandTaskResults(tasks, resultsByRequestId);
          if (expandedResults.length > 0) {
            onResults(expandedResults);
          }
        })
        .catch((error) => {
          if (batchGeneration !== generation) return;
          handleBatchFailure(error, tasks, batchGeneration);
        })
        .finally(() => {
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

    blocks.forEach((block) => {
      const text = block.text.trim();
      if (!text) return;
      if (scheduledIds.get(block.id) === generation) return;

      const normalizedBlock = text === block.text ? block : { ...block, text };
      const normalizedText = normalizeInlineTranslationText(normalizedBlock.text);
      if (!normalizedText) return;

      scheduledIds.set(normalizedBlock.id, generation);

      if (completedTranslations.has(normalizedText)) {
        immediateResults.push({
          id: normalizedBlock.id,
          originalText: normalizedBlock.text,
          translatedText: completedTranslations.get(normalizedText) || '',
        });
        return;
      }

      const existingTask = tasksByText.get(normalizedText);
      if (existingTask) {
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
    });

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
