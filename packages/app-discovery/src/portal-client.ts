import { SessionBus, type DbusOperationOptions } from "@moire/dbus";

const PORTAL_NAME = "org.freedesktop.impl.portal.desktop.moire";
const PORTAL_PATH = "/org/freedesktop/portal/desktop";
const FILE_ACTIVATION = "org.moire.FileActivation1";

export type FileChooserResponse = 0 | 1 | 2;

let requestSerial = 1;

/** Client for Moire's native chooser service, hosted by the portal process. */
export class FileActivationPortalClient {
  private bus: Promise<SessionBus> | null = null;

  async openWith(
    filePath: string,
    options: DbusOperationOptions = {},
  ): Promise<FileChooserResponse> {
    try {
      const bus = await this.sessionBus();
      const ownerReply = await bus.call(
        {
          destination: "org.freedesktop.DBus",
          path: "/org/freedesktop/DBus",
          interface: "org.freedesktop.DBus",
          member: "GetNameOwner",
          signature: "s",
          body: [PORTAL_NAME],
        },
        { timeoutMs: 3000, signal: options.signal },
      );
      const owner = ownerReply.body?.[0];
      if (typeof owner !== "string" || !owner.startsWith(":"))
        throw new Error("Portal has no unique owner");
      const handle =
        `/org/freedesktop/portal/desktop/request/moire/` +
        `native_${process.pid}_${requestSerial++}`;
      let reply;
      try {
        // This reply awaits a person's choice rather than an immediate service read.
        reply = await bus.call(
          {
            destination: owner,
            path: PORTAL_PATH,
            interface: FILE_ACTIVATION,
            member: "OpenWith",
            signature: "so",
            body: [filePath, handle],
          },
          { ...options, timeoutMs: options.timeoutMs ?? 120000 },
        );
      } catch (error) {
        await bus
          .call(
            {
              destination: owner,
              path: handle,
              interface: "org.freedesktop.impl.portal.Request",
              member: "Close",
            },
            { timeoutMs: 3000 },
          )
          .catch(() => {});
        throw error;
      }
      const response = Number(reply.body?.[0] ?? 2);
      return response === 0 || response === 1 ? response : 2;
    } catch (error) {
      // A restarted session bus should not permanently poison this client.
      const failedBus = this.bus;
      this.bus = null;
      void failedBus?.then((bus) => bus.close()).catch(() => {});
      throw error;
    }
  }

  private sessionBus(): Promise<SessionBus> {
    this.bus ??= SessionBus.connect();
    return this.bus;
  }
}
