/**
 * Client for polkit's `polkit-agent-helper-1` in its socket-activated form
 * (`/run/polkit/agent-helper.socket`, polkit 126 and later). See docs/polkit-agent.md, "The helper
 * protocol": pinned against polkit 127's helper and polkitd.
 *
 * The helper is root code Moire does not write. It takes this process's uid from the socket
 * (SO_PEERCRED and a pidfd), runs PAM service `polkit-1` for the named account and, on success,
 * tells polkitd itself. This side only learns the verdict.
 *
 * Wire form, as bytes: `account\n` `cookie\n`, then lines from the helper (`PAM_PROMPT_ECHO_OFF
 * <text>`, `PAM_PROMPT_ECHO_ON <text>`, `PAM_ERROR_MSG <text>`, `PAM_TEXT_INFO <text>`, and last
 * `SUCCESS` or `FAILURE`), each prompt answered with the answer bytes and a newline. The unit
 * leaves the helper's stderr on the same socket (systemd's StandardError=inherit), so its own
 * `polkit-agent-helper-1: ...` diagnostics arrive as lines too. Nothing the helper sends is
 * shown, logged or kept.
 */
import net from "node:net";
import type { SecurePromptVerdict } from "@moire/core";

export const POLKIT_HELPER_SOCKET = "/run/polkit/agent-helper.socket";
/** moire-dm's account pattern (apps/system/moire-dm/src/config.ts). */
const ACCOUNT_NAME = /^[a-z_][a-z0-9_-]{0,30}\$?$/;
/** Polkit 127 cookies are `<n>-<32 hex>-<n>-<32 hex>`; anything printable and bounded passes. */
const COOKIE = /^[\x21-\x7e]{1,128}$/;
/**
 * The helper reads an answer with fgets into PAM_MAX_RESP_SIZE (512) bytes: 510 bytes and the
 * newline are the most it takes whole. A longer answer would be cut, and its tail read as the
 * answer to the next prompt.
 */
export const POLKIT_ANSWER_MAX_BYTES = 510;
const MAX_LINE_BYTES = 1024;
const NEWLINE = 0x0a;

const SECRET_PROMPT = Buffer.from("PAM_PROMPT_ECHO_OFF ");
const VISIBLE_PROMPT = Buffer.from("PAM_PROMPT_ECHO_ON ");
const ERROR_MESSAGE = Buffer.from("PAM_ERROR_MSG ");
const TEXT_INFO = Buffer.from("PAM_TEXT_INFO ");
const SUCCESS = Buffer.from("SUCCESS");
const FAILURE = Buffer.from("FAILURE");
const DIAGNOSTIC = Buffer.from("polkit-agent-helper-1: ");
/** The one diagnostic that means "PAM refused these credentials"; its tail is localized. */
const AUTH_FAILED = Buffer.from("polkit-agent-helper-1: pam_authenticate failed: ");

export type PolkitHelperRequest = {
  account: string;
  cookie: string;
  /** A view the caller owns and wipes. It is copied once for the write and never stringified. */
  secret: Uint8Array;
  /** Aborting closes the conversation; the verdict is then "unavailable". */
  signal?: AbortSignal;
};

export type PolkitHelperOptions = {
  socketPath?: string;
  /** Connecting and receiving the first prompt. */
  promptTimeoutMs?: number;
  /** From the answer to the verdict. */
  verdictTimeoutMs?: number;
  /** How long the helper may take to close after its verdict (it sleeps 100 ms first). */
  closeTimeoutMs?: number;
};

export type PolkitHelper = (request: PolkitHelperRequest) => Promise<SecurePromptVerdict>;

export function polkitAccountName(value: string): boolean {
  return ACCOUNT_NAME.test(value);
}
export function polkitCookie(value: string): boolean {
  return COOKIE.test(value);
}

function startsWith(line: Buffer, prefix: Buffer): boolean {
  return line.length >= prefix.length && line.subarray(0, prefix.length).equals(prefix);
}

/**
 * One helper conversation: one account, one cookie, one answer. "rejected" means PAM refused the
 * password and another try may follow (a new conversation with the same cookie); "unavailable"
 * covers everything this client will not or cannot carry.
 */
