/** The media player's queue transitions, without rendering or mpv. */
import assert from "node:assert/strict";
import { currentEntry, initialQueue, reduceQueue, type PlayerQueue } from "./player-model";

let queue: PlayerQueue = initialQueue(["/m/a.mp4", "/m/a.mp4"]);
assert.equal(queue.entries.length, 2);
assert.notEqual(
  queue.entries[0]!.id,
  queue.entries[1]!.id,
  "the same file queued twice is two entries",
);
assert.equal(queue.play, false, "a new queue opens paused");

const playing = currentEntry(queue)!;
queue = reduceQueue(queue, { type: "append", paths: ["/m/b.mp4"] });
assert.equal(currentEntry(queue), playing, "adding keeps the current entry");
assert.equal(queue.entries.length, 3);

queue = reduceQueue(queue, { type: "ended" });
assert.deepEqual([queue.index, queue.play], [1, true], "the end of a file plays the next");
queue = reduceQueue(queue, { type: "select", index: 2, play: true });
queue = reduceQueue(queue, { type: "ended" });
assert.deepEqual([queue.index, queue.ended], [2, true], "the last file ends the queue, no wrap");

const revision = queue.revision;
queue = reduceQueue(queue, { type: "restart", play: true });
assert.deepEqual([queue.ended, queue.play, queue.revision], [false, true, revision + 1]);
queue = reduceQueue(queue, { type: "select", index: 9, play: true });
assert.equal(queue.index, 2, "selecting outside the queue does nothing");

const current = currentEntry(queue);
queue = reduceQueue(queue, { type: "clear" });
assert.deepEqual(queue.entries, [current], "Clear keeps only what is playing");
assert.equal(queue.index, 0);

queue = reduceQueue(queue, { type: "close" });
assert.equal(currentEntry(queue), null);
queue = reduceQueue(queue, { type: "append", paths: ["/m/c.mp4"] });
assert.equal(currentEntry(queue)?.path, "/m/c.mp4", "adding to an empty queue opens the file");
console.log(
  "[app-tools/player-model] duplicates, append, end advance, replay, clear and close passed",
);
