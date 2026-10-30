import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPersonalizedWidgetTheme,
  createSilkBackdrop,
  defaultSilkBackdropCacheDirectory,
  discoverPersonalization,
  mergePersonalization,
  readPrecomputedSilkBackdrop,
  silkBackdropCacheKey,
  writeSilkBackdropCache,
  type PersonalizationOverrides,
  type SilkBackdropOptions,
  type SilkBackdropSource,
} from "@moire/ui";

type GreeterPalette = Readonly<{ bg: number; accent: number; muted: number }>;

/** The only silk the native greeter draws; shared by the view and the build-time generator. */
export function nativeGreeterSilkOptions(palette: GreeterPalette): SilkBackdropOptions {
  return {
    variant: "greeter",
    palette: { background: palette.bg, filament: palette.accent, highlight: palette.muted },
  };
}

/** Uses build-time pixels for these exact options; otherwise renders them. */
export function nativeGreeterSilk(palette: GreeterPalette): SilkBackdropSource {
  const options = nativeGreeterSilkOptions(palette);
  const precomputed = readPrecomputedSilkBackdrop(options);
  if (precomputed) return precomputed;
  // Installed packages ship pixels for the default palette; say once when a theme misses them.
  const key = silkBackdropCacheKey(options) ?? "(unkeyed)";
  if (!reportedMisses.has(key) && fs.existsSync(defaultSilkBackdropCacheDirectory())) {
    reportedMisses.add(key);
    console.log(`[greeter] rendering silk backdrop ${key}`);
  }
  return createSilkBackdrop(options);
}
const reportedMisses = new Set<string>();

export type NativeGreeterPresentation = {
  colorScheme?: "light" | "dark";
  fontScale: number;
  reducedMotion?: boolean;
};

/** Application overrides used by runNativeGreeter. */
export function nativeGreeterPersonalization(
  presentation: NativeGreeterPresentation,
): PersonalizationOverrides {
  return {
    source: "application",
    themeFamily: "moire",
    colorScheme: presentation.colorScheme ?? "dark",
    fontScale: presentation.fontScale,
  };
}

/**
 * The palette the installed Wayland greeter resolves in its default
 * environment. A different runtime palette only misses the cache.
 */
export function installedNativeGreeterSilkOptions(): SilkBackdropOptions {
  const profile = mergePersonalization(discoverPersonalization("linux", { platform: "wayland" }), {
    ...nativeGreeterPersonalization({ fontScale: 1 }),
    reducedMotion: false,
  });
  return nativeGreeterSilkOptions(createPersonalizedWidgetTheme(profile).foundations.palette);
}

/** Build time only: store the installed greeter's silk pixels in `directory`. */
export function generateNativeGreeterSilk(directory?: string): string {
  return writeSilkBackdropCache(
    installedNativeGreeterSilkOptions(),
    directory ?? defaultSilkBackdropCacheDirectory(),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(generateNativeGreeterSilk(process.argv[2]));
}
