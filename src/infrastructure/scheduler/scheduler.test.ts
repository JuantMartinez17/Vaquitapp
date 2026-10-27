import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { startInterval, type FailureInfo } from './scheduler.js';

describe('startInterval', () => {
  it('runs immediately and then on every tick', async () => {
    let runs = 0;
    const handle = startInterval(
      () => {
        runs++;
        return Promise.resolve();
      },
      20,
      { onError: () => undefined },
    );
    await sleep(110);
    await handle.stop();
    assert.ok(runs >= 3, `expected several runs, got ${runs}`);
  });

  it('skips a tick while the previous run is still executing', async () => {
    let started = 0;
    let skipped = 0;
    let release: () => void = () => undefined;
    const handle = startInterval(
      () => {
        started++;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      10,
      { onError: () => undefined, onSkipped: () => skipped++ },
    );
    await sleep(80);
    assert.equal(started, 1, 'a second run must not start while the first is in flight');
    assert.ok(skipped >= 3, `ticks were skipped, got ${skipped}`);

    release();
    await handle.stop();
  });

  it('retries a failed run with the configured backoff before the next tick', async () => {
    const failures: FailureInfo[] = [];
    let attempts = 0;
    const handle = startInterval(
      () => {
        attempts++;
        return attempts < 3 ? Promise.reject(new Error('boom')) : Promise.resolve();
      },
      60_000,
      { onError: (_error, info) => failures.push(info), retryDelaysMs: [5, 10] },
    );
    await sleep(120);
    await handle.stop();

    assert.equal(attempts, 3, 'two failures, then a success inside the same tick');
    assert.deepEqual(failures, [
      { attempt: 1, retryInMs: 5 },
      { attempt: 2, retryInMs: 10 },
    ]);
  });

  it('gives up after the last backoff and waits for the next tick', async () => {
    const failures: FailureInfo[] = [];
    let attempts = 0;
    const handle = startInterval(
      () => {
        attempts++;
        return Promise.reject(new Error('still down'));
      },
      60_000,
      { onError: (_error, info) => failures.push(info), retryDelaysMs: [5] },
    );
    await sleep(80);
    await handle.stop();

    assert.equal(attempts, 2, 'the first attempt plus one retry');
    assert.deepEqual(failures.at(-1), { attempt: 2, retryInMs: undefined });
  });

  it('stop() cancels a pending backoff instead of waiting it out', async () => {
    let attempts = 0;
    const handle = startInterval(
      () => {
        attempts++;
        return Promise.reject(new Error('down'));
      },
      60_000,
      { onError: () => undefined, retryDelaysMs: [60_000] },
    );
    await sleep(20);

    const startedAt = Date.now();
    await handle.stop();
    assert.ok(Date.now() - startedAt < 1_000, 'did not wait for the 60 s backoff');
    assert.equal(attempts, 1, 'no retry after stop');
  });

  it('stop() waits for the run that is executing', async () => {
    let finished = false;
    const handle = startInterval(
      async () => {
        await sleep(50);
        finished = true;
      },
      60_000,
      { onError: () => undefined },
    );
    await sleep(10);
    await handle.stop();
    assert.equal(finished, true);
  });
});
