import path from "node:path";
import {
  StorageControlError,
  type StorageClient,
  type StorageClientState,
  type StorageVolume,
} from "@moire/system-management/storage-status";
import { createFolderTab, tabDirectory, type FolderTab } from "./navigation";

export type DriveAction = "mount" | "unmount" | "eject";
export type DriveRequest = Readonly<{ owner: string; id: StorageVolume["id"]; revision: number }>;
/** The app observes one session-service client; transport and device policy remain service-owned. */
export type FilesStorageClient = StorageClient;
export type DriveNavigationIntent = Readonly<{
  tabId: string;
  navigation: FolderTab["navigation"];
}>;
export const DRIVES_UNAVAILABLE: StorageClientState = {
  kind: "unavailable",
  message: "Removable drive service unavailable",
};

export function isWithinMount(directory: string, root: string): boolean {
  const relative = path.relative(root, directory);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}
export function mountedRoots(state: StorageClientState): readonly string[] {
  return state.kind === "ready" && state.snapshot.status.kind === "ready"
    ? state.snapshot.status.volumes.flatMap((volume) =>
        volume.mount.kind === "mounted" ? [...volume.mount.paths] : [],
      )
    : [];
}
/** Retire inaccessible mount history without touching favorites, tags or any filesystem data. */
export function retireDrivePaths(
  tab: FolderTab,
  roots: readonly string[],
  safeHome: string,
): FolderTab {
  const unavailable = (directory: string) => roots.some((root) => isWithinMount(directory, root));
  if (unavailable(tabDirectory(tab)))
    return createFolderTab(
      tab.id,
      unavailable(safeHome)
        ? unavailable(path.parse(safeHome).root)
          ? tabDirectory(tab)
          : path.parse(safeHome).root
        : safeHome,
    );
  const paths = tab.navigation.paths.filter((directory) => !unavailable(directory));
  if (paths.length === tab.navigation.paths.length) return tab;
  return { ...tab, navigation: { paths, index: paths.indexOf(tabDirectory(tab)) } };
}
export function storageVolumes(state: StorageClientState): readonly StorageVolume[] {
  return state.kind === "ready" && state.snapshot.status.kind === "ready"
    ? state.snapshot.status.volumes
    : [];
}
export function storageCaption(state: StorageClientState): string {
  if (state.kind !== "ready") return state.message;
  const status = state.snapshot.status;
  if (status.kind !== "ready") return status.message;
  const operation = state.snapshot.operation;
  if (operation.kind === "pending")
    return `${operation.action === "mount" ? "Mounting" : operation.action === "unmount" ? "Unmounting" : "Ejecting"} drive…`;
  if (operation.kind === "error" || operation.kind === "unknown") return operation.message;
  return status.policy === "readonly" ? "System policy allows drive status only" : "";
}
export function driveCaption(volume: StorageVolume): string {
  return volume.mount.kind === "mounted"
    ? "Mounted"
    : volume.mount.kind === "unsupported"
      ? volume.mount.message
      : "Not mounted";
}
export function driveOperationBlocked(state: StorageClientState, id: StorageVolume["id"]): boolean {
  if (state.kind !== "ready") return true;
  const operation = state.snapshot.operation;
  return operation.kind === "pending" || (operation.kind === "unknown" && operation.id === id);
}
export function canDriveAction(
  state: StorageClientState,
  id: StorageVolume["id"],
  action: DriveAction,
): boolean {
  if (
    state.kind !== "ready" ||
    state.snapshot.status.kind !== "ready" ||
    state.snapshot.status.policy !== "interactive"
  )
    return false;
  if (driveOperationBlocked(state, id)) return false;
  const volume = state.snapshot.status.volumes.find((volume) => volume.id === id);
  if (!volume || volume.mount.kind === "unsupported") return false;
  return action === "mount"
    ? volume.mount.kind === "unmounted"
    : action === "unmount"
      ? volume.mount.kind === "mounted"
      : volume.canEject;
}

