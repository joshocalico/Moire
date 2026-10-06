# Document Viewer

Open a PDF path or file URL. Previous/Next and the page-number field render the actual requested page. Fit width, zoom, vertical scrolling and horizontal Pan inspect the rendered page.

Only PDF is supported. Password-protected PDFs report Poppler's error; there is no password-entry flow. Word documents, spreadsheets and ebooks are rejected. Pages render privately at a bounded 2200-pixel scale.

Package: `apps/bundled/document-viewer`. Launcher: `moire-document-viewer`.
Required guest tools: pdfinfo and pdftoppm from poppler_utils.

## Verification

```bash
pnpm --filter @moire/document-viewer smoke
pnpm --filter @moire/document-viewer typecheck
```

Actual two-page PDF metadata, distinct rendered page contents, bounds, unsupported formats and cleanup.

Tests write only disposable fixtures with isolated HOME/XDG directories.
Live focus, overlap, resize, keyboard and output-device acceptance remains open.
