#!/usr/bin/env bash
# Install available Moire launchers and MIME registrations into this session.
register_moire_apps() {
  local root="$1" data_home="${XDG_DATA_HOME:-$HOME/.local/share}" entry command launcher mime current
  mkdir -p "$HOME/.local/bin" "$data_home/applications"
  for entry in "$root"/apps/{bundled,core,developer}/*/*.desktop; do
    [[ -f "$entry" ]] || continue
    launcher="$(basename "$entry" .desktop)"
    [[ -x "$(dirname "$entry")/$launcher" ]] || continue
    ln -sfn "$(dirname "$entry")/$launcher" "$HOME/.local/bin/$launcher"
    install -m 644 "$entry" "$data_home/applications/$(basename "$entry")"
  done
  # Namespaced vector identities work in development and the installed session.
  for entry in "$root"/packages/ui/icons/*.svg; do
    [[ -f "$entry" ]] || continue
    mkdir -p "$data_home/icons/hicolor/scalable/apps"
    install -m 644 "$entry" "$data_home/icons/hicolor/scalable/apps/moire-$(basename "$entry")"
  done
  # Recovery UI is service-launched rather than duplicated in the launcher.
  ln -sfn "$root/apps/core/memory-pressure/moire-memory-pressure" "$HOME/.local/bin/moire-memory-pressure"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$data_home/applications" >/dev/null 2>&1 || true
  fi
  if command -v xdg-mime >/dev/null 2>&1; then
    while read -r launcher mime; do
      [[ -f "$data_home/applications/$launcher" ]] || continue
      current="$(xdg-mime query default "$mime" 2>/dev/null || true)"
      [[ -n "$current" ]] || xdg-mime default "$launcher" "$mime"
    done <<'MIMES'
moire-files.desktop inode/directory
moire-editor.desktop text/plain
moire-editor.desktop text/markdown
moire-editor.desktop text/x-log
moire-editor.desktop application/json
moire-image-viewer.desktop image/png
moire-image-viewer.desktop image/jpeg
moire-image-viewer.desktop image/webp
moire-image-viewer.desktop image/gif
moire-image-viewer.desktop image/bmp
moire-image-viewer.desktop image/tiff
moire-document-viewer.desktop application/pdf
moire-music.desktop audio/mpeg
moire-music.desktop audio/flac
moire-music.desktop audio/ogg
moire-music.desktop audio/x-wav
moire-music.desktop audio/mp4
moire-video-player.desktop video/mp4
moire-video-player.desktop video/x-matroska
moire-video-player.desktop video/webm
moire-video-player.desktop video/quicktime
moire-archive-manager.desktop application/zip
moire-archive-manager.desktop application/x-tar
moire-archive-manager.desktop application/gzip
moire-archive-manager.desktop application/x-xz
moire-archive-manager.desktop application/x-bzip2
moire-archive-manager.desktop application/x-7z-compressed
moire-font-viewer.desktop font/ttf
moire-font-viewer.desktop font/otf
moire-font-viewer.desktop font/collection
moire-font-viewer.desktop application/x-font-ttf
moire-font-viewer.desktop application/x-font-opentype
MIMES
  fi
}