/** Mount completion is an observed source change, never merely a resolved method call. */
export class RemovableDriveController {
  private stateValue: StorageClientState;
  private alive = true;
  private unsubscribe: () => void;
  private intent: (DriveNavigationIntent & DriveRequest) | null = null;
  private observers = new Set<() => void>();
  private errorValue = "";
  private refreshingValue = false;
  constructor(
    private client: FilesStorageClient,
    private open: (intent: DriveNavigationIntent, directory: string) => void,
    private lost: (roots: readonly string[]) => void,
    private busy: () => boolean = () => false,
  ) {
    this.stateValue = client.state;
    this.unsubscribe = client.subscribe((state) => this.accept(state));
    this.accept(client.state);
  }
  get state() {
    return this.stateValue;
  }
  get refreshing() {
    return this.refreshingValue;
  }
  get error() {
    return this.errorValue;
  }
  request(id: StorageVolume["id"]): DriveRequest | null {
    const state = this.stateValue;
    return state.kind === "ready" && storageVolumes(state).some((volume) => volume.id === id)
      ? { owner: state.owner, revision: state.snapshot.revision, id }
      : null;
  }
  subscribe(listener: () => void): () => void {
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  }
  private publish() {
    for (const listener of this.observers) listener();
  }
  private accept(next: StorageClientState) {
    if (!this.alive) return;
    const previous = this.stateValue;
    const oldRoots = mountedRoots(previous),
      nextRoots = mountedRoots(next);
    this.stateValue = next;
    const changedOwner =
      previous.kind === "ready" && (next.kind !== "ready" || previous.owner !== next.owner);
    if (changedOwner) this.errorValue = "";
    const lost = oldRoots.filter((root) => changedOwner || !nextRoots.includes(root));
    if (lost.length) this.lost(lost);
    const intent = this.intent;
    if (intent) {
      if (
        next.kind !== "ready" ||
        next.owner !== intent.owner ||
        next.snapshot.status.kind !== "ready"
      )
        this.intent = null;
      else {
        const volume = next.snapshot.status.volumes.find((volume) => volume.id === intent.id);
        const operation = next.snapshot.operation;
        if (!volume || operation.kind === "unknown" || operation.kind === "error")
          this.intent = null;
        else if (
          volume.mount.kind === "mounted" &&
          next.snapshot.revision > intent.revision &&
          operation.kind !== "pending"
        ) {
          this.intent = null;
          if (!this.busy()) this.open(intent, volume.mount.paths[0]);
        }
      }
    }
    this.publish();
  }
  async activate(
    id: StorageVolume["id"],
    navigation: DriveNavigationIntent,
    expected?: DriveRequest,
  ): Promise<void> {
    if (!this.alive || this.busy()) return;
    const state = this.stateValue;
    if (state.kind !== "ready" || state.snapshot.status.kind !== "ready") return;
    if (
      expected &&
      (expected.owner !== state.owner ||
        expected.revision !== state.snapshot.revision ||
        expected.id !== id)
    ) {
      this.errorValue = "Drive status changed. Refresh before opening it.";
      this.publish();
      return;
    }
    const volume = state.snapshot.status.volumes.find((volume) => volume.id === id);
    if (!volume || driveOperationBlocked(state, id)) return;
    this.errorValue = "";
    if (volume.mount.kind === "mounted") {
      this.intent = null;
      this.open(navigation, volume.mount.paths[0]);
      return;
    }
    if (!canDriveAction(state, id, "mount")) return;
    this.intent = { ...navigation, owner: state.owner, revision: state.snapshot.revision, id };
    await this.action(id, "mount", true);
  }
  async action(
    id: StorageVolume["id"],
    action: DriveAction,
    keepIntent = false,
    expected?: DriveRequest,
  ): Promise<void> {
    if (!this.alive || this.busy() || !canDriveAction(this.stateValue, id, action)) return;
    const state = this.stateValue;
    if (state.kind !== "ready") return;
    if (
      expected &&
      (expected.owner !== state.owner ||
        expected.revision !== state.snapshot.revision ||
        expected.id !== id)
    ) {
      this.errorValue = "Drive status changed. Refresh before trying this action again.";
      this.publish();
      return;
    }
    if (!keepIntent) this.intent = null;
    const request = { owner: state.owner, revision: state.snapshot.revision, id };
    try {
      await this.client[action](request);
    } catch (error) {
      if (
        this.alive &&
        this.stateValue.kind === "ready" &&
        this.stateValue.owner === request.owner
      ) {
        this.intent = null;
        this.errorValue =
          error instanceof StorageControlError
            ? error.message
            : "Drive request failed. Check its observed status, then refresh and try again.";
        this.publish();
      }
    }
  }
  async refresh(): Promise<void> {
    if (!this.alive || this.refreshingValue) return;
    this.intent = null;
    this.errorValue = "";
    this.refreshingValue = true;
    this.publish();
    try {
      await this.client.refresh();
    } catch {
      if (this.alive) {
        this.errorValue = "Drive status could not be refreshed.";
      }
    } finally {
      this.refreshingValue = false;
      if (this.alive) this.publish();
    }
  }
  cancelNavigation(): void {
    this.intent = null;
  }
  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    this.intent = null;
    this.unsubscribe();
    this.observers.clear();
  }
}
