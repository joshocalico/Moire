import { hexToArgb, type MoireTheme } from "./index";

/** Compositor-owned outer chrome, in logical output pixels. */
export function windowChrome(theme: MoireTheme, focused: boolean) {
  return {
    width: 1,
    color: hexToArgb(
      focused
        ? theme.family === "moire" || !theme.family
          ? theme.tokens.accent
          : theme.tokens.focusRing
        : theme.tokens.borderSubtle,
    ),
    radius: theme.tokens.radiusWindow,
  };
}
