{ config, lib, ... }:

# Power & idle backend: power-profiles-daemon for Settings' power mode, UPower for the battery
# and lid, and the narrow polkit allowance for logind suspend/power off/inhibitors and profile
# switches. See docs/settings-redesign.md, "Power & idle backend". Polkit itself and the deny
# fallback come from moire-settings-services.nix.
{
  # The placeholder driver offers power-saver and balanced on hardware (or VMs) without
  # platform_profile; Moire never activates daemons over D-Bus, so both start with the system.
  services.power-profiles-daemon.enable = true;
  systemd.services.power-profiles-daemon.wantedBy = [ "multi-user.target" ];
  services.upower.enable = true;
  systemd.services.upower.wantedBy = [ "multi-user.target" ];
  # logind keeps its defaults (lid and power key suspend/power off) for the greeter and any
  # time the session's inhibitor is missing; the session takes them over only while it runs.
  environment.etc."polkit-1/rules.d/00-moire-power.rules".source = ./moire-power.rules;

  # The lock screen (docs/lock-screen.md) checks the session user's own password with pam_unix's
  # setuid helper; no polkit action is involved. Idle lock, lock on suspend and logind's Lock all
  # depend on it, so a missing wrapper would leave every lock unable to unlock.
  assertions = [
    {
      assertion = config.security.wrappers ? unix_chkpwd;
      message = "The lock screen verifies passwords with the unix_chkpwd wrapper.";
    }
  ];
}
