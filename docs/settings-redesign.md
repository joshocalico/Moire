# Settings redesign

Status: the recommendation (§4) is implemented in `apps/core/settings` (2026-10-10), with the
§7 widgets in `@moire/ui`. Three directions were explored, and the recommendation combines them:

- **Sidebar (A)** is the skeleton: a labelled, grouped sidebar with search at the top and pages
  that open with a hero card.
- **Overview (B)** supplies the landing page: status tiles, quick toggles, and "Recently
  changed" with Undo.
- **Canvas (C)** supplies the live desktop preview on Appearance.

Mockups were drawn with the real `@moire/ui` widgets by a throwaway script, since deleted. They
are in
`$SCRATCH/settings-mocks/`, where `$SCRATCH` is
`/private/tmp/claude-501/-Users-USER-projects-moire/0e965aa6-0537-4348-be8c-3c8bc54894fe/scratchpad`. Shapes the kit doesn't have yet are drawn inline and named in §7.

## 1. Audit

### What Settings is today

`apps/core/settings`, about 2.9k lines. It is a 560×680 window with a header bar, five tabs
(Appearance, Displays, Sound, Search, About), a centred column of cards, and a status line.

| Tab        | Contents                                                                                                                                    | Backend                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Appearance | Desktop style (select), light/dark, interface size, reduce motion, wallpaper mode (select), desktop icons, notifications, two panel toggles | `@moire/prefs` `updateSettings` + `applySettings`            |
| Displays   | Arrangement, primary display, resolution, refresh rate and scale, with a 15 s keep/revert trial                                             | Compositor display controller over D-Bus (`display-service`) |
| Sound      | One volume slider                                                                                                                           | `applyVolume` runs `wpctl` or `pactl` directly               |
| Search     | Index status, on/off, excluded folders, removable drives, rebuild and clear                                                                 | `org.moire.Index` and the storage service                    |
| About      | Three text rows: desktop name, style, and the prefs path                                                                                    | None                                                         |

Baseline render: `0-current-appearance.png`. The gallery renders only the Search page
(`settings-search-*` in the app-suite gallery).

### UX problems

1. **Tabs don't scale.** Five tabs already fill 620px. There is nowhere to put Network,
   Bluetooth, Power, Keyboard and the rest, and the tab icons drop out below about 580px.
2. **No overview.** Nothing shows the state of the system. You have to know which tab holds what.
3. **No search.** You can't find a setting by name, and nothing can link to one: the desktop's
   deep links are tab indexes (`MOIRE_SETTINGS_TAB=0|1`).
4. **Things are in the wrong place.** Notifications sits under Appearance › Desktop. "Panel" is a
   pair of switches with no picture of what they change. Wallpaper is a select menu with no
   previews, and the image mode can't be chosen at all.
5. **The device pages are missing.** Wi‑Fi and Bluetooth have working services and full
   connect and pair flows, but only the shell's Quick Settings popover uses them. Battery,
   storage and notification history have the same problem.
6. **Sound bypasses the service.** Sound calls `wpctl`/`pactl` itself, while Quick Settings
   uses the management service's audio adapter, which has readback, mute and the sink name. The
   two can disagree.
7. **About is empty**, and the prefs path is not useful to a user.
8. **The structure follows the old look.** All state lives in one 528-line `main.tsx`, and
   `SettingsPage` is a fixed card layout with no hero, list or picture rows.
9. **The window is too small.** At 560×680 everything is a narrow column. Files now sets the
   look with its rail and large titles, and Settings doesn't match it.

### What the system supports today

**Real** means a typed client or local API exists now. **Gap** means new backend work.

| Area                | What exists                                                                                                                                                                                                                 | Gaps                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wi‑Fi               | `DesktopStatusClient`: access points (ssid, strength, security, connected), connectivity, current connection, `refreshWifi` (scan), `connectWifi(id, psk)` (WPA-PSK or open), `cancelWifi`, read-only or interactive policy | Wi‑Fi on/off write (`WirelessEnabled` is read only), disconnect, forget, hidden SSIDs, enterprise or WPA3, per-connection details (band, DNS, MAC), auto-connect and metered flags            |
| Wired / other       | `snapshot.network`: interface name, transport and addresses                                                                                                                                                                 | Link speed, DNS, VPN (NetworkManager VPN plugins), proxy, airplane mode (rfkill)                                                                                                              |
| Bluetooth           | Adapters (name, powered), paired devices (name, address, trusted, connected), connect and disconnect, discovery leases, pairing with PIN, passkey and confirm prompts, trust with consent                                   | Adapter power and discoverable writes, remove (forget) a device, device class and icon, device battery (`org.bluez.Battery1`)                                                                 |
| Sound               | Management service audio adapter: default sink, volume (readback can exceed 1), mute, sink description                                                                                                                      | Choosing an output device, input devices and levels, per-app volume, alert sounds                                                                                                             |
| Displays            | Compositor display controller: outputs, modes, layout, scale, primary, trial and revert. Fully real.                                                                                                                        | Night light (gamma), brightness (`capabilities.brightness` is false), rotation                                                                                                                |
| Battery / power     | UPower: percentage, state, on-battery, time to empty or full, warning level. The shell has Lock, Log out, Suspend, Restart and Shut down.                                                                                   | Power profiles (power-profiles-daemon), idle timers (screen off, suspend), lid action, low-battery action. The compositor has no idle policy.                                                 |
| Storage             | UDisks: volumes, size, filesystem, mount, unmount, eject. `fs.statfs` for Home.                                                                                                                                             | Per-category usage (the Disk Usage app scans on demand), trash or cache cleanup policies                                                                                                      |
| Notifications       | Notification service with active list and history; Do not disturb (stored as `!settings.notifications`)                                                                                                                     | Per-app allow, banner and sound policy, DND schedule, lock-screen privacy                                                                                                                     |
| Appearance          | prefs: `themeFamily`, `dark`, `uiScale`, `reducedMotion`, `wallpaper` (atmosphere, gradient, solid, image path), `showDesktopIcons`, `panelFullWidth`, `panelIconsOnly`. Theme palettes per family.                         | Accent override (accent is fixed per family), automatic light and dark by time, a wallpaper image picker (the prefs field exists and `FileChooser` exists, but nothing wires them)            |
| Keyboard & mouse    | None. The keymap is hard-coded `evdev/pc105/us` in `packages/sys/src/keymap.ts`, and key repeat is hard-coded 40/400 in `packages/core/src/server.ts`.                                                                      | Layouts and switching, repeat rate and delay, pointer speed, natural scrolling, tap to click, a shortcuts editor. Each is a pref plus compositor plumbing.                                    |
| Apps & defaults     | `discoverApplications()`; `MimeAssociationDatabase` reads and writes `mimeapps.list` (`setDefaultApplication`). The Process Manager app.                                                                                    | Autostart entries, per-app permissions (none exist to manage)                                                                                                                                 |
| Search & privacy    | Index service, fully real; the existing page moves here unchanged. Per-app recent-file lists (`app-tools`).                                                                                                                 | "Clear recent files" across apps is easy (local files). Location and camera permissions don't exist yet.                                                                                      |
| Users               | `apps/system/compositor/src/local-users.ts`: read-only AccountsService discovery, used before login. AccountsService runs in the desktop image (Josh approved it for the picker).                                           | Current-user name and avatar from a session-side client (read-only, small). Password change, adding users and auto-login all need AccountsService writes and polkit, which Josh must approve. |
| Date, time & region | `Intl` and `app-tools/time-zones.ts` for listing and showing zones                                                                                                                                                          | Setting the system time zone and NTP (`timedated`; NixOS declares `time.timeZone`), a 24-hour clock pref read by the panel clock, locale and formats                                          |
| About & updates     | `os` (hostname, memory, CPU), `/etc/os-release`, the Moire build id                                                                                                                                                         | Updates: no channel or update mechanism exists (NixOS images). Renaming the computer (hostnamed).                                                                                             |
| Accessibility       | Reduce motion and interface size, both real                                                                                                                                                                                 | High contrast (a theme variant), larger text separate from scale, screen reader and zoom (large projects), sticky keys                                                                        |

## 2. Information architecture

Sixteen pages in four groups, plus Overview:

| Group       | Pages                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ |
| (top)       | **Overview**: the identity card at the top of the sidebar                                  |
| Connections | Wi‑Fi & Network · Bluetooth                                                                |
| Devices     | Displays · Sound · Keyboard & Mouse · Power & Battery · Storage & Drives                   |
| Personal    | Appearance · Desktop & Launcher · Notifications · Accessibility                            |
| System      | Apps & Defaults · Search & Privacy · Users & Login · Date, Time & Region · About & Updates |

- **Appearance** holds the look: style, scheme, accent, size, wallpaper, the panel's shape
  (islands or full width) and window buttons (titles or icons only), as Josh asked.
- **Desktop & Launcher** holds behaviour: desktop icons, launcher contents and order, and later
  hot corners and workspaces.
- **"Desktop & Dock" is renamed:** Moire has no dock. The panel is the bar at the bottom.

### Page anatomy

Every page is built the same way:

1. **Title** (20px medium) and a one-line **live summary** ("2 devices connected"). The summary
   doubles as the sidebar tooltip and the Overview tile detail.
2. **Hero** (optional, 84px): the page's icon in a tinted tile, its main state as a sentence,
   and the master control (the Wi‑Fi switch, the Bluetooth switch). On Appearance the hero is
   the live desktop preview with scheme, accent and size.
3. **Sections:** a muted heading (12px), then a card of `SettingRow`s. A section heading may
   carry a trailing status, such as a "Scanning…" badge.
4. **Row kinds:** switch, select, segmented, slider, button, value with chevron (drills into a
   detail sheet), list item (leading icon or avatar, hover actions), and picture choices
   (`OptionCard`).
5. **Errors and unavailable services:** a `Banner` at the top of the page, never a status-line
   sentence. A service that isn't running shows an `EmptyState` with what to do. Rows that need
   a missing backend don't render at all: no greyed-out "coming soon" rows.

### Settings search

- **Registry:** a static, typed registry in the app (`catalog.ts`). Each setting has
  `{ id, page, section, label, keywords, synonyms }`, and each page contributes its rows. The
  registry is also the deep-link table.
