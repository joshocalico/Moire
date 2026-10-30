/** Rewrites assets/alert.wav from `alertPcm()`. Run after changing alert.ts. */
import fs from "node:fs";
import { ALERT_SOUND_PATH, alertPcm } from "./alert";
import { encodeWav } from "./wav";

fs.writeFileSync(ALERT_SOUND_PATH, encodeWav(alertPcm()));
console.log(`wrote ${ALERT_SOUND_PATH}`);
