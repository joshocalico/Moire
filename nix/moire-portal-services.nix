{ pkgs, moire, ... }:

# xdg-desktop-portal for the Moire session (docs/portals.md): the frontend, Moire's backend for
# the interfaces it implements, and xdg-desktop-portal-gtk for the rest. The backend itself (its
# launcher and session-bus service file) is part of the moire package; the native session puts
# that package's share directory on XDG_DATA_DIRS, which is where the session bus finds it.
let
  # NixOS points xdg-desktop-portal at one directory of .portal files, built from extraPortals.
  backend = pkgs.runCommand "moire-portal-registration" { } ''
    mkdir -p $out/share/xdg-desktop-portal/portals
    cp ${moire}/share/xdg-desktop-portal/portals/moire.portal $out/share/xdg-desktop-portal/portals/
  '';
in
{
  xdg.portal = {
    enable = true;
    extraPortals = [ backend pkgs.xdg-desktop-portal-gtk ];
    # Becomes /etc/xdg/xdg-desktop-portal/moire-portals.conf, chosen by XDG_CURRENT_DESKTOP=Moire.
    # Keep in step with apps/system/portal/moire-portals.conf, which the development session uses.
    config.moire = {
      default = [ "gtk" ];
      "org.freedesktop.impl.portal.AppChooser" = [ "moire" ];
      "org.freedesktop.impl.portal.Settings" = [ "moire" ];
      "org.freedesktop.impl.portal.Notification" = [ "moire" ];
      "org.freedesktop.impl.portal.Inhibit" = [ "moire" ];
      "org.freedesktop.impl.portal.FileChooser" = [ "moire" ];
      # No screen capture, remote control, keyring or background-activity portal until Moire
      # has its own (docs/portals.md, "Later"); the GTK backend's would not work here.
      "org.freedesktop.impl.portal.Screenshot" = [ "none" ];
      "org.freedesktop.impl.portal.ScreenCast" = [ "none" ];
      "org.freedesktop.impl.portal.RemoteDesktop" = [ "none" ];
      "org.freedesktop.impl.portal.Secret" = [ "none" ];
      "org.freedesktop.impl.portal.Background" = [ "none" ];
      "org.freedesktop.impl.portal.Wallpaper" = [ "none" ];
    };
  };
}
