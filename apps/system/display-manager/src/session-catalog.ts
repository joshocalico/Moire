/** One explicitly configured, device-free Wayland descriptor. No catalog enumeration.
 * This bounded subset rejects localized/unknown keys, file/URL field codes and leaf
 * symlinks; executable text is ASCII before %c/%k/%i expansion. Configured roots
 * are current-UID fixture trust anchors, not a privileged installed catalog.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loginId, type SessionSelection } from "./types";

export type SessionCatalogOptions = Readonly<{
  qualification: "fixture";
  descriptorPath: string;
  trustedRoots: readonly string[];
  executableRoots: readonly string[];
  searchPath: readonly string[];
  uid?: number;
}>;
export type FixedSessionLauncher = Readonly<{
  qualification: "fixture";
  path: string;
  trustedRoots: readonly string[];
  uid?: number;
}>;
const failure = () => new Error("Configured fixture session is unavailable or invalid");
const within = (file: string, root: string) =>
  file === root || file.startsWith(`${root}${path.sep}`);
export function fixtureUid(uid?: number): number {
  const actual = process.getuid?.();
  if (actual === undefined || (uid !== undefined && uid !== actual)) throw failure();
  return actual;
}
function absolute(value: string): string {
  if (!path.isAbsolute(value) || value.includes("\0")) throw failure();
  return path.resolve(value);
}
function directory(file: string, uid: number): fs.Stats {
  const stat = fs.lstatSync(file);
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o022) !== 0) throw failure();
  return stat;
}
/** Configured roots are explicit trust anchors; every descendant directory is checked. */
function trustedPath(file: string, roots: readonly string[], uid: number): string {
  if (!roots.length || roots.length > 8) throw failure();
  const requested = absolute(file),
    leaf = fs.lstatSync(requested);
  if (leaf.isSymbolicLink()) throw failure();
  const real = fs.realpathSync(requested);
  const anchors = roots.map((root) => {
    const canonical = fs.realpathSync(absolute(root));
    directory(canonical, uid);
    return canonical;
  });
  const anchor = anchors
    .filter((root) => within(real, root))
    .sort((a, b) => b.length - a.length)[0];
  if (!anchor) throw failure();
  let current = path.dirname(real);
  while (within(current, anchor)) {
    directory(current, uid);
    if (current === anchor) break;
    current = path.dirname(current);
  }
  return real;
}
function regular(file: string, uid: number, executable: boolean): fs.Stats {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.uid !== uid ||
    (stat.mode & 0o022) !== 0 ||
    (stat.mode & 0o6000) !== 0 ||
    (executable && (stat.mode & 0o100) === 0)
  )
    throw failure();
  return stat;
}
function identity(stat: fs.Stats): readonly number[] {
  return [stat.dev, stat.ino, stat.uid, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs];
}
export function verifyFixtureExecutable(file: string, roots: readonly string[], uid?: number) {
  const expected = fixtureUid(uid),
    canonical = trustedPath(file, roots, expected);
  return { path: canonical, identity: identity(regular(canonical, expected, true)) };
}
function readDescriptor(file: string, roots: readonly string[], uid: number) {
  if (!file.endsWith(".desktop")) throw failure();
  const canonical = trustedPath(file, roots, uid),
    before = regular(canonical, uid, false);
  if (before.size < 1 || before.size > 65_536) throw failure();
  const fd = fs.openSync(canonical, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (JSON.stringify(identity(before)) !== JSON.stringify(identity(opened))) throw failure();
    const bytes = fs.readFileSync(fd),
      after = fs.fstatSync(fd);
    if (
      bytes.length > 65_536 ||
      JSON.stringify(identity(opened)) !== JSON.stringify(identity(after))
    )
      throw failure();
    return { path: canonical, bytes, identity: identity(after) };
  } finally {
    fs.closeSync(fd);
  }
}
function decoded(value: string): string {
  let output = "";
  const escapes: Readonly<Record<string, string>> = {
    s: " ",
    n: "\n",
    t: "\t",
    r: "\r",
    "\\": "\\",
  };
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (character !== "\\") {
      output += character;
      continue;
    }
    const escaped = value[++index],
      replacement = escaped === undefined ? undefined : escapes[escaped];
    if (replacement === undefined) throw failure();
    output += replacement;
  }
  return output;
}
const supported = new Set([
  "Type",
  "Name",
  "Exec",
  "TryExec",
  "Icon",
  "Comment",
  "DesktopNames",
  "Hidden",
  "NoDisplay",
  "Terminal",
  "DBusActivatable",
  "Version",
]);
function entries(bytes: Uint8Array): Map<string, string> {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    .decode(bytes)
    .replace(/\r\n/g, "\n");
  if (/[\0\r\uFEFF]/.test(text)) throw failure();
  const values = new Map<string, string>();
  let section = false;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line === "[Desktop Entry]") {
      if (section) throw failure();
      section = true;
      continue;
    }
    if (!section) throw failure();
    const match = /^([A-Za-z][A-Za-z0-9-]*)=(.*)$/.exec(line);
    if (!match || !supported.has(match[1]!) || values.has(match[1]!)) throw failure();
    values.set(match[1]!, match[2]!);
  }
  if (!section || values.get("Type") !== "Application") throw failure();
  // oxlint-disable-next-line no-control-regex -- Reject decoded control bytes at the descriptor boundary.
  if (values.has("Comment") && /[\x00-\x1f\x7f]/.test(decoded(values.get("Comment")!)))
    throw failure();
  for (const key of ["Hidden", "NoDisplay", "Terminal", "DBusActivatable"]) {
    if (values.has(key) && values.get(key) !== "false") throw failure();
  }
  if (values.has("Version") && values.get("Version") !== "1.0") throw failure();
  return values;
}
type Token = Readonly<{ value: string; quoted: boolean }>;
/** Desktop Entry double quoting follows string unescaping; no shell expansion occurs. */
function execTokens(raw: string): readonly Token[] {
  if (!raw || raw.length > 16_384 || /[^\x20-\x7e]/.test(raw)) throw failure();
  const value = decoded(raw),
    tokens: Token[] = [];
  let index = 0;
  while (index < value.length) {
    while (value[index] === " ") index++;
    if (index === value.length) break;
    const quoted = value[index] === '"';
    let token = "",
      closed = !quoted;
    if (quoted) index++;
    while (index < value.length) {
      const character = value[index]!;
      if (quoted && character === '"') {
        index++;
        closed = true;
        break;
      }
      if (!quoted && character === " ") break;
      if (quoted && character === "\\") {
        const escaped = value[++index];
        if (escaped === undefined || !['"', "`", "$", "\\"].includes(escaped)) throw failure();
        token += escaped;
        index++;
        continue;
      }
      if (quoted && (character === "$" || character === "`")) throw failure();
      if (!quoted && /[\t\n\r"'\\><~|&;$*?#()`]/.test(character)) throw failure();
      token += character;
      index++;
    }
    if (!closed || (index < value.length && value[index] !== " ")) throw failure();
    tokens.push({ value: token, quoted });
    if (tokens.length > 128) throw failure();
  }
  if (!tokens.length || !tokens[0]!.value || tokens[0]!.value.includes("=")) throw failure();
  return tokens;
}
function plain(value: string | undefined, max = 512): string {
  if (value === undefined) throw failure();
  const result = decoded(value);
  // oxlint-disable-next-line no-control-regex -- Display labels and path fields cannot contain control bytes.
  if (!result.trim() || result.length > max || /[\x00-\x1f\x7f]/.test(result)) throw failure();
  return result;
}
function expanded(
  tokens: readonly Token[],
  name: string,
  descriptor: string,
  icon: string | undefined,
): readonly [string, ...string[]] {
  const argv: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (index === 0 && token.value.includes("%")) throw failure();
    if (token.value === "%i" && !token.quoted) {
      if (icon) argv.push("--icon", icon);
      continue;
    }
    if (token.value.includes("%i")) throw failure();
    let argument = "";
    for (let i = 0; i < token.value.length; i++) {
      const character = token.value[i]!;
      if (character !== "%") {
        argument += character;
        continue;
      }
      const code = token.value[++i];
      if (token.quoted && code !== "%") throw failure();
      if (code === "%") argument += "%";
      else if (code === "c") argument += name;
      else if (code === "k") argument += descriptor;
      else throw failure();
    }
    argv.push(argument);
    if (
      argument.length > 16_384 ||
      argv.reduce((total, item) => total + item.length + 1, 0) > 65_536
    )
      throw failure();
  }
  const [program, ...args] = argv;
  if (!program) throw failure();
  return [program, ...args];
}
function executable(value: string, options: SessionCatalogOptions, uid: number) {
  if (path.isAbsolute(value)) return verifyFixtureExecutable(value, options.executableRoots, uid);
  if (
    !/^[A-Za-z0-9._-]+$/.test(value) ||
    !options.searchPath.length ||
    options.searchPath.length > 16
  )
    throw failure();
  for (const directory of options.searchPath) {
    const candidate = path.join(absolute(directory), value);
    if (!fs.existsSync(candidate)) continue;
    return verifyFixtureExecutable(candidate, options.executableRoots, uid);
  }
  throw failure();
}
export async function loadSessionSelection(
  options: SessionCatalogOptions,
): Promise<SessionSelection> {
  try {
    if (options.qualification !== "fixture") throw failure();
    const uid = fixtureUid(options.uid),
      descriptor = readDescriptor(options.descriptorPath, options.trustedRoots, uid);
    const fields = entries(descriptor.bytes),
      name = plain(fields.get("Name")),
      desktopValue = fields.get("DesktopNames");
    const desktop = desktopValue === undefined ? "Moire" : plain(desktopValue).replace(/;$/, "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(desktop)) throw failure();
    const icon = fields.get("Icon") ? plain(fields.get("Icon")) : undefined;
    const tokens = execTokens(fields.get("Exec") ?? ""),
      argv = expanded(tokens, name, descriptor.path, icon);
    const program = executable(argv[0], options, uid);
    const tryExec = fields.has("TryExec")
      ? executable(plain(fields.get("TryExec")), options, uid)
      : null;
    const generation = createHash("sha256")
      .update(
        JSON.stringify({
          descriptor: descriptor.path,
          contents: createHash("sha256").update(descriptor.bytes).digest("hex"),
          descriptorIdentity: descriptor.identity,
          executable: program,
          tryExec,
        }),
      )
      .digest("hex");
    return {
      id: loginId(`session-${generation}`),
      generation,
      label: name,
      protocol: "wayland",
      desktop,
      descriptorPath: descriptor.path,
      argv: [program.path, ...argv.slice(1)],
    };
  } catch {
    throw failure();
  }
}
