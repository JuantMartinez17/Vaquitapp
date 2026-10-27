/** Waits before each retry of a failed run: 30 s, 2 min, 10 min. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 600_000];

export interface FailureInfo {
  /** 1-based number of the attempt that just failed. */
  attempt: number;
  /** Delay before the next attempt, or `undefined` when retries are exhausted. */
  retryInMs: number | undefined;
}

export interface SchedulerOptions {
  onError: (error: unknown, info: FailureInfo) => void;
  /** Called when a tick is skipped because the previous run is still going. */
  onSkipped?: () => void;
  retryDelaysMs?: readonly number[];
}

export interface SchedulerHandle {
  /**
   * Stops future runs and cancels a pending retry. Resolves once the run that
   * is executing right now (if any) has settled, so shutdown never closes the
   * database under a job that is mid-flight.
   */
  stop(): Promise<void>;
}

/**
 * Generic "run this now, then every `intervalMs`" runner. Knows nothing
 * about what it's running — jobs are wired in server.ts, the composition
 * root, keeping this reusable without infrastructure/ importing a module.
 *
 * - Runs never overlap: a tick that fires while the previous run (including
 *   its retries) is still going is skipped, not queued.
 * - A failed run is retried with backoff before the next tick is awaited, so
 *   a blip (say, the database waking up) does not cost a whole interval.
 */
export const startInterval = (
  fn: () => Promise<void>,
  intervalMs: number,
  { onError, onSkipped, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS }: SchedulerOptions,
): SchedulerHandle => {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let cancelBackoff: (() => void) | null = null;

  const backoff = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        cancelBackoff = null;
        resolve();
      }
      cancelBackoff = done;
    });

  const runWithRetries = async (): Promise<void> => {
    for (let attempt = 1; !stopped; attempt++) {
      try {
        await fn();
        return;
      } catch (error) {
        const retryInMs = retryDelaysMs[attempt - 1];
        onError(error, { attempt, retryInMs });
        if (retryInMs === undefined) {
          return;
        }
        await backoff(retryInMs);
      }
    }
  };

  const tick = (): void => {
    if (stopped) {
      return;
    }
    if (inFlight) {
      onSkipped?.();
      return;
    }
    inFlight = runWithRetries().finally(() => {
      inFlight = null;
    });
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  // The HTTP server keeps the process alive; the scheduler must not.
  timer.unref();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      cancelBackoff?.();
      await inFlight;
    },
  };
};
