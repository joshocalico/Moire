import assert from "node:assert/strict";
import {
  parseStorageSnapshot,
  parseStorageState,
  parseStorageVolumeId,
  StorageControlError,
} from "./storage-status";

const id = parseStorageVolumeId(":1.42|fixture-media");
const ready = {
  status: {
    kind: "ready",
    policy: "readonly",
    volumes: [
      {
        id,
        label: "Fixture drive",
        device: "/dev/fixture",
        sizeBytes: 4096,
        filesystem: "ext4",
        mount: { kind: "mounted", paths: ["/media/fixture"] },
        canEject: true,
      },
    ],
  },
  operation: { kind: "idle" },
};
assert.deepEqual(parseStorageState(ready), ready);
assert.deepEqual(parseStorageSnapshot(JSON.stringify({ revision: 7, ...ready })), {
  revision: 7,
  ...ready,
});
const parsed = parseStorageState(ready);
ready.status.volumes[0]!.label = "Changed after parse";
assert.equal(parsed.status.kind === "ready" && parsed.status.volumes[0]?.label, "Fixture drive");
const invalid: unknown[] = [
  null,
  [],
  {},
  { ...ready, operation: { kind: "retry" } },
  { ...ready, status: { ...ready.status, policy: "admin" } },
  {
    ...ready,
    status: { ...ready.status, volumes: [...ready.status.volumes, ...ready.status.volumes] },
  },
  { ...ready, status: { ...ready.status, volumes: Array(65).fill(ready.status.volumes[0]) } },
];
for (const input of invalid) assert.throws(() => parseStorageState(input));
for (const id of [null, "", "a\0b", "x".repeat(1025), 42])
  assert.throws(() => parseStorageVolumeId(id));
for (const paths of [[], ["relative"], ["/a\0b"], Array(9).fill("/media/a")]) {
  const volume = { ...ready.status.volumes[0], mount: { kind: "mounted", paths } };
  assert.throws(() =>
    parseStorageState({ ...ready, status: { ...ready.status, volumes: [volume] } }),
  );
}
for (const sizeBytes of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  const volume = { ...ready.status.volumes[0], sizeBytes };
  assert.throws(() =>
    parseStorageState({ ...ready, status: { ...ready.status, volumes: [volume] } }),
  );
}
for (const revision of [-1, 1.5, Infinity, 0x1_0000_0000])
  assert.throws(() => parseStorageSnapshot(JSON.stringify({ revision, ...ready })));
const unknown = {
  status: { kind: "unavailable", message: "Service disappeared" },
  operation: {
    kind: "unknown",
    id,
    action: "mount",
    code: "unknown",
    message: "Check actual state",
  },
};
assert.deepEqual(parseStorageState(unknown), unknown);
assert.throws(() => parseStorageSnapshot("x".repeat(8 * 1024 * 1024 + 1)));
assert.equal(
  new StorageControlError("permission", "Denied").errorName,
  "org.moire.Storage1.Error.permission",
);
console.log("storage-status boundary smoke passed");
