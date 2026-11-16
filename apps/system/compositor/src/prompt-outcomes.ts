/**
 * Why the secure prompt dismissed a polkit request, for the process the request was for and
 * nobody else (docs/polkit-agent.md, "Why a request was dismissed").
 *
 * polkitd tells a mechanism only `polkit.dismissed`. The agent records the reason here under
 * polkit's `polkit.subject-pid` (the kernel's pid for the subject, which polkitd took from the
 * system bus daemon) and the action id. `TakeDismissal(actionId)` on the session bus answers
 * from the record for the caller's own pid, which the session bus daemon reports, never the
 * caller. So a process learns only about requests polkit made on its behalf: never another
 * app's prompt activity, nor whether a prompt is open.
 *
 * - **Pid reuse:** a record also holds the process's start time, and is answered only to a
 *   process with the same pid and start time. A process whose start time can't be read gets
 *   no record.
 * - **Bounded:** a record lives 60 s and is forgotten once read; at most 32 are kept.
 * - **What the caller learns:** a reason for a request it made and already knows was dismissed.
 */
import { DbusRemoteError, type SessionBus } from "@moire/dbus";
import {
  SECURE_PROMPT_INTERFACE,
  SECURE_PROMPT_PATH,
  type PromptDismissal,
} from "@moire/system-management/prompt-outcome";
import { busPeerPid, procInspector } from "./sleep-blockers";

const RECORD_MS = 60_000;
const MAX_RECORDS = 32;
const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

type Entry = {
  pid: number;
  startTime: number;
  actionId: string;
  dismissal: PromptDismissal;
  at: number;
};

export type PromptOutcomes = {
  /** The agent dismissed a request whose polkit subject is `pid`. */
  record(pid: number, actionId: string, dismissal: PromptDismissal): void;
  /** The newest reason recorded for `pid` and `actionId`, removed; null if none. */
  take(pid: number, actionId: string): PromptDismissal | null;
};

export function createPromptOutcomes(
  options: {
    now?: () => number;
    /** The process's start time, to tell a reused pid apart; `/proc/<pid>/stat` by default. */
    startTime?: (pid: number) => number | null;
  } = {},
): PromptOutcomes {
  const now = options.now ?? (() => performance.now());
  const startTime = options.startTime ?? ((pid) => procInspector.startTime?.(pid) ?? null);
  let entries: Entry[] = [];
  const prune = () => {
    const cutoff = now() - RECORD_MS;
    entries = entries.filter((entry) => entry.at >= cutoff);
  };
  return {
    record(pid, actionId, dismissal) {
      if (!Number.isSafeInteger(pid) || pid <= 1 || !ACTION_ID.test(actionId)) return;
      const started = startTime(pid);
      if (started === null) return;
      prune();
      entries.push({ pid, startTime: started, actionId, dismissal, at: now() });
      if (entries.length > MAX_RECORDS) entries = entries.slice(-MAX_RECORDS);
    },
    take(pid, actionId) {
      prune();
      const started = startTime(pid);
      if (started === null) return null;
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]!;
        if (entry.pid !== pid || entry.actionId !== actionId) continue;
        entries.splice(index, 1);
        // A record for an earlier process with this pid is dropped, never answered.
        if (entry.startTime === started) return entry.dismissal;
      }
      return null;
    },
  };
}

/**
 * Export `org.moire.SecurePrompt1` on `bus`: `TakeDismissal(s actionId) -> s`, the reason or
 * an empty string. Answered for the sender's own pid as the bus daemon reports it.
 */
export function exportPromptOutcomes(
  bus: SessionBus,
  outcomes: PromptOutcomes,
  options: { peerPid?: (bus: SessionBus, sender: string) => Promise<number> } = {},
): () => void {
  const peerPid = options.peerPid ?? ((target, sender) => busPeerPid(target, sender));
  return bus.exportObject(SECURE_PROMPT_PATH, {
    name: SECURE_PROMPT_INTERFACE,
    methods: {
      TakeDismissal: {
        inSignature: "s",
        outSignature: "s",
        handler: async ({ message, body }) => {
          const actionId = body[0];
          if (message.signature !== "s" || typeof actionId !== "string")
            throw new DbusRemoteError("org.freedesktop.DBus.Error.InvalidArgs", "Invalid action");
          const sender = message.sender;
          const pid = sender ? await peerPid(bus, sender).catch(() => Number.NaN) : Number.NaN;
          if (!Number.isSafeInteger(pid) || pid <= 1) return { body: [""] };
          return { body: [outcomes.take(pid, actionId) ?? ""] };
        },
      },
    },
  });
}
