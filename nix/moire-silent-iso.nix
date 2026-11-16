# The ISO's GRUB shows nothing before the kernel: upstream's iso-image.nix hard-codes a "Loading
# graphical boot menu..." banner in grub.cfg, with no option to turn it off, so this module swaps
# in a copy without it. Evaluation fails if the upstream text moves, rather than bringing it back.
{ lib, modulesPath, ... }:
let
  file = "installer/cd-dvd/iso-image.nix";
  upstream = builtins.readFile (modulesPath + "/${file}");
  banner = lib.concatMapStrings (line: "        ${line}\n") [
    ''echo ""''
    ''echo "Loading graphical boot menu..."''
    ''echo ""''
    ''echo "Press 't' to use the text boot menu on this console..."''
    ''echo ""''
  ];
  # The copy lives outside nixpkgs, so its relative imports become absolute.
  modules = toString modulesPath;
  relative = {
    "../../image/file-options.nix" = "${modules}/image/file-options.nix";
    "../../../lib/make-iso9660-image.nix" = "${modules}/../lib/make-iso9660-image.nix";
  };
  # GRUB announces every menu entry it runs, so boot before the menu; the entries stay as a fallback.
  entries = "        \${buildMenuGrub2 { }}\n";
  direct = lib.concatMapStrings (line: "        ${line}\n") [
    "linux /boot/\${config.boot.kernelPackages.kernel + \"/\" + config.system.boot.loader.kernelFile} \\''\${isoboot} init=\${config.system.build.toplevel}/init \${toString config.boot.kernelParams}"
    "initrd /boot/\${config.system.build.initialRamdisk + \"/\" + config.system.boot.loader.initrdFile}"
    "boot"
  ];
  silent = builtins.replaceStrings
    ([ banner entries ] ++ builtins.attrNames relative)
    ([ "" (direct + entries) ] ++ builtins.attrValues relative)
    upstream;
  found = text: lib.hasInfix text upstream;
in
assert lib.assertMsg (lib.all found ([ banner entries ] ++ builtins.attrNames relative))
  "moire-silent-iso.nix: upstream ${file} changed; update the copied text";
{
  disabledModules = [ file ];
  imports = [ (builtins.toFile "moire-iso-image.nix" silent) ];
  # Skip gfxterm's mode switch before the kernel. The theme stays: without one, the menu setup
  # calls background_image, which prints an error when no graphics mode is active.
  isoImage.forceTextMode = true;
}
