/** Every page's builder, by page id. */
import type { PageId } from "#settings/catalog";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { aboutPage } from "./about";
import { appearancePage } from "./appearance";
import { appsPage } from "./apps";
import { bluetoothPage } from "./bluetooth";
import { datetimePage } from "./datetime";
import { desktopPage } from "./desktop";
import { displaysPage } from "./displays";
import { keyboardPage } from "./keyboard";
import { networkPage } from "./network";
import { notificationsPage } from "./notifications";
import { overviewPage } from "./overview";
import { powerPage } from "./power";
import { privacyPage } from "./privacy";
import { accessibilityPage } from "./simple";
import { soundPage } from "./sound";
import { storagePage } from "./storage";
import { usersPage } from "./users";

export const PAGE_BUILDERS: Readonly<Record<PageId, (context: PageContext) => PageContent>> = {
  overview: overviewPage,
  network: networkPage,
  bluetooth: bluetoothPage,
  displays: displaysPage,
  sound: soundPage,
  keyboard: keyboardPage,
  power: powerPage,
  storage: storagePage,
  appearance: appearancePage,
  desktop: desktopPage,
  notifications: notificationsPage,
  accessibility: accessibilityPage,
  apps: appsPage,
  privacy: privacyPage,
  users: usersPage,
  datetime: datetimePage,
  about: aboutPage,
};
