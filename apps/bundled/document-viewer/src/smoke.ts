import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { withFixture } from "@moire/app-tools/testing";
import { documentInfo, renderPage } from "./backend";
import { writeTestPdf } from "./test-pdf";
await withFixture(async (directory) => {
  const pdf = path.join(directory, "two pages.pdf");
  await writeTestPdf(pdf, ["1 0 0", "0 0 1"], { width: 200, height: 100 });
  const info = await documentInfo(pdf);
  assert.equal(info.pages, 2);
  const first = await renderPage(info.file, 1, info.pages, 400),
    second = await renderPage(info.file, 2, info.pages, 400);
  try {
    assert.ok(first.width > first.height);
    assert.equal(first.width, second.width);
    assert.notDeepEqual(
      await fs.readFile(first.file),
      await fs.readFile(second.file),
      "page navigation renders different actual contents",
    );
  } finally {
    await first.dispose();
    await second.dispose();
  }
  await assert.rejects(renderPage(info.file, 3, info.pages, 400), /inside this document/);
  const unsupported = path.join(directory, "document.docx");
  await fs.writeFile(unsupported, "not a PDF");
  await assert.rejects(documentInfo(unsupported), /Only PDF/);
  console.log(
    "[document-viewer] real two-page PDF metadata/render/navigation, bounds, unsupported format and cleanup passed",
  );
});