- **Matching:**
  - Case- and accent-folded prefix and word matching over the label, keywords and section.
  - Synonyms: "resolution" also finds "screen size"; "dark mode" finds Color scheme.
  - Ranking: label prefix first, then word start, then keyword match.
- **Results:**
  - Grouped by page, in sidebar order. Each group has an "Open page ›" link.
  - Each result is the live row with its real control, so a setting can be changed from the
    results. The text that matched is accented.
  - The sidebar shows a count beside each page with matches and dims the pages without.
- **Keys:** ↑/↓ move between results, Space or Enter operates the control, Ctrl+Enter opens the
  page scrolled to the row with a brief highlight, and Esc clears.
- **Deep links:**
  - `MOIRE_SETTINGS_PAGE=<page>[#<setting>]` (for example `appearance#wallpaper` or
    `network#wifi`) replaces the `MOIRE_SETTINGS_TAB` indexes.
  - The desktop menu, Quick Settings ("Wi‑Fi settings…", "Bluetooth settings…", "Sound
    settings…") and notifications all use it.
  - The tab index stays accepted for one release.

## 3. Directions

All mocks are 1020×700 in Moire dark.

### A: sidebar and hero

Renders: `a1-sidebar-landing-network.png`, `a2-sidebar-appearance.png`,
`a3-sidebar-bluetooth.png`, `a4-sidebar-search.png`.

- **Sidebar (248px):**
  - The search field sits at the top. Under it is the identity card (avatar, name, "joshua-vm").
  - Then the four groups, with tinted 16px icons in 28px rows.
  - Every page is visible at 700px tall without scrolling.
- **Pages:** a centred column up to 660px wide. Each page opens with its hero, then sections.
- **Search:** results replace the page (§2), and the sidebar becomes a map of the matches.
- **Below 760px:** the sidebar collapses to a 64px icon rail with the avatar and a search button,
  matching Files' rail. See `r*-640.png`.

**Pros:**

- Every page is one click away and can be scanned at a glance.
- The layout is the familiar one (GNOME, macOS).
- Search in the sidebar keeps context.
- It scales to 16 or more pages.

**Cons:**

- It has no sense of "how is my system" until Overview is added (the recommendation does this).
- The hero repeats the page title.

### B: overview and categories

Renders: `b1-overview-home.png`, `b2-overview-appearance.png`, `b3-overview-network.png`,
`b4-overview-search.png`.

- **Rail:** Files' 64px `NavigationRail` with five categories (Overview, Connections, Devices,
  Personalize, System).
- **Top bar:** back and forward, and search centred in the top bar, the same as Files.
- **Overview:**
  - Eight `StatusTile`s: Wi‑Fi, Bluetooth, Battery, Sound (with an inline slider), Displays,
    Storage, Search index, Updates.
  - Quick toggle chips, then Recently changed with Undo.
- **Categories:** a large title and a `ChipGroup` of pages. Pages use two columns where they
  fit: Appearance has its controls on the left and the preview on the right; Wi‑Fi has the
  network list on the left and the selected network's details on the right.
- **Search:** a Best match card, then a two-column grid of result cards, with category chips
  for filtering.

**Pros:**

- The most informative landing page.
- Matches Files exactly.
- Master and detail use wide windows well.

**Cons:**

- Pages are two levels deep (category, then chip): Keyboard takes two clicks and isn't visible
  from anywhere.
- Chips as navigation are easy to miss.
- At 640px the two-column pages collapse back into A anyway.

### C: one canvas and a context pane

Renders: `c1-canvas-landing.png`, `c2-canvas-appearance.png`, `c3-canvas-bluetooth.png`,
`c4-canvas-search.png`.

- **Canvas:** every setting on one scrolling page, in sections. A plain table of contents on
  the left follows the scroll position.
- **Context pane (312px) on the right:** it changes with the section in view:
  - At the top: this computer's status.
  - On Appearance: the live preview, the last change with Undo, and Reset.
  - On Bluetooth: the selected device's battery, address, Trusted, Disconnect and Forget.
- **Search:** filters the canvas in place, folding everything else away. The pane explains the
  keys.

**Pros:**

- You never wonder which page holds a setting.
- Search is simply a filter.
- The context pane is a strong idea for previews and device details.

**Cons:**

- It is cramped: three columns in 1020px leave the canvas about 450px.
- It needs about 140 live rows and every service connected at once (cost and complexity).
- It doesn't survive 640px: both side columns go and it becomes a long list.
- Scroll spy is harder to make accessible than pages.

## 4. Recommendation

The recommendation is **A's structure, with B's Overview and C's preview.**

Renders: `r1-home.png`, `r2-appearance.png`, `r3-network.png`, `r4-search.png`. Each also
exists as `-640` (640×650), `-light`, and `-640-light`.

- **Structure:** sidebar (A).
  - The identity card at the top of the sidebar _is_ the Overview entry: clicking your name
    shows the system.
  - Overview is B's tiles (six of them, three across, two across at 640px), the quick toggles,
    and Recently changed with Undo.
- **Appearance:** its hero is the live `DesktopPreview` (C) beside scheme, accent and interface
  size. Under it come the style cards, then Panel and windows with picture options (Floating
  islands or Full-width bar) and Titles or Icons only. At 640px the picture options become a
  segmented control.
