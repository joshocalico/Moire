#!/usr/bin/env bash
# Apply Moire GTK theme for the current session user.
# Sourced from moire-session (expects ROOT to be set).
# Safe to call multiple times; idempotent.

moire_apply_gtk_theme() {
  local theme_src="${ROOT}/themes/Moire"
  if [[ ! -d "$theme_src/gtk-3.0" ]]; then
    echo "moire-session: Moire GTK theme missing at $theme_src" >&2
    return 0
  fi

  mkdir -p "${HOME}/.themes" \
    "${HOME}/.config/gtk-3.0" \
    "${HOME}/.config/gtk-4.0"

  ln -sfn "$theme_src" "${HOME}/.themes/Moire"

  # libadwaita (Nautilus) ignores GtkTheme; user CSS still applies.
  ln -sfn "$theme_src/gtk-4.0/adw-overrides.css" "${HOME}/.config/gtk-4.0/gtk.css"

  cat > "${HOME}/.config/gtk-3.0/settings.ini" <<'EOF'
[Settings]
gtk-theme-name=Moire
gtk-application-prefer-dark-theme=true
gtk-icon-theme-name=Adwaita
gtk-cursor-theme-name=Adwaita
gtk-font-name=Sans 10
gtk-decoration-layout=close,minimize,maximize:
EOF

  cat > "${HOME}/.config/gtk-4.0/settings.ini" <<'EOF'
[Settings]
gtk-theme-name=Moire
gtk-application-prefer-dark-theme=true
gtk-icon-theme-name=Adwaita
gtk-cursor-theme-name=Adwaita
gtk-font-name=Sans 10
gtk-decoration-layout=close,minimize,maximize:
EOF

  export GTK_THEME="${GTK_THEME:-Moire}"
  # Prefer dark for libadwaita / portals even when theme name is ignored.
  export GTK_APPLICATION_PREFER_DARK_THEME="${GTK_APPLICATION_PREFER_DARK_THEME:-1}"

  if command -v gsettings >/dev/null 2>&1; then
    gsettings set org.gnome.desktop.interface gtk-theme 'Moire' 2>/dev/null || true
    gsettings set org.gnome.desktop.interface icon-theme 'Adwaita' 2>/dev/null || true
    gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark' 2>/dev/null || true
    # Ubuntu/GNOME accent (when schema key exists)
    gsettings set org.gnome.desktop.interface accent-color 'blue' 2>/dev/null || true
  fi

  echo "Moire session: GTK theme=$GTK_THEME (dark)"
}
