{ lib, runCommand, silkArtwork ? ../themes/boot/silk-fold.png }:

runCommand "moire-silk-plymouth-theme" {
  passthru.themeName = "moire-silk";
  meta = {
    description = "Static Silk artwork for Plymouth's script plugin";
    platforms = lib.platforms.linux;
  };
} ''
  theme_dir="$out/share/plymouth/themes/moire-silk"
  mkdir -p "$theme_dir"
  install -m 0644 ${../themes/boot/moire-silk.script} "$theme_dir/moire-silk.script"
  install -m 0644 ${silkArtwork} "$theme_dir/silk-fold.png"
  substitute ${../themes/boot/moire-silk.plymouth} "$theme_dir/moire-silk.plymouth" \
    --subst-var-by THEME_DIR "$theme_dir"
''
