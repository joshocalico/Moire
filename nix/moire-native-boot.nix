{ config, lib, pkgs, moire, ... }:
let
  moireBoot = pkgs.callPackage ./boot.nix { pnpmDeps = moire.pnpmDeps; };
in {
  # A quiet console: the first thing drawn after firmware is the Moire boot scene.
  boot.consoleLogLevel = 3;
  # No boot menu: straight from firmware to the scene (hold a key in firmware for options).
  boot.loader.timeout = lib.mkOverride 40 0;
  boot.initrd.verbose = false;
  # zstd decompresses several times faster than xz; the boot stage and greeter read ~150 MB
  # (Node, bundles, fonts) from the squashfs before their first frame.
  isoImage.squashfsCompression = lib.mkForce "zstd -Xcompression-level 6";
  boot.kernelParams = [
    "quiet" "loglevel=3" "udev.log_level=3" "systemd.show_status=false"
    "vt.global_cursor_default=0"
  ];
  # The scene starts as soon as the GPU is probed, and animates until the greeter's
  # compositor asks for the display (see packages/sys/src/boot-handoff.ts). Its final frame
  # seeds the greeter's modeset, so boot → greeter has no blank or cut.
  systemd.services.moire-boot-stage = {
    description = "Moire boot scene";
    wantedBy = [ "sysinit.target" ];
    # tmpfiles creates /run/opengl-driver (GBM/EGL drivers); without it the stage falls back
    # to its static frame.
    after = [
      "systemd-modules-load.service" "systemd-udev-trigger.service" "systemd-tmpfiles-setup.service"
    ];
    # Never ordered before sysinit: the stage runs alongside the rest of boot. (moire-dm.nix
    # adds moire-dm.service here when that backend owns the seat.)
    before = [ "greetd.service" ];
    unitConfig.DefaultDependencies = false;
    serviceConfig = {
      Type = "notify";
      NotifyAccess = "main";
      ExecStart = "${moireBoot}/bin/moire-boot-stage";
      # Ready as soon as the handoff is open (before any GPU work), so greetd is not delayed.
      TimeoutStartSec = "5s";
      # The stage exits once the greeter presents; this only bounds a lost handoff.
      RuntimeMaxSec = "120s";
      Restart = "no";
      Group = "greeter";
      RuntimeDirectory = "moire-boot-handoff";
      RuntimeDirectoryMode = "0770";
      RuntimeDirectoryPreserve = "yes";
      Environment = [ "MOIRE_BOOT_HANDOFF_DIR=/run/moire-boot-handoff" ];
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };
  # Greeter → desktop: the greeter leaves its final (scene-only) frame here for the desktop
  # compositor to dissolve out of (packages/sys/src/boot-handoff.ts, STAGE_HANDOFF_DIR).
  systemd.tmpfiles.rules = [ "d /run/moire-stage 0755 greeter greeter -" ];
  # moire-dm orders itself the same way in moire-dm.nix.
  systemd.services.greetd = lib.mkIf config.services.greetd.enable {
    wants = [ "moire-boot-stage.service" ];
    after = [ "moire-boot-stage.service" ];
    # Upstream uses Type=idle, which holds the greeter until the boot job queue drains (up to
    # 5 s). The boot scene covers the screen meanwhile, so start the greeter immediately.
    serviceConfig.Type = lib.mkForce "simple";
  };
}
