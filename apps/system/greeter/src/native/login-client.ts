/**
 * The greeter's login client, picked by the backend that started it: moire-dm sets
 * MOIRE_DM_SOCK (Moire login protocol), greetd sets GREETD_SOCK (greetd's IPC). Both clients
 * have the same shape, so the controller and UI don't know which daemon is behind them, and an
 * image can roll back to greetd without a greeter change.
 */
// oxlint-disable import/no-relative-parent-imports -- Source-only adapters have no package export.
import { connectMoireDm } from "../../../display-manager/src/moire-dm-client";
import {
  connectNativeGreetd,
  fixedSessionCommand,
  type NativeGreetdClient,
} from "../../../display-manager/src/native-greetd-client";
// oxlint-enable import/no-relative-parent-imports

export type LoginBackend =
  | Readonly<{ kind: "moire-dm"; socketPath: string }>
  | Readonly<{ kind: "greetd"; socketPath: string }>;

/** moire-dm wins if both are somehow set: it is the backend that started us with its variable. */
export function loginBackend(env: NodeJS.ProcessEnv): LoginBackend | null {
  if (env.MOIRE_DM_SOCK) return { kind: "moire-dm", socketPath: env.MOIRE_DM_SOCK };
  if (env.GREETD_SOCK) return { kind: "greetd", socketPath: env.GREETD_SOCK };
  return null;
}

/**
 * `sessionExecutable` is the build-time desktop command. greetd needs it as the command to run;
 * moire-dm ignores it and starts its own catalog's session by id.
 */
export function connectLoginClient(
  backend: LoginBackend,
  sessionExecutable: string,
  timeoutMs: number,
): Promise<NativeGreetdClient> {
  return backend.kind === "moire-dm"
    ? connectMoireDm({ socketPath: backend.socketPath, timeoutMs })
    : connectNativeGreetd({
        session: fixedSessionCommand(sessionExecutable),
        socketPath: backend.socketPath,
        timeoutMs,
      });
}
