import path from "node:path";
import { privatePreview, readableFile, runTool, type Preview } from "@moire/app-tools";
export async function documentInfo(
  value: string,
  signal?: AbortSignal,
): Promise<{ file: string; pages: number; title: string }> {
  const file = await readableFile(value);
  if (path.extname(file).toLowerCase() !== ".pdf")
    throw new Error(
      "Only PDF documents are supported. Word, spreadsheets and ebooks need their own applications.",
    );
  const info = await runTool("pdfinfo", [file], signal);
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
  if (!Number.isSafeInteger(pages) || pages < 1) throw new Error("The PDF has no readable pages.");
  return { file, pages, title: /^Title:\s+(.+)$/m.exec(info)?.[1] ?? path.basename(file) };
}
export async function renderPage(
  file: string,
  page: number,
  pages: number,
  signal?: AbortSignal,
): Promise<Preview> {
  if (!Number.isInteger(page) || page < 1 || page > pages)
    throw new Error("Choose a page inside this document.");
  return privatePreview(async (output) => {
    await runTool(
      "pdftoppm",
      [
        "-f",
        String(page),
        "-l",
        String(page),
        "-singlefile",
        "-scale-to",
        "2200",
        "-png",
        file,
        output.slice(0, -4),
      ],
      signal,
    );
  });
}
