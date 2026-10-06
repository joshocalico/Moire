import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { identifyProcess, loadProcessCatalog } from "./main";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-process-identity-"));
const environment = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"] as const;
const previous = environment.map((key) => process.env[key]);
for (const key of environment) process.env[key] = fixture;
try {
  const directory = path.join(fixture, "apps/bundled/sample");
  await fs.mkdir(path.join(directory, "src"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "src/main.ts"),
    "import fs from 'node:fs'; console.log(JSON.stringify(process.platform === 'linux' ? fs.readFileSync('/proc/self/cmdline', 'utf8').split('\\0').filter(Boolean) : process.argv));\n",
  );
  await fs.writeFile(
    path.join(directory, "moire-sample.desktop"),
    `[Desktop Entry]
Name=Sample Workspace
Exec=moire-sample %U
StartupWMClass=org.example.SampleWorkspace
[Desktop Action Other]
Name=Incorrect Action Name
StartupWMClass=org.example.Wrong
`,
  );
  const cli = path.join(fixture, "tsx-cli.mjs");
  await fs.writeFile(cli, "");
  await fs.mkdir(path.join(fixture, "node_modules/.bin"), { recursive: true });
  await fs.symlink(cli, path.join(fixture, "node_modules/.bin/tsx"));
  const catalog = loadProcessCatalog(fixture);
  const identify = (argv: string[], cwd = directory) =>
    identifyProcess(argv, cwd, "fixture", catalog);
  const expected = {
    name: "Sample Workspace",
    appId: "org.example.SampleWorkspace",
    protected: false,
  };
  assert.deepEqual(identify(["node", "src/main.ts"]), expected);
  assert.deepEqual(
    identify(["tsx", "--tsconfig", "config.json", "src/main.ts", "/unrelated/music.mp3"]),
    expected,
  );
  assert.deepEqual(
    identify(["node", "--require", "preflight.cjs", "--import=loader.mjs", cli, "src/main.ts"]),
    expected,
  );
  assert.deepEqual(
    identify(["node", path.join(fixture, "node_modules/.bin/tsx"), "src/main.ts"]),
    expected,
  );
  assert.deepEqual(identify([path.join(directory, "moire-sample")]), expected);
  assert.deepEqual(identify(["bash", path.join(directory, "moire-sample")]), expected);
  assert.deepEqual(identify(["node", "../sample/src/main.ts"]), expected);
  for (const argv of [
    ["cat", "src/main.ts"],
    ["node", "/other/main.ts", path.join(directory, "src/main.ts")],
    ["node", "--eval", path.join(directory, "src/main.ts")],
    ["bash", "-c", path.join(directory, "moire-sample")],
    ["node", path.join(directory, "src/main.ts.backup")],
    [path.join(directory, "moire-sample-spoof")],
    ["sleep", "1"],
    ["node", "--require", path.join(directory, "src/main.ts"), "/other/main.ts"],
  ])
    assert.equal(identify(argv).appId, "", `Unrelated command misidentified: ${argv.join(" ")}`);
  assert.equal(
    identify(["sleep", "1"], path.join(fixture, "apps/system/compositor")).protected,
    false,
  );
  for (const [app, id] of [
    ["compositor", "org.moire.Compositor"],
    ["session", "org.moire.Session"],
    ["management-service", "org.moire.SystemManagement"],
    ["portal", "org.moire.Portal"],
  ]) {
    const identity = identify(["node", path.join(fixture, "apps/system", app, "src/main.ts")]);
    assert.equal(identity.appId, id);
    assert.equal(identity.protected, true);
    assert.equal(
      identify(["cat", path.join(fixture, "apps/system", app, "src/main.ts")]).protected,
      false,
    );
  }
  assert.equal(identify(["/usr/bin/Xwayland", ":0"]).protected, true);
  assert.equal(identify(["/usr/bin/dbus-daemon", "--session"]).protected, true);
  assert.equal(identify(["echo", "dbus-daemon"]).protected, false);
  assert.equal(identify(["/tmp/not-dbus-daemon"]).protected, false);

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const actualCatalog = loadProcessCatalog(root);
  const apps = [
    "editor",
    "notes",
    "calculator",
    "characters",
    "dictionary",
    "help",
    "calendar",
    "clock",
    "colors",
    "weather",
    "screenshot",
    "disk-usage",
    "image-viewer",
    "music",
    "archive-manager",
    "document-viewer",
    "video-player",
    "font-viewer",
    "sound-recorder",
  ];
  for (const app of apps) {
    const appDirectory = path.join(root, "apps/bundled", app);
    const desktop = await fs.readFile(path.join(appDirectory, `moire-${app}.desktop`), "utf8");
    const id = /^StartupWMClass=(.+)$/m.exec(desktop)?.[1];
    assert.ok(id);
    assert.equal(
      identifyProcess(["node", "src/main.tsx"], appDirectory, "node", actualCatalog).appId,
      id,
    );
    assert.equal(
      identifyProcess([path.join(appDirectory, `moire-${app}`)], "/", "bash", actualCatalog).appId,
      id,
    );
  }
  const loader = path.join(root, "apps/system/compositor/node_modules/tsx/dist/loader.mjs");
  for (const [executable, args] of [
    [process.execPath, ["--import", loader, path.join(directory, "src/main.ts")]],
    [path.join(root, "node_modules/.bin/tsx"), [path.join(directory, "src/main.ts")]],
  ] as const) {
    const raw: unknown = JSON.parse(
      execFileSync(executable, args, { encoding: "utf8", cwd: directory, timeout: 5_000 }),
    );
    assert.ok(Array.isArray(raw) && raw.every((value) => typeof value === "string"));
    assert.deepEqual(
      identifyProcess(raw, directory, "node", catalog),
      expected,
      "actual Node/tsx argv identifies fixture entrypoint",
    );
  }
  console.log(
    "[system-management/identity] 19 actual suite metadata identities, exact entrypoint/launcher matching, protected identities and unrelated argument/cwd regressions passed",
  );
} finally {
  environment.forEach((key, index) => {
    const value = previous[index];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  await fs.rm(fixture, { recursive: true, force: true });
}
