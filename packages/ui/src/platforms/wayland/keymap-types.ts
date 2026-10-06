import type { UiKeyModifiers } from "#ui/platform";

export type WaylandModifierMask = Readonly<{
  depressed: number;
  latched: number;
  locked: number;
  group: number;
}>;
export type KeymapTranslation = Readonly<{ key?: string; text?: string }>;
/** Client state follows compositor masks; it never generates server key state. */
export interface ClientKeymap {
  updateMask(mask: WaylandModifierMask): void;
  translate(evdevCode: number): KeymapTranslation;
  modifiers(): UiKeyModifiers;
  reset(): void;
  destroy(): void;
}
export type ClientKeymapFactory = (source: Buffer) => ClientKeymap;
export type KeymapAvailability =
  | Readonly<{ kind: "available" }>
  | Readonly<{
      kind: "unavailable";
      reason: "missing" | "invalid" | "unsupported" | "disconnected";
    }>;
/** The consumer owns each received descriptor, including failed reads. */
export type KeymapFdIo = Readonly<{
  read(fd: number, size: number): Buffer;
  close(fd: number): void;
}>;
