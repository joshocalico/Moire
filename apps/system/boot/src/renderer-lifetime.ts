import type { KmsPresentationFeedback } from "@moire/sys";

function isPeerLoss(error: Error): boolean {
  return (
    "code" in error &&
    (error.code === "ERR_IPC_CHANNEL_CLOSED" ||
      error.code === "ERR_IPC_DISCONNECTED" ||
      error.code === "EPIPE" ||
      error.code === "ECONNRESET")
  );
}

/** Draft: owns the renderer's existing guardian channel, never a graphics resource. */
export function createRendererLifetime() {
  const send = process.send?.bind(process);
  if (!send) throw new Error("Boot renderer must be owned by its guardian");
  let stopped = !process.connected;
  let closed = false;
  let wake: () => void = () => {};
  const stopRequested = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const stop = () => {
    stopped = true;
    wake();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.once("disconnect", stop);
  if (stopped) wake();

  return {
    isStopped: () => stopped,
    waitForStop: () => stopRequested,
    async notifyScanoutAccepted(feedback: KmsPresentationFeedback): Promise<void> {
      if (stopped || closed || !process.connected) {
        stop();
        return;
      }
      try {
        await new Promise<void>((resolve, reject) => {
          // A false return means backpressure. Only the callback reports write failure.
          send({ kind: "scanout-accepted", feedback }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      } catch (error) {
        stop();
        if (!(error instanceof Error) || !isPeerLoss(error)) throw error;
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      stop();
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
      process.removeListener("disconnect", stop);
      // Node retains disconnect() after EOF; calling it again emits process 'error'.
      if (process.connected) process.disconnect();
    },
  };
}
