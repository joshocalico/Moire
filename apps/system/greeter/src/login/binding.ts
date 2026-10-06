import type { LoginBinding, LoginBindingOptions, LoginUiSnapshot } from "./types";
type LoginState = LoginUiSnapshot["state"];
type BeginLogin = Parameters<LoginBinding["actions"]["begin"]>[0];
type AnswerLogin = Parameters<LoginBinding["actions"]["answer"]>[0];

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}
/** Borrowed fixture authorities. This binding owns presentation subscriptions only. */
export function createLoginBinding(options: LoginBindingOptions): LoginBinding {
  if (options.qualification !== "fixture" || options.preferences.qualification !== "fixture")
    throw new Error("Invalid fixture login binding");
  let detached = false,
    retired = false,
    retirementFailed = false,
    errorMessage = "";
  let primary: Promise<void> | null = null,
    cancellation: { id: string; promise: Promise<void> } | null = null;
  let saving: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const selection = structuredClone(options.selection);
  freeze(selection);
  let cached: LoginUiSnapshot;
  function update() {
    const source = options.controller.state;
    let state: LoginState = detached || retired ? { kind: "inactive" } : source;
    if (!detached && retirementFailed)
      state = { kind: "blocked", message: "Fixture login presentation could not retire" };
    const terminal =
      state.kind === "inactive" ||
      state.kind === "blocked" ||
      state.kind === "running" ||
      state.kind === "retiring-greeter" ||
      state.kind === "starting-session";
    const busyForm = primary !== null && (state.kind === "ready" || state.kind === "prompt");
    const motion = structuredClone(options.preferences.snapshot());
    freeze(motion);
    if (state !== source) freeze(state);
    cached = Object.freeze({
      qualification: "fixture",
      state,
      selection,
      motion,
      active: !detached && !retired && !terminal && !busyForm && cancellation === null,
      message: detached
        ? "Fixture login presentation is inactive"
        : retirementFailed
          ? "Fixture login presentation could not retire"
          : detached || retired
            ? "Fixture login presentation is inactive"
            : errorMessage,
    });
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {}
    }
  }
  function changed() {
    if (detached) return;
    const kind = options.controller.state.kind;
    if (!retired && (kind === "retiring-greeter" || kind === "running")) {
      retired = true;
      update();
      try {
        options.retirePresentation();
      } catch {
        retirementFailed = true;
        update();
      }
      return;
    }
    update();
  }
  function available() {
    const kind = options.controller.state.kind;
    if (
      detached ||
      retired ||
      retirementFailed ||
      kind === "inactive" ||
      kind === "blocked" ||
      kind === "running" ||
      kind === "retiring-greeter" ||
      kind === "starting-session"
    )
      throw new Error("Fixture login presentation is inactive");
  }
  function action(operation: () => Promise<void>, failure: string): Promise<void> {
    available();
    if (primary || cancellation) throw new Error("Fixture login action is pending");
    const owned = Promise.resolve().then(async () => {
      available();
      errorMessage = "";
      try {
        await operation();
      } catch {
        if (!detached && !retired) {
          errorMessage = failure;
          update();
        }
        throw new Error(failure);
      }
    });
    primary = owned;
    // Establish ownership before notification; a reentrant listener cannot dispatch twice.
    update();
    void owned
      .finally(() => {
        if (primary === owned) {
          primary = null;
          if (!detached && !retired) update();
        }
      })
      .catch(() => {});
    return owned;
  }
  update();
  const removeController = options.controller.subscribe(changed),
    removePreferences = options.preferences.subscribe(() => {
      if (!detached) update();
    });
  changed();
  const binding: LoginBinding = {
    qualification: "fixture",
    snapshot() {
      return cached;
    },
    subscribe(listener) {
      if (detached || listeners.size >= 64) throw new Error("Fixture login observer unavailable");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions: Object.freeze({
      async begin(request: BeginLogin) {
        const exact = Object.freeze({ ...request, greeter: Object.freeze({ ...request.greeter }) });
        return action(() => options.controller.beginLogin(exact), "Fixture login request failed");
      },
      async answer(request: AnswerLogin) {
        const exact = Object.freeze({ ...request });
        return action(
          () => options.controller.answerPrompt(exact),
          "Fixture authentication response failed",
        );
      },
      async cancel(attemptId) {
        available();
        if (cancellation) {
          if (cancellation.id !== attemptId) throw new Error("Fixture login attempt changed");
          return cancellation.promise;
        }
        const owned = Promise.resolve().then(async () => {
          available();
          errorMessage = "";
          try {
            await options.controller.cancelLogin(attemptId);
          } catch {
            if (!detached && !retired) {
              errorMessage = "Fixture login cancellation failed";
              update();
            }
            throw new Error("Fixture login cancellation failed");
          }
        });
        cancellation = { id: attemptId, promise: owned };
        update();
        void owned
          .finally(() => {
            if (cancellation?.promise === owned) {
              cancellation = null;
              if (!detached && !retired) update();
            }
          })
          .catch(() => {});
        return owned;
      },
      async saveReducedMotion(value) {
        available();
        if (saving || typeof value !== "boolean")
          throw new Error("Fixture motion save unavailable");
        const owned = Promise.resolve().then(async () => {
          available();
          try {
            await options.preferences.setReducedMotion(value);
          } catch {
            if (!detached && !retired) {
              errorMessage = "Fixture motion preference save failed";
              update();
            }
            throw new Error("Fixture motion preference save failed");
          }
        });
        saving = owned;
        void owned
          .finally(() => {
            if (saving === owned) saving = null;
          })
          .catch(() => {});
        return owned;
      },
    }),
    detach() {
      if (detached) return;
      detached = true;
      update();
      removeController();
      removePreferences();
      listeners.clear();
    },
    dispose() {
      binding.detach();
    },
  };
  return binding;
}
