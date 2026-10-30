/**
 * Test support: builds the stream shim (native/moire-pwring.c) against the fake libpipewire
 * (native/fake-pipewire/) with the host C compiler, so smokes can run real koffi streams whose
 * `process` is called from the fake's data thread. Point `MOIRE_PIPEWIRE_LIBRARY` and
 * `MOIRE_PWRING_LIBRARY` at the result before the first stream opens. Never used at runtime.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import { bindNativeFunction } from "./ffi";

export type FakePipeWireBuild = {
  /** The test's own temporary directory holding both libraries. */
  readonly directory: string;
  readonly pipewire: string;
  readonly pwring: string;
  remove(): void;
};

const native = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "native");

/** Compile the fake and the shim; null when there is no C compiler (callers print SKIP). */
export function buildFakePipeWire(cc = process.env.CC ?? "cc"): FakePipeWireBuild | null {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-pwring-"));
  const remove = () => fs.rmSync(directory, { recursive: true, force: true });
  const darwin = process.platform === "darwin";
  const ext = darwin ? "dylib" : "so";
  const pipewire = path.join(directory, `libpipewire-0.3.${ext}`);
  const pwring = path.join(directory, `libmoire-pwring.${ext}`);
  const flags = [
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-fPIC",
    "-I",
    path.join(native, "fake-pipewire"),
  ];
  const compile = (args: string[]): boolean => {
    const result = spawnSync(cc, args, { encoding: "utf8" });
    if (result.error) return false;
    assert.equal(result.status, 0, `${cc} failed: ${result.stderr}`);
    return true;
  };
  const built =
    compile([
      ...flags,
      darwin ? "-dynamiclib" : "-shared",
      path.join(native, "fake-pipewire", "fake-libpipewire.c"),
      ...(darwin ? ["-install_name", pipewire] : [`-Wl,-soname,${pipewire}`, "-lpthread"]),
      "-o",
      pipewire,
    ]) &&
    compile([
      ...flags,
      "-fvisibility=hidden",
      darwin ? "-dynamiclib" : "-shared",
      path.join(native, "moire-pwring.c"),
      `-L${directory}`,
      ...(darwin ? ["-lpipewire-0.3"] : [pipewire, `-Wl,-rpath,${directory}`, "-lm"]),
      "-o",
      pwring,
    ]);
  if (!built) {
    remove();
    return null;
  }
  return { directory, pipewire, pwring, remove };
}

/** The fake's test hooks (see the end of fake-libpipewire.c). */
export function fakePipeWireHooks(library: string) {
  const lib = koffi.load(library);
  return {
    sinkTake: bindNativeFunction<(dst: Uint8Array, max: number) => number | bigint>(
      lib,
      "size_t fake_pw_sink_take(void *dst, size_t max)",
    ),
    format: bindNativeFunction<(dst: Uint8Array, max: number) => number>(
      lib,
      "uint32_t fake_pw_format(void *dst, uint32_t max)",
    ),
    connectFlags: bindNativeFunction<() => number>(lib, "uint32_t fake_pw_connect_flags(void)"),
    connectDirection: bindNativeFunction<() => number>(lib, "int fake_pw_connect_direction(void)"),
    setCaptureAmplitude: bindNativeFunction<(amplitude: number) => void>(
      lib,
      "void fake_pw_set_capture_amplitude(float amplitude)",
    ),
    streamsAlive: bindNativeFunction<() => number>(lib, "int fake_pw_streams_alive(void)"),
    prop: bindNativeFunction<(key: string) => string | null>(
      lib,
      "const char *fake_pw_prop(const char *key)",
    ),
    failAll: bindNativeFunction<(fail: number) => void>(lib, "void fake_pw_fail_all(int fail)"),
  };
}
