# Screenshot

`@moire/screenshot` captures the primary display and edits PNG images. Its
command is `moire-screenshot [image.png]`, desktop entry is
`moire-screenshot.desktop`, and app ID is `org.moire.Screenshot`.

Set a capture delay from 0 to 30 seconds, then Capture. Cancel cancels
the delay or ignores the result of a capture already dispatched. Capture includes all visible windows, including
Screenshot itself; the delay gives time to arrange the desktop. The backend
captures the compositor's latest composed primary-output frame. It does not
provide window exclusion, region selection before capture, or additional
output selection.

Open PNG loads an existing file, so editing remains available when the Moire
capture service is unavailable. Drag on the preview to crop, draw with the
pen, or mark a rectangle. Annotation color accepts `#RRGGBB`. Undo removes the
last edit, and Reset restores the original image. The pen displays a live
preview while drawing. Crops require a positive area.

Enter a `.png` destination and Save PNG. The default is a dated file under
`~/Pictures/Screenshots`. Existing destinations require replacement
confirmation. Save encodes actual edited RGBA pixels, uses a temporary file
and atomic publication, and creates missing destination directories. Images
larger than 32 million pixels are rejected.

Opening another image, starting a capture or closing with unsaved edits asks
Save, Discard or Cancel. Save continues the requested action only after the
PNG is published successfully. Failed reads, captures and saves retain the
current image; canceling replacement retains the existing destination. Closing
is blocked while publication is in progress. Undoing to the saved revision
clears the unsaved state. There is no text annotation,
clipboard image transfer or non-PNG import/export.

Desktop capture calls `org.moire.Display1.CaptureScreenshot` on
`/org/moire/Display1` over the session bus. The returned private capture file
is decoded and its temporary directory is removed; edited copies remain in
memory until saved. A service failure appears in the app with the Open PNG
fallback.

Run `pnpm --filter @moire/screenshot smoke` for pixels produced by the actual
software renderer, cropping and annotation, PNG round trips, overwrite
protection, and actual Window crop/save input. These checks do not start a
native compositor session; the compositor capture endpoint has separate
backend coverage.

The suite also runs document revision and actual Window lifecycle regressions,
including guarded replacement, failed saves, delayed capture cancellation,
compact keyboard crop/save controls and theme/scale layouts. Native capture
and physical keyboard acceptance remain separate checks.
