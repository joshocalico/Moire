import { isLinux, runClearColorLoop } from "./index.js";

async function main() {
  if (!isLinux()) {
    console.log("clear-color: Linux only (run on MoireDev).");
    process.exit(0);
  }

  const frames = Number(process.env.MOIRE_FRAMES ?? 90);
  const card = process.env.MOIRE_CARD ?? "/dev/dri/card1";
  console.log(`Moire clear-color loop (${frames} frames) on ${card}`);

  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await runClearColorLoop({
      cardPath: card,
      frames,
      fps: 30,
      signal: ac.signal,
    });
    console.log("done");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
