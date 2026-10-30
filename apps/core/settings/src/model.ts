/**
 * The shapes every page is built from. A page is a plain function of the live models: it
 * returns its summary, an optional hero, banners and sections of rows. The app renders the
 * current page from it, Overview reads summaries from it, and search picks rows out of it, so
 * all three always agree.
 */
import type { ReactNode } from "react";
import type {
  BadgeTone,
  IconName,
  SettingRowSpec,
  SettingsSectionSpec,
  ThemePalette,
} from "@moire/ui";
import type { PageId, Route, SidebarPageId } from "./catalog";

export type Banner = {
  id: string;
  title: string;
  message?: string;
  tone: BadgeTone;
  icon?: IconName;
  action?: ReactNode;
  /** Room for the action (unscaled). */
  actionWidth?: number;
};

export type Hero =
  | {
      kind: "status";
      icon: IconName;
      title: string;
      detail: string;
      control?: ReactNode;
      /** Room for the control (unscaled). */
      controlWidth?: number;
    }
  | {
      kind: "custom";
      /** Unscaled. */
      height: number;
      render: (width: number) => ReactNode;
    };

export type SheetContent = {
  title: string;
  subtitle?: string;
  body: (size: { width: number; height: number }) => ReactNode;
};

export type PageContent = {
  /** One live line under the title; also the sidebar tooltip and Overview's detail. */
  summary: string;
  hero?: Hero;
  banners?: readonly Banner[];
  sections: readonly SettingsSectionSpec[];
  /**
   * Settings whose control lives outside the sections (in the hero), as rows of their own so
   * search can show them.
   */
  searchRows?: readonly SettingRowSpec[];
  /** Deep-link anchors drawn outside the sections, such as the hero's ("displays.arrangement"). */
  anchors?: readonly string[];
  /** Shown instead of the sections when the page's service isn't there. */
  empty?: { title: string; message: string; icon?: IconName; action?: ReactNode };
  /** Details on demand for something on this page, by the id the page opened it with. */
  sheet?: (id: string) => SheetContent | null;
};

/** What a page may ask of the app. */
export type Navigation = {
  go(route: Route): void;
  openSheet(page: PageId, id: string): void;
  closeSheet(): void;
  /** Show a failure at the top of a page until the next attempt; null clears it. */
  report(page: PageId, message: string | null): void;
};

/** Viewport and colours a page lays its controls out with. */
export type Layout = {
  width: number;
  height: number;
  /** The page column's width, which pages lay their pictures out in. */
  columnWidth: number;
  palette: ThemePalette;
};

export type SheetRoute = { page: PageId; id: string };

export type { SidebarPageId };
