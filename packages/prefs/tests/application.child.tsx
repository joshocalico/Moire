/* eslint-disable import/no-relative-parent-imports -- Exercise real workspace consumers in isolated preference fixtures. */
/** Actual isolated Application process; IPC only drives public preference commands. */
import React, { useEffect } from "react";
import { Application } from "../../ui/src/application";
import { Window } from "../../ui/src/window";
import { useWidgetTheme } from "../../ui/src/widget-theme";
import { Rect } from "../../react-host/src/index";

const app = new Application({
  platform: "headless",
  personalization: { source: "moire", accent: "#123456", fontScale: 1.15 },
});
const window = new Window({
  title: "Motion preference fixture",
  width: 12,
  height: 8,
  decorated: false,
});
function Probe() {
  const theme = useWidgetTheme();
  const profile = app.getPersonalization();
  const reduced = profile?.reducedMotion;
  const normalMs = theme.foundations.motion.normalMs;
  useEffect(() => {
    process.send?.({
      kind: "profile",
      reduced,
      normalMs,
      accent: profile?.accent,
      fontScale: profile?.fontScale,
    });
  }, [reduced, normalMs]);
  return <Rect width={12} height={8} fill={reduced ? 0xff663322 : 0xff223366} />;
}
window.setContent(() => <Probe />);
app.addWindow(window);
process.on("message", (message: unknown) => {
  if (
    typeof message !== "object" ||
    message === null ||
    !("id" in message) ||
    typeof message.id !== "number" ||
    !("kind" in message)
  )
    return;
  const id = message.id;
  if (message.kind === "save" && "value" in message && typeof message.value === "boolean") {
    void app
      .setSessionReducedMotion(message.value)
      .then(() => process.send?.({ kind: "response", id, ok: true }))
      .catch((error: unknown) =>
        process.send?.({
          kind: "response",
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  } else if (message.kind === "query") {
    process.send?.({ kind: "response", id, profile: app.getPersonalization() });
  } else if (message.kind === "quit") {
    app.quit();
    process.send?.({ kind: "response", id, ok: true });
  }
});
process.on("disconnect", () => app.quit());
try {
  await app.run();
} finally {
  process.disconnect?.();
}
