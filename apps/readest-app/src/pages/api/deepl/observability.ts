const MAX_RECENT_EVENTS = 50;

export interface DeepLProxyObservabilityMetrics {
  requestsStarted: number;
  requestsSucceeded: number;
  requestsFailed: number;
  requestsAborted: number;
  downstreamFetchesStarted: number;
  downstreamFetchesSucceeded: number;
  downstreamFetchesFailed: number;
  downstreamFetchesAborted: number;
  postAbortUsageUpdates: number;
  postAbortCacheWrites: number;
  totalRequestDurationMs: number;
  totalAbortDurationMs: number;
  totalDownstreamDurationMs: number;
}

export interface DeepLProxyObservabilityDerivedMetrics {
  abortRate: number;
  averageAbortDurationMs: number;
  averageRequestDurationMs: number;
  averageDownstreamDurationMs: number;
}

export type DeepLProxyObservabilityEvent =
  | {
      type: 'requestStarted';
      timestamp: number;
      requestId?: string;
      charCount: number;
      textCount: number;
    }
  | {
      type: 'requestSucceeded';
      timestamp: number;
      requestId?: string;
      durationMs: number;
      translationCount: number;
    }
  | {
      type: 'requestFailed';
      timestamp: number;
      requestId?: string;
      durationMs: number;
      reason: string;
    }
  | {
      type: 'requestAborted';
      timestamp: number;
      requestId?: string;
      durationMs: number;
    }
  | {
      type: 'downstreamFetchStarted';
      timestamp: number;
      requestId?: string;
      textLength: number;
    }
  | {
      type: 'downstreamFetchSucceeded';
      timestamp: number;
      requestId?: string;
      durationMs: number;
      textLength: number;
    }
  | {
      type: 'downstreamFetchFailed';
      timestamp: number;
      requestId?: string;
      durationMs: number;
      textLength: number;
      reason: string;
    }
  | {
      type: 'downstreamFetchAborted';
      timestamp: number;
      requestId?: string;
      durationMs: number;
      textLength: number;
    }
  | {
      type: 'postAbortUsageUpdate';
      timestamp: number;
      requestId?: string;
    }
  | {
      type: 'postAbortCacheWrite';
      timestamp: number;
      requestId?: string;
    };

export interface DeepLProxyObservabilitySnapshot {
  metrics: DeepLProxyObservabilityMetrics;
  derived: DeepLProxyObservabilityDerivedMetrics;
  recentEvents: DeepLProxyObservabilityEvent[];
}

const createEmptyMetrics = (): DeepLProxyObservabilityMetrics => ({
  requestsStarted: 0,
  requestsSucceeded: 0,
  requestsFailed: 0,
  requestsAborted: 0,
  downstreamFetchesStarted: 0,
  downstreamFetchesSucceeded: 0,
  downstreamFetchesFailed: 0,
  downstreamFetchesAborted: 0,
  postAbortUsageUpdates: 0,
  postAbortCacheWrites: 0,
  totalRequestDurationMs: 0,
  totalAbortDurationMs: 0,
  totalDownstreamDurationMs: 0,
});

const metrics = createEmptyMetrics();
let recentEvents: DeepLProxyObservabilityEvent[] = [];

const safeAverage = (total: number, count: number) => {
  return count > 0 ? total / count : 0;
};

const pushRecentEvent = (event: DeepLProxyObservabilityEvent) => {
  recentEvents = [...recentEvents, event].slice(-MAX_RECENT_EVENTS);
};

export const recordDeepLProxyObservabilityEvent = (event: DeepLProxyObservabilityEvent) => {
  switch (event.type) {
    case 'requestStarted':
      metrics.requestsStarted++;
      break;
    case 'requestSucceeded':
      metrics.requestsSucceeded++;
      metrics.totalRequestDurationMs += event.durationMs;
      break;
    case 'requestFailed':
      metrics.requestsFailed++;
      metrics.totalRequestDurationMs += event.durationMs;
      break;
    case 'requestAborted':
      metrics.requestsAborted++;
      metrics.totalRequestDurationMs += event.durationMs;
      metrics.totalAbortDurationMs += event.durationMs;
      break;
    case 'downstreamFetchStarted':
      metrics.downstreamFetchesStarted++;
      break;
    case 'downstreamFetchSucceeded':
      metrics.downstreamFetchesSucceeded++;
      metrics.totalDownstreamDurationMs += event.durationMs;
      break;
    case 'downstreamFetchFailed':
      metrics.downstreamFetchesFailed++;
      metrics.totalDownstreamDurationMs += event.durationMs;
      break;
    case 'downstreamFetchAborted':
      metrics.downstreamFetchesAborted++;
      metrics.totalDownstreamDurationMs += event.durationMs;
      break;
    case 'postAbortUsageUpdate':
      metrics.postAbortUsageUpdates++;
      break;
    case 'postAbortCacheWrite':
      metrics.postAbortCacheWrites++;
      break;
  }

  pushRecentEvent(event);
};

export const getDeepLProxyObservabilitySnapshot = (): DeepLProxyObservabilitySnapshot => {
  const completedRequests =
    metrics.requestsSucceeded + metrics.requestsFailed + metrics.requestsAborted;
  const completedDownstreamFetches =
    metrics.downstreamFetchesSucceeded +
    metrics.downstreamFetchesFailed +
    metrics.downstreamFetchesAborted;

  return {
    metrics: { ...metrics },
    derived: {
      abortRate:
        metrics.requestsStarted > 0 ? metrics.requestsAborted / metrics.requestsStarted : 0,
      averageAbortDurationMs: safeAverage(metrics.totalAbortDurationMs, metrics.requestsAborted),
      averageRequestDurationMs: safeAverage(metrics.totalRequestDurationMs, completedRequests),
      averageDownstreamDurationMs: safeAverage(
        metrics.totalDownstreamDurationMs,
        completedDownstreamFetches,
      ),
    },
    recentEvents: [...recentEvents],
  };
};

export const resetDeepLProxyObservability = () => {
  const emptyMetrics = createEmptyMetrics();
  Object.keys(emptyMetrics).forEach((key) => {
    const metricKey = key as keyof DeepLProxyObservabilityMetrics;
    metrics[metricKey] = emptyMetrics[metricKey];
  });
  recentEvents = [];
};
