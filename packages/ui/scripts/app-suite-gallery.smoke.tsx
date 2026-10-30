/* eslint-disable import/no-relative-parent-imports -- Integration gallery owns fixtures, not app dependencies. */
/** Render the shipped app components across every theme, width and UI scale. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import React, { type ReactNode } from "react";
import { PNG } from "pngjs";
import {
  createShellRoot,
  renderShell,
  collectHits,
  SoftwareRenderer,
  type SceneNode,
  type HitKeyEvent,
  type SoftwareFrame,
} from "@moire/react-host";
import { THEME_FAMILIES } from "@moire/theme";
import {
  installUiFonts,
  setUiScaleFactor,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  type WindowSize,
  type ImageData,
} from "@moire/ui";
import type { SystemSnapshot } from "@moire/system-management";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
const output = path.resolve(
  process.env.MOIRE_APP_GALLERY_DIR ??
    path.join(repository, "vm/verification/2026-10-02-app-suite/gallery"),
);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-app-gallery-"));
const environment = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"] as const;
const savedEnvironment = environment.map((name) => [name, process.env[name]] as const);
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
process.env.XDG_DATA_HOME = path.join(fixture, ".local/share");
process.env.XDG_CACHE_HOME = path.join(fixture, ".cache");
const realFetch = globalThis.fetch;
const networkAttempts: string[] = [];
globalThis.fetch = async (input) => {
  networkAttempts.push(String(input));
  throw new Error("Network requests are disabled in the app gallery");
};

const renderer = new SoftwareRenderer();
const textNodes = (node: SceneNode): string[] => [
  ...(node.kind === "text" && node.text ? [node.text] : []),
  ...node.children.flatMap(textNodes),
];
function nodes(node: SceneNode): SceneNode[] {
  return [node, ...node.children.flatMap(nodes)];
}
function key(code: number, value: string, text?: string): HitKeyEvent {
  return {
    code,
    key: value,
    text,
    repeat: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };
}
function press(root: SceneNode, label: string): void {
  const text = nodes(root).find((node) => node.kind === "text" && node.text === label);
  assert.ok(text, `App does not paint the ${label} label`);
  let x = text.width / 2,
    y = text.height / 2;
  for (let node: SceneNode | null = text; node; node = node.parent) {
    x += node.x;
    y += node.y;
  }
  const target = collectHits(root).find(
    (hit) =>
      hit.focusable &&
      hit.onPress &&
      x >= hit.x &&
      x <= hit.x + hit.width &&
      y >= hit.y &&
      y <= hit.y + hit.height,
  );
  assert.ok(target?.onPress, `App does not expose the ${label} control`);
  target.onPress({ x, y, localX: x - target.x, localY: y - target.y, button: "left" });
}
function typeAndSubmit(root: SceneNode, value: string): void {
  const target = collectHits(root).find((hit) => hit.autoFocus && hit.onKeyDown);
  assert.ok(target?.onKeyDown, "App has no initial keyboard text target");
  target.onKeyDown(key(0, value, value));
  // Controlled input handlers change after the React commit. The caller submits
  // separately after rendering that updated app tree.
}
function savePNG(frame: SoftwareFrame, filename: string): void {
  const png = new PNG({ width: frame.width, height: frame.height });
  for (let index = 0; index < frame.pixels.length; index += 4) {
    png.data[index] = frame.pixels[index + 2]!;
    png.data[index + 1] = frame.pixels[index + 1]!;
    png.data[index + 2] = frame.pixels[index]!;
    png.data[index + 3] = frame.pixels[index + 3]!;
  }
  fs.writeFileSync(path.join(output, filename), PNG.sync.write(png));
}
type GalleryContext = {
  root: ReturnType<typeof createShellRoot>;
  refresh: () => void;
  settle: (ready?: () => boolean) => Promise<void>;
};
type AppCase = {
  id: string;
  state: string;
  render: (size: WindowSize) => ReactNode;
  prepare?: (context: GalleryContext) => Promise<void>;
  ready?: (texts: string[]) => boolean;
  labels?: readonly string[];
  visibleText?: string;
};
type Finding = { app: string; configuration: string; message: string };
type RecordFrame = {
  app: string;
  state: string;
  configuration: string;
  nodes: number;
  hits: number;
  sha256: string;
  png?: string;
};
const findings: Finding[] = [];
const failures: Finding[] = [];
const records: RecordFrame[] = [];

try {
  await installUiFonts();
  fs.mkdirSync(output, { recursive: true });
  const [
    editor,
    notes,
    calculator,
    characters,
    dictionary,
    help,
    clock,
    calendar,
    weather,
    colors,
    screenshot,
    music,
    video,
    image,
    document,
    font,
    archive,
    recorder,
    monitor,
    disk,
    filesApp,
    noteStorage,
    dictionaryStorage,
    clockStorage,
    calendarStorage,
    weatherStorage,
    colorStorage,
    musicStorage,
  ] = await Promise.all([
    import("../../../apps/bundled/editor/src/main"),
    import("../../../apps/bundled/notes/src/main"),
    import("../../../apps/bundled/calculator/src/main"),
    import("../../../apps/bundled/characters/src/main"),
    import("../../../apps/bundled/dictionary/src/main"),
    import("../../../apps/bundled/help/src/main"),
    import("../../../apps/bundled/clock/src/main"),
    import("../../../apps/bundled/calendar/src/main"),
    import("../../../apps/bundled/weather/src/main"),
    import("../../../apps/bundled/colors/src/main"),
    import("../../../apps/bundled/screenshot/src/main"),
    import("../../../apps/bundled/music/src/main"),
    import("../../../apps/bundled/video-player/src/main"),
    import("../../../apps/bundled/image-viewer/src/main"),
    import("../../../apps/bundled/document-viewer/src/main"),
    import("../../../apps/bundled/font-viewer/src/main"),
    import("../../../apps/bundled/archive-manager/src/main"),
    import("../../../apps/bundled/sound-recorder/src/main"),
    import("../../../apps/core/process-manager/src/main"),
    import("../../../apps/bundled/disk-usage/src/main"),
    import("../../../apps/bundled/files/src/main"),
    import("../../../apps/bundled/notes/src/store"),
    import("../../../apps/bundled/dictionary/src/dictionary"),
    import("../../../apps/bundled/clock/src/backend"),
    import("../../../apps/bundled/calendar/src/events"),
    import("../../../apps/bundled/weather/src/weather"),
    import("../../../apps/bundled/colors/src/palettes"),
    import("../../../apps/bundled/music/src/library"),
  ]);
  const now = Date.parse("2026-10-02T02:30:00Z");
  // Seeded local metadata exercises populated library layout without starting audio.
  // Actual decoding, artwork import and playback are checked by Music's workflow smoke.
  const musicStore = new musicStorage.MusicLibraryStore(path.join(fixture, "music"));
  musicStore.save({
    revision: null,
    tracks: ["First light", "Soft geometry", "Leaves in the current"].map((title, index) => {
      const file = path.join(fixture, `${index + 1}.flac`);
      return {
        id: createHash("sha256").update(file).digest("hex"),
        path: file,
        title,
        artist: "Lumen",
        album: "Soft geometry",
        year: "2026",
        number: index + 1,
        duration: 180 + index * 30,
        addedAt: now,
        artwork: path.join(repository, "themes/default/botanical-wisteria.png"),
      };
    }),
  });
  const noteStore = new noteStorage.NotesStore(path.join(fixture, "notes"));
  noteStore.save({
    ...noteStorage.emptyNotebook(),
    notes: [
      {
        ...noteStorage.createNote(),
        id: "ideas",
        title: "A quiet desktop",
        body: "Make useful things.\nKeep the details clear.\n\n• Write\n• Explore\n• Create",
        updatedAt: now,
      },
      {
        ...noteStorage.createNote(),
        id: "garden",
        title: "Garden notebook",
        body: "Wisteria, sage, and the afternoon light.",
        updatedAt: now - 1000,
      },
    ],
  });
  const dictionaryService = new dictionaryStorage.DictionaryService(
    path.join(fixture, "dictionary"),
    async () =>
      new Response(
        JSON.stringify([
          {
            word: "moire",
            phonetic: "/mwɑːr/",
            meanings: [
              {
                partOfSpeech: "noun",
                definitions: [
                  {
                    definition: "A rippled or wavy appearance, especially in fabric.",
                    example: "The surface catches the light in a moire pattern.",
                  },
                ],
              },
            ],
          },
        ]),
      ),
  );
  await dictionaryService.lookup("moire");
  const alarmStore = new clockStorage.AlarmStore(path.join(fixture, "alarms.json"));
  alarmStore.write(
    [{ id: "tea", label: "Afternoon tea", time: "15:00", enabled: false, nextAtMs: now + 3600000 }],
    alarmStore.load(now).revision,
    now,
  );
  const calendarStore = new calendarStorage.CalendarStore(path.join(fixture, "events.json"));
  calendarStore.write(
    [
      {
        id: "review",
        title: "Desktop design review",
        startMs: now,
        endMs: now + 3600000,
        timeZone: "Australia/Adelaide",
        notes: "Review the app suite and keyboard workflows.",
      },
      {
        id: "walk",
        title: "A walk in the garden",
        startMs: now + 7200000,
        endMs: now + 9000000,
        timeZone: "Australia/Adelaide",
        notes: "Bring the camera.",
      },
    ],
    calendarStore.load().revision,
  );
  const paletteStore = new colorStorage.PaletteStore(path.join(fixture, "palettes.json"));
  paletteStore.write(
    [
      {
        id: "botanical",
        name: "Botanical",
        swatches: [
          { id: "wisteria", name: "Wisteria", hex: "#8A7AFF" },
          { id: "sage", name: "Sage", hex: "#8EA88B" },
          { id: "petal", name: "Petal", hex: "#EAB6CA" },
        ],
      },
    ],
    paletteStore.load().revision,
  );
  const weatherCache = new weatherStorage.WeatherCache(path.join(fixture, "weather.json"));
  weatherCache.write([
    {
      place: {
        id: "adelaide",
        name: "Adelaide",
        country: "Australia",
        latitude: -34.9,
        longitude: 138.6,
        timeZone: "Australia/Adelaide",
      },
      forecast: {
        fetchedAt: Date.now(),
        timeZone: "Australia/Adelaide",
        time: "2026-10-02T12:00",
        temperature: 21,
        feelsLike: 20,
        wind: 11,
        code: 2,
        days: [
          { date: "2026-10-02", min: 12, max: 23, rain: 10, code: 2 },
          { date: "2026-10-03", min: 13, max: 24, rain: 5, code: 0 },
          { date: "2026-10-04", min: 14, max: 20, rain: 45, code: 61 },
        ],
        // A day of hours from noon, so the hourly strip is laid out too.
        hours: Array.from({ length: 24 }, (_, hour) => ({
          time: `2026-10-0${hour < 12 ? 2 : 3}T${String((12 + hour) % 24).padStart(2, "0")}:00`,
          temperature: Math.round(21 + 3 * Math.sin((hour * Math.PI) / 12)),
          rain: hour === 6 ? 40 : 0,
          code: hour === 6 ? 61 : 2,
        })),
      },
    },
  ]);
  const [settings, settingsFixtures, prefs] = await Promise.all([
    import("../../../apps/core/settings/src/main"),
    import("../../../apps/core/settings/src/testing"),
    import("@moire/prefs"),
  ]);
  const settingsInitial = prefs.updateSettings({
    indexExcludes: [path.join(fixture, "Projects", "Archive")],
    indexIncludes: ["/run/media/ada/USB"],
  });
  const resultsFixture = settingsFixtures.settingsFixture(settingsInitial);
  const wiredFixture = settingsFixtures.settingsFixture(settingsInitial, {
    page: "network",
    desktop: settingsFixtures.wiredOnlySnapshot(),
  });
  const sampleImage: ImageData = { width: 360, height: 220, rgba: new Uint8Array(360 * 220 * 4) };
  for (let y = 0; y < sampleImage.height; y++)
    for (let x = 0; x < sampleImage.width; x++) {
      const offset = (y * sampleImage.width + x) * 4;
      sampleImage.rgba.set([70 + Math.round(x / 3), 65 + Math.round(y / 3), 155, 255], offset);
    }
  const diskFixture = path.join(fixture, "Projects");
  fs.mkdirSync(path.join(diskFixture, "Pictures"), { recursive: true });
  fs.mkdirSync(path.join(diskFixture, "Documents"));
  fs.writeFileSync(path.join(diskFixture, "Pictures", "sample.raw"), Buffer.alloc(90000, 4));
  fs.writeFileSync(
    path.join(diskFixture, "Documents", "notes.txt"),
    "A local fixture\n".repeat(80),
  );
  const systemSnapshot: SystemSnapshot = {
    totalMemoryBytes: 8 * 1024 ** 3,
    availableMemoryBytes: 5 * 1024 ** 3,
    swapTotalBytes: 2 * 1024 ** 3,
    swapFreeBytes: 2 * 1024 ** 3,
    processes: [
      {
        pid: 1101,
        name: "Text Editor",
        appId: "org.moire.Editor",
        command: "moire-editor",
        rssBytes: 52 * 1024 ** 2,
        cpuPercent: 0.8,
        protected: false,
      },
      {
        pid: 1102,
        name: "Files",
        appId: "org.moire.Files",
        command: "moire-files",
        rssBytes: 78 * 1024 ** 2,
        cpuPercent: 1.2,
        protected: false,
      },
      {
        pid: 1103,
        name: "Shell",
        appId: "org.moire.Shell",
        command: "moire-shell",
        rssBytes: 96 * 1024 ** 2,
        cpuPercent: 2.5,
        protected: true,
      },
    ],
  };
  const apps: AppCase[] = [
    {
      id: "editor",
      labels: ["Save"],
      state: "sample UTF-8 document",
      render: (size) => (
        <editor.EditorApp
          {...size}
          onClose={() => {}}
          initialDocument={{
            path: path.join(fixture, "Botanical notes.md"),
            text: "# Botanical notes\n\nA desktop for thoughtful work.\n\n- Clear typography\n- Useful tools\n- Gentle color\n",
            savedText: "",
            fingerprint: null,
          }}
        />
      ),
    },
    {
      id: "notes",
      labels: ["New note", "Save"],
      state: "two saved local notes",
      render: (size) => <notes.NotesApp {...size} store={noteStore} />,
      ready: (texts) => texts.includes("A quiet desktop"),
    },
    {
      id: "calculator",
      labels: ["Clear"],
      state: "typed expression and result",
      render: (size) => <calculator.CalculatorApp {...size} />,
      prepare: async ({ root, refresh }) => {
        typeAndSubmit(root.container, "2*(3+4)");
        refresh();
        const input = collectHits(root.container).find((hit) => hit.autoFocus && hit.onKeyDown);
        assert.ok(input?.onKeyDown);
        input.onKeyDown(key(28, "Enter"));
        refresh();
      },
      ready: (texts) => texts.includes("14"),
    },
    {
      id: "characters",
      labels: ["Copy"],
      state: "curated Unicode collection",
      render: (size) => <characters.CharactersApp {...size} />,
    },
    {
      id: "dictionary",
      labels: ["Look up"],
      state: "cached definition; network disabled",
      render: (size) => <dictionary.DictionaryApp {...size} service={dictionaryService} />,
      prepare: async ({ root, refresh, settle }) => {
        typeAndSubmit(root.container, "moire");
        refresh();
        const input = collectHits(root.container).find((hit) => hit.autoFocus && hit.onKeyDown);
        assert.ok(input?.onKeyDown);
        input.onKeyDown(key(28, "Enter"));
        await settle(() => textNodes(root.container).includes("Saved definition · offline ready"));
      },
      ready: (texts) => texts.includes("Saved definition · offline ready"),
    },
    {
      id: "help",
      state: "implemented desktop shortcuts",
      render: (size) => <help.HelpApp {...size} />,
    },
    {
      id: "clock",
      state: "fixed local clock with two world clocks; alarms disabled",
      render: (size) => (
        <clock.ClockApp
          {...size}
          store={alarmStore}
          cityStore={{ load: () => ["Asia/Tokyo", "Europe/London"], save: () => {} }}
          wallNow={() => now}
          monotonicNow={() => 1000}
          onRing={() => assert.fail("Idle gallery rang an alarm")}
        />
      ),
    },
    {
      id: "calendar",
      state: "two local events",
      render: (size) => <calendar.CalendarApp {...size} store={calendarStore} now={() => now} />,
    },
    {
      id: "weather",
      state: "fresh cached Adelaide forecast",
      render: (size) => (
        <weather.WeatherApp
          {...size}
          cache={weatherCache}
          client={new weatherStorage.WeatherClient()}
        />
      ),
      ready: (texts) => texts.some((text) => text.includes("Adelaide")),
    },
    {
      id: "colors",
      state: "saved botanical palette",
      render: (size) => <colors.ColorsApp {...size} store={paletteStore} copy={async () => {}} />,
    },
    {
      id: "screenshot",
      state: "supplied image; capture disabled",
      render: (size) => (
        <screenshot.ScreenshotApp
          {...size}
          initialImage={sampleImage}
          capture={async () => {
            assert.fail("Gallery attempted capture");
          }}
        />
      ),
    },
    {
      id: "music",
      state: "seeded local album metadata/artwork; playback not started",
      render: (size) => <music.MusicApp {...size} store={musicStore} />,
      prepare: async ({ root, refresh, settle }) => {
        await settle(() =>
          collectHits(root.container).some((hit) => hit.focusId === "music:albums"),
        );
        const albums = collectHits(root.container).find((hit) => hit.focusId === "music:albums");
        assert.ok(albums?.onKeyDown, "Music gallery has no album collection keyboard owner");
        // Arrow keys highlight an album; Enter opens it.
        albums.onKeyDown(key(108, "ArrowDown"));
        refresh();
        const highlighted = collectHits(root.container).find(
          (hit) => hit.focusId === "music:albums",
        );
        highlighted?.onKeyDown?.(key(28, "Enter"));
        refresh();
        await settle(() => textNodes(root.container).includes("Play album"));
      },
    },
    {
      id: "video-player",
      state: "idle; playback not started",
      render: (size) => <video.VideoPlayerApp {...size} />,
    },
    {
      id: "image-viewer",
      state: "idle file-open workflow",
      render: (size) => <image.ImageViewerApp {...size} />,
    },
    {
      id: "document-viewer",
      state: "idle PDF-open workflow",
      render: (size) => <document.DocumentViewerApp {...size} />,
    },
    {
      id: "font-viewer",
      state: "idle font-open workflow",
      render: (size) => <font.FontViewerApp {...size} />,
    },
    {
      id: "archive-manager",
      state: "idle create/extract workflow",
      render: (size) => <archive.ArchiveManagerApp {...size} />,
    },
    {
      id: "sound-recorder",
      state: "idle; recording not started",
      // A fixed input keeps the frame the same with or without PipeWire on the host.
      render: (size) => (
        <recorder.SoundRecorderApp
          {...size}
          probeInput={async () => ({ kind: "ready", name: "Built-in Microphone" })}
        />
      ),
    },
    {
      id: "system-monitor",
      state: "injected service snapshot",
      render: (size) => (
        <monitor.SystemMonitor
          {...size}
          client={{
            snapshot: async () => systemSnapshot,
            terminate: async () => {
              assert.fail("Gallery attempted process termination");
            },
          }}
        />
      ),
      ready: (texts) => texts.includes("Text Editor"),
    },
    {
      id: "disk-usage",
      visibleText: "entries ·",
      state: "scanned disposable fixture",
      // A folder given at launch is scanned straight away.
      render: (size) => <disk.DiskUsageApp {...size} initialPath={diskFixture} />,
      ready: (texts) =>
        texts.some((text) => text.includes("entries ·")) && texts.includes("Pictures"),
    },
    {
      id: "files",
      state: "disposable folder page with folders and files",
      // The disk usage fixture doubles as a folder of folders and files.
      render: (size) => <filesApp.FilesApp {...size} initialPath={diskFixture} onQuit={() => {}} />,
      ready: (texts) => texts.includes("Documents") && texts.includes("Projects"),
    },
    ...(
      [
        [
          "overview",
          "overview",
          "Overview tiles, quick toggles and recent changes",
          "Quick toggles",
        ],
        [
          "appearance",
          "appearance",
          "Appearance with the desktop preview and pictures",
          "Color scheme",
        ],
        ["network", "network", "Wi‑Fi networks and wired connections", "Halcyon-Guest"],
        ["bluetooth", "bluetooth", "Paired and nearby Bluetooth devices", "Pixel 8"],
        ["displays", "displays", "Display arrangement and modes", "Resolution"],
        ["keyboard", "keyboard", "Keyboard layouts, repeat and the pointer", "Repeat delay"],
        ["power", "power", "Battery, power mode and screen timeouts", "Turn the screen off"],
        ["users", "users", "Your account and other users", "Your picture"],
        ["search", "privacy", "Search & Privacy with a ready index", "Rebuild index"],
      ] as const
    ).map(([id, page, state, ready]) => {
      const fixture = settingsFixtures.settingsFixture(settingsInitial, { page });
      return {
        id: `settings-${id}`,
        state,
        render: (size: WindowSize) => <settings.SettingsApp {...size} {...fixture.props} />,
        ready: (texts: string[]) => texts.includes(ready),
      };
    }),
    {
      id: "settings-network-wired",
      state: "Wi‑Fi & Network on a wired-only computer with no Wi‑Fi adapter",
      render: (size: WindowSize) => <settings.SettingsApp {...size} {...wiredFixture.props} />,
      ready: (texts: string[]) => texts.includes("No Wi‑Fi adapter"),
    },
    {
      id: "settings-results",
      state: "Settings search results for “screen” with live controls",
      render: (size: WindowSize) => (
        <settings.SettingsApp
          {...size}
          {...resultsFixture.props}
          route={{ kind: "search", query: "screen" }}
        />
      ),
      ready: (texts: string[]) => texts.includes("Resolution"),
    },
  ];
  assert.equal(apps.length, 32);
  for (const family of THEME_FAMILIES)
    for (const scheme of ["dark", "light"] as const) {
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", {
          themeFamily: family,
          colorScheme: scheme,
          reducedMotion: true,
        }),
      );
      for (const scale of [1, 1.5])
        for (const width of [640, 1020]) {
          const height = Math.round(650 * scale);
          setUiScaleFactor(scale);
          const configuration = `${family}-${scheme}-${width}x${height}-scale${scale}`;
          for (const app of apps) {
            const root = createShellRoot();
            const tree = (
              <WidgetThemeProvider theme={theme}>
                {app.render({ width, height })}
              </WidgetThemeProvider>
            );
            const refresh = () => renderShell(root, tree);
            const settle = async (ready?: () => boolean) => {
              for (let attempt = 0; attempt < 100; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                refresh();
                if (!ready || ready()) return;
              }
              assert.fail(`${app.id}: sample state did not finish loading`);
            };
            try {
              refresh();
              await settle();
              await app.prepare?.({ root, refresh, settle });
              if (app.ready) await settle(() => app.ready!(textNodes(root.container)));
              const scene = nodes(root.container);
              for (const node of scene)
                for (const [name, value] of Object.entries({
                  x: node.x,
                  y: node.y,
                  width: node.width,
                  height: node.height,
                })) {
                  assert.ok(Number.isFinite(value), `${app.id}: non-finite ${name}`);
                  if (name === "width" || name === "height")
                    assert.ok(value >= 0, `${app.id}: negative ${name} ${value}`);
                }
              assert.ok(textNodes(root.container).length > 2, `${app.id}: empty app tree`);
              for (const label of app.labels ?? [])
                assert.ok(
                  textNodes(root.container).includes(label),
                  `${app.id}: clipped control label ${label}`,
                );
              if (app.id === "dictionary")
                assert.ok(
                  textNodes(root.container).join(" ").includes("The surface catches the light"),
                  "Dictionary clipped the supplied example",
                );
              if (app.visibleText) {
                const text = scene.find(
                  (node) => node.kind === "text" && node.text?.includes(app.visibleText!),
                );
                assert.ok(text, `${app.id}: required status text missing`);
                let y = 0;
                for (let node: SceneNode | null = text; node; node = node.parent) y += node.y;
                assert.ok(
                  y >= 0 && y + text.height <= height + 1,
                  `${app.id}: status text is clipped below the window (${y}+${text.height}>${height})`,
                );
              }
              const hits = collectHits(root.container);
              for (const hit of hits.filter(
                (hit) => hit.focusable && hit.focusScopeActive !== false,
              )) {
                const clip = hit.pointerClip;
                const x = Math.max(hit.x, clip?.x ?? hit.x),
                  y = Math.max(hit.y, clip?.y ?? hit.y);
                const right = Math.min(hit.x + hit.width, clip ? clip.x + clip.width : Infinity);
                const bottom = Math.min(hit.y + hit.height, clip ? clip.y + clip.height : Infinity);
                if (right <= x || bottom <= y) continue;
                if (x < -1 || y < -1 || right > width + 1 || bottom > height + 1)
                  findings.push({
                    app: app.id,
                    configuration,
                    message: `Focusable control exceeds window: ${Math.round(x)},${Math.round(y)}–${Math.round(right)},${Math.round(bottom)} (${hit.focusId})`,
                  });
              }
              const frame = renderer.render(root.container, { width, height });
              assert.equal(frame.pixels.length, width * height * 4);
              assert.ok(
                frame.pixels.some((value) => value !== 0),
                `${app.id}: blank frame`,
              );
              const selected =
                (family === "moire" &&
                  ((scheme === "dark" &&
                    ((width === 640 && scale === 1) || (width === 1020 && scale === 1.5))) ||
                    (scheme === "light" && width === 1020 && scale === 1))) ||
                (app.id === "calendar" && width === 640 && scale === 1);
              const png = selected ? `${app.id}-${configuration}.png` : undefined;
              if (png) savePNG(frame, png);
              records.push({
                app: app.id,
                state: app.state,
                configuration,
                nodes: scene.length,
                hits: hits.length,
                sha256: createHash("sha256").update(frame.pixels).digest("hex"),
                png,
              });
              if (
                app.id === "editor" &&
                family === "moire" &&
                scheme === "dark" &&
                width === 1020 &&
                scale === 1.5
              ) {
                const shortcut = collectHits(root.container).find((hit) => hit.onGlobalKeyDown);
                assert.ok(shortcut?.onGlobalKeyDown);
                shortcut.onGlobalKeyDown({ ...key(31, "s"), ctrlKey: true, shiftKey: true });
                await settle(() => textNodes(root.container).includes("Save document as"));
                savePNG(
                  renderer.render(root.container, { width, height }),
                  `editor-save-as-sheet-${configuration}.png`,
                );
              }
            } catch (error) {
              failures.push({
                app: app.id,
                configuration,
                message: error instanceof Error ? error.message : String(error),
              });
            } finally {
              renderShell(root, null);
            }
          }
          console.log(
            `[app-suite/gallery] ${configuration}: ${apps.length} actual app trees checked`,
          );
        }
    }
  const report = {
    apps: apps.map(({ id, state }) => ({ id, state })),
    frames: records.length,
    themes: THEME_FAMILIES.length * 2,
    widths: [640, 1020],
    scales: [1, 1.5],
    networkAttempts,
    failures,
    findings,
    records,
  };
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(
    `[app-suite/gallery] ${records.length} frames, ${records.filter((record) => record.png).length} PNGs, ${findings.length} overflow findings, ${failures.length} invalid states`,
  );
  assert.deepEqual(networkAttempts, [], "Gallery attempted a network request");
  assert.deepEqual(
    failures,
    [],
    "Gallery found invalid app trees or unloaded sample states; see report.json",
  );
  assert.equal(records.length, 32 * 10 * 2 * 2);
} finally {
  setUiScaleFactor(1);
  globalThis.fetch = realFetch;
  for (const [name, value] of savedEnvironment)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  fs.rmSync(fixture, { recursive: true, force: true });
}
