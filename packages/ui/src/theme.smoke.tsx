/** Render the actual native controls across every family and color scheme. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import React from "react";
import { PNG } from "pngjs";
import { SoftwareRenderer, createShellRoot, renderShell, collectHits } from "@moire/react-host";
import { THEME_FAMILIES, windowControlLayout } from "@moire/theme";
import { discoverPersonalization, mergePersonalization, personalizeTheme } from "./personalization";
import { createPersonalizedWidgetTheme, WidgetThemeProvider } from "./widget-theme";
import {
  Button,
  Label,
  Surface,
  TextField,
  Toggle,
  ListItem,
  PathBar,
  TextBlock,
} from "./widgets/index";
import { installUiFonts } from "./index";

await installUiFonts();
const hashes = new Set<string>();
for (const family of THEME_FAMILIES) {
  for (const colorScheme of ["dark", "light"] as const) {
    const profile = mergePersonalization(
      discoverPersonalization("linux", { themeFamily: family }),
      {
        source: "application",
        themeFamily: family,
        colorScheme,
      },
    );
    const tokens = personalizeTheme(profile).tokens;
    const theme = createPersonalizedWidgetTheme({ ...profile, accent: tokens.accent });
    const pal = theme.foundations.palette;
    const root = createShellRoot();
    renderShell(
      root,
      <WidgetThemeProvider theme={theme}>
        <Surface width={460} height={310} fill={pal.panel}>
          <Label
            x={20}
            y={20}
            width={420}
            text={`${family} · ${colorScheme}`}
            fontSize={18}
            fontWeight="medium"
          />
          <Button
            x={20}
            y={60}
            width={120}
            label="Open folder"
            variant="primary"
            onPress={() => {}}
          />
          <Button x={156} y={60} width={120} label="Cancel" variant="secondary" />
          <Button x={292} y={60} width={120} label="Disabled" disabled />
          <TextField x={20} y={112} width={250} value="Documents" onChange={() => {}} />
          <Toggle x={294} y={112} width={146} on label="Dark theme" onChange={() => {}} />
          <ListItem
            x={20}
            y={166}
            width={420}
            title="Botanical.png"
            subtitle="PNG image · selected"
            selected
            onPress={() => {}}
          />
          <PathBar
            x={20}
            y={225}
            width={420}
            segments={[
              { id: "home", label: "Home" },
              { id: "desktop", label: "Desktop" },
            ]}
            value="~/Desktop"
            onCommit={() => undefined}
            onNavigate={() => {}}
          />
          <TextBlock
            x={20}
            y={278}
            width={80}
            height={20}
            text="A long filename that must show an ellipsis"
            overflow="ellipsis"
            maxLines={1}
          />
        </Surface>
      </WidgetThemeProvider>,
    );
    const frame = new SoftwareRenderer().render(root.container, { width: 460, height: 310 });
    const hash = createHash("sha256").update(frame.pixels).digest("hex");
    assert.ok(!hashes.has(hash), `${family}/${colorScheme} should render distinctly`);
    hashes.add(hash);
    assert.ok(
      collectHits(root.container).length >= 6,
      "native controls must retain their input regions",
    );
    const text = (node: typeof root.container): string[] => [
      ...(node.kind === "text" ? [node.text ?? ""] : []),
      ...node.children.flatMap(text),
    ];
    assert.ok(
      text(root.container).some((line) => line.endsWith("…")),
      "overflow must disclose truncation",
    );
    assert.ok(
      text(root.container).includes("Desktop"),
      "current breadcrumb must retain its last letter",
    );
    assert.ok(text(root.container).includes("Edit"), "location edit action must remain readable");
    const controls = windowControlLayout(460, family);
    assert.ok(controls.titleEnd > controls.titleX);
    assert.equal(controls.closeX < controls.minX, family === "cupertino");
    if (process.env.MOIRE_THEME_PREVIEW_DIR) {
      const png = new PNG({ width: frame.width, height: frame.height });
      // Native software frames use BGRA; PNG expects RGBA.
      for (let i = 0; i < frame.pixels.length; i += 4) {
        png.data[i] = frame.pixels[i + 2]!;
        png.data[i + 1] = frame.pixels[i + 1]!;
        png.data[i + 2] = frame.pixels[i]!;
        png.data[i + 3] = frame.pixels[i + 3]!;
      }
      fs.mkdirSync(process.env.MOIRE_THEME_PREVIEW_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(process.env.MOIRE_THEME_PREVIEW_DIR, `${family}-${colorScheme}.png`),
        PNG.sync.write(png),
      );
    }
    console.log(`[ui/theme-smoke] ${family}/${colorScheme} ${hash.slice(0, 12)} ok`);
  }
}
