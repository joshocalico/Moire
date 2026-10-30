import type { GreeterReply } from "@moire/moire-dm/protocol";
import { answerBytes, connectMoireDmSocket } from "./moire-dm-connection";
import type { BrokerLaunch, BrokerReply, LoginBroker } from "./types";

/**
 * `LoginBroker` over moire-dm's Moire login protocol.
 *
 * moire-dm never takes a command from the greeter: `start` expects `command` to be exactly one
 * element, the catalog session id (the `SessionSelection.id` the controller launches), and no
 * environment. As with the greetd clients, daemon-supplied text is never surfaced: PAM messages
 * can echo a typed response, so prompts become fixed sentences.
 */
export type MoireDmBrokerOptions = Readonly<{
  socketPath: string;
  timeoutMs?: number;
}>;

type Phase =
  | "idle"
  | "prompt-answer"
  | "prompt-acknowledge"
  | "authorized"
  | "scheduled"
  | "failed";

const MAX_ACCOUNT_CHARS = 32;
const MAX_ANSWER_BYTES = 512;
const PROMPT_TEXT = {
  secret: "Enter the requested secret",
  visible: "Enter the requested response",
  info: "Acknowledge the authentication message",
  error: "Acknowledge the authentication message",
} as const;

function hasControl(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export async function connectMoireDmBroker(options: MoireDmBrokerOptions): Promise<LoginBroker> {
  const connection = await connectMoireDmSocket(options.socketPath, options.timeoutMs);
  let phase: Phase = "idle";

  function settle(reply: GreeterReply): BrokerReply {
    switch (reply.type) {
      case "prompt":
        phase =
          reply.style === "secret" || reply.style === "visible"
            ? "prompt-answer"
            : "prompt-acknowledge";
        return { kind: "prompt", style: reply.style, message: PROMPT_TEXT[reply.style] };
      case "authorized":
        phase = "authorized";
        return { kind: "success" };
      case "scheduled":
        phase = "scheduled";
        return { kind: "success" };
      case "cancelled":
        phase = "idle";
        return { kind: "success" };
      case "error":
        if (reply.code === "denied") {
          phase = "failed";
          return { kind: "denied", message: "Authentication failed" };
        }
        // An unknown session leaves the attempt authorized; anything else ends it.
        if (reply.code !== "unknown-session") phase = "failed";
        return { kind: "error", message: "Login is unavailable" };
      case "sessions":
        return { kind: "error", message: "Unexpected reply" };
    }
  }

  return {
    qualification: "fixture",
    async begin(account) {
      if (phase !== "idle") throw new Error("moire-dm authentication phase changed");
      if (
        typeof account !== "string" ||
        !account ||
        account.length > MAX_ACCOUNT_CHARS ||
        hasControl(account)
      )
        throw new Error("Invalid account");
      return settle(await connection.exchange({ type: "begin", account }));
    },
    async answer(response) {
      if (phase === "prompt-acknowledge") {
        if (response !== null) throw new Error("Informational prompt requires acknowledgement");
        return settle(await connection.exchange({ type: "answer", response: null }));
      }
      if (phase !== "prompt-answer") throw new Error("moire-dm prompt phase changed");
      if (typeof response !== "string")
        throw new Error("Authentication prompt requires a response");
      const bytes = answerBytes(response);
      if (bytes.byteLength > MAX_ANSWER_BYTES) {
        bytes.fill(0);
        throw new Error("Authentication response is too long");
      }
      const pending = connection.exchange({ type: "answer", response: bytes });
      bytes.fill(0);
      return settle(await pending);
    },
    async start(request: BrokerLaunch) {
      if (phase !== "authorized") throw new Error("moire-dm launch phase changed");
      const [session, ...rest] = request.command;
      if (!session || rest.length || request.environment.length)
        throw new Error("moire-dm starts sessions by catalog id only");
      // Success schedules the session; the daemon starts it once this greeter has exited.
      return settle(await connection.exchange({ type: "start", session }));
    },
    async cancel() {
      if (connection.closed || phase === "scheduled")
        throw new Error("moire-dm cancellation outcome is unknown");
      if (phase === "idle") return { kind: "success" };
      return settle(await connection.exchange({ type: "cancel" }));
    },
    close: () => connection.close(),
  };
}
