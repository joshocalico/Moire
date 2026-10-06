{ config, ... }:

{
  # Disposable validation only. The normal image keeps its existing services.
  services.udisks2.enable = true;
  systemd.services.moire-session = {
    wants = [ "udisks2.service" ];
    after = [ "udisks2.service" ];
    # Permit a request to prove the daemon denies it; this grants no authority.
    environment.MOIRE_STORAGE_CONTROL = "interactive";
  };
  assertions = [
    {
      assertion = !config.security.polkit.enable && config.security.polkit.extraConfig == "";
      message = "The disposable storage probe must keep Polkit disabled and rules empty.";
    }
    {
      assertion = config.users.users.moire.extraGroups == [ "video" "render" "input" "tty" ];
      message = "The disposable storage probe must retain Moire's existing groups.";
    }
  ];
}
