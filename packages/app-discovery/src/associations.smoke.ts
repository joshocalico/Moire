import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildDesktopExec,
  discoverApplications,
  loadMimeAssociationDatabase,
  parseDesktopFile,
  resolveApplicationIcon,
} from "./index";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
if (process.argv[2] !== "--registered") {
  const result = spawnSync(
    "bash",
    [path.join(repository, "apps/system/session/register-apps.smoke.sh")],
    {
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "isolated registration/discovery fixture failed");
} else {
  const fixture = process.env.MOIRE_ASSOC_FIXTURE;
  assert.ok(fixture, "registered mode requires an isolated fixture");
  for (const key of [
    "HOME",
    "XDG_DATA_HOME",
    "XDG_DATA_DIRS",
    "XDG_CONFIG_HOME",
    "XDG_CONFIG_DIRS",
  ]) {
    const value = process.env[key];
    assert.ok(value && value.startsWith(`${fixture}${path.sep}`), `${key} must be inside fixture`);
  }
  const project = process.argv[3];
  assert.ok(project);
  const apps = discoverApplications("Moire");
  const expected = new Set<string>();
  const expectedOtherDesktop = new Set<string>(["user-editor.desktop"]);
  for (const group of ["bundled", "core", "developer"]) {
    const parent = path.join(project, "apps", group);
    for (const directory of fs.readdirSync(parent)) {
      const appDirectory = path.join(parent, directory);
      for (const file of fs.readdirSync(appDirectory).filter((name) => name.endsWith(".desktop"))) {
        if (file === "moire-unavailable.desktop") continue;
        expected.add(file);
        const source = fs.readFileSync(path.join(appDirectory, file), "utf8");
        const parsed = parseDesktopFile(source, file, "Moire");
        if (parseDesktopFile(source, file, "OtherDesktop")) expectedOtherDesktop.add(file);
        assert.ok(parsed, `${file} must parse as a visible Moire application`);
        if (parsed.icon?.startsWith("moire-")) {
          const icon = resolveApplicationIcon(parsed.icon);
          assert.ok(icon, `${file}: namespaced icon was not registered/resolved`);
          assert.equal(path.basename(icon), `${parsed.icon}.svg`);
          assert.ok(
            icon.startsWith(`${path.resolve(fixture)}${path.sep}`),
            `${file}: icon escaped fixture`,
          );
        }
        assert.equal(
          parsed.exec.split(/\s+/)[0],
          file.replace(/\.desktop$/, ""),
          `${file} must invoke its installed launcher`,
        );
        assert.deepEqual(
          apps.find((app) => app.id === file),
          parsed,
          `${file} discovery differs from source`,
        );
      }
    }
  }
  assert.ok(expected.size >= 25, "full utility suite must be registered");
  assert.deepEqual(
    new Set(apps.map((app) => app.id)),
    new Set([...expected, "user-editor.desktop"]),
  );
  assert.deepEqual(
    new Set(discoverApplications("OtherDesktop").map((app) => app.id)),
    expectedOtherDesktop,
  );

  const defaults: Record<string, string> = {
    "inode/directory": "files",
    "text/plain": "user-editor",
    "text/markdown": "editor",
    "text/x-log": "editor",
    "application/json": "editor",
    "image/png": "image-viewer",
    "image/jpeg": "image-viewer",
    "image/webp": "image-viewer",
    "image/gif": "image-viewer",
    "image/bmp": "image-viewer",
    "image/tiff": "image-viewer",
    "application/pdf": "document-viewer",
    "audio/mpeg": "music",
    "audio/flac": "music",
    "audio/ogg": "music",
    "audio/x-wav": "music",
    "audio/mp4": "music",
    "video/mp4": "video-player",
    "video/x-matroska": "video-player",
    "video/webm": "video-player",
    "video/quicktime": "video-player",
    "application/zip": "archive-manager",
    "application/x-tar": "archive-manager",
    "application/gzip": "archive-manager",
    "application/x-xz": "archive-manager",
    "application/x-bzip2": "archive-manager",
    "application/x-7z-compressed": "archive-manager",
    "font/ttf": "font-viewer",
    "font/otf": "font-viewer",
    "font/collection": "font-viewer",
    "application/x-font-ttf": "font-viewer",
    "application/x-font-opentype": "font-viewer",
  };
  const database = loadMimeAssociationDatabase(apps);
  for (const [mime, slug] of Object.entries(defaults)) {
    const id = slug === "user-editor" ? "user-editor.desktop" : `moire-${slug}.desktop`;
    assert.equal(database.snapshot().defaults.get(mime)?.[0], id, `${mime} registration default`);
    assert.equal(database.defaultApplicationForMime(mime)?.id, id, `${mime} discovery default`);
    assert.ok(
      apps.find((app) => app.id === id)?.mimeTypes?.includes(mime),
      `${mime} default must advertise that MIME`,
    );
  }
  const extensions: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tiff: "image/tiff",
    mp3: "audio/mpeg",
    flac: "audio/flac",
    ogg: "audio/ogg",
    wav: "audio/x-wav",
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    webm: "video/webm",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
    xz: "application/x-xz",
    bz2: "application/x-bzip2",
    "7z": "application/x-7z-compressed",
    ttf: "font/ttf",
    otf: "font/otf",
    ttc: "font/collection",
    m4a: "audio/mp4",
    mov: "video/quicktime",
    log: "text/x-log",
  };
  for (const [extension, mime] of Object.entries(extensions)) {
    assert.equal(database.mimeTypeForPath(path.join(fixture, `file.${extension}`)), mime);
    assert.ok(database.applicationsForMime(mime).length, `${extension} must have a suite handler`);
  }
  assert.equal(database.mimeTypeForPath(fixture), "inode/directory");
  assert.equal(
    database.mimeTypeForPath(path.join(fixture, "unknown.extension")),
    "application/octet-stream",
  );

  // Execute only a disposable argv recorder, never a suite application or user shell input.
  const recorder = path.join(fixture, "argument  recorder.sh");
  const output = path.join(fixture, "argv");
  fs.writeFileSync(recorder, '#!/bin/sh\nprintf "%s\\0" "$@" > "$MOIRE_ARGV_OUTPUT"\n', {
    mode: 0o700,
  });
  const files = [
    path.join(fixture, "Planning  draft's.txt"),
    path.join(fixture, "Second  document.pdf"),
  ];
  for (const code of ["%f", "%F", "%u", "%U", ""] as const) {
    const app = parseDesktopFile(
      `[Desktop Entry]\nType=Application\nName=Recorder\nExec="${recorder}" ${code}\n`,
      "recorder.desktop",
      "Moire",
    );
    assert.ok(app);
    const command = buildDesktopExec(app, files);
    const result = spawnSync("sh", ["-c", command], {
      env: { ...process.env, MOIRE_ARGV_OUTPUT: output },
    });
    assert.equal(
      result.status,
      0,
      `${code || "implicit files"} command failed: ${result.stderr.toString()}`,
    );
    const actual = fs.readFileSync(output, "utf8").split("\0").slice(0, -1);
    const requested =
      code === "%u" || code === "%U" ? files.map((file) => pathToFileURL(file).href) : files;
    assert.deepEqual(
      actual,
      code === "%f" || code === "%u" ? requested.slice(0, 1) : requested,
      `${code} preserves exact paths`,
    );
    if (!code) {
      const bare = spawnSync("sh", ["-c", app.exec], {
        env: { ...process.env, MOIRE_ARGV_OUTPUT: output },
      });
      assert.equal(bare.status, 0, "bare Exec preserves quoted executable path");
    }
  }
  console.log(
    "[app-discovery/associations-smoke] suite discovery, MIME defaults, existing choice and exact Exec argv passed",
  );
}
