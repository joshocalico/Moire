/** Native owner opts in on its permitted device; no KMS registration or modeset. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { EglOutputScaler } from "./egl-output";
import { GbmDevice, openOwnedGbmImporter } from "./gbm";
import { openPath, closeFd, O_CLOEXEC, O_RDWR } from "./libc";

const node = process.env.MOIRE_RENDER_NODE;
if (process.platform !== "linux" || !node) {
  console.log("SKIP native GBM independent reopen: Linux and explicit MOIRE_RENDER_NODE required");
} else {
  const fd = openPath(node, O_RDWR | O_CLOEXEC);
  const describe = (descriptor: number) => {
    const info = fs.readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8");
    return {
      fd: descriptor,
      rdev: fs.fstatSync(descriptor).rdev,
      clientId: /^drm-client-id:\s*(\d+)/m.exec(info)?.[1] ?? null,
      fdinfo: info,
    };
  };
  let scaler: EglOutputScaler | null = null;
  let importer: GbmDevice | null = null;
  let importFd: number | null = null;
  const rejected: string[] = [];
  try {
    scaler = new EglOutputScaler(fd);
    importer = openOwnedGbmImporter(fd, {
      open(path, flags) {
        if (path.startsWith("/dev/dri/renderD")) {
          rejected.push(path);
          throw new Error("fixture rejects render candidates without mutating devices");
        }
        assert.equal(path, `/proc/self/fd/${fd}`);
        return openPath(path, flags);
      },
      close: closeFd,
      create(ownedFd) {
        importFd = ownedFd;
        return new GbmDevice(ownedFd, ownedFd);
      },
    });
    assert.deepEqual(rejected, ["/dev/dri/renderD128", "/dev/dri/renderD129"]);
    assert.notEqual(importFd, fd);
    assert.ok(importFd !== null);
    const ownedImportFd = importFd;
    const producer = describe(fd),
      consumer = describe(importFd);
    assert.equal(consumer.rdev, producer.rdev, "reopen retains exact device identity");
    if (producer.clientId !== null && consumer.clientId !== null)
      assert.notEqual(consumer.clientId, producer.clientId, "fresh DRM file identity");
    console.log(
      JSON.stringify({
        event: "gbm-import-native-topology",
        node,
        producer,
        consumer,
        clientIdentity:
          producer.clientId !== null && consumer.clientId !== null
            ? "measured-distinct"
            : "unavailable",
        scope:
          "actual proc reopen; render candidates rejected only at open boundary; not physical render-node unavailability or primary-only qualification",
      }),
    );
    for (const { color, width, height } of [
      { color: 0, width: 128, height: 32 },
      { color: 0xff000000, width: 128, height: 32 },
      { color: 0xff3167ad, width: 97, height: 33 },
      { color: 0, width: 256, height: 40 },
      { color: 0xff000000, width: 128, height: 32 },
    ]) {
      const frame = scaler.renderClientComposition("reopen-ownership", {
        width,
        height,
        clearColor: color,
        layers: [],
      });
      assert.ok(frame);
      assert.equal(frame.format, color >>> 24 === 255 ? 0x34325258 : 0x34325241);
      try {
        const owned = scaler.snapshotDmabuf({
          width: frame.width,
          height: frame.height,
          format: frame.format,
          plane: { fd: frame.fd, offset: 0, stride: frame.stride, modifier: frame.modifier },
        });
        try {
          const pixels = owned.readbackPixels();
          assert.equal(pixels.length, frame.width * frame.height * 4);
          for (let i = 0; i < pixels.length; i += 4)
            assert.deepEqual(
              Array.from(pixels.subarray(i, i + 4)),
              [color & 255, (color >>> 8) & 255, (color >>> 16) & 255, color >>> 24],
              "canonical GPU bytes before map/retirement",
            );
        } finally {
          owned.destroy();
        }
        const mapped = importer.mapImport({ ...frame, offset: 0 });
        assert.ok(mapped, "actual independent import/map required");
        for (let y = 0; y < frame.height; y++) {
          const row: DataView = new DataView(
            mapped.pixels.buffer,
            mapped.pixels.byteOffset + y * mapped.stride,
          );
          for (let x = 0; x < frame.width; x++) {
            const actual = row.getUint32(x * 4, true);
            assert.equal(
              frame.format === 0x34325258 ? actual & 0xffffff : actual,
              frame.format === 0x34325258 ? color & 0xffffff : color,
            );
          }
        }
      } finally {
        importer.releaseImport(frame.fd);
        scaler.releaseClientFrame(frame.id);
      }
    }
    importer.destroy();
    assert.throws(() => fs.fstatSync(ownedImportFd), { code: "EBADF" });
    const replacementFds: number[] = [];
    try {
      let reused: number | null = null;
      for (let attempt = 0; attempt < 32; attempt++) {
        const replacement = openPath(node, O_RDWR | O_CLOEXEC);
        replacementFds.push(replacement);
        if (replacement === importFd) {
          reused = replacement;
          break;
        }
      }
      assert.equal(reused, importFd, "fixture must actually recycle former owned descriptor");
      assert.ok(reused !== null);
      importer.destroy();
      fs.fstatSync(reused);
      fs.fstatSync(fd);
      const next = scaler.renderClientComposition("reopen-ownership", {
        width: 128,
        height: 32,
        clearColor: 0xffb34519,
        layers: [],
      });
      assert.ok(next);
      try {
        const owned = scaler.snapshotDmabuf({
          width: next.width,
          height: next.height,
          format: next.format,
          plane: { fd: next.fd, offset: 0, stride: next.stride, modifier: next.modifier },
        });
        try {
          const pixels = owned.readbackPixels();
          assert.equal(pixels.length, next.width * next.height * 4);
          for (let i = 0; i < pixels.length; i += 4)
            assert.deepEqual(
              Array.from(pixels.subarray(i, i + 4)),
              [25, 69, 179, 255],
              "producer survives importer destruction and repeated close",
            );
        } finally {
          owned.destroy();
        }
      } finally {
        scaler.releaseClientFrame(next.id);
      }
      assert.throws(() => importer?.mapImport({ ...next, offset: 0 }), /destroyed/);
    } finally {
      for (const replacement of replacementFds) closeFd(replacement);
    }
    console.log(
      `Native production GBM selection helper same-device proc reopen, five strict color/alpha/size transitions, producer survival and repeated destroy with fd reuse PASS on ${scaler.info.glRenderer}; DRM client identity ${producer.clientId !== null && consumer.clientId !== null ? "measured distinct" : "unavailable"}; no hardware/scanout claim`,
    );
  } finally {
    importer?.destroy();
    scaler?.destroy();
    closeFd(fd);
  }
}
