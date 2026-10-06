import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Device-free verification of the installed, precompiled package, independent
// of workspace module resolution. A latch exits before any console/device IO.
const installed = process.argv[2];
assert.ok(installed && path.isAbsolute(installed), "Pass an absolute installed package path");
assert.equal(process.platform, "linux", "Installed native smoke requires Linux");
const runtime = path.join(installed, "lib/moire-boot");
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, "bundle-manifest.json"), "utf8"));
assert.equal(manifest.nativeTriplet, `linux_${process.arch}`);
assert.equal(fs.statSync(path.join(installed, "share/moire-boot/silk-fold.rgba")).size, 4096000);
assert.ok(fs.statSync(path.join(runtime, manifest.wasm)).size > 0, "Yoga embedded WASM is present");
const native = path.join(runtime, "node_modules/koffi/build/koffi");
assert.deepEqual(fs.readdirSync(native), [`linux_${process.arch}`]);
const fonts = fs.readdirSync(path.join(runtime, "fonts")).filter((name) => name.endsWith(".ttf"));
assert.equal(fonts.length, 5, "The current shared font engine requires all five font files");
const icons = fs.readdirSync(path.join(runtime, "icons")).filter((name) => name.endsWith(".svg"));
assert.ok(icons.length > 0);
for (const name of [
  "moire-boot",
  "moire-boot-cleanup",
  "moire-boot-smoke",
  "moire-boot-view-smoke",
  "moire-boot-managed-smoke",
  "moire-boot-service-smoke",
  "moire-boot-renderer-lifetime-smoke",
  "moire-boot-admission-smoke",
  "moire-boot-manager-smoke",
  "moire-boot-cleanup-cli-smoke",
  "moire-initial-startup",
  "moire-boot-initial-startup-smoke",
  "moire-boot-console-latch-smoke",
  "moire-boot-desktop-admission-smoke",
  "moire-boot-renderer-environment-smoke",
  "moire-boot-systemd-notify-smoke",
]) {
  const wrapper = fs.readFileSync(path.join(installed, "bin", name), "utf8");
  assert.doesNotMatch(wrapper, /tsx|esbuild|loader\.mjs|\/lib\/moire\//);
}
assert.deepEqual(fs.readdirSync(path.join(runtime, "node_modules")).sort(), [
  "koffi",
  "yoga-layout",
]);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-boot-installed-"));
try {
  const environment = { ...process.env };
  for (const [key, name] of Object.entries({
    HOME: "home",
    XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache",
    XDG_RUNTIME_DIR: "runtime",
  })) {
    environment[key] = path.join(fixture, name);
    fs.mkdirSync(environment[key], { mode: 0o700 });
  }
  for (const name of [
    "moire-boot-smoke",
    "moire-boot-view-smoke",
    "moire-boot-managed-smoke",
    "moire-boot-service-smoke",
    "moire-boot-renderer-lifetime-smoke",
    "moire-boot-admission-smoke",
    "moire-boot-manager-smoke",
    "moire-boot-cleanup-cli-smoke",
    "moire-boot-initial-startup-smoke",
    "moire-boot-console-latch-smoke",
    "moire-boot-desktop-admission-smoke",
    "moire-boot-renderer-environment-smoke",
    "moire-boot-systemd-notify-smoke",
  ]) {
    const result = spawnSync(path.join(installed, "bin", name), [], {
      env: environment,
      encoding: "utf8",
      timeout: 30000,
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    assert.equal(result.error, undefined, name);
    assert.equal(result.status, 0, name);
  }
  const latch = path.join(fixture, "console-requested");
  fs.writeFileSync(latch, "escape\n");
  const result = spawnSync(path.join(installed, "bin/moire-boot"), [], {
    env: { ...environment, MOIRE_BOOT_LATCH: latch },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /presentation skipped: console-requested/);
  assert.equal(result.stderr, "");
  const invalidCleanup = spawnSync(path.join(installed, "bin/moire-boot-cleanup"), ["--invalid"], {
    env: environment,
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(invalidCleanup.error, undefined);
  assert.equal(invalidCleanup.status, 1);
  assert.match(invalidCleanup.stderr, /Usage: moire-boot-cleanup/);
  const stateDirectory = path.join(fixture, "service-state");
  const ledgerEnvironment = {
    ...environment,
    MOIRE_BOOT_UNIT: "moire-installed-ledger.service",
    MOIRE_BOOT_SERVICE_STATE: stateDirectory,
    INVOCATION_ID: "e".repeat(32),
  };
  let ledgerBefore;
  for (let attempt = 0; attempt < 2; attempt++) {
    const initialized = spawnSync(
      path.join(installed, "bin/moire-boot-cleanup"),
      ["--init-ledger"],
      { env: ledgerEnvironment, encoding: "utf8", timeout: 5000 },
    );
    assert.equal(initialized.error, undefined);
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.equal(initialized.stderr, "");
    const ledger = fs.readFileSync(path.join(stateDirectory, "attempt.json"), "utf8");
    const parsed = JSON.parse(ledger);
    assert.deepEqual(parsed, {
      version: 1,
      bootId: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
      unit: "moire-installed-ledger.service",
      state: "never-attempted",
    });
    if (attempt === 0) ledgerBefore = ledger;
    else assert.equal(ledger, ledgerBefore, "initializer retains protected existing history");
  }
  assert.deepEqual(fs.readdirSync(stateDirectory), ["attempt.json"]);
  console.log(
    JSON.stringify({
      installed,
      precompiled: true,
      fonts: fonts.length,
      icons: icons.length,
      artworkBytes: 4096000,
      deviceIO: false,
      guardianEntryLatch: "passed",
      compiledLedgerInitialization: "passed twice in isolated state; no manager/device claim",
      nativeRecovery: "unverified",
      hardwareAnimation: "unfinished",
    }),
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
