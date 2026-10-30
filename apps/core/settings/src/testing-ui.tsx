/** Mounting Settings with fakes for its smokes, and the gallery's overflow rule. */
import React from "react";
import {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "@moire/ui";
import { mountWindow } from "@moire/app-tools/testing";
import { SettingsApp } from "./app";
import type { SettingsFixture } from "./testing";

type Hit = {
  focusable?: boolean;
  focusScopeActive?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  focusId?: string;
  pointerClip?: { x: number; y: number; width: number; height: number } | null;
};

function theme(scheme: "dark" | "light") {
  return createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: scheme,
      reducedMotion: true,
    }),
  );
}

export async function mountSettings(
  fixture: SettingsFixture,
  size: { width: number; height: number; scheme?: "dark" | "light" },
) {
  const widgetTheme = theme(size.scheme ?? "dark");
  return mountWindow(
    (windowSize) => (
      <WidgetThemeProvider theme={widgetTheme}>
        <SettingsApp {...windowSize} {...fixture.props} />
      </WidgetThemeProvider>
    ),
    size,
  );
}

/** Focusable controls that reach past the window, as the app gallery counts them. */
export function overflow(
  app: Awaited<ReturnType<typeof mountSettings>>,
  width: number,
  height: number,
): string[] {
  const hits = (app.window as unknown as { hits: Hit[] }).hits;
  const found: string[] = [];
  for (const hit of hits.filter(
    (candidate) => candidate.focusable && candidate.focusScopeActive !== false,
  )) {
    const clip = hit.pointerClip;
    const x = Math.max(hit.x, clip?.x ?? hit.x);
    const y = Math.max(hit.y, clip?.y ?? hit.y);
    const right = Math.min(hit.x + hit.width, clip ? clip.x + clip.width : Infinity);
    const bottom = Math.min(hit.y + hit.height, clip ? clip.y + clip.height : Infinity);
    if (right <= x || bottom <= y) continue;
    if (x < -1 || y < -1 || right > width + 1 || bottom > height + 1)
      found.push(
        `${hit.focusId} at ${Math.round(x)},${Math.round(y)}–${Math.round(right)},${Math.round(bottom)}`,
      );
  }
  return found;
}
