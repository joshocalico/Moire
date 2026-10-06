import { runGreeter } from "@moire/greeter";
import { requestDesktopStart } from "./desktop";

const complete = await runGreeter({ onContinue: requestDesktopStart });
if (!complete) process.exitCode = 1;
