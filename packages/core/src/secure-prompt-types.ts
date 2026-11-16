// The contract between the compositor-owned secure prompt and whoever asks for one (the polkit
// agent, later the keyring). See docs/polkit-agent.md. Types only: the state machine lives in
// secure-prompt.ts.

/** How one submitted secret was judged by the requester's checker. */
export type SecurePromptVerdict = "accepted" | "rejected" | "throttled" | "unavailable";

export type SecurePromptOutcome =
  /** A password was accepted, or a consent prompt was allowed. */
  | "completed"
  /** Escape, the Cancel button, or `cancel()` on the handle. */
  | "cancelled"
  | "timed-out"
  /** The session locked while the prompt was visible. */
  | "locked"
  /** Never shown: the queue was full or the requester is in its cancel cool-down. */
  | "refused"
  /** Neither the shell's view nor the fallback painter could draw it. */
  | "failed";

export interface SecurePromptIdentity {
  /** Account name, already validated by the requester. */
  readonly account: string;
  readonly displayName: string;
}

export interface SecurePromptRequester {
  /** Kernel-derived program or app name. Advisory. */
  readonly name: string;
  readonly pid?: number;
  /** The nearest ancestor that owns a window, when the requester has none ("Terminal"). */
  readonly via?: string;
  readonly x11: boolean;
}

export interface SecurePromptDetail {
  readonly label: string;
  readonly value: string;
}

export interface SecurePromptRequest {
  readonly kind: "password" | "consent";
  /** Plain text, already stripped of control characters and bounded by the requester. */
  readonly headline: string;
  readonly requester: SecurePromptRequester | null;
  /** Password prompts: who may answer. Empty for consent prompts. */
  readonly identities: readonly SecurePromptIdentity[];
  /** Index into `identities` shown first. */
  readonly selected: number;
  /** True when the session user is not among `identities`. */
  readonly needsAdministrator: boolean;
  readonly details: readonly SecurePromptDetail[];
  /** Requests sharing a key share the short cancel cool-down (executable plus action). */
  readonly coolDownKey?: string;
  /**
   * Requests sharing a key are one program to the flood pause, whatever they ask for. Absent,
   * `coolDownKey` stands in.
   */
  readonly requesterKey?: string;
  /**
   * Password prompts: judge one answer. `secret` is a view of bytes the prompt owns and wipes
   * once the promise settles; the checker must not keep or stringify it. "rejected" keeps the
   * prompt open for another try.
   */
  readonly check?: (
    identity: SecurePromptIdentity,
    secret: Uint8Array,
  ) => Promise<SecurePromptVerdict>;
}

export interface SecurePromptResult {
  readonly outcome: SecurePromptOutcome;
  /** The identity that answered, when `outcome` is "completed" on a password prompt. */
  readonly identity?: SecurePromptIdentity;
}

export interface SecurePromptHandle {
  readonly result: Promise<SecurePromptResult>;
  /** The requester went away. Closes or dequeues the prompt without a message. */
  cancel(): void;
}

export interface SecurePrompts {
  request(request: SecurePromptRequest): SecurePromptHandle;
}
