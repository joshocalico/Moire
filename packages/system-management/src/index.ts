import { SessionBus } from "@moire/dbus";

export const SYSTEM_MANAGEMENT_BUS = "org.moire.SystemManagement1";
export const SYSTEM_MANAGEMENT_PATH = "/org/moire/SystemManagement1";
export const SYSTEM_MANAGEMENT_INTERFACE = "org.moire.SystemManagement1";

export type ManagedProcess = {
  pid: number;
  name: string;
  appId: string;
  command: string;
  rssBytes: number;
  cpuPercent: number;
  protected: boolean;
};

export type SystemSnapshot = {
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
  processes: ManagedProcess[];
};

type WireProcess = [number, string, string, string, number, number, boolean];

function bigintNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

/** Typed client for the privileged, session-owned management service. */
export class SystemManagementClient {
  private constructor(private readonly bus: SessionBus) {}

  static async connect(): Promise<SystemManagementClient> {
    return new SystemManagementClient(await SessionBus.connect());
  }

  async snapshot(): Promise<SystemSnapshot> {
    const reply = await this.bus.call({
      destination: SYSTEM_MANAGEMENT_BUS,
      path: SYSTEM_MANAGEMENT_PATH,
      interface: SYSTEM_MANAGEMENT_INTERFACE,
      member: "GetSnapshot",
    });
    const [total, available, swapTotal, swapFree, rawProcesses] = reply.body ?? [];
    const processes = ((rawProcesses as WireProcess[] | undefined) ?? []).map(
      ([pid, name, appId, command, rssKiB, cpuBasisPoints, protectedProcess]) => ({
        pid: Number(pid),
        name: String(name),
        appId: String(appId),
        command: String(command),
        rssBytes: Number(rssKiB) * 1024,
        cpuPercent: Number(cpuBasisPoints) / 100,
        protected: Boolean(protectedProcess),
      }),
    );
    return {
      totalMemoryBytes: bigintNumber(total),
      availableMemoryBytes: bigintNumber(available),
      swapTotalBytes: bigintNumber(swapTotal),
      swapFreeBytes: bigintNumber(swapFree),
      processes,
    };
  }

  async terminate(pid: number, force = false): Promise<boolean> {
    const reply = await this.bus.call({
      destination: SYSTEM_MANAGEMENT_BUS,
      path: SYSTEM_MANAGEMENT_PATH,
      interface: SYSTEM_MANAGEMENT_INTERFACE,
      member: "Terminate",
      signature: "ub",
      body: [pid, force],
    });
    return Boolean(reply.body?.[0]);
  }

  close(): void {
    this.bus.close();
  }
}

export function memoryPressure(snapshot: SystemSnapshot): number {
  if (snapshot.totalMemoryBytes <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - snapshot.availableMemoryBytes / snapshot.totalMemoryBytes));
}
