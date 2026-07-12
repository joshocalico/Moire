/** Shared SSD chrome metrics (keep in sync with TitleBar / Panel). */
export const SSD_TITLEBAR_H = 32;
export const SSD_PANEL_H = 36;

export type SsdWindowInfo = {
  surfaceId: number;
  /** Distinguishes clients — Wayland object ids are per-connection. */
  clientId: number;
  /** Frame origin (titlebar top-left). */
  x: number;
  y: number;
  contentW: number;
  contentH: number;
  title: string;
  focused: boolean;
};

export type SsdAction =
  | { kind: "drag"; surfaceId: number; clientId: number }
  | { kind: "close"; surfaceId: number; clientId: number }
  | { kind: "maximize"; surfaceId: number; clientId: number }
  | { kind: "minimize"; surfaceId: number; clientId: number };
