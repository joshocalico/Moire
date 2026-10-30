/**
 * The desktop session's polkit agent: the seam between the compositor server and
 * polkit-agent.ts. Only the desktop session calls this; the greeter's compositor has no agent.
 */
import type { SecurePrompts } from "@moire/core";
import { startPolkitAgent, type PolkitAgent, type PolkitAgentOptions } from "./polkit-agent";
import { createRequesterResolver } from "./polkit-requester";
import type { WaylandClientProcess } from "./sleep-blockers";

/** What the agent needs from the compositor server. */
type PromptHost = {
  clientProcesses(): readonly WaylandClientProcess[];
};

/**
 * The one place that knows what the server calls its compositor-owned secure prompt
 * (packages/core/src/secure-prompt.ts). Null when the server has none.
 */
export function securePromptsOf(server: object): SecurePrompts | null {
  return (server as { securePrompts?: SecurePrompts }).securePrompts ?? null;
}

/**
 * Register the agent for this session. Await it before starting any client: polkit allows one
 * agent per session, and being first is what keeps a user process out of that slot. Returns null
 * when the server has no secure prompt to show.
 */
export async function startSessionPolkitAgent(
  server: PromptHost,
  options: Pick<PolkitAgentOptions, "sessionUser" | "onStatus"> & {
    /** The compositor's own launch a process belongs to, with the app name it shows. */
    launchOf?: (pid: number) => { pid: number; name: string } | null;
  },
): Promise<PolkitAgent | null> {
  const prompts = securePromptsOf(server);
  if (!prompts) {
    console.log("polkit-agent: code=no-prompt action=-");
    return null;
  }
  return startPolkitAgent({
    sessionUser: options.sessionUser,
    onStatus: options.onStatus,
    prompts,
    resolveRequester: createRequesterResolver({
      clients: () => server.clientProcesses(),
      launchOf: options.launchOf,
    }),
  });
}
