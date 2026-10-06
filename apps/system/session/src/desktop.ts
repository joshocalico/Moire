import { SessionBus } from "@moire/dbus";

/** Confirm the actual shell handoff on the current session's existing bus. */
export async function requestDesktopStart(options: { timeoutMs?: number } = {}): Promise<void> {
  const state: { bus: SessionBus | null; finished: boolean } = { bus: null, finished: false };
  const timeoutError = new Error("The desktop did not respond. Try again.");
  const cancellation = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError);
      cancellation.abort();
    }, options.timeoutMs ?? 5000);
  });
  const handoff = async () => {
    const connection = await SessionBus.connect(undefined, { signal: cancellation.signal });
    if (state.finished) {
      connection.close();
      throw timeoutError;
    }
    state.bus = connection;
    const reply = await connection.call({
      destination: "org.moire.Display1",
      path: "/org/moire/Display1",
      interface: "org.moire.Display1",
      member: "StartDesktop",
    });
    if (reply.body?.[0] !== true)
      throw new Error("The desktop did not confirm startup. Try again.");
  };
  try {
    await Promise.race([handoff(), deadline]);
  } finally {
    state.finished = true;
    clearTimeout(timer);
    cancellation.abort();
    state.bus?.close();
  }
}
