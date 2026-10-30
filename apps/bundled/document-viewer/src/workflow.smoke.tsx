/**
 * Document Viewer as a person uses it: open a PDF through the file chooser, page with the
 * thumbnails, Page Up/Down/Home/End and the go-to-page field, zoom with Ctrl+wheel and keys,
 * scroll with the wheel, hide the thumbnails, and see an unreadable PDF reported. Real poppler.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { loadRecentFiles } from "@moire/app-tools";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import { DocumentViewerApp } from "./main";
import { writeTestPdf } from "./test-pdf";

/** The parts of a painted scene node these checks read. */
type SceneNode = { kind: string; x: number; y: number; width: number; children: SceneNode[] };

const KEY = { down: 108, enter: 28, pageUp: 104, pageDown: 109, home: 102, end: 107, equal: 13 };
const COLOURS = ["1 0 0", "0 1 0", "0 0 1", "1 1 0", "0 1 1"];

/** The drawn page: the largest image (icons and thumbnails are under 100px wide). */
function pageNode(root: SceneNode): { y: number; width: number } | null {
  let largest: { y: number; width: number } | null = null;
  const walk = (node: SceneNode, y: number) => {
    y += node.y;
    if (node.kind === "image" && node.width > (largest?.width ?? 100))
      largest = { y, width: node.width };
    for (const child of node.children) walk(child, y);
  };
  walk(root, 0);
  return largest;
}

await withFixture(async (home) => {
  const documents = path.join(home, "Documents");
  await fs.mkdir(documents, { recursive: true });
  const report = path.join(documents, "report.pdf");
  await writeTestPdf(report, COLOURS);
  await fs.writeFile(path.join(documents, "notes.txt"), "not offered");

  const app = await mountWindow((size) => <DocumentViewerApp {...size} />, {
    width: 1200,
    height: 700,
  });
  const root = () => (app.window as unknown as { root: { container: SceneNode } }).root.container;
  const has = (text: string) => app.texts().includes(text);
  const onPage = (page: number) =>
    app.until(() => has(`Page ${page} of 5`), `expected page ${page}: ${app.texts().join(" | ")}`);
  const rendered = () =>
    app.until(
      () => !app.texts().some((text) => text.startsWith("Rendering")) && !!pageNode(root()),
      "the page renders",
      6000,
    );
  try {
    // The empty state's primary action is the chooser, which starts in Documents.
    app.press({ text: "Open…" });
    await app.settle();
    assert.ok(has("report.pdf") && !has("notes.txt"), "the chooser offers only PDFs");
    app.key(KEY.down, "ArrowDown");
    app.key(KEY.enter, "Enter");
    await onPage(1);
    await rendered();
    assert.deepEqual(loadRecentFiles("org.moire.DocumentViewer"), [report]);

    // Thumbnails: every page is listed and pressing one shows it.
    await app.until(() => {
      try {
        app.press({ focusId: "document:thumbnail:3" });
        return true;
      } catch {
        return false;
      }
    }, "the thumbnail sidebar lists page 3");
    await onPage(3);

    // Paging keys.
    app.key(KEY.pageDown, "PageDown");
    await onPage(4);
    app.key(KEY.end, "End");
    await onPage(5);
    app.key(KEY.pageDown, "PageDown");
    await onPage(5);
    app.key(KEY.home, "Home");
    await onPage(1);
    app.key(KEY.pageUp, "PageUp");
    await onPage(1);
    await rendered();

    // Keyboard zoom, then the go-to-page field: typing digits there doesn't trigger shortcuts.
    const fitted = app.texts().find((text) => /^\d+%$/.test(text))!;
    app.key(KEY.equal, "=", { text: "=" });
    await app.settle(2);
    const zoomed = app.texts().find((text) => /^\d+%$/.test(text))!;
    assert.ok(parseInt(zoomed) > parseInt(fitted), "= zooms in");
    app.press({ text: "1" });
    app.key(30, "a", { ctrl: true });
    app.type("40");
    app.key(KEY.enter, "Enter");
    await app.until(() => has("Enter a page from 1 to 5."), "an out-of-range page is explained");
    assert.ok(has(zoomed), "typing 0 in the page field doesn't reset the zoom");
    app.key(30, "a", { ctrl: true });
    app.type("4");
    app.key(KEY.enter, "Enter");
    await onPage(4);
    await rendered();

    // Ctrl+wheel zooms; the plain wheel scrolls the zoomed page.
    app.press({ focusId: "document:fit" });
    await app.settle(2);
    assert.ok(has(fitted), "Fit width restores the fitted zoom");
    const at = { x: 700, y: 400 };
    app.native.injectPointer({
      type: "wheel",
      ...at,
      deltaY: -100,
      modifiers: { shift: false, ctrl: true, alt: false, meta: false },
      timeMs: 3,
    });
    await app.settle(2);
    assert.ok(!has(fitted), "Ctrl+wheel zooms");
    const before = pageNode(root())!;
    app.native.injectPointer({ type: "wheel", ...at, deltaY: 120, timeMs: 4 });
    await app.settle(2);
    assert.ok(pageNode(root())!.y < before.y, "the wheel scrolls down the page");

    // The thumbnails can be hidden to give the page the whole window.
    app.press({ focusId: "document:sidebar" });
    await app.settle(2);
    assert.throws(() => app.press({ focusId: "document:thumbnail:1" }), "thumbnails hidden");
  } finally {
    app.destroy();
  }

  // An unreadable PDF is reported with a way to try again.
  const broken = path.join(documents, "broken.pdf");
  await fs.writeFile(broken, "%PDF-1.4 not really");
  const failed = await mountWindow((size) => <DocumentViewerApp {...size} initialPath={broken} />);
  try {
    await failed.until(() => failed.texts().includes("This document can't be shown"), "error");
    assert.ok(failed.texts().includes("Try again"));
  } finally {
    failed.destroy();
  }
});
console.log(
  "[document-viewer/workflow] chooser open, recent, thumbnails, PgUp/PgDn/Home/End, go-to-page, +/Fit, Ctrl+wheel zoom, wheel scroll, sidebar toggle and unreadable PDF passed",
);