export function createPolkitHelper(options: PolkitHelperOptions = {}): PolkitHelper {
  const socketPath = options.socketPath ?? POLKIT_HELPER_SOCKET;
  const promptTimeoutMs = options.promptTimeoutMs ?? 10_000;
  const verdictTimeoutMs = options.verdictTimeoutMs ?? 30_000;
  const closeTimeoutMs = options.closeTimeoutMs ?? 1000;
  return ({ account, cookie, secret, signal }) =>
    new Promise<SecurePromptVerdict>((resolve) => {
      if (!ACCOUNT_NAME.test(account) || !COOKIE.test(cookie) || signal?.aborted) {
        resolve("unavailable");
        return;
      }
      // An answer the line protocol cannot carry is never the password as PAM would see it.
      if (
        secret.length === 0 ||
        secret.length > POLKIT_ANSWER_MAX_BYTES ||
        secret.includes(NEWLINE) ||
        secret.includes(0)
      ) {
        resolve("rejected");
        return;
      }

      // The only copy this module makes of the answer, wiped whichever way the write ends.
      const answer = Buffer.alloc(secret.length + 1);
      answer.set(secret);
      answer[secret.length] = NEWLINE;

      let settled = false;
      let answered = false;
      let authFailed = false;
      let otherFailure = false;
      let verdict: SecurePromptVerdict | null = null;
      let pending: Buffer = Buffer.alloc(0);
      let timer: ReturnType<typeof setTimeout>;
      const socket = net.createConnection({ path: socketPath });

      const finish = (result: SecurePromptVerdict) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        answer.fill(0);
        pending = Buffer.alloc(0);
        signal?.removeEventListener("abort", abort);
        socket.destroy();
        resolve(result);
      };
      const abort = () => finish("unavailable");
      const deadline = (ms: number, result: SecurePromptVerdict = "unavailable") => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(result), ms);
      };
      /** The stream ended: with a verdict line it stands, otherwise only a PAM refusal does. */
      const ended = () =>
        finish(verdict ?? (answered && authFailed && !otherFailure ? "rejected" : "unavailable"));

      const line = (bytes: Buffer): boolean => {
        // Anything after the verdict line is outside the protocol.
        if (verdict !== null) return false;
        if (bytes.equals(SUCCESS)) {
          verdict = otherFailure || authFailed ? "unavailable" : "accepted";
        } else if (bytes.equals(FAILURE)) {
          // Without the diagnostic (stderr sent elsewhere), a failure after an answer is a refusal.
          verdict = answered && !otherFailure ? "rejected" : "unavailable";
        } else if (startsWith(bytes, SECRET_PROMPT)) {
          // One answer per conversation; a second secret (another factor) is not supported.
          if (answered) return false;
          answered = true;
          socket.write(answer, () => answer.fill(0));
          deadline(verdictTimeoutMs);
          return true;
        } else if (startsWith(bytes, VISIBLE_PROMPT)) {
          // A one-time code or a new-password dialogue: version 1 answers passwords only.
          return false;
        } else if (startsWith(bytes, ERROR_MESSAGE) || startsWith(bytes, TEXT_INFO)) {
          return true;
        } else if (startsWith(bytes, AUTH_FAILED)) {
          authFailed = true;
          return true;
        } else if (startsWith(bytes, DIAGNOSTIC)) {
          otherFailure = true;
          return true;
        } else return false;
        // The helper exits right after its verdict; wait for that so trailing bytes are seen.
        deadline(closeTimeoutMs, verdict);
        return true;
      };

      deadline(promptTimeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      socket.once("connect", () => {
        socket.write(Buffer.from(`${account}\n${cookie}\n`, "ascii"));
      });
      socket.on("data", (chunk: Buffer) => {
        if (settled) return;
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        for (;;) {
          const end = pending.indexOf(NEWLINE);
          if (end < 0 ? pending.length > MAX_LINE_BYTES : end > MAX_LINE_BYTES) {
            finish("unavailable");
            return;
          }
          if (end < 0) return;
          const bytes = pending.subarray(0, end);
          pending = pending.subarray(end + 1);
          if (!line(bytes)) {
            finish("unavailable");
            return;
          }
        }
      });
      socket.once("error", () => finish(verdict ?? "unavailable"));
      socket.once("end", () => {
        // An unterminated tail is not a line.
        if (pending.length > 0) finish("unavailable");
        else ended();
      });
      socket.once("close", ended);
    });
}
