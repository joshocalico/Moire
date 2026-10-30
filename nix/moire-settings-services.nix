{ config, lib, ... }:

# Settings backends for date & time (systemd-timedated) and accounts (AccountsService), with
# the narrow polkit policy they need. See docs/settings-redesign.md, "Time, region & accounts
# backend". Imported by the native desktop image.
{
  # timedated owns /etc/localtime only when NixOS does not declare a zone, and AccountsService
  # refuses user changes (NIXOS_USERS_PURE) unless users are mutable. Both are the defaults; the
  # assertions below keep them so.
  services.accounts-daemon.enable = true;

  # Polkit decides timedated and AccountsService requests. The compositor is the session's
  # authentication agent (docs/polkit-agent.md): it checks a typed password through polkit's own
  # helper, socket-activated as root by systemd (polkit-agent-helper.socket and
  # polkit-agent-helper@.service, which the NixOS polkit module enables). Nothing is setuid:
  # pkexec stays off and the helper has no wrapper. The assertion below keeps all of that so.
  security.polkit.enable = true;
  security.wrappers.pkexec.enable = lib.mkForce false;
  # Polkit stops at the first rule that returns a result, in file-name order. 00 grants the
  # Settings actions; the immutable 01 fallback then denies every other non-root request,
  # including stock allow_active=yes actions. Another backend that needs a polkit action (logind
  # suspend, power profiles) must add its own 00-moire-*.rules allowance.
  environment.etc."polkit-1/rules.d/00-moire-settings.rules".source = ./moire-settings.rules;
  # Administrator actions answer "ask for an administrator's password" (AUTH_ADMIN_KEEP) instead
  # of YES: other users' accounts and moire-dm's automatic login (docs/polkit-agent.md).
  environment.etc."polkit-1/rules.d/00-moire-admin.rules".source = ./moire-admin.rules;
  environment.etc."polkit-1/rules.d/01-moire-deny-unapproved.rules".source = ./moire-deny-unapproved.rules;

  assertions = [
    {
      assertion = config.time.timeZone == null;
      message = "Settings sets the time zone through timedated; time.timeZone must stay null.";
    }
    {
      assertion = config.services.timesyncd.enable;
      message = "Settings' network time switch drives systemd-timesyncd; keep it enabled.";
    }
    {
      assertion = config.users.mutableUsers;
      message = "Settings creates and edits users at runtime; users.mutableUsers must be true.";
    }
    {
      assertion = config.security.polkit.extraConfig == "";
      message = "Settings' polkit grants live only in moire-settings.rules; add no global rules.";
    }
    {
      assertion = !config.security.wrappers.pkexec.enable &&
        !(config.security.wrappers ? "polkit-agent-helper-1") &&
        config.systemd.sockets.polkit-agent-helper.enable &&
        builtins.elem "sockets.target" config.systemd.sockets.polkit-agent-helper.wantedBy &&
        config.systemd.services."polkit-agent-helper@".enable &&
        config.security.pam.services ? "polkit-1";
      message = "Moire's polkit agent needs the socket-activated helper and the polkit-1 PAM service; keep pkexec off and the helper without a setuid wrapper.";
    }
    {
      # Whose password an administrator prompt accepts. The NixOS default; 00-moire-admin.rules
      # and the agent's identity chooser are written for it.
      assertion = config.security.polkit.adminIdentities == [ "unix-group:wheel" ];
      message = "Moire's administrator prompts accept members of wheel; keep security.polkit.adminIdentities at its default.";
    }
    {
      assertion = config.security.wrappers ? unix_chkpwd && config.security.wrappers ? passwd;
      message = "Settings verifies and changes passwords with the unix_chkpwd and passwd wrappers.";
    }
  ];
}