- **Device pages:** hero plus lists (A). Network rows show signal and a lock, and Connect
  appears on hover. Details for a network or Bluetooth device open in a **side sheet** (B's
  detail panel and C's pane, shown on demand) rather than a permanent third column.
- **Search:** A's results: live rows grouped by page, with sidebar counts.

Why: it keeps every page one click away, it is the only option that works at 640px without
changing shape, and it borrows the two ideas Josh is likely to enjoy most: the status landing
and the live preview.

### Rendered sanity check

Findings from the renders, and the fix for each:

1. **Signal bars disappeared** where the strength was low, because the alpha was passed as a
   fraction (`colorWithAlpha` takes 0–255). Unlit bars now show at 35%.
2. **"Connect" on every row** was noisy (`a1`, first pass). Rows now show a lock for secured
   networks, and Connect appears only on the hovered or focused row (`HoverActions`).
3. **The accent swatches overflowed** the row: a component with no intrinsic size inside
   `Horizontal`. They now sit in a sized box. The widget needs an intrinsic size (§7).
4. **The four-option scale segments truncated** to "10…". Search results use three options
   (100/150/200%). Displays keeps a select for the full list.
5. **`PropertyList` stacked** its labels in the 312px pane. Pass `stacked={false}` and a 90px
   label width in sheets.
6. **The 640px layout holds:**
   - All 16 rail icons, plus the avatar and search, fit in 650px.
   - The Overview tiles go two across.
   - The hero preview and controls sit side by side at 528px.
7. **Light mode** reads well.
   - The hovered list row (`pal.hover`) is a strong lavender. Keep it for hover, and make sure
     selection is visibly different.

## 5. Pages

Each page lists its contents in order. _Gap_ marks rows that wait for backend work. They are
hidden until that work lands.

### Overview (identity card)

- **Title and summary:** the hostname, then the Moire build, NixOS version, and the user's real
  name and role.
- **Tiles:**
  - Wi‑Fi (desktop-status `wifi`).
  - Bluetooth (`bluetooth`).
  - Battery: only when `batterySupported` (UPower).
  - Sound, with an inline slider: `setVolume` on the desktop-status audio.
  - Storage: `statfs` for Home, plus UDisks removable volumes.
  - Updates: _gap_. The tile is hidden until an update source exists. Until then, Search index
    (index-status) takes its place.
- **Quick toggles:**
  - Dark style, Reduce motion, Desktop icons and Full-width panel come from prefs.
  - Do not disturb uses `setDoNotDisturb`.
- **Recently changed:** a new local journal, `~/.config/moire/settings-history.json`. It holds
  the last 20 changes as `{ key, from, to, at, page }`, and Undo re-applies `from`. Display
  trials are excluded.

### Wi‑Fi & Network

- **Hero:** the Wi‑Fi switch and the connection sentence. The switch is a _gap_: it needs
  `setWifiEnabled`. Until then the hero shows state only.
- **Networks:** `accessPoints` sorted with the connected one first, then by strength. Each row
  has a signal glyph, a lock, and Connect on hover. A secured network opens the password sheet,
  reusing Quick Settings' WPA-PSK validation (`isValidWpaPsk`). A "Scanning…" badge shows while
  `refreshWifi` runs. The page scans on open and every 20 s while visible.
- **Join another network…:** done: name, security (none, WPA2, WPA3) and password, as a
  temporary hidden profile (see "Network & Bluetooth backend").
- **Details sheet:**
  - Security, signal and IPv4/IPv6 addresses are real.
  - Band, DNS, MAC, Disconnect, Forget, Connect automatically and Metered are *gap*s:
    NetworkManager `Settings.Connection` and `Device` properties, and new service methods.
- **Wired and other connections:** Ethernet (name and addresses, real).
- **Airplane mode, VPN and Proxy:** done; see "Network & Bluetooth backend".
- **Read-only policy:** a `Banner` says "Network changes are managed by the system", and
  Connect is hidden.

### Bluetooth

- **Hero:** state, and the adapter name as the visible name. The power switch is a _gap_
  (adapter `Powered` write).
- **My devices:**
  - Real: paired devices, Connect and Disconnect (`setBluetoothConnected`), and Trusted (the
    trust flow with consent).
  - Done: the device kind icon (`Icon`, else `Class`), battery (`Battery1`), Forget
    (`RemoveDevice`) and Rename (`Alias`). Quick Settings shows the kind and battery too.
- **Nearby:**
  - Discovery runs while the page is visible: `startBluetoothDiscovery` takes a lease, which is
    released on leave.
  - Pair runs the existing pairing prompts (PIN, passkey, confirm) in a sheet.

### Displays

The existing page, restyled to the new anatomy:

- **Hero:** the `DisplayArrangement`.
- **Selected display:** resolution, refresh rate, scale and primary.
- **The keep/revert trial** becomes a `Banner` with a countdown, Keep and Revert at the top of
  the page.
- **Night light and Brightness:** _gap_.

### Sound

- **Output:**
  - Volume and mute through the desktop-status audio, replacing the direct `applyVolume`, so
    Settings and Quick Settings agree.
  - The default sink's name is real. Choosing the output device is a _gap_ (sink list).
- **Input and alert sounds:** _gap_. The section is hidden.

### Keyboard & Mouse

The whole page is a _gap_. It ships last, or with only "Keyboard shortcuts" (a read-only list
built from the apps' shortcut catalogs, which is real).

- **Layouts:** prefs `keyboardLayouts`, read by `createXkbKeymapMemfd` (names instead of null)
  and switched with Super+Space.
- **Repeat:** repeat rate and delay, sent as `repeat_info` from prefs.
- **Pointer:** pointer speed, natural scrolling and tap to click, applied in `evdev-pointer`.

### Power & Battery

- **Hero:** percentage, state and time left (real, UPower).
- **Power mode:** Balanced, Power saver or Performance. _Gap_: power-profiles-daemon.
- **Idle:** "Turn the screen off" and "Suspend when inactive", on battery and plugged in. _Gap_:
  the compositor needs an idle policy (dimming, DPMS and suspend through logind).
- **Show battery percentage in the panel:** a new pref, small.
- **Power actions:** the shell's Lock, Log out, Suspend, Restart and Shut down already exist.
  They stay in Quick Settings, not here.

### Storage & Drives

- **Home:** a capacity bar (`statfs`) and "Open Disk Usage" (launches the app).
- **Drives:** UDisks volumes with Mount, Unmount and Eject (real, the same client as Files),
  plus an "Index this drive" switch (moved from Search & Privacy, using the same prefs).

### Appearance

- **Hero:** `DesktopPreview`, then Color scheme, Accent and Interface size.
  - Light and Dark are real. Auto is a _gap_: a sunrise and sunset or fixed-time switcher in the
    management service.
  - Accent is a _gap_ (small): `accent` in prefs overrides the family's tokens in
    `themeForSettings`. Contrast is checked with `foregroundOn`.
  - Interface size is real.
- **Style:** five `FamilyCard`s drawn from each family's real palette.
- **Wallpaper:** thumbnails for Theme, Atmosphere, Gradient and Solid, and "Choose…", which opens
  `FileChooser` and sets `{ mode: "image", path }` (real). Solid gets a colour row.
- **Panel and windows:**
  - Panel: Floating islands or Full-width bar (`panelFullWidth`).
  - Window buttons: Titles or Icons only (`panelIconsOnly`).
- **Reduce motion:** stays on Accessibility, with a mirror row here that search can find.

### Desktop & Launcher

- **Desktop icons** (`showDesktopIcons`, real).
- **Launcher:** pinned apps and order, with a _gap_: new prefs read by `Launcher`.
- **Hot corners and workspaces:** _gap_.

### Notifications

- **Do not disturb** (real).
- **History:** "Clear history" through `dismissMany` (real), and a count.
- **Per-app:** allow, banners and sounds, from apps seen in history. _Gap_: the notification
  service needs a policy table.
- **DND schedule:** _gap_.

### Accessibility

- **Seeing:** interface size (mirror), reduce motion (real). High contrast, screen reader and
  zoom are _gap_, and hidden.
- **Typing:** sticky keys and slow keys, _gap_.

### Apps & Defaults

- **Default apps:** Web, Mail, Text, Images, Music, Video, PDF and Archives, each a select over
  `discoverApplications()` filtered by MIME type. It writes `mimeapps.list` through
  `setDefaultApplication` (real).
- **Installed apps:** a list with an Open button. "Running apps…" opens Process Manager.
- **Autostart:** _gap_.

### Search & Privacy

- **Search:** the current Search page, moved as it is: status headline, toggle, excludes,
  rebuild and clear. Removable drives move to Storage.
- **Recent files:** "Remember recent files" and "Clear recent files". Both need a new pref and
  the clearing of `app-tools` recent lists, which are local and small.
- **Lock screen privacy for notifications:** _gap_.

### Users & Login

- **You:** avatar, real name and username, read through a session-side AccountsService client
  (a read-only adapter like `local-users.ts`).
- **Lock screen:**
  - "Lock after" is a _gap_ (idle policy).
  - "Lock now" is real (the shell's lock).
- **Password, other users and account types:** real through `AccountsSettingsClient` (see
  "Time, region & accounts backend"). Changing another account raises the system's password
  prompt for an administrator ([polkit-agent.md](polkit-agent.md)); Settings has no unlock of
  its own and only says "Waiting for your password" meanwhile.
- **Automatic login:** real through `LoginSettingsClient` with moire-dm (see
  [moire-dm.md](moire-dm.md), "Automatic login"): your own account only, behind the same
  system prompt. Hidden under greetd.

### Date, Time & Region

- **Shown live:** the current time and zone (real, `Intl`).
- **Time zone and automatic time:** real through `TimeSettingsClient` (timedated), with a
  searchable zone list (see "Time, region & accounts backend").
- **24-hour clock, first day of the week, date format:** `settings.region` in `@moire/prefs`.

### About & Updates

- **Facts:** hostname, Moire build (C63), OS (`/etc/os-release`), memory, processor and graphics
  (`os` plus the EGL renderer string). "Copy system info" copies them for bug reports.
- **Updates:** _gap_. The section is hidden until there is an update source.
- **Diagnostics:** "Open Process Manager", and the prefs folder (moved here from the old About).

## 6. Architecture

Following `apps/AGENTS.md`:

```
apps/core/settings/src/
  main.tsx              entry: runApp, window, services → <SettingsApp>  (<200 lines)
  app.tsx               shell: sidebar, page router, search, sheets
  catalog.ts            pages, groups, setting registry (ids, labels, keywords) — deep links
  search-settings.ts    pure: fold, match, rank, group (smoke-tested)
  history.ts            pure + backend: settings journal, undo
  services.ts           connect desktop-status, index, storage, display (all optional)
  pages/<page>.tsx      one file per page: model hook + view, using settings-page widgets
  pages/<page>-model.ts pure parts where there is logic (wifi sorting, defaults mapping)
```

- **Services connect lazily and optionally.** A missing service shows that page's
  `EmptyState`, and its tiles are hidden from Overview.
- **One `useDesktopStatus()` hook** (`observeDesktopStatus`) feeds Overview, Network,
  Bluetooth, Sound, Power and Notifications. It is the same snapshot Quick Settings renders.
- **Page state is a discriminated union**:
  `{ kind: "page", id, anchor? } | { kind: "search", query }`. Sheets are a second union.
- **Window:** 980×680 by default, the minimum 640×520. The sidebar collapses below 760px.

## 7. New `@moire/ui` widgets

Each widget gets general props, a smoke, and a gallery entry.

| Widget                                          | Purpose                                                                                                                                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NavigationSidebar` `density="compact"`, counts | 28px rows, a per-item tinted icon, a trailing count badge, dimmed items, and `collapsed` mode rendering as `NavigationRail`. This extends the existing widget.                                                         |
| `SettingsCard` and `SettingRow`                 | Promote `settings-page.tsx` into the kit: switch, select, segmented, slider, button, value with chevron, list item (leading icon or avatar), and block. Stacks under 400px. Supports a highlight flash for deep links. |
| `PageHero`                                      | An icon tile, title, state sentence and master control; or arbitrary content (the preview)                                                                                                                             |
| `StatusTile`                                    | Title, value, detail, an optional bar or inline control, and a chevron. The whole tile is pressable.                                                                                                                   |
| `OptionCard`                                    | A selectable picture with a label and a selected ring (style, wallpaper, panel layout)                                                                                                                                 |
| `SwatchPicker`                                  | Round colour swatches with a selected ring, arrow-key navigation, and an intrinsic size (it overflowed without one)                                                                                                    |
| `SignalStrength`                                | Four bars for a 0–100 strength, with an accessible label ("Signal 82%")                                                                                                                                                |
| `Avatar`                                        | Initials or an image in a circle, with a tint from the name                                                                                                                                                            |
| `DesktopPreview`                                | A miniature desktop from a theme, wallpaper spec and panel prefs. The shell's preview scenes could reuse it.                                                                                                           |
| `SideSheet`                                     | A right-hand sheet (360px; full width under 640px) for details and pairing. Files' Properties sheet could reuse it.                                                                                                    |

`HoverActions`, `ChipGroup`, `FilterChip`, `ItemCard`, `PropertyList`, `Banner`, `EmptyState`,
`DisplayArrangement` and `SearchField` already exist and are used as they are.

New icons: `keyboard`, `mouse`, `user`, `shield`, `accessibility`, `apps` and `panel`. Mocks of
these are in `$SCRATCH/settings-icons/`, drawn in the house style (24px grid, 1.7 stroke).

## 8. Keyboard and accessibility

| Keys                       | Action                                                      |
| -------------------------- | ----------------------------------------------------------- |
| Ctrl+F, or typing a letter | Focus search (typing starts a search, as in Files)          |
| ↑ / ↓ in the sidebar       | Move between pages; Enter or Space opens one                |
| Ctrl+1–4                   | Jump to the first page of each group; Ctrl+0 opens Overview |
| Alt+Left / Alt+Right       | Back and forward through the pages visited                  |
| Tab                        | Sidebar → page content → status line; rows in order         |
| Esc                        | Close a sheet, then clear search                            |
| Ctrl+Z                     | Undo the last settings change (the history journal)         |

- **Labels:** every control is labelled by its row label and description. Hover actions also
  appear on focus. Tiles and option cards are single focus stops with a full name, such as
  "Battery, 78 percent, 3 hours 12 minutes left".
- **Colour:** the sidebar's tinted icons are decoration. Selection uses a fill and the
  accentLine colour, never tint alone. Contrast is checked in both schemes.
- **Scale and motion:** everything multiplies by `getUiScaleFactor()`. At scale 1.5 the
  sidebar collapses earlier (the rule is width / scale < 760). Reduced motion turns off the
  preview's transitions and the deep-link highlight animation.

## 9. Phases

1. **Kit (parallel):** the §7 widgets with smokes and gallery entries, including compact
   `NavigationSidebar`, `SettingsCard`/`SettingRow` (moved out of the app), `PageHero`,
   `StatusTile`, `OptionCard`, `SwatchPicker`, `SignalStrength`, `Avatar`, `DesktopPreview` and
   `SideSheet`.
2. **The new shell on today's data:**
   - Sidebar, Overview, page router, catalog and search, and deep links (with a
     `MOIRE_SETTINGS_TAB` shim).
   - The existing pages ported to the new anatomy: Appearance (preview and pictures), Displays,
     Sound (switched to desktop-status), Search & Privacy, and About (real facts).
   - Update the desktop actions and the smokes. The tab smokes keep their intent through
     page ids.
3. **The device pages on existing services:** Wi‑Fi & Network, Bluetooth, Power & Battery
   (read-only), Storage & Drives, Notifications (DND and history), Apps & Defaults, Users
   (read-only), Date & Time (read-only plus the 24-hour pref). Quick Settings gains "… settings"
   links.
4. **Small backend additions:**
   - The settings history journal, accent override, wallpaper image picker, Wi‑Fi on/off,
     disconnect and forget.
   - Bluetooth power, forget, kind and battery.
   - The output device list.
5. **Larger backend projects**, each separately approved:
   - Compositor keyboard and pointer prefs (layouts, repeat, pointer).
   - Idle policy (screen off, lock, suspend).
   - Power profiles, night light and brightness, timedated.
   - AccountsService writes (approval needed), notification per-app policy, updates.
6. **Verification:**
   - Typecheck and all smokes.
   - Gallery: settings Overview, Appearance, Network and Search at 640×650 and 1020×975, scale 1
     and 1.5, every theme, with 0 overflow.
   - Visreg previews.
   - A fresh ISO in the VM.

## 10. Open questions

- **Rows that need missing backends:** hide them (proposed), or show them disabled with
  "Requires …"? Hiding keeps pages honest, but makes the gaps invisible to Josh during
  development. A `MOIRE_SETTINGS_SHOW_PLANNED=1` flag could show them for review.
- **Overview tiles:** fixed, or user-pinnable? Proposed: fixed for now.
- **Notifications:** should the toggle move to Quick Settings only, and Settings › Notifications
  keep just history and per-app policy? Proposed: keep DND in both.
- **Window size:** should Settings open at 980×680 (proposed), or remember the last size?

## Time, region & accounts backend

Status: implemented on 2026-10-10; native behaviour still needs a VM run (below). Settings
consumes these clients; it never talks to timedated or AccountsService itself.

```
Settings ──session bus──▶ management service ──system bus──▶ systemd-timedated
  TimeSettingsClient       org.moire.TimeSettings1            org.freedesktop.timedate1
  AccountsSettingsClient   org.moire.Accounts1                org.freedesktop.Accounts
                                    │ passwd (setuid wrapper, stdin only), for your own password
                                    │ polkit CheckAuthorization, interaction allowed ──▶ the
                                    │   compositor's password prompt (polkit-agent.md)
panel clock, apps ── @moire/prefs region prefs + /etc/localtime
```

### Clients

Every setter resolves to `SettingsResult<T>` and never rejects:
`{ ok: true, value: T } | { ok: false, code, message }`. `code` is one of `permission`,
`cancelled`, `wrong_password`, `rate_limited`, `invalid`, `unavailable`, `busy`, `failed`
and `unknown`, and `message` is a sentence fit for a `Banner`. `cancelled` is the exception: the
user dismissed the system's password prompt, and the UI shows nothing at all. Only the service's own fixed
messages are passed through; daemon and polkit text never reaches the UI. Client `state` is
`{ kind: "loading" | "unavailable" | "error", message }` or
`{ kind: "ready", owner, revision, status }`, and `subscribe` calls back at once and then on
each `Changed` signal.

`@moire/system-management/time-settings`:

| API                                                  | Notes                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `connectTimeSettings()` / `observeTimeSettings(bus)` | Owns or borrows a session-bus connection                                                         |
| `status`                                             | `{ kind: "ready", timeZone, ntp: { available, enabled, synchronized }, localRtc, readAtMs }`     |
| `refresh()`                                          | Re-reads timedated (sync status has no signal). Reads are otherwise cached for 15 s              |
| `timeZones()` → `TimeZoneEntry[]`                    | `{ id, region, subregion, city, countries[{code,name}], comment, keywords }`, read once          |
| `setTimeZone(id)`, `setNetworkTime(enabled)`         | `invalid` for ids outside the catalog                                                            |
| `searchTimeZones(entries, query, limit?)`            | Pure. Accent-folded; city prefix, then word prefix, then substring; every word must match        |
| `parseZoneCatalog(zone1970, iso3166)`                | Pure. The service reads `zone1970.tab` and `iso3166.tab` from `$TZDIR` or `/etc/zoneinfo`, + UTC |
| `createFakeTimeSettingsClient({ status?, zones? })`  | `emit(status)`, `failNext(code)`, `calls`                                                        |

`@moire/system-management/accounts-settings`:

| API                                                                     | Notes                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `connectAccountsSettings()` / `observeAccountsSettings()`               | Owns or borrows a session-bus connection                                        |
| `status`                                                                | `{ selfUid, users: AccountUser[], policy }`                                     |
| `AccountUser`                                                           | `{ uid, username, realName, iconFile, accountType, locked, lastLoginMs, self }` |
| `policy`                                                                | `{ canAdminister, minPasswordLength }`; `canAdminister` only words the UI       |
| `setRealName(uid, name)`, `setIcon(uid, path \| null)`                  | Prompts only for another user                                                   |
| `changePassword(current, next)`                                         | No prompt: the current password is the check                                    |
| `setPassword(uid, next)`                                                | Prompts; another user only                                                      |
| `createUser({ username, realName, accountType, password })` → `{ uid }` | Prompts                                                                         |
| `deleteUser(uid, { keepHome })`, `setAccountType(uid, type)`            | Prompts                                                                         |
| `usernameProblem`, `realNameProblem`, `passwordProblem`                 | Pure validators, shared with the service, for inline errors                     |
| `createFakeAccountsSettingsClient({ status?, prompt? })`                | `prompt` stands in for the system prompt; `calls` records method names only     |

"Prompts" means the system's password prompt for an administrator
([polkit-agent.md](polkit-agent.md)). The call resolves when the prompt does (clients wait up to
170 s, the service 150 s, the prompt itself 120 s idle). A dismissed prompt is `cancelled`.
Arguments are checked first, so nobody types a password for a change that would be refused.
Polkit keeps the authorization for five minutes, so a second change soon after doesn't prompt.
There is no `authenticate()`, `lock()` or `auth_required` any more.

Rules the service enforces: you cannot delete yourself, the last administrator cannot be demoted
or deleted, system and `nologin` accounts are hidden, icons must be PNG or JPEG of at most 1 MiB
(AccountsService copies the file into its store, reading it as you), and passwords need 8 or more
characters.

`@moire/system-management/login-settings` (automatic login; design and security in
[moire-dm.md](moire-dm.md), "Automatic login"):

| API                                                    | Notes                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `observeLoginSettings(bus)` / `connectLoginSettings()` | Any session-bus connection                                               |
| `status`                                               | `{ available, enabled, user }`; `available` is false without moire-dm    |
| `setAutologin(enabled)`                                | Your own account. Prompts for an administrator; `cancelled` if dismissed |
| `createFakeLoginSettingsClient({ status?, prompt? })`  | `prompt` stands in for the system prompt                                 |

AccountsService's own `AutomaticLogin` (and polkit `set-login-option`) stays unused: it only edits
GDM's file.

`@moire/prefs` region prefs (`settings.region`): `RegionSettings` is
`{ formatLocale, clock, firstDayOfWeek, dateFormat }`. `formatLocale` is a BCP 47 tag, or null to
follow `LC_ALL`, `LC_TIME`, then `LANG`. `clock` is `24h` (the default, as before) or `12h`.
`firstDayOfWeek` is `locale`, `monday`, `sunday` or `saturday`. `dateFormat` is `locale`, `iso`,
`day-month-year` or `month-day-year`.

| API                                                       | Notes                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `loadRegionSettings()`, `updateRegionSettings(patch)`     | Read-modify-write on settings.json                                                 |
| `formatClockTime(date, region, { timeZone?, seconds? })`  | `14:05` or `2:05 PM`                                                               |
| `formatCalendarDate(date, region, { style?, timeZone? })` | `short` follows `dateFormat`; `long` spells the date out                           |
| `resolveFirstDayOfWeek(region)`                           | ISO weekday 1, 6 or 7; `locale` uses `Intl.Locale#getWeekInfo`                     |
| `systemTimeZone()`                                        | The zone `/etc/localtime` points at; pass it as `timeZone` (see below)             |
| `createLiveClock()`                                       | The panel clock: re-reads prefs when settings.json changes, and the zone each tick |

The system time zone is not a pref: it belongs to timedated. Node fixes its zone when it starts,
so long-lived processes format with `timeZone: systemTimeZone()` to follow a change. The
shell's panel clock now uses `createLiveClock()`, so it honours the 24-hour pref and a new zone
within a second.

### Security model

Moire keeps the posture of [removable-drives.md](removable-drives.md): explicit allowances, then
a deny-everything fallback. Since the polkit authentication agent
([polkit-agent.md](polkit-agent.md), Phase 4) there is a third answer for two administrator
actions: "ask for an administrator's password", in a prompt the compositor draws.

- **Image** (`nix/moire-settings-services.nix`, imported by the native desktop image): polkit on;
  pkexec off; `00-moire-settings.rules` and `00-moire-admin.rules`, then the immutable
  `01-moire-deny-unapproved.rules`. Assertions keep `time.timeZone = null`, timesyncd on,
  `users.mutableUsers = true`, no `security.polkit.extraConfig`,
  `security.polkit.adminIdentities` at the NixOS default (`unix-group:wheel`: whose password an
  administrator prompt accepts), and the `unix_chkpwd` and `passwd` wrappers present. The agent
  helper's units are the agent work's (polkit-agent.md, Phase 3). `nix/moire-network-services.nix` force-empties
  `security.polkit.extraConfig`, which drops the NetworkManager module's rule granting every
  NetworkManager action to the `networkmanager` group.
- **Granted to any active, local session:** `timedate1.set-timezone`, `timedate1.set-ntp`, and
  `accounts.change-own-user-data` (AccountsService uses it only when the target is the caller).
  From `00-moire-network.rules`: NetworkManager `network-control`, `settings.modify.own`,
  `wifi.scan`, `enable-disable-wifi` and `enable-disable-wwan` (see "Network & Bluetooth
  backend"). From `00-moire-power.rules`: see "Power & idle backend".
- **An administrator's password, for any active, local session** (`00-moire-admin.rules`,
  `AUTH_ADMIN_KEEP`): `accounts.user-administration` and moire-dm's `org.moire.dm.set-autologin`.
  The subject needn't be in `wheel`: a standard user gets through when an administrator types
  their own password at the prompt (Josh's decision). No rule answers YES for either any more.
- **Never granted:** `accounts.change-own-password` (AccountsService does not check the current
  password), `accounts.set-login-option`, `timedate1.set-time`, `timedate1.set-local-rtc`, and
  every other action, including stock allow-active ones such as logind power-off. A backend that
  needs one (power, idle) must add its own `00-moire-*.rules` allowance.
- **Own password:** changed through the setuid `passwd`, whose PAM stack verifies the current
  password. The service answers its prompts on stdin one at a time. No polkit grant covers it.
- **Administrator actions:** the service keeps no authorization state. Before one, it asks
  polkit (`CheckAuthorization`, interaction allowed, 150 s) about its own system-bus connection.
  That is where a dismissed prompt (`cancelled`) is told apart from a refusal (`permission`);
  AccountsService reports both as `PermissionDenied`. Polkit keeps the authorization for the
  service's process for five minutes, so the AccountsService call that follows (also sent with
  D-Bus's `ALLOW_INTERACTIVE_AUTHORIZATION`) doesn't prompt again. The password is typed into the
  compositor's prompt and checked by polkit's helper; it never reaches Settings, the service or
  the session bus. `unix_chkpwd` is now the lock screen's only.
- **Secrets:** new passwords (data entry) travel only in D-Bus method bodies on the session bus
  and in `passwd`'s stdin. They are never logged, never in argv or the environment (helpers get an empty or
  `LC_ALL=C` environment), and never stored. Other users' new passwords become `$6$rounds=65536$`
  SHA-512 crypt hashes inside the service; AccountsService passes only the hash to
  `chpasswd -e`. Password hints are left empty because every local user can read them.

Residual risks, stated plainly:

- **Closed (polkit-agent.md, Phase 4):** the admin grant used to be a polkit YES for any process
  of an active wheel user, with the password re-entry only a gate in Moire's own UI path. Code
  running as an administrator could create a second admin account and reach `sudo` without the
  password, or turn on automatic login. Polkit itself now requires an administrator's password,
  typed into a prompt no client can draw, for both actions and for every caller. It needs the
  agent registered and the helper units on (Phases 2 and 3); without an agent polkit refuses.
- What remains of it: within five minutes of a prompt being answered, the authorization is kept
  for the management service's process, and the service acts for any process of the user. Code
  running as you can ride that window. See polkit-agent.md, open question 5.
- `moire-pam-test` is a standard user and `moire-admin-test` an administrator (public test
  passwords), so both sides of the prompt can be tested.
- Same-user processes can read the session bus (`BecomeMonitor`). The administrator's password
  no longer crosses it. A _new_ password (your own change, or one set for another user) still
  does, visible to code already running as you, as it is to anything that can read your terminal
  or ptrace your apps (polkit-agent.md, open question 6).
- Polkit 127's `active` is UID-wide (see removable-drives.md), so a background process of the
  logged-in user counts as active.

### Verification

Run from the repo root with `node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs`:

- `apps/system/management-service/src/time-settings.smoke.ts`: zone catalog parsing and search
  from fixture tables; a fake timedated on a private dbus-daemon; set zone and NTP (always
  `interactive=false`); unknown and malformed zones stopped before timedated; polkit refusal as
  `permission` with no daemon text; timedated disappearing.
- `apps/system/management-service/src/accounts-settings.smoke.ts`: SHA-512 crypt against the
  specification's vectors; a fake AccountsService; a fake polkit authority standing in for the
  rule and the prompt (authorized, dismissed, refused, no agent, never answered); fake
  `unix_chkpwd` and `passwd` that record their argv and environment; every flow above, the
  interactive flag on each change, no prompt for invalid arguments, the throttle, the last-admin
  and self-delete guards; and proof that no secret reaches a helper's argv or environment, a log
  line, or AccountsService in plain text.
- `node scripts/test-settings-policy.mjs`: the rules with mocked subjects and first-result
  dispatch, in ES5 as polkit's Duktape requires.
- `packages/prefs/src/region.smoke.ts` (the 24-hour and zone-following panel clock) and
  `packages/system-management/src/settings-clients.smoke.ts` (validators and fakes). The image
  build runs both.

Needs the VM: timedated and timesyncd under the real polkit rules (set a zone, watch the panel
clock follow, toggle NTP); AccountsService create, retype and delete with `useradd`/`userdel` on
NixOS; `passwd`'s real PAM prompts over a pipe; the real prompt for both administrator actions
(polkit-agent.md, "VM test plan"), including AccountsService honouring the interactive flag and
the kept authorization covering its call; and a standard user getting through with an
administrator's password. Changes live in the RAM-backed live image and are lost on reboot.

## Keyboard & pointer backend

Implemented 2026-10-10. Prefs are the single source of truth: Settings writes
`~/.config/moire/settings.json` (fields `keyboard` and `pointer`), and the compositor polls the
file (at most about 1 s behind) and applies changes live. The only live compositor state is the
active layout, which the compositor exposes on D-Bus.

### Client: `@moire/system-management/input-settings`

Also re-exported from `@moire/system-management`.

```ts
function connectInputSettings(options?: {
  bus?: SessionBus | null; // reuse a connection; otherwise one is opened and closed on dispose
  offline?: boolean; // skip D-Bus (tests); the active layout then comes from prefs
  pollMs?: number; // settings.json re-stat interval, default 1000
}): Promise<InputSettingsClient>;

function createFakeInputSettings(options?: {
  keyboard?: Partial<KeyboardSettings>;
  pointer?: Partial<PointerSettings>;
  catalog?: KeyboardLayoutCatalog; // default: the built-in fallback list
  compositor?: boolean; // default true; false → source "prefs", setActiveLayout rejects
}): FakeInputSettingsClient; // + writes[] and cycleLayout() for smokes

type InputSettingsClient = {
  readonly state: InputSettingsState; // replaced, never mutated, on every change
  subscribe(listener: (state: InputSettingsState) => void): () => void;
  availableLayouts(): Promise<KeyboardLayoutCatalog>; // cached after the first read
  setKeyboard(patch: Partial<KeyboardSettings>): Promise<KeyboardSettings>; // merged, normalized, stored
  setPointer(patch: Partial<PointerSettings>): Promise<PointerSettings>;
  setActiveLayout(index: number): Promise<ActiveKeyboardLayout>; // rejects without a compositor
  refresh(): Promise<void>;
  dispose(): Promise<void>;
};

type InputSettingsState = {
  keyboard: KeyboardSettings;
  pointer: PointerSettings;
  activeLayout: ActiveKeyboardLayout;
};

type ActiveKeyboardLayout = {
  index: number; // into keyboard.layouts
  id: string; // "de(nodeadkeys)" — keyboardLayoutId() of the prefs entry
  layout: string; // "de"
  variant: string; // "nodeadkeys", or ""
  name: string; // XKB's description from the compiled keymap, e.g. "German (no dead keys)"
  count: number; // configured layouts
  source: "compositor" | "prefs";
};

type KeyboardSettings = {
  layouts: { layout: string; variant: string }[]; // 1–4 entries, first is the default
  switchShortcut: "super-space" | "alt-shift" | "ctrl-shift" | "none";
  repeatEnabled: boolean;
  repeatDelayMs: number; // 150–2000, default 400
  repeatRate: number; // 1–100 per second, default 40
  capsLock: "normal" | "ctrl" | "escape";
};

type PointerSettings = {
  speed: number; // -1..1, default 0
  accelProfile: "adaptive" | "flat";
  naturalScrollMouse: boolean; // default false
  naturalScrollTouchpad: boolean; // default true
  tapToClick: boolean; // default true
  scrollMethod: "two-finger" | "edge" | "none"; // touchpad
  disableWhileTyping: boolean; // default true
  kineticScroll: boolean; // default true; two-finger scrolling coasts after a flick
  clickMethod: "areas" | "clickfinger"; // clickpads, default "clickfinger"
  leftHanded: boolean;
  middleEmulation: boolean;
};

type KeyboardLayoutCatalog = {
  source: "evdev.xml" | "lst" | "fallback";
  path: string | null;
  layouts: KeyboardLayoutInfo[]; // sorted by description
};
type KeyboardLayoutInfo = {
  name: string; // "de"
  description: string; // "German"
  shortDescription: string; // "de" — indicator label; may be ""
  languages: string[]; // ISO 639-2
  variants: { name: string; description: string; shortDescription: string; languages: string[] }[];
};
```

Constants and helpers exported alongside: `MAX_KEYBOARD_LAYOUTS` (4), `REPEAT_DELAY_RANGE`,
`REPEAT_RATE_RANGE`, `keyboardLayoutId` and the normalizers are in `@moire/prefs`; the
catalog's `loadKeyboardLayoutCatalog`, `parseEvdevXml`, `parseRulesLst` and `FALLBACK_LAYOUTS`
are re-exported from the client module.

Notes for the page:

- **Writes are synchronous file writes** wrapped in a promise; a failed write rejects. Values
  are clamped (speed, repeat), invalid names and duplicate layouts are dropped, and the returned
  object is what was stored.
- **Layouts:** reorder or remove by writing the whole `layouts` list. The compositor keeps the
  user on the layout they were typing with if it is still in the list.
- **Touchpad rows:** shown only while the compositor has a touchpad open.
  `state.pointerDevices` comes from `org.moire.Input1.GetPointerDevices() → a(ssb)` (name, kind
  `mouse`/`touchpad`, clickpad) and follows the `PointerDevicesChanged` signal;
  `touchpadPresence(state)` gives `{ touchpad, clickpad }`. The page shows tap to click, scrolling
  (fingers/edge/off), natural scrolling on the touchpad, kinetic scrolling (two-finger only),
  clicking (clickpads only: fingers or corners) and ignore-while-typing. Pointer speed is shared
  with mice.
- **Layout catalog:** read from `$MOIRE_XKB_CONFIG_ROOT` (set by the nix wrappers),
  `$XKB_CONFIG_ROOT`, then the usual system paths. On macOS without XQuartz it is the
  built-in list of 26 common layouts.

### Compositor behaviour

- **Keymap:** compiled from prefs (`evdev`/`pc105`, layouts and variants comma-joined,
  `ctrl:nocaps` or `caps:escape`) through the koffi binding in `packages/sys/src/keymap.ts`.
  A change rebuilds the keymap and the server XKB state, sends `wl_keyboard.keymap` to every
  bound keyboard, then the current modifiers to the focused client. A keymap XKB rejects falls
  back to the system default.
- **Repeat:** `repeat_info` (rate 0 when disabled) on `get_keyboard` and to every v4+ keyboard
  when the prefs change.
- **Switching:** Super+Space fires on the Space press and swallows that key (and closes a
  launcher the same Super press opened). Alt+Shift and Ctrl+Shift fire on release, only if no
  other key was pressed, so Ctrl+Shift+T still reaches apps. The shortcut locks the next XKB
  group and sends the new group in `wl_keyboard.modifiers`.
- **Shell:** `ShellBridge.setKeyboardLayout(layout)` is called on attach and on every change;
  `keyboardLayout()` returns it for a future panel indicator.
- **D-Bus:** `org.moire.Input1` at `/org/moire/Input1` on the compositor's `org.moire.Display1`
  name. Methods `GetActiveLayout() → (ussssu)` and `SetActiveLayout(u) → (ussssu)`; signal
  `LayoutChanged(ussssu)`. The tuple is index, id, layout, variant, name, count.
- **Pointer:** each device is classified from sysfs (touchpad, or mouse with or without
  relative motion) and configured on add and on every pointer pref change, through a
  libinput-shaped target (`supports(option)`, `set(option, value)`). The evdev reader applies
  acceleration (flat or adaptive, relative devices only), natural scroll (mouse or touchpad
  pref by device kind), left-handed button swap and middle-button emulation (50 ms window).
- **Touchpads:** Moire's own multitouch driver in `packages/sys` (no libinput):
  - `touchpad-device.ts`: detection and geometry from EVIOCGPROP (INPUT_PROP_POINTER,
    BUTTONPAD, SEMI_MT, TOPBUTTONPAD), EVIOCGBIT and EVIOCGABS (ranges, resolution) through
    the koffi `ioctlFd` boundary in `libc.ts`; touch screens (INPUT_PROP_DIRECT) are not
    touchpads. `TouchpadDecoder` turns protocol B slots (ABS_MT_SLOT, TRACKING_ID, POSITION_X/Y,
    TOUCH_MAJOR, PRESSURE, TOOL_TYPE), BTN_TOUCH and BTN_TOOL_FINGER…QUINTTAP into one frame per
    SYN_REPORT; single-touch pads decode as one slot; SYN_DROPPED ends every contact.
  - `touchpad-gesture.ts` (`TouchpadGestures`, pure, clocked by the caller): motion in mm,
    resolution-independent, through the pointer speed/acceleration; tap to click (1 left,
    2 right, 3 middle) with tap-and-drag; two-finger scrolling with natural and kinetic options;
    edge scrolling; clickpad software buttons (bottom areas or clickfinger) with thumb handling;
    disable-while-typing (500 ms after a non-modifier key; the seat forwards keys); palm
    rejection by touch major, pressure, firmware palm tool type and side bands.
  - `supports()` reports the touchpad options only for a device the driver runs, and
    `clickMethod` only for clickpads, so `GetPointerDevices` tells Settings the truth.
  - `touchpad-recording.ts` reads and writes evemu text (plus `# K:` key lines for
    disable-while-typing) and replays it through decoder and gestures on a virtual clock;
    `packages/sys/scripts/touchpad-record.ts [/dev/input/eventN] [seconds]` captures one on real
    hardware with the same ioctl reads.

Touchpad smokes: `packages/sys/src/touchpad.smoke.ts` (decoder, every gesture, palms, DWT,
recordings, `EvdevPointer` with a synthetic device) runs anywhere;
`packages/sys/test/touchpad.native.smoke.ts` checks the ioctl path through the image's libc and
lists touchpads it can open. Both run in the `moire-native-desktop` install check.

Smokes: `packages/prefs/tests/input-settings.smoke.ts`, `packages/sys/src/pointer-config.smoke.ts`,
`packages/core/src/seat-input.smoke.ts`, `packages/system-management/src/keyboard-layouts.smoke.ts`
and `input-settings.smoke.ts` run anywhere. `packages/sys/test/keymap-layouts.native.smoke.ts`
needs Linux libxkbcommon. All six run in the `moire-native-desktop` install check, which also
requires the image's real `evdev.xml`.

Needs the VM: typing with two layouts in a GTK, Qt or Xwayland client after Super+Space; a
live repeat change in a running terminal; Caps Lock as Escape; the launcher not flashing on
Super+Space; natural scroll and left-handed buttons on the VM's virtual mouse (its tablet is
absolute, so speed has no visible effect there). The UTM VM has no touchpad: validate on a
laptop (record with `touchpad-record.ts`, add the file as a fixture to `touchpad.smoke.ts`, and
check the Keyboard & Mouse touchpad rows appear and act), or pass a USB/I2C touchpad through to
the VM.

## Network & Bluetooth backend

Implemented 2026-10-10 in the management service (`network-manager.ts`, `network-vpn.ts`,
`airplane-mode.ts`, `bluez-bluetooth.ts`) and carried by the desktop-status snapshot, so Settings
and Quick Settings see the same state. Every request is validated on both sides of the bus with
the shared parsers in `@moire/system-management/network-status`, `vpn-config` and
`bluetooth-status`; error messages are written for people and never quote secrets.

| Feature                 | Snapshot                                                                                | Client method (D-Bus member)                                            | Backend                                                                                                                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden network          | `wifi.canConnect`                                                                       | `connectHiddenWifi({ ssid, security, password })` (`ConnectHiddenWifi`) | `AddAndActivateConnection2` with `802-11-wireless.hidden`, a temporary profile like Connect, no access point (`/`); `key-mgmt` `wpa-psk` or `sae`                                                                                                                                   |
| Airplane mode           | `airplane: { active, canToggle }`                                                       | `setAirplaneMode(on)` (`SetAirplaneMode`)                               | NetworkManager `WirelessEnabled`/`WwanEnabled` and BlueZ adapter `Powered`, which NM and BlueZ apply as rfkill soft blocks; off restores the Bluetooth adapters that were on                                                                                                        |
| Mobile broadband        | `wifi.wwan`                                                                             | through `SetAirplaneMode`                                               | `WwanEnabled`, permission `enable-disable-wwan`                                                                                                                                                                                                                                     |
| VPN list                | `wifi.vpn: { connections, canManage, importable }`                                      | `activateVpn`, `deactivateVpn`, `removeVpn` by profile UUID             | `vpn` and `wireguard` profiles; state from the active connection; `ActivateConnection`, `DeactivateConnection`, `Delete`                                                                                                                                                            |
| VPN import              | `wifi.vpn.importable`                                                                   | `importVpn({ kind, name, config, username, password })` (`ImportVpn`)   | `Settings.AddConnection`; WireGuard built in; OpenVPN when its plugin's `.name` file is installed. Certificates go to `$XDG_DATA_HOME/moire/vpn/<uuid>/` (0700/0600) and are removed with the profile. Secrets are stored with the profile (flags 0): Moire runs no NM secret agent |
| Proxy (automatic)       | `wifi.proxy: { connection, method, pacUrl, canChange, ownership, copy, needsPassword }` | `setProxy({ method, pacUrl, password? })` (`SetProxy`)                  | the primary connection's profile: `GetSettings`, merge `proxy`, `Update`, then `Device.Reapply` (best effort); a shared profile the user can't change gets a user copy instead (see "Network grant")                                                                                |
| Proxy (manual)          | prefs `proxy`                                                                           | `prefs.set({ proxy })`                                                  | NetworkManager has no manual proxy; the compositor puts `http_proxy`, `https_proxy`, `no_proxy` (and upper case) into the environment of apps it starts                                                                                                                             |
| Bluetooth kind, battery | `devices[].kind`, `devices[].battery`                                                   | —                                                                       | `Device1.Icon`, else `Class`; `Battery1.Percentage` (a battery appearing keeps the device's identity)                                                                                                                                                                               |
| Bluetooth rename        | —                                                                                       | `renameBluetoothDevice({ id, name })` (`RenameBluetoothDevice`)         | `Device1.Alias`, verified by readback                                                                                                                                                                                                                                               |

Profiles (and so VPN and proxy) are read only under the interactive network policy; read-only
Settings says "VPN connections are managed by the system".

### Network grant (native desktop image)

Josh approved letting the active local session control networking (connect and forget Wi‑Fi,
VPNs, airplane mode, proxy). The native desktop image carries it; the QEMU images
(`moire-vm.nix`) keep NetworkManager `auth-polkit = root-only`, Polkit off and the read-only
policy.

- **Daemon** (`nix/moire-networkmanager.nix`, shared by every image): NetworkManager with the
  `networkmanager-openvpn` plugin, no dhcpcd, no ModemManager.
- **Native** (`nix/moire-network-services.nix`): NetworkManager manages every Ethernet and Wi‑Fi
  device (wpa_supplicant under its D-Bus control) with its default `auth-polkit = true`, and
  installs `00-moire-network.rules`. For active, local sessions only, that rule allows
  `org.freedesktop.NetworkManager.network-control` (activate, deactivate, `Device.Reapply`),
  `settings.modify.own` (add, update and delete profiles whose `connection.permissions` name
  only the caller), `wifi.scan`, `enable-disable-wifi` and `enable-disable-wwan`. Everything else
  falls through to `01-moire-deny-unapproved.rules`, including `settings.modify.system`,
  `enable-disable-network`, `sleep-wake`, hotspots (`wifi.share.*`), hostname, global DNS,
  statistics, connectivity checking, checkpoints and reload. Assertions keep Polkit on, the deny
  fallback present, `auth-polkit` on and no device unmanaged; `moire-desktop-services.nix`
  (which forces Polkit off) refuses to share an image with this module.
- **Session:** `nix/moire-native-desktop.nix` takes `networkControl` (default `readonly`) and
  sets `MOIRE_NETWORK_CONTROL` on the compositor, which hands it to `moire-management`; the
  native image passes `interactive` and asserts the rule is installed. `interactive` only lets
  Settings ask: the service still offers a control only when NetworkManager's `GetPermissions`
  says `yes`, so a missing rule fails closed.
- **What `settings.modify.own` covers:** every profile Moire creates names its user in
  `connection.permissions` (temporary Wi‑Fi from Connect and Connect Hidden, imported VPNs), so
  Forget, VPN import and removal, and proxy changes on those profiles work. NetworkManager uses
  `modify.own` only for a profile whose permissions name exactly one user, the caller; a profile
  with no permissions is shared by every user (NetworkManager's own "Wired connection 1", Wi‑Fi
  saved by root or the installer) and needs `settings.modify.system`, which is not granted.
- **Shared profiles (decided 2026-10-10, "copy to a user profile"):** the service reads each
  profile's ownership (`user` when its permissions name only the session user, else `system`)
  and reports it with the actions that will actually succeed, so Settings never offers a
  control NetworkManager will deny. Profiles another user owns are skipped (NetworkManager
  refuses `GetSettings` on them) instead of hiding the whole list.
  - _Proxy on a shared wired or Wi‑Fi profile:_ `proxy.copy` is set and Settings says "applies
    to you only". Saving leaves the shared profile untouched and makes the user's own copy:
    the shared profile's settings with a new UUID, id `<name> (<user>)`, permissions
    `user:<user>:`, autoconnect on at `autoconnect-priority` one above the original (so it wins
    the next time the device connects), no `timestamp`, the change applied, and
    `user.data["moire.copy-of"] = <original UUID>` as Moire's marker. `AddConnection`, then
    `ActivateConnection` on the same device (and, for Wi‑Fi, access point) replaces the shared
    connection there. The marker makes it idempotent: while the copy is active its proxy is
    edited in place (it is the user's own profile); if the shared profile is up again, the next
    change updates the same copy and activates it, never a second one. `user.data` has been in
    NetworkManager since 1.8, so no separate UUID map is kept.
  - _Secured shared Wi‑Fi:_ `GetSecrets` on a shared profile also needs `modify.system`, so its
    password can't be copied. `proxy.needsPassword` makes the proxy sheet ask for the Wi‑Fi
    password (checked as WPA2 or WPA3 for the profile's `key-mgmt`), stored with the copy
    (`psk-flags` 0, as Moire runs no secret agent). It is asked again whenever the shared
    profile is the one connected, which also mends a copy saved with a wrong password.
    Profiles whose secrets can't be typed here (802.1X/enterprise, WEP, mobile broadband and
    other types) aren't copied: `canChange` is false and the sheet says only an administrator
    can set the shared connection's automatic proxy.
  - _At login:_ NetworkManager connects a user's own profiles only while they're logged in, so
    after boot the shared profile is usually already up. Once per NetworkManager owner, the
    service switches each device running a shared profile it has a Moire copy of (autoconnect
    on) to the copy, a brief reconnect; a failure leaves the shared connection up.
  - _Forget on shared Wi‑Fi:_ not offered. NetworkManager has no per-user way to stop a shared
    profile connecting: a user copy with autoconnect off doesn't stop the original, and a manual
    disconnect blocks autoconnect only until the next activation or restart. So the details
    sheet says "Saved for everyone on this computer · Ask an administrator to remove it"
    (`canForget: false`), and the service refuses Forget without sending anything. When the
    user also has their own profile for the network (such as a proxy copy), Forget is offered
    as "Forget your copy · The shared one stays saved" and deletes only the user's profiles.
  - _VPNs:_ a shared VPN still connects and disconnects (`network-control`), but
    `canRemove: false` replaces Remove with "Shared with everyone on this computer".
  - With `modify.system` granted (a later decision, e.g. for `wheel` after re-authentication),
    shared profiles become editable in place and removable; no copy is made. The Polkit rules
    are unchanged by this, so `scripts/test-settings-policy.mjs` needs no new cases.
- **Residual risk:** as with every grant here, the YES covers any process of the active local
  user, not only the management service, and Polkit 127's `active` is UID-wide. Such a process
  can join or leave networks, scan, switch radios and add or change its own user's profiles; it
  cannot change shared profiles, turn networking off or start a hotspot.

**Bluetooth** needs no Polkit: BlueZ's D-Bus policy lets any local client call `org.bluez`. The
native image enables `hardware.bluetooth` (bluetoothd starts through `bluetooth.target` when a
controller appears; the UTM VM has none). The management service's Bluetooth adapter stays
read-only in production (no policy variable), so airplane mode can switch only while no
Bluetooth adapter is present.

Smokes: `vpn-config.smoke.ts`, `bluetooth-status.smoke.ts` and `prefs/tests/network-proxy.smoke.ts`
(pure); `network-manager.smoke.ts`, `bluez-bluetooth.smoke.ts` and `desktop-controls.smoke.ts`
(private dbus-daemon fakes; the NetworkManager fake covers user-owned in-place edits, the shared
wired copy, editing it again without a duplicate, the login switch, the Wi‑Fi copy asking for its
password, shared Forget and VPN removal refused, and another user's hidden profile);
`apps/core/settings/src/connections.smoke.tsx` (the pages, sheets and the file chooser import, the
"applies to you only" hint and password field, and the shared-network Forget and VPN states).
`scripts/test-network-controls.sh` runs them.

## Power & idle backend

The compositor now has an idle policy: dim, then screen off (DPMS), then lock, then suspend
through logind, each measured from the last key, pointer or touch input. Power profiles come from
power-profiles-daemon through the management service. Settings reads and writes everything
through one client, `@moire/system-management/power-settings`.

### Preferences

`settings.json` → `power` (`PowerSettings` in `@moire/prefs`). Durations are seconds and `null`
is "never". Each field accepts only the values in `POWER_CHOICES`; anything else falls back to
the default.

| Field                                | Choices (`POWER_CHOICES`)                      | Default                |
| ------------------------------------ | ---------------------------------------------- | ---------------------- |
| `dimAfterSeconds`                    | off, 30, 60, 120, 300                          | 120                    |
| `screenOffAfterSeconds.{ac,battery}` | never, 60, 120, 300, 600, 900, 1800            | AC 600, battery 300    |
| `lockAfterScreenOffSeconds`          | 0 (immediately), 60, 300, never                | 0                      |
| `lockOnSuspend`                      | boolean                                        | true                   |
| `suspendAfterSeconds.{ac,battery}`   | never, 900, 1800, 3600                         | AC never, battery 1800 |
| `lidCloseAction`                     | `suspend`, `power-off`, `nothing`              | `suspend`              |
| `powerButtonAction`                  | `suspend`, `power-off`, `nothing`, `ask`       | `ask`                  |
| `showBatteryPercentage`              | boolean                                        | false                  |
| `powerProfile`                       | `power-saver`, `balanced`, `performance`, null | null (system's)        |

Dimming is skipped when it would not come before screen off. `lockAfterScreenOffSeconds` counts
from screen off. The lid has no `ask`, since nobody can see a dialog with the lid shut. The
compositor reads the prefs live (it polls `settings.json` every second). Helpers:
`loadPowerSettings()`, `updatePowerSettings(patch)` and `applyPowerPatch(current, patch)`. The
per-source timeouts merge field by field. `showBatteryPercentage` is stored only; the panel does
not read it yet.

### Client API

```ts
import {
  connectPowerSettings, // Settings owns the bus connection
  observePowerSettings, // (bus, { store?, readTimeoutMs? }) on a caller-owned bus
  createFakePowerSettingsClient, // in-memory fake for UI smokes and the gallery
  POWER_CHOICES,
  type PowerSettingsClient,
  type PowerSettingsState,
  type IdleStatus,
  type PowerProfilesStatus,
} from "@moire/system-management/power-settings";

type PowerSettingsState = {
  settings: PowerSettings; // always present
  profiles: ServiceClientState<PowerProfilesStatus>; // management service
  idle: ServiceClientState<IdleStatus>; // compositor
};
// ServiceClientState<S> (settings-service.ts):
//   { kind: "loading" | "unavailable" | "error"; message } | { kind: "ready"; owner; revision; status: S }

type PowerProfilesStatus =
  | { kind: "unavailable" | "error"; message: string } // daemon not running: hide the row
  | {
      kind: "ready";
      profiles: readonly PowerProfile[]; // in POWER_CHOICES order; VMs offer power-saver, balanced
      active: PowerProfile;
      degraded: string | null; // "lap-detected", "high-operating-temperature"
    };

type IdleStatus = {
  state: "active" | "dimmed" | "off" | "locked"; // off wins over locked, locked over dimmed
  phase: "active" | "dimmed" | "off";
  locked: boolean;
  powerSource: "ac" | "battery"; // which column of timeouts is live
  inhibitors: { display: readonly string[]; suspend: readonly string[] }; // app ids; "audio"
  sleepBlocking: {
    // Apps that asked to keep the computer awake; `id` is the compositor's identity, or null
    requests: readonly {
      id: string | null;
      name: string;
      x11: boolean;
      allowed: boolean;
      holding: boolean;
    }[];
    lidHeld: boolean; // the lid is closed and an allowed app is keeping the computer awake
  };
  capabilities: {
    screenOff: boolean | null; // DPMS worked the last time; null until the screen has gone off
    lock: boolean; // true with the compositor's lock screen (docs/lock-screen.md)
    suspend: boolean; // logind CanSuspend == "yes"
    powerOff: boolean; // logind CanPowerOff == "yes"
    lidPresent: boolean; // UPower LidIsPresent
    lidAction: boolean; // Moire holds logind's lid inhibitor, so lidCloseAction applies
    powerButton: boolean; // the compositor handles the power key (always true)
  };
  lastError: string | null; // "suspend: Access denied", for the status line
};

type PowerSettingsClient = {
  readonly state: PowerSettingsState;
  subscribe(listener: (state: PowerSettingsState) => void): () => void; // calls at once
  update(patch: PowerSettingsPatch): Promise<PowerSettings>;
  setDimAfter(seconds: number | null): Promise<PowerSettings>;
  setScreenOffAfter(source: "ac" | "battery", seconds: number | null): Promise<PowerSettings>;
  setLockAfterScreenOff(seconds: number | null): Promise<PowerSettings>;
  setLockOnSuspend(enabled: boolean): Promise<PowerSettings>;
  setSuspendAfter(source: "ac" | "battery", seconds: number | null): Promise<PowerSettings>;
  setLidCloseAction(action: LidCloseAction): Promise<PowerSettings>;
  setPowerButtonAction(action: PowerButtonAction): Promise<PowerSettings>;
  setShowBatteryPercentage(show: boolean): Promise<PowerSettings>;
  setPowerProfile(profile: PowerProfile): Promise<SettingsResult>; // never rejects
  dispose(): Promise<void>;
};
```

`setPowerProfile` switches now and saves `powerProfile`; the service applies the saved choice
the next time the daemon appears in a session. Its failure codes: `permission` (polkit),
`invalid` (not offered here), `unavailable` (no daemon), `busy`, `failed`. The fake adds
`emitIdle`, `emitProfiles`, `setServiceState(service, kind)`, `failNext(code)` and `calls`.

UI guidance: hide "Lock after" and "Lock on suspend" while `capabilities.lock` is false. Show the
lid row only when `lidPresent`, and note "Handled by the system" when `!lidAction`. Hide the
"Power mode" row unless profiles are `ready`. While `inhibitors.display` is non-empty, a note can
say which app keeps the screen on.

### Wire

- **Compositor:** `org.moire.Display1`, `/org/moire/Idle1`, `org.moire.Idle1`. `GetStatus() → s`
  and the `Changed(s)` signal carry `{"revision":n,"status":IdleStatus}`.
- **Management service:** `org.moire.SystemManagement1`, `/org/moire/Power1`, `org.moire.Power1`.
  `GetStatus() → s` and `Changed(s)` carry `{"revision":n,"status":PowerProfilesStatus}`.
  `SetProfile(s)` fails with `org.moire.Power1.Error.<code>`.

### Behaviour

- **Activity and wake:** every key, pointer motion, button and scroll event counts as activity.
  The event that wakes a dark screen is still delivered to its client, so the first keypress is
  not lost. The one exception is the power key: if it wakes the screen, that press does nothing
  more.
- **Dim:** a black overlay at 55% fades in over 700 ms, in both the retained and the flat
  composition paths. There is no backlight control yet. Before DPMS the screen fades to black over
  450 ms. Undimming takes 160 ms. Reduce motion makes every fade instant.
- **Screen off:** DPMS through each connector's legacy `DPMS` property
  (`setKmsOutputPower` in `@moire/sys`). Composition stops while outputs are off, since inactive
  CRTCs cannot flip, so clients get no frame callbacks until the wake. A keypress during the fade
  cancels the power-off.
- **Inhibitors:**
  - `zwp_idle_inhibit_manager_v1` (v1) is advertised to desktop clients, not the greeter. An
    inhibitor counts while its surface is mapped and not minimized. It holds off dim, screen
    off, idle lock and suspend, and an inhibitor appearing wakes a dimmed screen. Releasing one
    restarts the timers from that moment.
  - Audio playback blocks only automatic suspend, rechecked every minute. It is read from
    `/proc/asound/card*/pcm*p/sub*/status` (`RUNNING`), and only when a suspend is due.
  - App inhibitors (`Idle1.Inhibit`, the portal's Inhibit): idle acts like the Wayland
    inhibitor, suspend holds off automatic suspend. A suspend inhibitor holds off the lid-close
    suspend only for an app on the user's allowlist (`power.sleepBlockers`, the "Apps that can
    keep this computer awake" list on this page), never a chosen Suspend, and nothing once the
    battery is critical. See [portals.md](portals.md), "Sleep blocking".
- **Suspend:** through logind's `Suspend(false)` after the timeout. A failure is reported in
  `lastError` and not retried until the next idle period. Resuming counts as activity.
- **logind hints:** `SetIdleHint` follows dim and off.
- **Power keys:** the compositor's exclusive keyboard grab already hides `KEY_POWER`,
  `KEY_SLEEP` and `KEY_SUSPEND` from logind, so the session acts on them itself.
  - Power key: follows `powerButtonAction`. `ask` calls the session's `askPowerAction` hook,
    which the shell does not provide yet, so `ask` behaves like `nothing` for now.
  - Sleep and suspend keys: suspend.
- **Lid:** the session holds a `handle-power-key:handle-suspend-key[:handle-lid-switch]`
  block inhibitor: logind's `Inhibit` over D-Bus returns a file descriptor, received close-on-exec
  through `@moire/sys/dbus-fds`, so the inhibitor dies with the compositor and never leaks into an
  app it starts. Lid state comes from UPower `LidIsClosed`. Moire acts on the lid only
  while it holds that inhibitor, and ignores it when more than one output is connected (docked).
  Otherwise logind's own defaults stay in charge. A lid-close suspend waits while an allowed app
  holds a suspend inhibitor, and happens when the last one goes.
- **Lock:** the compositor's lock screen ([lock-screen.md](lock-screen.md)) is the lock provider:
  `PowerSession({ lock, unlock })` and `setLocked()` from every lock and unlock, so
  `capabilities.lock` is true. Lock after screen off, lock on suspend (with a `sleep` delay
  inhibitor released only once a locked frame is on screen) and logind's `Lock`/`Unlock` all
  apply, and `SetLockedHint` follows. An untouched lock screen goes dark after 60 s.
- **Power actions:** Quick Settings › Power and the lock screen's power menu read one capability
  source, the power session's `capabilities` (`suspend`, `reboot`, `powerOff` from logind's
  `CanSuspend`/`CanReboot`/`CanPowerOff` answering `yes`; Idle1 carries `reboot` too). Each row
  shows only when allowed, and both call `PowerSession.requestPowerAction`, which calls logind's
  `Suspend`/`Reboot`/`PowerOff` with `interactive=false`. Suspend takes the idle suspend's path,
  so lock on suspend locks first (logind's `PrepareForSleep` waits on the delay inhibitor).
  In Quick Settings, Suspend runs at once; Restart and Shut down show a 10 s countdown with
  Cancel and "Restart"/"Shut down" now. Cancel, Escape, Back, closing the popup or locking drop
  it. The lock screen's menu acts on the choice directly.

### System configuration

`nix/moire-power-services.nix` is imported by the native desktop image. It enables
power-profiles-daemon and UPower (both started at boot, never D-Bus activated) and installs
`00-moire-power.rules`. For active local sessions only, that rule allows `login1.suspend`,
`login1.reboot`, `login1.power-off`,
`login1.inhibit-handle-{lid-switch,power-key,suspend-key}`, `login1.inhibit-delay-sleep` and
`PowerProfiles.switch-profile`. It does not allow the `*-multiple-sessions` and
`*-ignore-inhibit` variants, rebooting into firmware setup or a boot entry, hibernate, or the
block-mode `inhibit-block-sleep` (polkit cannot tell the compositor from an app, so no process
gets it; allowed apps are honoured inside the compositor instead).
`scripts/test-settings-policy.mjs` covers the grants and denials. logind.conf keeps its
defaults, which apply at the greeter and whenever the session's inhibitor is missing.

### Code

- `packages/prefs/src/power.ts`, `power-settings.ts`
- `packages/core/src/idle-policy.ts`: the pure state machine and fade
- `idle-controller.ts`: policy to outputs and hooks
- `output-power.ts`: DPMS gate and dim level
- `idle-inhibit.ts`
- `server.ts` hooks: `onUserActivity`, `setSystemKeyHandler`, `idleInhibitorReasons`,
  `outputPower`
- `packages/sys/src/kms-power.ts`
- `apps/system/compositor/src/power-session.ts`, `logind-power.ts`, `audio-activity.ts`
- `apps/system/management-service/src/power-profiles.ts`
- `packages/system-management/src/power-settings.ts`

### Verification

- **Smokes:**
  - `packages/core/src/idle-policy.smoke.ts`: timings per source, inhibitors, audio, activity,
    lock, sleep and fades with a fake clock.
  - `packages/core/src/idle-output.smoke.ts`: controller, DPMS and dim against fake outputs, and
    on a portable `CompositorServer`, the idle-inhibit wire protocol, activity and power-key
    routing, and the presentation gate.
  - `apps/system/management-service/src/power-profiles.smoke.ts`: a fake power-profiles-daemon
    on a private bus, end to end through the client.
  - `apps/system/compositor/src/power-session.smoke.ts`: fake logind and UPower on a private bus,
    Idle1 through the client, app inhibitors, the sleep-blocking allowlist (lid, explicit
    suspend, critical battery, revoking, impostors, portal app ids), logind's `Inhibit` (the
    descriptor itself on Linux only) and the ALSA probe.
  - `apps/system/compositor/src/sleep-blockers.smoke.ts`: who a request comes from.
  - `apps/core/settings/src/power.smoke.tsx`: the "keep awake" list and its switches.
  - `apps/system/compositor/src/lock-session.smoke.ts`: the lock screen's menu (restart included)
    and Quick Settings' suspend path in order: `Suspend`, locked, sleep delay released.
  - `packages/shell/src/power-actions.smoke.tsx`: the power view's rows by capability, suspend at
    once, the countdown's Cancel, confirm, expiry, Escape and lock, against a fake session.
- **Needs the VM:**
  - DPMS on virtio-gpu, and waking with the first keypress delivered.
  - The dim overlay on the EGL path.
  - logind `Inhibit` (handling block, sleep delay) under the new polkit rule.
  - `CanSuspend`, and an actual suspend and resume in UTM.
  - power-profiles-daemon's placeholder driver.
  - The power key reaching the compositor (the "Power Button" evdev device is grabbed).
