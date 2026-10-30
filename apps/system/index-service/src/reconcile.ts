/**
 * The periodic reconcile pass: a full walk every 30 minutes, offset by a random stagger so that
 * several sessions or services do not all start their disk scans together.
 */
export const RECONCILE_INTERVAL_MS = 30 * 60 * 1000;
/** Without a live watch, reconcile more often so changes still show up within minutes. */
export const UNWATCHED_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const STAGGER_FRACTION = 0.2;

export type ReconcileSchedule = { stop(): void };

/** Run `pass` repeatedly; a pass never overlaps the previous one. */
export function scheduleReconcile(
  intervalMs: number,
  pass: () => Promise<void>,
  random: () => number = Math.random,
): ReconcileSchedule {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const next = () => {
    if (stopped) return;
    const delay = intervalMs * (1 + STAGGER_FRACTION * (random() - 0.5));
    timer = setTimeout(() => {
      void pass()
        .catch(() => {
          // A failed pass is reported through the service status; try again next interval.
        })
        .finally(next);
    }, delay);
    timer.unref();
  };
  next();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
