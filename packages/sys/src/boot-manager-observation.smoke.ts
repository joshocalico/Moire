import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bootManagerProperties,
  parseBootManagerObservation,
  observeBootManager,
} from "./boot-manager-observation";
const unit = "moire-observer-test.service";
const fields = {
  Id: unit,
  LoadState: "loaded",
  ActiveState: "inactive",
  InvocationID: "",
  MainPID: "0",
  ControlPID: "0",
  ControlGroup: "",
  Job: "",
  ExecMainStartTimestampMonotonic: "0",
  ExecMainExitTimestampMonotonic: "0",
  ActiveEnterTimestampMonotonic: "0",
  ActiveExitTimestampMonotonic: "0",
  InactiveEnterTimestampMonotonic: "0",
  InactiveExitTimestampMonotonic: "0",
};
const text = () =>
  Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
assert.equal(parseBootManagerObservation(text(), unit).jobId, null);
for (const name of bootManagerProperties) {
  const missing = text()
    .split("\n")
    .filter((line) => !line.startsWith(name + "="))
    .join("\n");
  assert.throws(() => parseBootManagerObservation(missing, unit), /Missing/);
  assert.throws(() => parseBootManagerObservation(text() + `${name}=0\n`, unit), /duplicate/);
}
for (const [key, value] of [
  ["LoadState", "error"],
  ["ActiveState", "maintenance"],
  ["InvocationID", "bad"],
  ["ControlGroup", "/bad/../root"],
  ["Job", "0"],
  ["MainPID", "-1"],
  ["ControlPID", "4294967296"],
  ["ExecMainExitTimestampMonotonic", "18446744073709551616"],
]) {
  assert.throws(() =>
    parseBootManagerObservation(
      text().replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`),
      unit,
    ),
  );
}
assert.throws(() => parseBootManagerObservation(text() + "Unexpected=value\n", unit));
assert.throws(() => parseBootManagerObservation(text(), "different.service"));
const stamp = "18446744073709551615";
assert.equal(
  parseBootManagerObservation(
    text().replace("ExecMainStartTimestampMonotonic=0", `ExecMainStartTimestampMonotonic=${stamp}`),
    unit,
  ).timestamps[0],
  stamp,
  "uint64 remains exact rather than rounded number",
);
assert.equal(
  parseBootManagerObservation(text().replace("LoadState=loaded", "LoadState=not-found"), unit)
    .loadState,
  "not-found",
);
assert.throws(() =>
  parseBootManagerObservation(
    text().replace("LoadState=loaded", "LoadState=not-found").replace("Job=\n", "Job=123\n"),
    unit,
  ),
);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-manager-"));
try {
  const executable = path.join(fixture, "systemctl-fixture"),
    argvFile = path.join(fixture, "argv.json");
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(argvFile)},JSON.stringify(process.argv.slice(2))); process.stdout.write(${JSON.stringify(text())});`,
    { mode: 0o700 },
  );
  assert.equal((await observeBootManager(unit, executable)).activeState, "inactive");
  const argv: unknown = JSON.parse(fs.readFileSync(argvFile, "utf8"));
  assert.deepEqual(argv, [
    "--system",
    "--no-pager",
    "--no-ask-password",
    "show",
    "--all",
    ...bootManagerProperties.map((name) => `--property=${name}`),
    "--",
    unit,
  ]);
  fs.writeFileSync(executable, `#!${process.execPath}\nprocess.exitCode=3;`);
  await assert.rejects(observeBootManager(unit, executable), /observation failed/);
  fs.writeFileSync(executable, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(20000));`);
  await assert.rejects(observeBootManager(unit, executable));
  fs.writeFileSync(executable, `#!${process.execPath}\nsetTimeout(()=>{},10000);`);
  const start = performance.now();
  await assert.rejects(observeBootManager(unit, executable), /observation failed/);
  assert.ok(performance.now() - start < 4000, "real subprocess observation is bounded");
  console.log(
    "boot manager: complete/duplicate/invalid batches, exact uint64 timestamps, collected unit, actual readonly argv subprocess/error/output/time bounds PASS (systemctl fixture, no manager claim)",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
