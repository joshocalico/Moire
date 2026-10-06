# Colors

`@moire/colors` edits RGB colors and stores named palettes. Its command is
`moire-colors`, desktop entry is `moire-colors.desktop`, and app ID is
`org.moire.Colors`.

Enter a three- or six-digit HEX color, or edit the three RGB channels using
whole numbers from 0 to 255. The preview updates to the valid color and uses
readable light or dark text. Copy HEX writes the canonical six-digit value to
the system clipboard.

Create a named palette in the sidebar. Save Color adds the current color;
selecting a saved swatch lets Update Color change its name or value. New Color
starts a new swatch. Delete Color removes the selected swatch. Rename changes
the current palette name, and Delete Palette asks for confirmation before
removing it and its colors.

Palettes are stored atomically in
`$XDG_DATA_HOME/moire/colors/palettes.json`, defaulting to
`~/.local/share/moire/colors/palettes.json`. A malformed file shows an error and
blocks writes. The editor supports opaque RGB colors; alpha channels, color
profiles and screen color picking are not implemented.

Changes saved by another window block a stale save and retain the current
palette name, HEX value and color name. Keep draft retains that input; Reload
saved reads the current palettes while keeping the draft for a deliberate
retry. Active or unknown save locks report an error without deleting another
writer's state.

Run `pnpm --filter @moire/colors smoke` for HEX/RGB validation and actual
Window palette editing, persistent swatches and clipboard access.
