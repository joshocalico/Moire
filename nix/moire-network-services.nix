{ config, lib, ... }:

# Network & Bluetooth backend for the native desktop: NetworkManager under Polkit with the
# active local session allowed to control networking, and BlueZ. See docs/settings-redesign.md,
# "Network & Bluetooth backend". Polkit itself and the deny fallback come from
# moire-settings-services.nix; the session's MOIRE_NETWORK_CONTROL=interactive is set by the
# native desktop package (moire-native-desktop.nix, networkControl).
{
  # NetworkManager manages every Ethernet and Wi-Fi device it finds (QEMU's virtual Ethernet in
  # the VM), with the wpa_supplicant its module enables under D-Bus control, and keeps its
  # default auth-polkit = true, so each mutation is a Polkit check (asserted below).
  imports = [ ./moire-networkmanager.nix ];

  # mkForce: the NetworkManager module grants every NetworkManager action to the networkmanager
  # group in 10-nixos.rules. Moire's allowances live only in 00-moire-*.rules; the settings
  # module's assertion keeps extraConfig empty.
  security.polkit.extraConfig = lib.mkForce "";
  environment.etc."polkit-1/rules.d/00-moire-network.rules".source = ./moire-network.rules;

  # BlueZ needs no Polkit: its D-Bus policy lets any local client call org.bluez. bluetoothd
  # starts through bluetooth.target when a controller appears (the UTM VM has none, so Settings
  # reports no adapter); Moire never activates it over D-Bus.
  hardware.bluetooth.enable = true;

  assertions = [
    {
      assertion = config.security.polkit.enable &&
        config.environment.etc ? "polkit-1/rules.d/01-moire-deny-unapproved.rules";
      message = "The network grant relies on Polkit and Moire's deny fallback (moire-settings-services.nix).";
    }
    {
      assertion = (config.networking.networkmanager.settings.main.auth-polkit or true) == true;
      message = "Settings controls NetworkManager through Polkit; auth-polkit must stay enabled.";
    }
    {
      assertion = config.networking.networkmanager.unmanaged == [ ];
      message = "Settings lists and connects Wi-Fi devices; NetworkManager must manage them.";
    }
  ];
}
