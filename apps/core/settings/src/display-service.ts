/** The compositor's display service (org.moire.Display1) as Settings sees it. */
import { SessionBus } from "@moire/dbus";

export type ConnectedOutput = {
  id: string;
  name: string;
  make: string;
  model: string;
  serial: string;
  mode: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale120: number;
  primary: boolean;
};

export type DisplayState = {
  modes: string[];
  current: string;
  preferred: string;
  name: string;
  widthMm: number;
  heightMm: number;
  outputs: ConnectedOutput[];
};

export type DisplayController = DisplayState & {
  getState: () => Promise<DisplayState>;
  setMode: (modeId: string) => Promise<boolean>;
  confirmMode: () => Promise<boolean>;
  revertMode: () => Promise<boolean>;
  setLayout: (outputs: ConnectedOutput[]) => Promise<boolean>;
  confirmLayout: () => Promise<boolean>;
  revertLayout: () => Promise<boolean>;
};

export type ParsedDisplayMode = {
  id: string;
  width: number;
  height: number;
  refreshMilliHz: number;
  resolution: string;
};

export function parseDisplayMode(modeId: string): ParsedDisplayMode | null {
  const match = /^(\d+)x(\d+)@(\d+)$/.exec(modeId);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return {
    id: modeId,
    width,
    height,
    refreshMilliHz: Number(match[3]),
    resolution: `${width}x${height}`,
  };
}

export function resolutionForMode(modeId: string): string {
  return parseDisplayMode(modeId)?.resolution ?? "";
}

export function refreshLabel(refreshMilliHz: number): string {
  const hz = refreshMilliHz / 1000;
  return `${Number.isInteger(hz) ? hz : hz.toFixed(2)} Hz`;
}

export function displayModeLabel(modeId: string): string {
  const mode = parseDisplayMode(modeId);
  if (!mode) return modeId;
  return `${mode.width} × ${mode.height}  ·  ${refreshLabel(mode.refreshMilliHz)}`;
}

const SERVICE = {
  destination: "org.moire.Display1",
  path: "/org/moire/Display1",
  interface: "org.moire.Display1",
} as const;

export async function connectDisplayController(): Promise<{
  bus: SessionBus;
  controller: DisplayController;
} | null> {
  try {
    const bus = await SessionBus.connect();
    const getState = async (): Promise<DisplayState> => {
      const [reply, outputReply, outputsReply] = await Promise.all([
        bus.call({ ...SERVICE, member: "GetModes" }),
        bus.call({ ...SERVICE, member: "GetOutputInfo" }),
        bus.call({ ...SERVICE, member: "ListOutputs" }),
      ]);
      const outputRows = Array.isArray(outputsReply.body?.[0]) ? outputsReply.body[0] : [];
      return {
        modes: Array.isArray(reply.body?.[0]) ? reply.body[0].map(String) : [],
        current: String(reply.body?.[1] ?? ""),
        preferred: String(reply.body?.[2] ?? ""),
        name: String(outputReply.body?.[0] ?? "Display"),
        widthMm: Number(outputReply.body?.[1] ?? 0),
        heightMm: Number(outputReply.body?.[2] ?? 0),
        outputs: outputRows
          .filter((row): row is unknown[] => Array.isArray(row))
          .map((row) => ({
            id: String(row[0] ?? ""),
            name: String(row[1] ?? "Display"),
            make: String(row[2] ?? ""),
            model: String(row[3] ?? "Display"),
            serial: String(row[4] ?? ""),
            mode: String(row[5] ?? ""),
            x: Number(row[6] ?? 0),
            y: Number(row[7] ?? 0),
            width: Number(row[8] ?? 0),
            height: Number(row[9] ?? 0),
            scale120: Number(row[10] ?? 120),
            primary: row[11] === true,
          })),
      };
    };
    const initial = await getState();
    const callBoolean = async (member: string, body?: unknown[]) => {
      const result = await bus.call({
        ...SERVICE,
        member,
        ...(body ? { signature: "s", body } : {}),
      });
      return result.body?.[0] === true;
    };
    return {
      bus,
      controller: {
        ...initial,
        getState,
        setMode: (modeId) => callBoolean("SetMode", [modeId]),
        confirmMode: () => callBoolean("ConfirmMode"),
        revertMode: () => callBoolean("RevertMode"),
        setLayout: async (outputs) => {
          const result = await bus.call({
            ...SERVICE,
            member: "SetLayout",
            signature: "a(siiub)",
            body: [
              outputs.map((output) => [
                output.id,
                output.x,
                output.y,
                output.scale120,
                output.primary,
              ]),
            ],
          });
          return result.body?.[0] === true;
        },
        confirmLayout: () => callBoolean("ConfirmLayout"),
        revertLayout: () => callBoolean("RevertLayout"),
      },
    };
  } catch (error) {
    console.warn("[settings] display service unavailable:", error);
    return null;
  }
}
