import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openLogindSeat, type LogindSeat } from "@moire/sys";

/** The desktop remains in greetd's PAM scope; a user-manager unit cannot own this seat. */
export async function acquireNativeDesktopSeat(onRevoked: () => void): Promise<{
  seat: LogindSeat;
  cardPath: string;
}> {
  if (!process.getuid?.() || !process.env.XDG_RUNTIME_DIR?.startsWith("/run/user/"))
    throw new Error("A non-root authenticated runtime is required");
  const identity = Object.fromEntries(
    execFileSync(
      "/run/current-system/systemd/bin/loginctl",
      [
        "show-session",
        "self",
        "--property=Id",
        "--property=User",
        "--property=Class",
        "--property=Seat",
        "--property=Active",
        "--property=Scope",
      ],
      { encoding: "utf8", timeout: 5000, maxBuffer: 8192 },
    )
      .trim()
      .split("\n")
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  console.log(JSON.stringify({ nativeDesktopIdentity: identity, pid: process.pid }));
  if (
    identity.Class !== "user" ||
    identity.Seat !== "seat0" ||
    identity.Active !== "yes" ||
    identity.User !== String(process.getuid()) ||
    !/^session-.+\.scope$/.test(identity.Scope ?? "")
  )
    throw new Error("Desktop is outside the active authenticated PAM session");
  const seat = await openLogindSeat(onRevoked);
  try {
    seat.setGraphics(true);
    const card = fs
      .readdirSync("/dev/dri")
      .filter((name) => /^card\d+$/.test(name))
      .sort()[0];
    if (!card) throw new Error("No DRM card available");
    return { seat, cardPath: `/dev/dri/${card}` };
  } catch (error) {
    seat.shutdown();
    throw error;
  }
}
