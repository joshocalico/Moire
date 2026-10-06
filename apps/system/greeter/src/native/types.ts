/** Greeter frontend state only. Authentication and session lifecycle belong to stock greetd. */
import { randomUUID } from "node:crypto";
import type {
  NativeGreetdClient,
  // oxlint-disable-next-line import/no-relative-parent-imports -- Source-only adapter has no package export; fixture contracts stay separate.
} from "../../../display-manager/src/native-greetd-client";

const attemptBrand: unique symbol = Symbol("native-greeter-attempt");
const promptBrand: unique symbol = Symbol("native-greeter-prompt");
export type AttemptId = Readonly<{ readonly [attemptBrand]: true; value: string }>;
export type PromptId = Readonly<{ readonly [promptBrand]: true; value: string }>;
export function newAttemptId(): AttemptId {
  const id: AttemptId = { [attemptBrand]: true, value: randomUUID() };
  return Object.freeze(id);
}
export function newPromptId(): PromptId {
  const id: PromptId = { [promptBrand]: true, value: randomUUID() };
  return Object.freeze(id);
}
export type NativeGreeterState =
  | Readonly<{ kind: "ready"; revision: number; message: string }>
  | Readonly<{ kind: "authenticating"; attemptId: AttemptId }>
  | Readonly<{
      kind: "prompt";
      attemptId: AttemptId;
      promptId: PromptId;
      style: "visible" | "secret" | "info" | "error";
      message: string;
    }>
  | Readonly<{ kind: "cancelling"; attemptId: AttemptId }>
  | Readonly<{ kind: "launching"; attemptId: AttemptId }>
  | Readonly<{ kind: "launch-committed" }>
  | Readonly<{ kind: "unavailable"; message: string }>;
export type NativeGreeterOutcome = Readonly<{
  kind: "launch-committed" | "unavailable";
}>;
export interface NativeGreeterController {
  snapshot(): NativeGreeterState;
  subscribe(listener: () => void): () => void;
  begin(username: string, revision: number): Promise<void>;
  answer(attemptId: AttemptId, promptId: PromptId, response: string | null): Promise<void>;
  cancel(attemptId: AttemptId): Promise<void>;
  /** Stops presentation/transport. It does not claim cancellation of a scheduled native session. */
  dispose(): Promise<void>;
  readonly finished: Promise<NativeGreeterOutcome>;
}
export type NativeGreeterControllerOptions = Readonly<{
  client: NativeGreetdClient;
}>;
