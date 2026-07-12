import { platform } from "node:os";

export function isLinux(): boolean {
  return platform() === "linux";
}

export function assertLinux(feature: string): void {
  if (!isLinux()) {
    throw new Error(
      `${feature} requires Linux (DRM/KMS). Develop in the Parallels Ubuntu VM — see docs/dev-vm.md.`,
    );
  }
}
