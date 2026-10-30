/** Operations run one at a time with progress, cancellation and outcomes as values. */
import assert from "node:assert/strict";
import { OperationQueue } from "./queue";

const queue = new OperationQueue((error) => `Failed: ${(error as Error).message}`);
const seen: string[] = [];
queue.subscribe(() => {
  const running = queue.state.running;
  if (running) seen.push(`${running.label}:${running.progress?.done ?? "-"}`);
});
let release!: () => void;
const first = queue.enqueue({
  label: "First",
  run: async ({ report }) => {
    report({ done: 1, total: 2, name: "a" });
    await new Promise<void>((resolve) => (release = resolve));
    return 7;
  },
  done: (value) => `First made ${value}`,
  undoable: true,
});
const second = queue.enqueue({ label: "Second", run: async () => "ok" });
assert.equal(queue.state.pending, 1, "the second operation waits for the first");
await new Promise((resolve) => setTimeout(resolve, 0));
release();
assert.deepEqual(await first, { ok: true, value: 7 });
assert.equal((await second).ok, true);
assert.equal(queue.state.outcome?.message, "Second finished");
assert.ok(seen.includes("First:1"));

const cancelled = queue.enqueue({
  label: "Long",
  run: ({ signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("stop")))),
});
await new Promise((resolve) => setTimeout(resolve, 0));
queue.cancel();
const result = await cancelled;
assert.equal(result.ok, false);
assert.equal(!result.ok && result.cancelled, true);
assert.equal(queue.state.outcome?.state, "cancelled");

const failed = await queue.enqueue({
  label: "Broken",
  run: async () => {
    throw new Error("disk full");
  },
});
assert.equal(failed.ok, false);
assert.equal(queue.state.outcome?.message, "Failed: disk full");
queue.dismissOutcome();
assert.equal(queue.state.outcome, null);
console.log("[file-operations/queue] ordering, progress, cancellation and failures passed");
