import assert from "node:assert/strict";
import { once } from "node:events";
import { parseDesktopCommand, spawnDesktopApp } from "./spawn";

assert.deepEqual(
  parseDesktopCommand(`program 'folder with spaces' "double quoted" '' plain\\ arg`),
  ["program", "folder with spaces", "double quoted", "", "plain arg"],
);
assert.deepEqual(parseDesktopCommand(`terminal --command 'printf '\\''hello world'\\'''`), [
  "terminal",
  "--command",
  "printf 'hello world'",
]);
assert.deepEqual(parseDesktopCommand(`program '$HOME $(touch forbidden)' "\\$VALUE"`), [
  "program",
  "$HOME $(touch forbidden)",
  "$VALUE",
]);
for (const command of ["", "'unterminated", "trailing\\"])
  assert.throws(() => parseDesktopCommand(command));
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const child = spawnDesktopApp({
  exec: `${quote(process.execPath)} -e ${quote("process.exit(process.argv[1] === 'quoted value' ? 0 : 9)")} ${quote("quoted value")}`,
});
assert.equal(
  (await once(child, "exit"))[0],
  0,
  "actual spawned child receives one quoted argument",
);
const missing = spawnDesktopApp({ exec: "/moire-nonexistent-executable-smoke" });
assert.ok(missing.listenerCount("error") > 0, "unobserved launch failure cannot crash compositor");
const [error] = await once(missing, "error");
assert.equal(error.code, "ENOENT");
console.log("Desktop command quoting and real child process launch smoke passed");
