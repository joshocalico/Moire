/** Device-free trusted selected-session launch, independent of shell-evaluated broker text.
 * Revalidation binds the selected generation immediately before ordinary path
 * spawning. It does not pin a kernel executable fd against concurrent root/owner
 * replacement, validate arbitrary interpreters, or establish privileged auth.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  verifyFixtureExecutable,
  type FixedSessionLauncher,
  type SessionCatalogOptions,
  loadSessionSelection,
} from "./session-catalog";
import { loginId, type BrokerLaunch, type LoginId, type SessionSelection } from "./types";

export function createBrokerLaunch(
  selection: SessionSelection,
  fixedLauncher: FixedSessionLauncher,
): BrokerLaunch {
  if (
    fixedLauncher.qualification !== "fixture" ||
    !/^session-[a-f0-9]{64}$/.test(selection.id) ||
    !/^[a-f0-9]{64}$/.test(selection.generation) ||
    selection.id !== `session-${selection.generation}`
  )
    throw new Error("Invalid fixture launch selection");
  const launcher = verifyFixtureExecutable(
    fixedLauncher.path,
    fixedLauncher.trustedRoots,
    fixedLauncher.uid,
  );
  // greetd joins command elements and shell-evaluates them. This fixed path is
  // quoted once; the only variable token is a restricted generation-bound ID.
  const quoted = `'${launcher.path.replaceAll("'", "'\\''")}'`;
  return { command: [quoted, selection.id], environment: [] };
}
const allowed = new Set([
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
]);
export function selectedSessionEnvironment(
  source: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!allowed.has(key) || value === undefined) continue;
    if (typeof value !== "string" || value.length > 4096 || /[\0\r\n]/.test(value))
      throw new Error("Invalid fixture session environment");
    result[key] = value;
  }
  // No process.env inheritance; display/greeter/notification/loader values never cross.
  return result;
}
export type SelectedSessionLaunchOptions = Readonly<{
  qualification: "fixture";
  catalog: SessionCatalogOptions;
  id: LoginId;
  generation: string;
  environment?: Readonly<Record<string, string | undefined>>;
  ipc?: boolean;
  signal?: AbortSignal;
  onSpawn?: (child: ChildProcess) => void;
}>;
export async function launchSelectedSession(
  options: SelectedSessionLaunchOptions,
): Promise<ChildProcess> {
  if (options.qualification !== "fixture" || options.signal?.aborted)
    throw new Error("Fixture session launch canceled");
  const requestedId = loginId(options.id),
    selection = await loadSessionSelection(options.catalog);
  if (selection.id !== requestedId || selection.generation !== options.generation)
    throw new Error("Fixture session selection changed");
  if (options.signal?.aborted) throw new Error("Fixture session launch canceled");
  const child = spawn(selection.argv[0], selection.argv.slice(1), {
    shell: false,
    env: selectedSessionEnvironment(options.environment),
    stdio: options.ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    signal: options.signal,
  });
  const ready = new Promise<ChildProcess>((resolve, reject) => {
    child.once("spawn", () => resolve(child));
    child.once("error", () => reject(new Error("Fixture session process could not start")));
  });
  options.onSpawn?.(child);
  return ready;
}
