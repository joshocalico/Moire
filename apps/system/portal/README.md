# xdg-desktop-portal-moire

Moire's portal backend. It owns `org.freedesktop.impl.portal.desktop.moire` on the session bus
and implements, at `/org/freedesktop/portal/desktop`:

| Interface                                  | Source                              |
| ------------------------------------------ | ----------------------------------- |
| `org.freedesktop.impl.portal.AppChooser`   | `src/app-chooser.tsx`               |
| `org.freedesktop.impl.portal.Settings`     | `src/settings.ts`                   |
| `org.freedesktop.impl.portal.Notification` | `src/notification.ts`               |
| `org.freedesktop.impl.portal.Inhibit`      | `src/inhibit.ts`                    |
| `org.freedesktop.impl.portal.FileChooser`  | `src/file-chooser.tsx`, `-model.ts` |
| `org.moire.FileActivation1` (Moire's apps) | `src/main.tsx`, `src/open-uri.ts`   |

`xdg-desktop-portal` stays the public, sandbox-facing frontend; `moire.portal` and
`moire-portals.conf` select this backend for the interfaces above. The design, the security
model and the test plan are in [docs/portals.md](../../../docs/portals.md).

Each interface has a smoke beside it (`src/*.smoke.ts`), run from the repo root:

```sh
node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs apps/system/portal/src/settings.smoke.ts
```

They start the backend on a private `dbus-daemon` with a scratch home (`src/testing.ts`).
