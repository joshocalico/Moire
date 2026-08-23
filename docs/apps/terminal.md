# Terminal

Moire Terminal is a native `@moire/ui` application and the default terminal in
`moire-session`. It is split into three composable layers:

1. `@moire/terminal` owns the renderer-independent VT screen, ANSI parsing,
   scrollback, cursor state, alternate screen, and terminal responses.
2. `PtySession` owns the Linux pseudoterminal byte stream. It uses util-linux
   `script` to create the PTY and Moire's Koffi convention for `TIOCSWINSZ`, so
   a resized window updates real terminal rows and columns.
3. `TerminalView` composes `RichTextView` with terminal-grid measurement, a
   blinking caret, focus, and keyboard input. The app adds a shared
   `StatusBar` and process lifecycle.

This boundary lets the VT engine drive a full app, an embedded developer
console, a test harness, or a future serial/remote transport without coupling
those uses to Wayland or a renderer backend.

## Run

```sh
moire-terminal
moire-terminal --command 'htop'
```

The terminal identifies itself as `xterm-256color` and currently supports the
core cursor/erase/SGR sequences, indexed and true color, alternate screen,
title updates, device-status responses, scrollback, resize, navigation keys,
function keys, and Ctrl/Alt input. Shift+PageUp/PageDown scrolls locally.

## Current boundaries

- Text is cell-oriented; double-width glyphs, combining characters, and full
  Unicode grapheme width need a dedicated width model.
- Selection/clipboard, hyperlinks, mouse reporting, bracketed paste, and IME
  integration are follow-up terminal/widget slices.
- The PTY transport is Linux-specific. The VT buffer and React view are not.

Smoke the non-visual engine with:

```sh
pnpm --filter @moire/terminal smoke
```
