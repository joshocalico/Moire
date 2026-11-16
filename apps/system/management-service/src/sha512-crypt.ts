/**
 * SHA-512 crypt (`$6$`, Ulrich Drepper's specification), so a new password becomes a hash
 * inside moire-accounts: no helper sees the plaintext on its command line or stdin.
 * AccountsService then hands only the hash to `chpasswd -e`. Plain `node:crypto`, no native
 * code: glibc's crypt(3) would need an FFI boundary for no gain, as `$6$` is what
 * AccountsService and pam_unix already accept.
 */
import { createHash, randomBytes } from "node:crypto";

const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const DEFAULT_ROUNDS = 5000;
/** Above the spec default so a stolen /etc/shadow costs more to attack, yet ~100 ms to compute. */
export const PASSWORD_ROUNDS = 65536;

function sha512(...parts: Buffer[]): Buffer {
  const hash = createHash("sha512");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function repeatTo(source: Buffer, length: number): Buffer {
  const out = Buffer.alloc(length);
  for (let offset = 0; offset < length; offset += source.length)
    source.copy(out, offset, 0, Math.min(source.length, length - offset));
  return out;
}

const ORDER = [
  [0, 21, 42],
  [22, 43, 1],
  [44, 2, 23],
  [3, 24, 45],
  [25, 46, 4],
  [47, 5, 26],
  [6, 27, 48],
  [28, 49, 7],
  [50, 8, 29],
  [9, 30, 51],
  [31, 52, 10],
  [53, 11, 32],
  [12, 33, 54],
  [34, 55, 13],
  [56, 14, 35],
  [15, 36, 57],
  [37, 58, 16],
  [59, 17, 38],
  [18, 39, 60],
  [40, 61, 19],
  [62, 20, 41],
] as const;

function encode(digest: Buffer): string {
  let out = "";
  const emit = (b2: number, b1: number, b0: number, count: number) => {
    let word = (b2 << 16) | (b1 << 8) | b0;
    for (let index = 0; index < count; index++) {
      out += ITOA64[word & 0x3f];
      word >>>= 6;
    }
  };
  for (const [a, b, c] of ORDER) emit(digest[a]!, digest[b]!, digest[c]!, 4);
  emit(0, 0, digest[63]!, 2);
  return out;
}

/** `setting` is `$6$salt` or `$6$rounds=N$salt` (salt truncated to 16 characters). */
export function sha512Crypt(password: string | Buffer, setting: string): string {
  const match = /^\$6\$(?:rounds=(\d{1,9})\$)?([^$]*)/.exec(setting);
  if (!match) throw new Error("Unsupported crypt setting");
  const custom = match[1] !== undefined;
  const rounds = custom ? Math.min(999_999_999, Math.max(1000, Number(match[1]))) : DEFAULT_ROUNDS;
  const saltText = match[2]!.slice(0, 16);
  const key = Buffer.isBuffer(password) ? password : Buffer.from(password, "utf8");
  const salt = Buffer.from(saltText, "utf8");

  const alternate = sha512(key, salt, key);
  const a = createHash("sha512");
  a.update(key);
  a.update(salt);
  let remaining = key.length;
  for (; remaining > 64; remaining -= 64) a.update(alternate);
  a.update(alternate.subarray(0, remaining));
  for (let length = key.length; length > 0; length >>= 1) a.update(length & 1 ? alternate : key);
  let current = a.digest();

  const p = repeatTo(sha512(...Array<Buffer>(key.length).fill(key)), key.length);
  const s = repeatTo(sha512(...Array<Buffer>(16 + current[0]!).fill(salt)), salt.length);

  for (let round = 0; round < rounds; round++) {
    const c = createHash("sha512");
    c.update(round & 1 ? p : current);
    if (round % 3) c.update(s);
    if (round % 7) c.update(p);
    c.update(round & 1 ? current : p);
    current = c.digest();
  }
  // Best effort: wipe the copies this function made (the caller's string is immutable).
  if (!Buffer.isBuffer(password)) key.fill(0);
  p.fill(0);
  alternate.fill(0);
  return `$6$${custom ? `rounds=${rounds}$` : ""}${saltText}$${encode(current)}`;
}

/**
 * A fresh `$6$rounds=…$<16 random salt characters>$…` hash for /etc/shadow. A Buffer is the
 * caller's to wipe.
 */
export function hashNewPassword(password: string | Buffer, rounds = PASSWORD_ROUNDS): string {
  const bytes = randomBytes(16);
  const salt = Array.from(bytes, (byte) => ITOA64[byte & 0x3f]).join("");
  return sha512Crypt(password, `$6$rounds=${rounds}$${salt}`);
}
