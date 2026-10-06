import { useLayoutEffect, useRef, useState } from "react";
import type { LocalLoginUser, LocalUserProvider } from "./local-users";
import type { NativeGreeterActions } from "./view";
import type { NativeGreeterState } from "./types";

type Selection =
  | Readonly<{ kind: "legacy" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "choosing"; users: readonly LocalLoginUser[]; message: string }>
  | Readonly<{ kind: "checking"; user: LocalLoginUser }>
  | Readonly<{ kind: "selected"; user: LocalLoginUser }>
  | Readonly<{ kind: "changing" }>
  | Readonly<{ kind: "unavailable" }>;

/** Owns presentation selection, never authentication or user-session authority. */
export function useUserSelection(props: {
  state: NativeGreeterState;
  actions: NativeGreeterActions;
  provider: LocalUserProvider | undefined;
}) {
  const [selection, setSelection] = useState<Selection>(
    props.provider ? { kind: "loading" } : { kind: "legacy" },
  );
  const current = useRef(props);
  current.current = props;
  const selected = useRef(selection);
  selected.current = selection;
  const epoch = useRef(0);
  const live = useRef(true);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      ++epoch.current;
      pending.current?.abort();
    };
  }, []);
  const publish = (next: Selection) => {
    selected.current = next;
    setSelection(next);
  };
  const readyRevision = props.state.kind === "ready" ? props.state.revision : null;
  useLayoutEffect(() => {
    const generation = ++epoch.current;
    pending.current?.abort();
    if (!props.provider) {
      publish({ kind: "legacy" });
      return;
    }
    if (readyRevision === null) return;
    const abort = new AbortController();
    pending.current = abort;
    publish({ kind: "loading" });
    void props.provider.list(abort.signal).then(
      (users) => {
        if (generation === epoch.current && !abort.signal.aborted)
          publish({ kind: "choosing", users, message: "" });
      },
      () => {
        if (generation === epoch.current && !abort.signal.aborted) publish({ kind: "unavailable" });
      },
    );
    return () => {
      ++epoch.current;
      abort.abort();
    };
  }, [props.provider, readyRevision, refresh]);

  const choose = (user: LocalLoginUser) => {
    const { state, provider, actions } = current.current;
    const catalog = selected.current;
    if (
      !live.current ||
      current.current.state !== props.state ||
      selected.current !== selection ||
      !provider ||
      state.kind !== "ready" ||
      catalog.kind !== "choosing" ||
      !catalog.users.includes(user)
    )
      return;
    const generation = ++epoch.current;
    pending.current?.abort();
    const abort = new AbortController();
    pending.current = abort;
    publish({ kind: "checking", user });
    // Re-read Locked/SystemAccount/LocalAccount immediately before beginning PAM.
    void provider
      .list(abort.signal)
      .then(async (users) => {
        if (generation !== epoch.current || abort.signal.aborted || current.current.state !== state)
          return;
        const fresh = users.find(
          (candidate) => candidate.uid === user.uid && candidate.username === user.username,
        );
        if (!fresh) {
          publish({ kind: "choosing", users, message: "That account is no longer available." });
          return;
        }
        publish({ kind: "selected", user: fresh });
        await actions.begin(fresh.username, state.revision);
      })
      .catch(() => {
        if (generation === epoch.current && !abort.signal.aborted) publish({ kind: "unavailable" });
      });
  };
  const changeUser = () => {
    const { state, actions } = current.current;
    if (
      !live.current ||
      current.current.state !== props.state ||
      selected.current !== selection ||
      selected.current.kind !== "selected" ||
      (state.kind !== "prompt" && state.kind !== "authenticating")
    )
      return;
    publish({ kind: "changing" }); // Unmount the private draft before cancellation.
    void actions.cancel(state.attemptId).catch(() => {
      if (live.current && current.current.state === state) publish({ kind: "unavailable" });
    });
  };
  const retry = () => {
    if (
      live.current &&
      current.current.state.kind === "ready" &&
      selected.current.kind === "unavailable"
    )
      setRefresh((value) => value + 1);
  };
  return { selection, choose, changeUser, retry };
}
