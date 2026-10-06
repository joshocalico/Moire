import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { withFixture } from "@moire/app-tools/testing";
import { documentInfo, renderPage } from "./backend";
await withFixture(async (directory) => {
  const pdf = path.join(directory, "two pages.pdf");
  const streams = ["1 0 0 rg 0 0 200 100 re f", "0 0 1 rg 0 0 200 100 re f"];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>`,
    `<< /Length ${streams[0]?.length} >>\nstream\n${streams[0]}\nendstream`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 6 0 R >>`,
    `<< /Length ${streams[1]?.length} >>\nstream\n${streams[1]}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await fs.writeFile(pdf, text);
  const info = await documentInfo(pdf);
  assert.equal(info.pages, 2);
  const first = await renderPage(info.file, 1, info.pages),
    second = await renderPage(info.file, 2, info.pages);
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
  await assert.rejects(renderPage(info.file, 3, info.pages), /inside this document/);
  const unsupported = path.join(directory, "document.docx");
  await fs.writeFile(unsupported, "not a PDF");
  await assert.rejects(documentInfo(unsupported), /Only PDF/);
  console.log(
    "[document-viewer] real two-page PDF metadata/render/navigation, bounds, unsupported format and cleanup passed",
  );
});
