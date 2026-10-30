import path from "node:path";
import { privatePreview, readableFile, runTool, type Preview } from "@moire/app-tools";

const MIN_PAGE_PIXELS = 512;
const MAX_PAGE_PIXELS = 4096;
/** pdftoppm processes rendering thumbnails at once, so a long document can't flood the system. */
const THUMBNAIL_CONCURRENCY = 2;

const LETTER = { width: 612, height: 792 };

export type DocumentInfo = {
  file: string;
  pages: number;
  title: string;
  /** The first page's size in points (1/72 in); later pages are assumed alike for layout. */
  pageSize: { width: number; height: number };
};

/** Page height over width, from the first page. */
export function pageAspect(info: DocumentInfo): number {
  return info.pageSize.height / info.pageSize.width;
}

export async function documentInfo(value: string, signal?: AbortSignal): Promise<DocumentInfo> {
  const file = await readableFile(value);
  if (path.extname(file).toLowerCase() !== ".pdf")
    throw new Error(
      "Only PDF documents are supported. Word, spreadsheets and ebooks need their own applications.",
    );
  const info = await runTool("pdfinfo", [file], signal);
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
  if (!Number.isSafeInteger(pages) || pages < 1) throw new Error("The PDF has no readable pages.");
  const size = /^Page size:\s+([\d.]+) x ([\d.]+)/m.exec(info);
  return {
    file,
    pages,
    title: /^Title:\s+(.+)$/m.exec(info)?.[1]?.trim() || path.basename(file),
    pageSize: size ? { width: Number(size[1]), height: Number(size[2]) } : LETTER,
  };
}

/**
 * The render size (long edge, device pixels) for a page shown `shown` pixels along its long
 * edge. Bitmaps are drawn with nearest-neighbour sampling, so text is only crisp when the page
 * is rendered at the size it is shown.
 */
export function pagePixels(shown: number): number {
  return Math.min(MAX_PAGE_PIXELS, Math.max(MIN_PAGE_PIXELS, Math.round(shown)));
}

export async function renderPage(
  file: string,
  page: number,
  pages: number,
  /** Long edge of the render in device pixels. */
  pixels: number,
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
        String(pixels),
        "-png",
        file,
        output.slice(0, -4),
      ],
      signal,
    );
  });
}

/**
 * Small renders of a document's pages for the sidebar, made on demand a few at a time and kept
 * until the document closes.
 */
export class ThumbnailStore {
  private readonly made = new Map<number, Promise<Preview>>();
  private readonly waiting: Array<() => void> = [];
  private running = 0;
  private readonly controller = new AbortController();

  /** `pixels`: the long edge thumbnails are drawn at, so they render at their shown size. */
  constructor(
    private readonly document: DocumentInfo,
    private readonly pixels: number,
  ) {}

  get(page: number): Promise<Preview> {
    let preview = this.made.get(page);
    if (!preview) {
      preview = this.slot().then(async (release) => {
        try {
          return await renderPage(
            this.document.file,
            page,
            this.document.pages,
            this.pixels,
            this.controller.signal,
          );
        } finally {
          release();
        }
      });
      // A failed thumbnail may be asked for again (it scrolled back into view).
      preview.catch(() => this.made.delete(page));
      this.made.set(page, preview);
    }
    return preview;
  }

  /** Stop pending renders and remove every thumbnail's private files. */
  async dispose(): Promise<void> {
    this.controller.abort();
    const made = [...this.made.values()];
    this.made.clear();
    await Promise.all(
      made.map((preview) =>
        preview.then(
          (value) => value.dispose(),
          () => {},
        ),
      ),
    );
  }

  private slot(): Promise<() => void> {
    return new Promise((resolve) => {
      const start = () => {
        this.running++;
        resolve(() => {
          this.running--;
          this.waiting.shift()?.();
        });
      };
      if (this.running < THUMBNAIL_CONCURRENCY) start();
      else this.waiting.push(start);
    });
  }
}
