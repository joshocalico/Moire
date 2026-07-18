import { SessionBus } from "@moire/dbus";

const PORTAL_NAME = "org.freedesktop.impl.portal.desktop.moire";
const PORTAL_PATH = "/org/freedesktop/portal/desktop";
const FILE_ACTIVATION = "org.moire.FileActivation1";

export type FileChooserResponse = 0 | 1 | 2;

let requestSerial = 1;

/** Client for Moire's native chooser service, hosted by the portal process. */
export class FileActivationPortalClient {
  private bus: Promise<SessionBus> | null = null;

  async openWith(filePath: string): Promise<FileChooserResponse> {
    try {
      const bus = await this.sessionBus();
      const handle =
        `/org/freedesktop/portal/desktop/request/moire/` +
        `native_${process.pid}_${requestSerial++}`;
      const reply = await bus.call({
        destination: PORTAL_NAME,
        path: PORTAL_PATH,
        interface: FILE_ACTIVATION,
        member: "OpenWith",
        signature: "so",
        body: [filePath, handle],
      });
      const response = Number(reply.body?.[0] ?? 2);
      return response === 0 || response === 1 ? response : 2;
    } catch (error) {
      // A restarted session bus should not permanently poison this client.
      this.bus = null;
      throw error;
    }
  }

  private sessionBus(): Promise<SessionBus> {
    this.bus ??= SessionBus.connect();
    return this.bus;
  }
}
