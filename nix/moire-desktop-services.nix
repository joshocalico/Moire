{ config, lib, ... }:

# Desktop services for the QEMU images (moire-vm.nix). These images run without Polkit (only
# the removable-storage candidate enables it, for its own rules), so Moire observes the daemons
# and network mutations remain root-only. The native desktop image takes its services from
# moire-settings-services.nix, moire-power-services.nix and moire-network-services.nix instead,
# and must not import this module: see the assertion below.
{
  imports = [ ./moire-networkmanager.nix ];

  options.moire.removableStorage.enable = lib.mkEnableOption "the bounded removable-storage authorization candidate";

  config = {
    # This VM exposes only QEMU's virtual Ethernet.
    networking.networkmanager = {
      unmanaged = [ "*" "except:type:ethernet" ];
      settings.main.auth-polkit = "root-only";
    };
    # Ethernet only, so no wpa_supplicant. mkForce: the NetworkManager module enables it.
    networking.wireless.enable = lib.mkForce false;
    # mkForce: the NetworkManager module enables Polkit and adds its networkmanager-group rule.
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

    assertions = [
      {
        # The forced Polkit switch above would silently disable the native image's grants.
        assertion = !(config.environment.etc ? "polkit-1/rules.d/00-moire-settings.rules") &&
          !(config.environment.etc ? "polkit-1/rules.d/00-moire-power.rules") &&
          !(config.environment.etc ? "polkit-1/rules.d/00-moire-network.rules");
        message = "moire-desktop-services.nix (QEMU, Polkit off) cannot be combined with the native desktop's Polkit-owning service modules.";
      }
    ];
  };
}
