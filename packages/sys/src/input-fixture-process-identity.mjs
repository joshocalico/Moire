import fs from "node:fs";
import path from "node:path";

const LIMIT = 16384;
const OPTIONS = new Set(["--import", "--loader", "--experimental-loader"]);

/** Select Node's executed script, never a loader value or later document argument. */
export function parseNodeScriptCmdline(bytes, cwd) {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.length ||
    bytes.length > LIMIT ||
    bytes[bytes.length - 1] !== 0 ||
    typeof cwd !== "string" ||
    !path.isAbsolute(cwd) ||
    path.normalize(cwd) !== cwd ||
    /[\0\r\n]/.test(cwd)
  )
    throw new Error("Invalid bounded Node command line/cwd");
  const argv = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0");
  argv.pop();
  if (argv.length > 64 || !argv[0] || path.basename(argv[0]) !== "node")
    throw new Error("Expected bounded Node argv");
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--") {
      const script = argv[index + 1];
      if (!script || script === "-" || /[\r\n]/.test(script))
        throw new Error("Missing Node script");
      return path.resolve(cwd, script);
    }
    if (argument.startsWith("-")) {
      const equals = argument.indexOf("=");
      const option = equals < 0 ? argument : argument.slice(0, equals);
      if (!OPTIONS.has(option)) throw new Error("Unsupported Node option");
      const value = equals < 0 ? argv[++index] : argument.slice(equals + 1);
      if (!value || value.startsWith("-") || /[\r\n]/.test(value))
        throw new Error("Missing Node option value");
      continue;
    }
    if (!argument || /[\r\n]/.test(argument)) throw new Error("Missing Node script");
    return path.resolve(cwd, argument);
  }
  throw new Error("Missing Node script");
}

/** Read only proc command-line metadata; resolve the executed script canonically. */
export function readProcessEntryPoint(pid, cwd) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid process PID");
  const fd = fs.openSync(`/proc/${pid}/cmdline`, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    return fs.realpathSync(parseNodeScriptCmdline(bytes.subarray(0, length), cwd));
  } finally {
    fs.closeSync(fd);
  }
}
