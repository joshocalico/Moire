{ config, lib, ... }:

{
  # This module is imported only by the separately approved candidate target.
  moire.removableStorage.enable = true;
  services.udisks2.enable = true;
  # Compact candidate assembly fits the existing constrained builder without
  # deleting preserved images. This changes compression only, not the closure.
  isoImage.squashfsCompression = lib.mkForce "xz -Xdict-size 100%";
  security.polkit.debug = true;
  security.wrappers.pkexec.enable = lib.mkForce false;
  systemd.sockets.polkit-agent-helper = {
    enable = false;
    wantedBy = lib.mkForce [];
  };
  systemd.services."polkit-agent-helper@".enable = false;

  # C creates a regular file only when absent. Root's subsequent hand edits are
  # authoritative for this RAM-backed boot, and never overwritten by activation.
  # Do not use /etc/moire: its persistent form is intentionally root-only 0500.
  systemd.tmpfiles.rules = [
    "d /etc/polkit-1/rules.d 0755 root root -"
    "C /etc/polkit-1/rules.d/00-moire-removable.rules 0644 root root - ${./moire-removable.rules}"
  ];
  environment.etc."polkit-1/rules.d/01-moire-deny-unapproved.rules".source = ./moire-deny-unapproved.rules;
  systemd.services.polkit.after = [ "systemd-tmpfiles-setup.service" ];
  systemd.services.moire-session = {
    wants = [ "polkit.service" "udisks2.service" ];
    after = [ "polkit.service" "udisks2.service" ];
    environment.MOIRE_STORAGE_CONTROL = "interactive";
  };
  assertions = [
    {
      assertion = config.security.polkit.enable && config.security.polkit.extraConfig == "";
      message = "The removable candidate needs Polkit with no extra global grants.";
    }
    {
      assertion = !config.security.wrappers.pkexec.enable &&
        !config.systemd.sockets.polkit-agent-helper.enable &&
        !config.systemd.services."polkit-agent-helper@".enable;
      message = "The removable candidate must suppress privileged authentication helpers.";
    }
    {
      assertion = config.users.users.moire.extraGroups == [ "video" "render" "input" "tty" ];
      message = "The removable candidate must retain Moire's existing groups.";
    }
  ];
}
