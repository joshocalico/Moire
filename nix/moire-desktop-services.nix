{ config, lib, ... }:

{
  options.moire.removableStorage.enable = lib.mkEnableOption "the bounded removable-storage authorization candidate";

  config = {
    # This VM exposes only QEMU's virtual Ethernet. Moire observes the daemon;
    # network mutations remain root-only without enabling Polkit or new grants.
    networking.networkmanager = {
      enable = true;
      plugins = lib.mkForce [];
      unmanaged = [ "*" "except:type:ethernet" ];
      settings.main.auth-polkit = "root-only";
    };
    networking.dhcpcd.enable = false;
    networking.wireless.enable = lib.mkForce false;
    networking.modemmanager.enable = lib.mkForce false;
    security.polkit.enable = lib.mkForce config.moire.removableStorage.enable;
    security.polkit.extraConfig = lib.mkForce "";

    # Observation only in the battery-less QEMU guest. Ignore deliberately
    # disables critical-battery sleep/shutdown; do not reuse on physical hardware.
    services.upower = {
      enable = true;
      criticalPowerAction = "Ignore";
      allowRiskyCriticalPowerAction = true;
    };
    # Moire never activates backend services through D-Bus. Start the installed
    # UPower unit explicitly and order both observations before the session.
    systemd.services.upower.wantedBy = [ "multi-user.target" ];
    systemd.services.moire-session = {
      wants = [ "NetworkManager.service" "upower.service" ];
      after = [ "NetworkManager.service" "upower.service" ];
    };
  };
}
