/**
 * Permissions as the inspector shows them: three access levels per class
 * (owner, group, others) and "Allow running as a program", both directions to
 * and from a mode. Account names come from /etc/passwd and /etc/group.
 */
import fs from "node:fs/promises";
import os from "node:os";

/** Write implies read in this UI ("Read & write"). */
export type Access = "none" | "read" | "write";
export type PermissionClass = "owner" | "group" | "others";

/** How far each class's r, w and x bits are shifted. */
const SHIFT: Record<PermissionClass, number> = { owner: 6, group: 3, others: 0 };
const READ = 4;
const WRITE = 2;
const EXECUTE = 1;
const ALL_EXECUTE = 0o111;

const bits = (mode: number, who: PermissionClass) => (mode >> SHIFT[who]) & 7;

export function accessOf(mode: number, who: PermissionClass): Access {
  const value = bits(mode, who);
  return value & WRITE ? "write" : value & READ ? "read" : "none";
}

/**
 * Set one class's access, keeping its execute bit. On a folder the execute
 * (search) bit follows: any access sets it, "none" clears it.
 */
export function withAccess(
  mode: number,
  who: PermissionClass,
  access: Access,
  isDir = false,
): number {
  const shift = SHIFT[who];
  const keep = isDir ? 0 : bits(mode, who) & EXECUTE;
  const granted = access === "write" ? READ | WRITE : access === "read" ? READ : 0;
  const search = isDir && access !== "none" ? EXECUTE : 0;
  return (mode & ~(7 << shift)) | ((granted | keep | search) << shift);
}

/** "Allow running as a program": the owner's execute bit. */
export function isExecutable(mode: number): boolean {
  return (mode & (EXECUTE << SHIFT.owner)) !== 0;
}

/** On: execute for the owner and every class that can read. Off: no execute at all. */
export function withExecutable(mode: number, on: boolean): number {
  if (!on) return mode & ~ALL_EXECUTE;
  let next = mode | (EXECUTE << SHIFT.owner);
  for (const who of ["group", "others"] as const)
    if (bits(mode, who) & READ) next |= EXECUTE << SHIFT[who];
  return next;
}

/** What the current user may do with each item, as one line for a multiple selection. */
export function permissionsSummary(
  modes: readonly number[],
  uids: readonly number[],
  currentUid: number,
): string {
  if (!modes.length) return "";
  if (uids.length && uids.every((uid) => uid !== currentUid)) return "Owned by someone else";
  // Items owned by someone else count with what everyone may do.
  const access = new Set(
    modes.map((mode, index) =>
      accessOf(mode, (uids[index] ?? currentUid) === currentUid ? "owner" : "others"),
    ),
  );
  if (access.size > 1) return "Mixed permissions";
  const [only] = access;
  if (only === "none") return "No access for you";
  const text = only === "write" ? "read & write" : "read-only";
  if (modes.length > 1) return `All ${text} for you`;
  return `${text[0]!.toUpperCase()}${text.slice(1)} for you`;
}

export type Accounts = { users: Map<number, string>; groups: Map<number, string> };
export type AccountFiles = { passwd: string; group: string };

/**
 * `name:x:id:…` lines → id → name. Comments, blank lines, NIS (`+`/`-`) lines
 * and garbled entries are skipped; the first name for an id wins.
 */
function parseAccounts(text: string, idField: number): Map<number, string> {
  const names = new Map<number, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("+") || line.startsWith("-")) continue;
    const fields = line.split(":");
    const name = fields[0];
    const id = fields[idField];
    if (!name || !id || !/^\d+$/.test(id)) continue;
    const value = Number(id);
    if (!names.has(value)) names.set(value, name);
  }
  return names;
}

const readText = (file: string) => fs.readFile(file, "utf8").catch(() => "");
const cache = new Map<string, Promise<Accounts>>();

/** User and group names by id, read once per process. Missing files give empty maps. */
export function readAccounts(
  files: AccountFiles = { passwd: "/etc/passwd", group: "/etc/group" },
): Promise<Accounts> {
  const key = `${files.passwd}\0${files.group}`;
  let accounts = cache.get(key);
  if (!accounts) {
    accounts = Promise.all([readText(files.passwd), readText(files.group)]).then(
      ([passwd, group]) => {
        const users = parseAccounts(passwd, 2);
        // The current user may come from NSS or a directory service, not /etc/passwd.
        const current = currentUser();
        if (current && !users.has(current.uid)) users.set(current.uid, current.name);
        return { users, groups: parseAccounts(group, 2) };
      },
    );
    cache.set(key, accounts);
  }
  return accounts;
}

/** The account's name, or its id when the name is unknown. */
export function accountName(names: ReadonlyMap<number, string>, id: number): string {
  return names.get(id) ?? String(id);
}

function currentUser(): { uid: number; name: string } | null {
  try {
    const info = os.userInfo();
    return info.uid >= 0 && info.username ? { uid: info.uid, name: info.username } : null;
  } catch {
    return null;
  }
}

/** The signed-in user's name: from the system, else $USER, else the numeric id. */
export function currentUserName(): string {
  return (
    currentUser()?.name ||
    process.env.USER ||
    process.env.LOGNAME ||
    String(process.getuid?.() ?? "")
  );
}
