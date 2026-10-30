/**
 * Is any sound card playing? ALSA lists each playback substream's state under /proc/asound;
 * PipeWire suspends idle sinks after a few seconds, so RUNNING means audio is really flowing.
 * Read only when an automatic suspend is due, never polled.
 */
import fs from "node:fs";
import path from "node:path";

export function audioPlaybackActive(root = "/proc/asound"): boolean {
  let cards: string[];
  try {
    cards = fs.readdirSync(root).filter((name) => /^card\d+$/.test(name));
  } catch {
    return false;
  }
  for (const card of cards) {
    let streams: string[];
    try {
      streams = fs.readdirSync(path.join(root, card)).filter((name) => /^pcm\d+p$/.test(name));
    } catch {
      continue;
    }
    for (const stream of streams) {
      let substreams: string[];
      try {
        substreams = fs
          .readdirSync(path.join(root, card, stream))
          .filter((name) => /^sub\d+$/.test(name));
      } catch {
        continue;
      }
      for (const substream of substreams) {
        try {
          const status = fs.readFileSync(
            path.join(root, card, stream, substream, "status"),
            "utf8",
          );
          if (/^state:\s*RUNNING\b/m.test(status)) return true;
        } catch {
          // A substream that vanished mid-read is not playing.
        }
      }
    }
  }
  return false;
}
