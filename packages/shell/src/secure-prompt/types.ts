/**
 * The secure prompt's wire from the compositor (core's SecurePromptView and SecurePromptAction;
 * the shell does not depend on core, so the shapes are restated here and kept structurally
 * equal).
 */
export type SecurePromptPhase = "entry" | "checking" | "wrong" | "throttled" | "unavailable";

export type SecurePromptAction =
  | { type: "cancel" }
  | { type: "submit" }
  | { type: "identity"; index: number }
  | { type: "allow" }
  | { type: "deny" };

export type SecurePromptView = Readonly<{
  revision: number;
  /** A new number for every prompt shown. */
  id: number;
  kind: "password" | "consent";
  /** Plain, bounded text. */
  headline: string;
  /** Advisory: the kernel-derived name of the program that asked. */
  requester: Readonly<{ name: string; pid?: number; via?: string; x11: boolean }> | null;
  /** Who may answer (at most eight); empty for consent. */
  identities: readonly Readonly<{ account: string; displayName: string }>[];
  selected: number;
  /** The session user is not among `identities`. */
  needsAdministrator: boolean;
  details: readonly Readonly<{ label: string; value: string }>[];
  /** Characters typed; the answer itself never leaves the compositor. */
  length: number;
  phase: SecurePromptPhase;
  failures: number;
  /** Requests waiting behind this one. */
  waiting: number;
  /** Times the verification key was pressed on this prompt. */
  verifications: number;
  /** True for a moment after the verification key. */
  pulsing: boolean;
  capsLock: boolean;
  layout: Readonly<{ label: string; name: string }> | null;
  reducedMotion: boolean;
}>;
