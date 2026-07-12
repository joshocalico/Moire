/**
 * Headless smoke — proves Application/Window/widgets without a display.
 */
import { createElement, useState } from "react";
import {
  Application,
  Window,
  Column,
  Label,
  Button,
  Checkbox,
  Toggle,
  Separator,
} from "./index.js";

function SmokeApp(props: { onQuit: () => void }) {
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(false);
  return createElement(
    Column,
    { x: 0, y: 0, width: 400, height: 300, padding: 16, gap: 12 },
    createElement(Label, {
      text: "Moire UI smoke",
      fontSize: 20,
      fontWeight: "bold",
      height: 28,
      width: 360,
    }),
    createElement(Separator, { width: 360, height: 1 }),
    createElement(Toggle, {
      on,
      label: "Dark mode",
      onChange: setOn,
      width: 200,
      height: 28,
    }),
    createElement(Checkbox, {
      checked,
      label: "Enable notifications",
      onChange: setChecked,
      width: 280,
      height: 28,
    }),
    createElement(Button, {
      width: 120,
      height: 36,
      label: "Quit",
      onPress: props.onQuit,
    }),
  );
}

async function main() {
  process.env.MOIRE_UI_PLATFORM = "headless";
  const app = new Application({ platform: "headless" });
  const win = new Window({ title: "Smoke", width: 420, height: 320 });
  win.setContent(
    createElement(SmokeApp, {
      onQuit: () => app.quit(),
    }),
  );
  app.addWindow(win);
  // Auto-quit after a few frames so CI doesn't hang.
  setTimeout(() => app.quit(), 200);
  await app.run();
  console.log("[ui/smoke] ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
