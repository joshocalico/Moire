/**
 * What moire-dm needs to know about the seat when it starts: are sessions it opened before a
 * restart still there? Pure; the logind query itself is `@moire/sys/login-sessions`.
 */
import type { LoginSession, SeatSessions } from "@moire/sys/login-sessions";

export const SEAT = "seat0";
const USER_SERVICES = new Set(["moire-dm", "moire-dm-autologin"]);
const GREETER_SERVICE = "moire-dm-greeter";

export type SeatSnapshot =
  | Readonly<{
      ok: true;
      /** Live user sessions moire-dm started: wait for them, never draw over them. */
      users: number;
      /** Session workers of greeters left from before the restart: stop them. */
      greeterLeaders: readonly number[];
    }>
  /** logind couldn't be asked. */
  | Readonly<{ ok: false }>;

function live(session: LoginSession): boolean {
  return session.state === "online" || session.state === "active";
}

export function seatSnapshot(seat: SeatSessions): SeatSnapshot {
  if (!seat.ok) return { ok: false };
  const ours = seat.sessions.filter(live);
  return {
    ok: true,
    users: ours.filter(
      (session) => session.sessionClass === "user" && USER_SERVICES.has(session.service ?? ""),
    ).length,
    greeterLeaders: ours
      .filter((session) => session.service === GREETER_SERVICE && session.leader !== null)
      .map((session) => session.leader!),
  };
}
