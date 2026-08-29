# Moire Settings

Out-of-process `@moire/ui` app. Changes write to `~/.config/moire/` and apply live:

| Control       | Effect                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| Dark theme    | Swaps `active-theme.json` (shell + wallpaper hot-reload) + GTK/gsettings |
| Notifications | Persisted for the future notification daemon                             |
| UI scale      | Persisted + GTK font size; DE chrome scale follows later                 |
| Volume        | `wpctl` / `pactl` when PipeWire/Pulse is installed                       |

```bash
pnpm --filter @moire/settings start
```

Launch from the shell Apps menu (Settings is a built-in entry).
