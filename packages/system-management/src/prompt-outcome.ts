/**
 * Why the compositor's password prompt answered polkit with `polkit.dismissed`
 * (docs/polkit-agent.md, "Why a request was dismissed").
 *
 * polkitd carries no reason: a mechanism learns only that the prompt was dismissed, whether a
 * person cancelled it or the prompt refused the request unseen. The compositor keeps the reason
 * for a short while, keyed by the process polkit named as the request's subject, and hands it
 * only to that process: `TakeDismissal(actionId)` on its session-bus name, answered for the
 * caller's own pid as the bus daemon reports it, and forgotten once read.
 */
import type { SessionBus } from "@moire/dbus";

/** The compositor's session-bus name, which owns the prompt's object. */
export const SECURE_PROMPT_BUS = "org.moire.Display1";
export const SECURE_PROMPT_PATH = "/org/moire/SecurePrompt1";
export const SECURE_PROMPT_INTERFACE = "org.moire.SecurePrompt1";

/**
 * - `refused`: never shown, or taken off the queue unseen (full queue, cancel cool-down, flood
 *   pause).
 * - `cancelled`: a person cancelled it.
 * - `timed-out`: 120 s without input.
 * - `locked`: the session locked while it was on screen.
 * - `withdrawn`: polkit withdrew it (the requester went away, or polkitd restarted).
 */
export type PromptDismissal = "refused" | "cancelled" | "timed-out" | "locked" | "withdrawn";

const DISMISSALS: readonly PromptDismissal[] = [
  "refused",
  "cancelled",
  "timed-out",
  "locked",
  "withdrawn",
];

export function promptDismissal(value: unknown): PromptDismissal | null {
  return DISMISSALS.includes(value as PromptDismissal) ? (value as PromptDismissal) : null;
}

/** Why this process's own dismissed request for `actionId` was dismissed; null if unknown. */
export type PromptDismissalLookup = (actionId: string) => Promise<PromptDismissal | null>;

/** Ask the compositor on `bus`. Null when it isn't reachable or kept no reason. */
export function compositorDismissalLookup(
  bus: SessionBus,
  timeoutMs = 2000,
): PromptDismissalLookup {
  return async (actionId) => {
    try {
      const reply = await bus.call(
        {
          destination: SECURE_PROMPT_BUS,
          path: SECURE_PROMPT_PATH,
          interface: SECURE_PROMPT_INTERFACE,
          member: "TakeDismissal",
          signature: "s",
          body: [actionId],
        },
        { timeoutMs },
      );
      return reply.signature === "s" ? promptDismissal(reply.body?.[0]) : null;
    } catch {
      return null;
    }
  };
}
