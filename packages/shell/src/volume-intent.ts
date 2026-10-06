import type { DesktopStatusState } from "@moire/system-management/desktop-status";

export type VolumeDispatchIntent = Readonly<{ owner: string; revision: number; value: number }>;
export type VolumeIntentState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "editing"; owner: string; revision: number; value: number }>
  | Readonly<{ kind: "pending"; intent: VolumeDispatchIntent }>
  | Readonly<{ kind: "unknown"; intent: VolumeDispatchIntent; message: string }>
  | Readonly<{ kind: "revoked"; reason: string }>
  | Readonly<{ kind: "disposed" }>;
export type VolumeIntentResult = { kind: "succeeded" } | { kind: "unknown"; message: string };

function available(status: DesktopStatusState) {
  return (
    status.kind === "ready" && status.snapshot.audio.kind === "ready" && !status.snapshot.updating
  );
}
function sliderValue(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Owns a gesture and its requested value; observed backend facts are never overwritten. */
export function createVolumeIntent(initial: DesktopStatusState) {
  let observed = initial;
  let state: VolumeIntentState = Object.freeze({ kind: "idle" });
  let dispatch: VolumeDispatchIntent | null = null;
  let outcome: "awaiting" | "succeeded" | "unknown" = "awaiting";
  const revoke = (reason: string) => {
    dispatch = null;
    state = Object.freeze({ kind: "revoked", reason });
  };
  const settle = () => {
    if (
      dispatch &&
      observed.kind === "ready" &&
      observed.owner === dispatch.owner &&
      observed.snapshot.revision > dispatch.revision &&
      available(observed)
    ) {
      dispatch = null;
      state = Object.freeze({ kind: "idle" });
      return true;
    }
    return false;
  };
  return {
    get observed(): DesktopStatusState {
      return observed;
    },
    get state(): VolumeIntentState {
      return state;
    },
    begin(): boolean {
      if (
        state.kind === "disposed" ||
        state.kind === "editing" ||
        state.kind === "pending" ||
        state.kind === "unknown" ||
        observed.kind !== "ready" ||
        observed.snapshot.audio.kind !== "ready" ||
        !available(observed)
      )
        return false;
      state = Object.freeze({
        kind: "editing",
        owner: observed.owner,
        revision: observed.snapshot.revision,
        value: sliderValue(observed.snapshot.audio.volume),
      });
      return true;
    },
    change(value: number): boolean {
      if (state.kind !== "editing" || !Number.isFinite(value) || value < 0 || value > 1)
        return false;
      state = Object.freeze({ ...state, value });
      return true;
    },
    commit(): VolumeDispatchIntent | null {
      if (state.kind !== "editing") return null;
      if (
        observed.kind !== "ready" ||
        observed.owner !== state.owner ||
        observed.snapshot.revision !== state.revision ||
        !available(observed)
      ) {
        revoke("Sound changed; begin a new adjustment");
        return null;
      }
      dispatch = Object.freeze({
        owner: state.owner,
        revision: state.revision,
        value: state.value,
      });
      outcome = "awaiting";
      state = Object.freeze({ kind: "pending", intent: dispatch });
      return dispatch;
    },
    cancel(): void {
      // A pointer cancellation cannot cancel a backend write that was already submitted.
      if (state.kind === "editing" || state.kind === "revoked")
        state = Object.freeze({ kind: "idle" });
    },
    observe(next: DesktopStatusState): void {
      if (state.kind === "disposed") return;
      // Match the status client's monotonic observation contract. An old readback is not new authority.
      if (
        next.kind === "ready" &&
        observed.kind === "ready" &&
        next.owner === observed.owner &&
        next.snapshot.revision < observed.snapshot.revision
      )
        return;
      observed = next;
      if (state.kind === "editing") {
        if (
          next.kind !== "ready" ||
          next.owner !== state.owner ||
          next.snapshot.revision !== state.revision ||
          !available(next)
        )
          revoke("Sound changed; begin a new adjustment");
        return;
      }
      if (!dispatch) return;
      if (next.kind !== "ready" || next.owner !== dispatch.owner) {
        revoke("Desktop controls changed");
        return;
      }
      // Own audio loading/updating belongs to the same ready service owner. Keep the draft.
      // No observation can retire an RPC whose outcome has not arrived yet.
      if (outcome !== "awaiting") settle();
    },
    result(intent: VolumeDispatchIntent, result: VolumeIntentResult): void {
      if (state.kind === "disposed" || dispatch !== intent || outcome !== "awaiting") return;
      outcome = result.kind;
      if (result.kind === "unknown") {
        // A deadline is not proof of rollback. Only a subsequent actual idle read can settle it.
        state = Object.freeze({ kind: "unknown", intent, message: result.message });
      } else if (!settle()) state = Object.freeze({ kind: "pending", intent });
    },
    dispose(): void {
      dispatch = null;
      state = Object.freeze({ kind: "disposed" });
    },
  };
}
