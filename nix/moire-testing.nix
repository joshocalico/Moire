# Test-image-only allowances in the desktop session. Every option here defaults off, and each
# asserts it is set only in an image with the public moire-pam-test account (a test image).
{ config, lib, ... }:
let
  cfg = config.moire.testing;
in {
  options.moire.testing.displayControl = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = ''
      TEST IMAGES ONLY. Lets the guest display scripts (scripts/guest-display-mode.sh,
      scripts/guest-smoke-display-layout-dbus.sh), run from a root shell, change the display mode
      and layout, which org.moire.Display1 otherwise allows only Settings. Installs
      /etc/moire/testing/display-control; the compositor then also accepts a caller descended
      from the root process named in root's grant, /run/moire-test/display-control, which the
      scripts write for the length of their run (apps/system/compositor/src/display-access.ts).
    '';
  };

  config = lib.mkIf cfg.displayControl {
    assertions = [
      {
        assertion = config.users.users ? moire-pam-test;
        message = "moire.testing.displayControl is for test images (with the public moire-pam-test account) only.";
      }
    ];
    environment.etc."moire/testing/display-control" = {
      text = "Test image: root may grant display control (docs/compositor/display-and-protocols.md).\n";
      mode = "0444";
    };
  };
}
