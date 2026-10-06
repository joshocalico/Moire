/** Private descriptor fixtures only. No account/system/application catalog discovery. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSessionSelection, type SessionCatalogOptions } from "./session-catalog";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "moire-c55-catalog-"));
fs.chmodSync(root, 0o700);
const descriptorPath = path.join(root, "only.desktop");
const executableRoot = path.dirname(process.execPath);
const options: SessionCatalogOptions = {
  qualification: "fixture",
  descriptorPath,
  trustedRoots: [root],
  executableRoots: [executableRoot, root],
  searchPath: [executableRoot],
  uid: process.getuid?.(),
};
const quote = (value: string) =>
  `"${value.replaceAll("%", "%%").replace(/[\\"`$]/g, (character) => `\\${character}`)}"`.replaceAll(
    "\\",
    "\\\\",
  );
const valid = `[Desktop Entry]\nType=Application\nName=Moire fixture\nDesktopNames=Moire;\nExec=${quote(process.execPath)} --version\nTryExec=node\n`;
let cases = 0;
const write = (value: string | Buffer) => {
  fs.writeFileSync(descriptorPath, value, { mode: 0o600 });
  fs.chmodSync(descriptorPath, 0o600);
};
const rejects = async (value: string | Buffer, override: Partial<SessionCatalogOptions> = {}) => {
  write(value);
  await assert.rejects(
    loadSessionSelection({ ...options, ...override }),
    /Configured fixture session/,
  );
  cases++;
};
try {
  write(valid);
  const selection = await loadSessionSelection(options);
  assert.equal(selection.protocol, "wayland");
  assert.equal(selection.desktop, "Moire");
  assert.equal(selection.argv[0], fs.realpathSync(process.execPath));
  assert.equal(selection.id, `session-${selection.generation}`);
  assert.deepEqual(await loadSessionSelection(options), selection);
  cases++;
  const literal = "a 'quote' ; $(nothing) `none` | & > < * ? # ( ) ~ \\ tail";
  write(
    `[Desktop Entry]\nType=Application\nName=Moire %c ; & é\nExec=${quote(process.execPath)} ${quote(literal)} %c %k %i ${quote("100%")} empty-"not-concatenated"\nIcon=fixture-icon\n`,
  );
  await assert.rejects(loadSessionSelection(options));
  cases++;
  write(
    `[Desktop Entry]\nType=Application\nName=Moire %c ; & é\nExec=${quote(process.execPath)} ${quote(literal)} %c %k %i ${quote("100%")} ""\nIcon=fixture-icon\n`,
  );
  const fields = await loadSessionSelection(options);
  assert.deepEqual(fields.argv.slice(1), [
    literal,
    "Moire %c ; & é",
    fs.realpathSync(descriptorPath),
    "--icon",
    "fixture-icon",
    "100%",
    "",
  ]);
  cases++;
  write(`[Desktop Entry]\nType=Application\nName=Fixture\nExec=node %i\n`);
  assert.equal((await loadSessionSelection(options)).argv.length, 1);
  cases++;
  write(`[Desktop Entry]\nType=Application\nName=Fixture\nExec=node %i\nIcon=\n`);
  assert.equal((await loadSessionSelection(options)).argv.length, 1);
  cases++;
  for (const value of [
    valid.replace("Type=Application", "Type=Link"),
    valid + "Name=duplicate\n",
    valid + "[Desktop Action Extra]\nExec=node\n",
    valid + "[Desktop Entry]\n",
    valid + "Hidden=true\n",
    valid + "NoDisplay=true\n",
    valid + "Terminal=true\n",
    valid + "DBusActivatable=true\n",
    valid + "OnlyShowIn=Moire;\n",
    valid + "Path=/tmp\n",
    valid + "Name[en]=Localized\n",
    valid + "Actions=Other;\n",
    valid.replace("Name=Moire fixture\n", ""),
    valid.replace("Name=Moire fixture", "Name=   "),
    valid + "Comment=bad\\q\n",
    valid.replace(/Exec=.*\n/, ""),
    valid.replace("DesktopNames=Moire;", "DesktopNames=Moire;Other;"),
    valid.replace("TryExec=node", "TryExec=missing"),
    valid.replace("TryExec=node", "TryExec=node --argument"),
    valid.replace(/Exec=.*\n/, "Exec=node ; touch outside\n"),
    valid.replace(/Exec=.*\n/, "Exec=node 'single-quoted'\n"),
    valid.replace(/Exec=.*\n/, 'Exec=node "unterminated\n'),
    valid.replace(/Exec=.*\n/, 'Exec=node "raw$expansion"\n'),
    valid.replace(/Exec=.*\n/, 'Exec=node "raw`command`"\n'),
    valid.replace(/Exec=.*\n/, 'Exec=node "%c"\n'),
    valid.replace(/Exec=.*\n/, "Exec=node %f\n"),
    valid.replace(/Exec=.*\n/, "Exec=node %U\n"),
    valid.replace(/Exec=.*\n/, "Exec=node %x\n"),
    valid.replace(/Exec=.*\n/, "Exec=node embedded%i\n"),
    valid.replace(/Exec=.*\n/, "Exec=node trailing%\n"),
    valid.replace(/Exec=.*\n/, "Exec=node\\bad\n"),
    valid.replace(/Exec=.*\n/, "Exec=A=B\n"),
    valid.replace(/Exec=.*\n/, "Exec=./node\n"),
    valid + "Version=9\n",
    valid + "# harmless\nUnknown=unsupported\n",
    valid + "Comment=bad\0data\n",
  ])
    await rejects(value);
  await rejects(Buffer.from([0xff, 0xfe]));
  await rejects(valid, { searchPath: [] });
  await rejects(valid, { uid: (process.getuid?.() ?? 0) + 1 });
  await rejects(valid, { trustedRoots: [] });
  await rejects(valid, { trustedRoots: [executableRoot] });
  await rejects(valid, { executableRoots: [root] });
  write(valid);
  fs.chmodSync(descriptorPath, 0o666);
  await assert.rejects(loadSessionSelection(options));
  cases++;
  fs.chmodSync(descriptorPath, 0o600);
  fs.chmodSync(root, 0o777);
  await assert.rejects(loadSessionSelection(options));
  cases++;
  fs.chmodSync(root, 0o700);
  const realDescriptor = path.join(root, "real.desktop");
  fs.renameSync(descriptorPath, realDescriptor);
  fs.symlinkSync(realDescriptor, descriptorPath);
  await assert.rejects(loadSessionSelection(options));
  cases++;
  fs.unlinkSync(descriptorPath);
  fs.renameSync(realDescriptor, descriptorPath);
  const nested = path.join(root, "nested");
  fs.mkdirSync(nested, { mode: 0o777 });
  fs.chmodSync(nested, 0o777);
  const nestedDescriptor = path.join(nested, "other.desktop");
  fs.writeFileSync(nestedDescriptor, valid, { mode: 0o600 });
  await assert.rejects(loadSessionSelection({ ...options, descriptorPath: nestedDescriptor }));
  cases++;
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside, { mode: 0o700 });
  const linkExec = path.join(root, "node-link");
  fs.symlinkSync(process.execPath, linkExec);
  write(`[Desktop Entry]\nType=Application\nName=Fixture\nExec=${quote(linkExec)}\n`);
  await assert.rejects(loadSessionSelection(options));
  cases++;
  write(valid);
  const old = await loadSessionSelection(options);
  write(valid.replace("Name=Moire fixture", "Name=Changed fixture"));
  assert.notEqual((await loadSessionSelection(options)).generation, old.generation);
  cases++;
  const fake = path.join(root, "owned-command");
  fs.writeFileSync(fake, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  write(`[Desktop Entry]\nType=Application\nName=Fixture\nExec=${quote(fake)}\n`);
  const first = await loadSessionSelection(options);
  fs.appendFileSync(fake, "# changed identity\n");
  assert.notEqual((await loadSessionSelection(options)).id, first.id);
  cases++;
  fs.chmodSync(fake, 0o600);
  await assert.rejects(loadSessionSelection(options));
  cases++;
  write(valid);
  fs.appendFileSync(descriptorPath, "# " + "a".repeat(65_536));
  await assert.rejects(loadSessionSelection(options));
  cases++;
  process.stdout.write(
    `${JSON.stringify({ fixture: "session-catalog", actualExitCode: 0, actualCode: 0, cases, qualification: "fixture", scope: "One configured descriptor, strict direct-argv boundary and configured trust anchors only; no production/account/seat authentication." })}\n`,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
