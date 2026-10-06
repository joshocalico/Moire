{ config, lib, pkgs, modulesPath, moire, moireBoot, ... }:

let
  bootHandoff = pkgs.writeShellScriptBin "moire-boot-handoff" ''
    export MOIRE_SYSTEMCTL=${pkgs.systemd}/bin/systemctl
    export MOIRE_BOOT_CLEANUP=${moireBoot}/bin/moire-boot-cleanup
    exec ${pkgs.bash}/bin/bash ${../apps/system/boot/scripts/handoff.sh} "$@"
  '';
in {
  imports = [
    (modulesPath + "/profiles/minimal.nix")
    (modulesPath + "/installer/cd-dvd/iso-image.nix")
    ./moire-home.nix
    ./moire-desktop-services.nix
  ];

  nixpkgs.hostPlatform = "aarch64-linux";
  system.stateVersion = "26.05";
  networking.hostName = "moire-vm";

  # The ISO holds the system closure. The ISO module puts writable state in RAM.
  image.baseName = lib.mkForce "moire-aarch64";
  isoImage = {
    volumeID = "MOIRE_AARCH64_P1";
    makeEfiBootable = true;
    makeUsbBootable = true;
    makeBiosBootable = false;
    squashfsCompression = "zstd -Xcompression-level 6";
  };
  boot.loader.timeout = lib.mkForce 1;
  boot.initrd.availableKernelModules = [
    "virtio_pci" "virtio_blk" "virtio_scsi" "sr_mod" "virtio_gpu"
    "virtio_input" "usbhid" "hid_generic" "xhci_pci"
  ];
  boot.kernelModules = [ "virtio_gpu" "virtio_input" "evdev" ];
  # Keep both recovery consoles. graphical selects Plymouth's graphical
  # renderer despite the serial console; Escape still belongs to its daemon.
  boot.kernelParams = [ "console=tty1" "console=ttyAMA0,115200" "plymouth.graphical" ];
  boot.plymouth = {
    enable = true;
    # Upstream details globally suppresses printk to avoid overlapping VT text.
    # This VM also needs live kernel output on ttyAMA0 during Escape-to-logs.
    package = (pkgs.plymouth.override {
      systemd = config.boot.initrd.systemd.package;
    }).overrideAttrs (old: {
      postPatch = (old.postPatch or "") + ''
        substituteInPlace src/plugins/splash/details/plugin.c src/plugins/splash/text/plugin.c \
          --replace-fail 'ply_show_new_kernel_messages (false);' \
            '/* Keep the serial recovery console live while details is shown. */'
      '';
    });
    theme = "moire-silk";
    themePackages = [ (pkgs.callPackage ./plymouth-theme.nix {}) ];
  };

  hardware.graphics.enable = true;
  services.dbus.enable = true;
  services.xserver.enable = false;
  # Local recovery consoles only; tty1 belongs to Moire and SSH is disabled.
  services.getty.autologinUser = "root";
  systemd.services."getty@tty1".enable = false;
  systemd.defaultUnit = "graphical.target";

  users.users.moire = {
    isNormalUser = true;
    uid = 1000;
    extraGroups = [ "video" "render" "input" "tty" ];
    # No network login. Serial recovery is a local, passwordless root console.
    hashedPassword = "!";
  };
  users.users.root.initialHashedPassword = "";
  services.openssh.enable = false;

  environment.systemPackages = [ moire moireBoot bootHandoff pkgs.bash pkgs.xwayland pkgs.xdg-utils ];
  fonts.packages = [ pkgs.dejavu_fonts ];

  security.pam.services.moire-session = { startSession = true; };
  # The initial coordinator owns automatic startup and separate desktop ordering.
  # This uses the existing root recovery context; desktop permissions stay fixed.
  # Initialize durable current-boot admission state before either
  # desktop admission or any managed renderer launch. This unit opens no device.
  systemd.services.moire-boot-state = {
    description = "Moire current-boot attempt ledger";
    requiredBy = [ "moire-boot.service" "moire-boot-release-gate.service" ];
    environment = {
      MOIRE_BOOT_UNIT = "moire-boot.service";
      MOIRE_BOOT_SERVICE_STATE = "/run/moire-boot/service";
    };
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = "${moireBoot}/bin/moire-boot-cleanup --init-ledger";
      TimeoutStartSec = "5s";
      Restart = "no";
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };
  # Check-only root admission: never recursively starts the dependent desktop.
  systemd.services.moire-boot-release-gate = {
    description = "Verify managed boot release before Moire desktop";
    requires = [ "moire-boot-state.service" ];
    after = [ "moire-boot-state.service" "moire-boot.service" ];
    before = [ "moire-session.service" ];
    requiredBy = [ "moire-session.service" ];
    conflicts = [ "moire-boot.service" ];
    environment = {
      MOIRE_BOOT_UNIT = "moire-boot.service";
      MOIRE_BOOT_SERVICE_STATE = "/run/moire-boot/service";
      MOIRE_SYSTEMCTL = "${pkgs.systemd}/bin/systemctl";
    };
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${moireBoot}/bin/moire-boot-cleanup --desktop-admission-check";
      TimeoutStartSec = "5s";
      Restart = "no";
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };
  systemd.services.moire-boot = {
    description = "Moire managed React boot stage on tty1";
    requires = [ "moire-boot-state.service" ];
    wants = [ "systemd-udev-settle.service" "plymouth-quit.service" ];
    after = [ "systemd-udev-settle.service" "plymouth-quit.service" "moire-session.service" "moire-boot-state.service" ];
    conflicts = [ "moire-session.service" "getty@tty1.service" ];
    environment = {
      MOIRE_BOOT_MANAGED = "1";
      MOIRE_BOOT_NOTIFY = "1";
      MOIRE_SYSTEMCTL = "${pkgs.systemd}/bin/systemctl";
      MOIRE_BOOT_UNIT = "moire-boot.service";
      MOIRE_BOOT_SERVICE_STATE = "/run/moire-boot/service";
    };
    serviceConfig = {
      Type = "notify";
      NotifyAccess = "main";
      # This bounds a stalled pre-ready renderer; RuntimeMaxSec starts at READY.
      TimeoutStartSec = "15s";
      # Track every workload owner through manager termination before cleanup.
      # The finite cap also retires descendants after an unexpected main exit.
      ExitType = "cgroup";
      RuntimeMaxSec = "60s";
      ExecStartPre = "${moireBoot}/bin/moire-boot-cleanup --record-attempt";
      ExecStart = "${moireBoot}/bin/moire-boot";
      ExecStopPost = "${moireBoot}/bin/moire-boot-cleanup";
      KillMode = "control-group";
      SendSIGKILL = true;
      Restart = "no";
      TimeoutStopSec = "4s";
      RuntimeDirectory = "moire-boot";
      RuntimeDirectoryMode = "0700";
      RuntimeDirectoryPreserve = "yes";
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };
  # The sole automatic graphical entry serializes boot and desktop transactions.
  systemd.services.moire-initial-startup = {
    description = "Moire initial accepted frame and verified desktop handoff";
    wantedBy = [ "graphical.target" ];
    requires = [ "moire-boot-state.service" ];
    after = [ "moire-boot-state.service" "systemd-user-sessions.service" ];
    environment = {
      MOIRE_SYSTEMCTL = "${pkgs.systemd}/bin/systemctl";
      MOIRE_BOOT_CLEANUP = "${moireBoot}/bin/moire-boot-cleanup";
      MOIRE_BOOT_SERVICE_STATE = "/run/moire-boot/service";
      MOIRE_BOOT_LATCH = "/run/moire-boot/console-requested";
    };
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${moireBoot}/bin/moire-initial-startup";
      TimeoutStartSec = "65s";
      Restart = "no";
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };
  systemd.services.moire-session = {
    description = "Moire desktop on tty1";
    requires = [ "moire-boot-release-gate.service" ];
    wants = [ "systemd-udev-settle.service" "plymouth-quit.service" ];
    after = [ "systemd-user-sessions.service" "systemd-udev-settle.service" "plymouth-quit.service" "moire-boot-release-gate.service" ];
    conflicts = [ "getty@tty1.service" ];
    environment = {
      HOME = "/home/moire";
      SHELL = "${pkgs.bashInteractive}/bin/bash";
      XDG_RUNTIME_DIR = "/run/user/1000";
      XDG_SESSION_TYPE = "wayland";
      XDG_SESSION_DESKTOP = "Moire";
      XDG_CURRENT_DESKTOP = "Moire";
      XDG_SEAT = "seat0";
      XDG_VTNR = "1";
      MOIRE_RENDERER = "auto";
      MOIRE_EGL_PRESENT = "auto";
      MOIRE_UI_ACCELERATION = "auto";
      MOIRE_GREETER = "1";
      XKB_CONFIG_ROOT = "${pkgs.xkeyboard_config}/share/X11/xkb";
    };
    serviceConfig = {
      User = "moire";
      PAMName = "moire-session";
      WorkingDirectory = "/home/moire";
      ExecStart = "${moire}/bin/moire-session";
      Restart = "on-failure";
      RestartSec = 3;
      TTYPath = "/dev/tty1";
      StandardInput = "tty";
      StandardOutput = "journal";
      StandardError = "journal";
      TTYReset = true;
      TTYVHangup = true;
      TTYVTDisallocate = true;
      UtmpIdentifier = "tty1";
      UtmpMode = "user";
    };
  };
}
