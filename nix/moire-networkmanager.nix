{ pkgs, ... }:

# The NetworkManager daemon every Moire image shares: no DHCP client or modem manager beside
# it, and the OpenVPN plugin for the profiles Settings imports (WireGuard is built in; the
# plugin is found through /etc/NetworkManager/VPN/nm-openvpn-service.name). Who may control it
# is image policy: moire-desktop-services.nix (QEMU images, root-only) or
# moire-network-services.nix (native desktop, the active local session).
{
  networking.networkmanager = {
    enable = true;
    plugins = [ pkgs.networkmanager-openvpn ];
  };
  # NetworkManager runs its own DHCP; the module already turns networking.useDHCP off.
  networking.dhcpcd.enable = false;
  # No modem in these images; the NetworkManager module only defaults ModemManager on.
  networking.modemmanager.enable = false;
}
