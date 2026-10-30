import type { ImageData } from "@moire/ui";
import { applyEdits, type Edit } from "./image";

type Revision = { revision: number; edits: readonly Edit[] };
/** Revisions identify edit states, so undoing to the saved state is clean again. */
export type ScreenshotDocument = Revision & {
  original: ImageData | null;
  savedRevision: number | null;
  nextRevision: number;
  undo: readonly Revision[];
};
export function emptyDocument(): ScreenshotDocument {
  return {
    original: null,
    edits: [],
    revision: 0,
    nextRevision: 1,
    savedRevision: 0,
    undo: [],
  };
}
export function replaceDocument(
  previous: ScreenshotDocument,
  image: ImageData,
  saved: boolean,
): ScreenshotDocument {
  return {
    original: image,
    edits: [],
    undo: [],
    revision: previous.nextRevision,
    nextRevision: previous.nextRevision + 1,
    savedRevision: saved ? previous.nextRevision : null,
  };
}
export function changeEdits(
  document: ScreenshotDocument,
  edits: readonly Edit[],
): ScreenshotDocument {
  if (!document.original) return document;
  return {
    ...document,
    edits,
    revision: document.nextRevision,
    nextRevision: document.nextRevision + 1,
    undo: [...document.undo, { revision: document.revision, edits: document.edits }],
  };
}
export function undoDocument(document: ScreenshotDocument): ScreenshotDocument {
  const prior = document.undo.at(-1);
  return prior ? { ...document, ...prior, undo: document.undo.slice(0, -1) } : document;
}
export function markSaved(document: ScreenshotDocument, revision: number): ScreenshotDocument {
  return { ...document, savedRevision: revision };
}
export function isDirty(document: ScreenshotDocument): boolean {
  return document.original !== null && document.savedRevision !== document.revision;
}
export function documentImage(document: ScreenshotDocument): ImageData | null {
  return document.original ? applyEdits(document.original, document.edits) : null;
}
