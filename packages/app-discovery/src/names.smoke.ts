/** App display names for "last opened in": installed entries by every id form, else humanised. */
import assert from "node:assert/strict";
import { parseDesktopFile } from "./desktop";
import { applicationDisplayName } from "./names";
import { FileActivationService } from "./open-with";

const imageViewer = parseDesktopFile(
  [
    "[Desktop Entry]",
    "Name=Image Viewer",
    "Exec=moire-image-viewer %U",
    "Type=Application",
    "OnlyShowIn=Moire;",
    "StartupWMClass=org.moire.ImageViewer",
  ].join("\n"),
  "moire-image-viewer.desktop",
  "Moire",
);
assert.ok(imageViewer);
assert.equal(imageViewer.startupWMClass, "org.moire.ImageViewer");
const gimp = parseDesktopFile(
  ["[Desktop Entry]", "Name=GNU Image Manipulation Program", 'Exec="/usr/bin/gimp-2.10" %U'].join(
    "\n",
  ),
  "gimp.desktop",
  "Moire",
);
assert.ok(gimp);
assert.equal(gimp.startupWMClass, undefined);
const apps = [imageViewer, gimp];

// Installed: by desktop id with or without the suffix, window class in any case, or executable.
for (const id of [
  "moire-image-viewer.desktop",
  "moire-image-viewer",
  "org.moire.ImageViewer",
  "ORG.MOIRE.IMAGEVIEWER",
])
  assert.equal(applicationDisplayName(id, apps), "Image Viewer", id);
assert.equal(applicationDisplayName("gimp-2.10", apps), "GNU Image Manipulation Program");

// Not installed: the id made readable.
assert.equal(applicationDisplayName("org.moire.FontViewer", apps), "Font Viewer");
assert.equal(applicationDisplayName("moire-font-viewer", apps), "Font Viewer");
assert.equal(applicationDisplayName("moire-font-viewer.desktop", []), "Font Viewer");
assert.equal(applicationDisplayName("org.gnome.Nautilus", []), "Nautilus");
assert.equal(applicationDisplayName("firefox", []), "Firefox");
assert.equal(applicationDisplayName("moire", []), "Moire");

const service = new FileActivationService(() => {}, apps);
assert.equal(service.applicationName("org.moire.ImageViewer"), "Image Viewer");
assert.equal(service.applicationName("org.moire.Calculator"), "Calculator");
console.log("[app-discovery/names] desktop id, window class, exec and humanised names ok");
