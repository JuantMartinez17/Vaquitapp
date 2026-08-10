/**
 * Generic "run this now, then every `intervalMs`" runner. Knows nothing
 * about what it's running — the recurring-expense generation job is wired
 * in server.ts, the composition root, keeping this reusable for any future
 * periodic job without infrastructure/ importing a specific module.
 */
export const startInterval = (
  fn: () => Promise<void>,
  intervalMs: number,
  onError: (error: unknown) => void,
): NodeJS.Timeout => {
  const run = (): void => {
    fn().catch(onError);
  };
  run();
  return setInterval(run, intervalMs);
};
