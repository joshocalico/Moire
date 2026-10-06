{ lib, pkgs, moire, ... }:
let
  storage = "/var/lib/moire-persist";
  device = "/dev/disk/by-id/virtio-MOIREHOME";
  prepare = pkgs.writeShellScript "moire-home-prepare" ''
    export PATH=${lib.makeBinPath [ pkgs.coreutils pkgs.diffutils pkgs.util-linux pkgs.e2fsprogs pkgs.systemd ]}
    exec ${pkgs.bash}/bin/bash ${./moire-home.sh} \
      /sys/firmware/qemu_fw_cfg/by_name/opt/moire/home-disk/raw \
      ${device} ${storage} /home/moire /etc/moire
  '';
  homeFiles = pkgs.writeText "moire-home-tmpfiles.conf" ''
    d /home/moire/Desktop 0755 moire users -
    d /home/moire/Documents 0755 moire users -
    d /home/moire/Pictures 0755 moire users -
    d /home/moire/Downloads 0755 moire users -
    L /home/moire/Pictures/Botanical.png - moire users - ${moire}/lib/moire/themes/default/botanical-wisteria.png
  '';
in {
  # Activation must not create or chmod a home hidden beneath a later mount.
  users.users.moire.createHome = false;
  boot.kernelModules = [ "qemu_fw_cfg" ];

  # Declare no static home mount: WorkingDirectory would implicitly start it
  # even in RAM mode. The helper creates mount units only after explicit opt-in.
  systemd.services.moire-home = {
    description = "Prepare explicit Moire persistent home or RAM home";
    # Ordinary /run and /var setup must survive a rejected persistent disk so
    # the existing recovery login can still open its PAM session.
    requiredBy = [ "moire-session.service" ];
    wantedBy = [ "systemd-user-sessions.service" ];
    wants = [ "systemd-udev-settle.service" ];
    requires = [ "systemd-modules-load.service" ];
    after = [ "systemd-modules-load.service" "systemd-udev-settle.service" "local-fs.target" "systemd-tmpfiles-setup.service" ];
    before = [ "systemd-user-sessions.service" "moire-session.service" ];
    unitConfig.DefaultDependencies = false;
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = prepare;
      ExecStartPost = "${pkgs.systemd}/bin/systemd-tmpfiles --create ${homeFiles}";
      TimeoutStartSec = "45s";
      Restart = "no";
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };
  systemd.services.moire-session = {
    requires = [ "moire-home.service" ];
    after = [ "moire-home.service" ];
    serviceConfig.EnvironmentFile = "-/etc/moire/session.conf";
  };
}
