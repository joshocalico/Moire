import type { GreeterReply } from "@moire/moire-dm/protocol";
import { answerBytes, connectMoireDmSocket } from "./moire-dm-connection";
import type {
  AuthReply,
  CancelReply,
  NativeGreetdClient,
  StartReply,
} from "./native-greetd-client";

/**
 * The greeter's client for moire-dm (Moire login protocol). It has the same shape as the greetd
 * client, so the greeter's controller is backend-agnostic: the greeter picks one or the other
 * by which socket variable its session was started with (see greeter `login-client.ts`).
 *
 * The session is chosen by catalog id: the first entry moire-dm lists, which is the image's
 * desktop. Prompt text from PAM is never surfaced (it can echo a typed response).
 */
export type MoireDmClientOptions = Readonly<{ socketPath: string; timeoutMs?: number }>;

type Phase =
  | { kind: "idle" }
  | { kind: "prompt"; style: "visible" | "secret" | "info" | "error" }
  | { kind: "authorized" }
  | { kind: "failed" }
  | { kind: "launching" }
  | { kind: "committed" }
  | { kind: "closed" };

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

export async function connectMoireDm(options: MoireDmClientOptions): Promise<NativeGreetdClient> {
  const connection = await connectMoireDmSocket(options.socketPath, options.timeoutMs);
  let phase: Phase = { kind: "idle" };
  let busy = false;

  async function exchange(request: Parameters<typeof connection.exchange>[0]) {
    busy = true;
    try {
      return await connection.exchange(request);
    } catch (error) {
      phase = { kind: "closed" };
      connection.close();
      throw error;
    } finally {
      busy = false;
    }
  }

  function authentication(reply: GreeterReply): AuthReply {
    if (reply.type === "prompt") {
      phase = { kind: "prompt", style: reply.style };
      return { kind: "prompt", style: reply.style, message: PROMPT_TEXT[reply.style] };
    }
    if (reply.type === "authorized") {
      phase = { kind: "authorized" };
      return { kind: "authorized" };
    }
    if (reply.type === "error" && reply.code === "denied") {
      phase = { kind: "failed" };
      return { kind: "denied" };
    }
    // Anything else is a daemon-side failure, as with greetd's "error" replies.
    phase = { kind: "closed" };
    connection.close();
    throw new Error("Authentication request failed");
  }

  return {
    async authenticate(username) {
      if (phase.kind !== "idle" || busy) throw new Error("Authentication request unavailable");
      if (
        typeof username !== "string" ||
        !username ||
        username.length > MAX_ACCOUNT_CHARS ||
        hasControl(username)
      )
        throw new Error("Invalid authentication account");
      return authentication(await exchange({ type: "begin", account: username }));
    },
    async respond(response) {
      if (phase.kind !== "prompt" || busy) throw new Error("Authentication response unavailable");
      if (phase.style === "info" || phase.style === "error") {
        if (response !== null) throw new Error("Authentication acknowledgement required");
        return authentication(await exchange({ type: "answer", response: null }));
      }
      if (typeof response !== "string") throw new Error("Invalid authentication response");
      const bytes = answerBytes(response);
      if (bytes.byteLength > MAX_ANSWER_BYTES || bytes.includes(0)) {
        bytes.fill(0);
        throw new Error("Invalid authentication response");
      }
      const pending = exchange({ type: "answer", response: bytes });
      // encodeRequest has copied the bytes into the frame (wiped once written).
      bytes.fill(0);
      return authentication(await pending);
    },
    async cancel(): Promise<CancelReply> {
      if (
        busy ||
        phase.kind === "closed" ||
        phase.kind === "launching" ||
        phase.kind === "committed"
      )
        return { kind: "unavailable" };
      if (phase.kind === "idle") return { kind: "cancelled" };
      try {
        const reply = await exchange({ type: "cancel" });
        if (reply.type === "cancelled") {
          phase = { kind: "idle" };
          return { kind: "cancelled" };
        }
      } catch {
        // Unknown cancellation never authorizes a fresh attempt.
      }
      phase = { kind: "closed" };
      connection.close();
      return { kind: "unavailable" };
    },
    async start(): Promise<StartReply> {
      if (phase.kind !== "authorized" || busy) return { kind: "unavailable" };
      phase = { kind: "launching" };
      try {
        const list = await exchange({ type: "sessions" });
        const session = list.type === "sessions" ? list.sessions[0] : undefined;
        if (!session) return { kind: "failed" };
        const reply = await exchange({ type: "start", session: session.id });
        if (reply.type !== "scheduled") return { kind: "failed" };
        // Scheduling, not desktop readiness: moire-dm starts it once this greeter exits.
        phase = { kind: "committed" };
        return { kind: "committed" };
      } catch {
        return { kind: "unavailable" };
      }
    },
    close() {
      phase = { kind: "closed" };
      connection.close();
    },
  };
}
