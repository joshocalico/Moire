/**
 * The PDF reader against real Quartz output (cupsfilter on macOS) and hand-built documents that
 * exercise each path: plain objects with Differences and TJ kerning, ASCII85/hex filter chains,
 * object streams with an xref stream and a ToUnicode Identity-H font, encryption, damage and
 * non-PDF input. Where poppler is installed, page counts, titles and text are cross-checked.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { readPdf } from "./pdf";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** A document from object bodies (numbered from 1) with a correct classic xref table. */
function buildPdf(objects: Array<string | Buffer>, trailer: string): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      typeof body === "string" ? Buffer.from(body, "latin1") : body,
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(part);
    length += part.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${length}\n%%EOF\n`,
  ].join("");
  return Buffer.concat([...parts, Buffer.from(xref, "latin1")]);
}

const stream = (dict: string, data: Buffer) =>
  Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"),
    data,
    Buffer.from("\nendstream"),
  ]);

function ascii85(data: Buffer): Buffer {
  let out = "";
  for (let index = 0; index < data.length; index += 4) {
    const chunk = data.subarray(index, index + 4);
    const padded = Buffer.concat([chunk, Buffer.alloc(4 - chunk.length)]);
    let value = padded.readUInt32BE(0);
    if (value === 0 && chunk.length === 4) {
      out += "z";
      continue;
    }
    const digits: string[] = [];
    for (let digit = 0; digit < 5; digit++) {
      digits.unshift(String.fromCharCode((value % 85) + 33));
      value = Math.floor(value / 85);
    }
    out += digits.slice(0, chunk.length + 1).join("");
  }
  return Buffer.from(`${out}~>`, "latin1");
}

/** Two pages of plain objects: WinAnsi with Differences, TJ kerning, T*, ', and filter chains. */
function plainDocument(): Buffer {
  const page1 = Buffer.from(
    "BT /F1 12 Tf 72 720 Td (Hello PDF world) Tj 0 -14 Td (Second \\(line\\) caf\\351 \\001 dash) Tj ET",
    "latin1",
  );
  const page2 = Buffer.from(
    "BT /F1 12 Tf 14 TL 72 720 Td [(Kern) -30 (ed) -250 (word)] TJ T* (Next line) Tj (Third line) ' ET",
    "latin1",
  );
  return buildPdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Resources << /Font << /F1 5 0 R >> >> >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents [7 0 R] >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /BaseEncoding /WinAnsiEncoding /Differences [1 /emdash] >> >>",
      stream("/Filter /ASCII85Decode", ascii85(page1)),
      stream(
        "/Filter [/ASCIIHexDecode /FlateDecode]",
        Buffer.from(`${deflateSync(page2).toString("hex")}>`, "latin1"),
      ),
      "<< /Title (Report \\204 Draft) /Author <FEFF005A006F00EB002000DC006E00EF0063006F00640065> /Creator (Smoke) /CreationDate (D:20240601143000+02'00') >>",
    ],
    "/Root 1 0 R /Info 8 0 R",
  );
}

/**
 * PDF 1.5 layout: catalog, pages, font and Info live in an object stream; the trailer is an xref
 * stream with a PNG Up predictor; the font is Type0 Identity-H with a ToUnicode CMap using
 * bfchar, a bfrange with a base and a bfrange with an array.
 */
function compressedDocument(): Buffer {
  const toUnicode = Buffer.from(
    [
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
      "1 begincodespacerange <0000> <FFFF> endcodespacerange",
      "2 beginbfchar <0001> <0048> <0002> <0069> endbfchar",
      "2 beginbfrange <0003> <0005> <0074> <0010> <0012> [<0068> <0065> <0072>] endbfrange",
      "endcmap CMapName currentdict /CMap defineresource pop end end",
    ].join("\n"),
  );
  const content = Buffer.from(
    "q 1 0 0 1 0 0 cm BT /F1 10 Tf 50 700 Td [<00010002> -300 <00030010001100120011>] TJ ET Q",
  );
  const compressed = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /Fake /Encoding /Identity-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fake /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 600 >>] /ToUnicode 7 0 R >>",
    "<< /Title <FEFF004F0062006A006500630074002000730074007200650061006D> /Producer (smoke) >>",
  ];
  // Object stream: "num offset" pairs, then the objects.
  let body = "";
  const header: string[] = [];
  compressed.forEach((object, index) => {
    header.push(`${index + 1} ${body.length}`);
    body += `${object}\n`;
  });
  const headerText = `${header.join(" ")}\n`;
  const objectStream = deflateSync(Buffer.from(headerText + body));
  const parts: Buffer[] = [Buffer.from("%PDF-1.5\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let length = parts[0]!.length;
  const offsets = new Map<number, number>();
  const add = (num: number, data: Buffer) => {
    offsets.set(num, length);
    const part = Buffer.concat([Buffer.from(`${num} 0 obj\n`), data, Buffer.from("\nendobj\n")]);
    parts.push(part);
    length += part.length;
  };
  add(
    8,
    stream(
      `/Type /ObjStm /N ${compressed.length} /First ${headerText.length} /Filter /FlateDecode`,
      objectStream,
    ),
  );
  add(6, stream("/Filter /FlateDecode", deflateSync(content)));
  add(7, stream("/Filter /FlateDecode", deflateSync(toUnicode)));
  // Xref rows: type (1 byte), offset or object stream (4), generation or index (2).
  const rows: number[][] = [[0, 0, 0, 0, 0, 0xff, 0xff]];
  const row = (type: number, field: number, index: number) => [
    type,
    (field >>> 24) & 0xff,
    (field >>> 16) & 0xff,
    (field >>> 8) & 0xff,
    field & 0xff,
    (index >>> 8) & 0xff,
    index & 0xff,
  ];
  for (let num = 1; num <= 5; num++) rows.push(row(2, 8, num - 1));
  rows.push(row(1, offsets.get(6)!, 0), row(1, offsets.get(7)!, 0), row(1, offsets.get(8)!, 0));
  rows.push(row(1, length, 0));
  // PNG "Up" predictor: each byte minus the one above it.
  const predicted = rows.flatMap((current, index) => [
    2,
    ...current.map((value, column) => (value - (rows[index - 1]?.[column] ?? 0)) & 0xff),
  ]);
  const xrefOffset = length;
  add(
    9,
    stream(
      "/Type /XRef /Size 10 /W [1 4 2] /Root 1 0 R /Info 5 0 R /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >>",
      deflateSync(Buffer.from(predicted)),
    ),
  );
  return Buffer.concat([...parts, Buffer.from(`startxref\n${xrefOffset}\n%%EOF\n`)]);
}

function encryptedDocument(): Buffer {
  return buildPdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
      stream("", Buffer.from("BT /F1 12 Tf (scrambled) Tj ET")),
      "<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>",
      "<< /Title (scrambled title) >>",
    ],
    "/Root 1 0 R /Encrypt 5 0 R /Info 6 0 R",
  );
}

/** Poppler's view of a document, when it is installed; null otherwise. */
function poppler(bytes: Buffer): { pages: number; title: string; text: string } | null {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-pdf-"));
  const file = path.join(directory, "document.pdf");
  try {
    fs.writeFileSync(file, bytes);
    const info = execFileSync("pdfinfo", [file], { encoding: "utf8", stdio: "pipe" });
    const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8", stdio: "pipe" });
    return {
      pages: Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]),
      title: /^Title:[ \t]+(.*)$/m.exec(info)?.[1]?.trim() ?? "",
      text,
    };
  } catch {
    return null;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
let crossChecked = 0;
function crossCheck(bytes: Buffer, result: ReturnType<typeof readPdf>): void {
  const reference = poppler(bytes);
  if (!reference) return;
  crossChecked++;
  assert.equal(result.pages, reference.pages, "page count matches pdfinfo");
  assert.equal(result.title ?? "", reference.title, "title matches pdfinfo");
  const mine = new Set(words(result.text));
  for (const word of words(reference.text)) assert.ok(mine.has(word), `text has "${word}"`);
}

// Real Quartz output: one page, then two pages with typographic characters.
{
  const bytes = fs.readFileSync(path.join(fixtures, "pdf-quartz-text.pdf"));
  const result = readPdf(bytes);
  assert.equal(result.pages, 1);
  assert.equal(result.encrypted, false);
  assert.match(result.producer ?? "", /Quartz PDFContext/);
  // 2026-10-10 16:12:56 +10:30
  assert.equal(result.created, Date.UTC(2026, 9, 10, 5, 42, 56));
  assert.equal(
    result.text,
    "Moire quarterly report\nThe quick brown fox jumps over the lazy dog.\nSecond line with café and naïve.",
  );
  crossCheck(bytes, result);
}
{
  const bytes = fs.readFileSync(path.join(fixtures, "pdf-quartz-two-pages.pdf"));
  const result = readPdf(bytes);
  assert.equal(result.pages, 2);
  const lines = result.text.split("\n").filter(Boolean);
  assert.equal(lines[0], "Line 1 of the longer document: résumé naïve “quoted” — dash");
  assert.ok(lines.includes("Line 90 of the longer document: résumé naïve “quoted” — dash"));
  // Page caps stop after the first page.
  assert.doesNotMatch(readPdf(bytes, { maxPages: 1 }).text, /Line 90 /);
  assert.equal(readPdf(bytes, { maxTextChars: 40 }).text.length, 40);
  crossCheck(bytes, result);
}

// Plain objects, Differences, kerning gaps, T* and ', ASCII85 and a hex+flate chain.
{
  const bytes = plainDocument();
  const result = readPdf(bytes);
  assert.equal(result.pages, 2);
  assert.equal(result.title, "Report — Draft", "PDFDocEncoding");
  assert.equal(result.author, "Zoë Ünïcode", "UTF-16BE");
  assert.equal(result.creator, "Smoke");
  assert.equal(result.created, Date.UTC(2024, 5, 1, 12, 30));
  assert.equal(
    result.text,
    "Hello PDF world\nSecond (line) café — dash\n\nKerned word\nNext line\nThird line",
  );
  crossCheck(bytes, result);
}

// Object stream, xref stream with predictor, Identity-H font with ToUnicode.
{
  const bytes = compressedDocument();
  const result = readPdf(bytes);
  assert.equal(result.pages, 1);
  assert.equal(result.title, "Object stream");
  assert.equal(result.producer, "smoke");
  assert.equal(result.text, "Hi there");
  crossCheck(bytes, result);
}

// Encrypted: structure is readable, strings and streams are not.
{
  const result = readPdf(encryptedDocument());
  assert.equal(result.encrypted, true);
  assert.equal(result.pages, 1);
  assert.equal(result.title, null);
  assert.equal(result.text, "");
}

// Damage never throws; a non-PDF does.
{
  const bytes = fs.readFileSync(path.join(fixtures, "pdf-quartz-two-pages.pdf"));
  for (const cut of [0.2, 0.5, 0.8]) {
    const result = readPdf(bytes.subarray(0, Math.floor(bytes.length * cut)));
    assert.equal(typeof result.text, "string");
  }
  const garbage = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(4096, 0x28)]);
  assert.deepEqual(readPdf(garbage).pages, null);
  assert.throws(() => readPdf(Buffer.from("PK\x03\x04 not a pdf")), /not a PDF/);
}

console.log(
  `pdf: ok (quartz, plain, object streams, encrypted, damaged; ${crossChecked} cross-checked with poppler)`,
);
