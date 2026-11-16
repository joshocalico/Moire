{ config, lib, pkgs, moire, ... }:

# Settings backends for date & time (systemd-timedated) and accounts (AccountsService), with
# the narrow polkit policy they need. See docs/settings-redesign.md, "Time, region & accounts
# backend". Imported by the native desktop image.
let
  # polkitd with one Moire patch: an agent registered for a single process (`unix-process`,
  # what `pkttyagent --process` uses) is fallback-only, so the compositor's session agent always
  # gets the session's requests (docs/polkit-agent.md, threat model and open question 10).
  # Only polkitd is swapped (security.polkit.package): libpolkit-gobject, which other packages
  # link, is untouched, so nothing else rebuilds. The patch is written against polkit 127's
  # get_authentication_agent_for_subject(); any other version must be re-reviewed, not re-applied.
  polkitProcessAgentFallback = pkgs.polkit.overrideAttrs (old: {
    patches = (old.patches or [ ]) ++ [ ./patches/polkit-process-agent-fallback.patch ];
    passthru = (old.passthru or { }) // { moireProcessAgentFallback = true; };
  });
  # moire-accounts: administrator changes to accounts, one prompt per change
  # (docs/polkit-agent.md, "One prompt per change").
  accountsPackage = import ./moire-accounts-package.nix { inherit lib pkgs moire; };
in
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
  security.polkit.package = polkitProcessAgentFallback;
  security.wrappers.pkexec.enable = lib.mkForce false;
  # Polkit stops at the first rule that returns a result, in file-name order. 00 grants the
  # Settings actions; the immutable 01 fallback then denies every other non-root request,
  # including stock allow_active=yes actions. Another backend that needs a polkit action (logind
  # suspend, power profiles) must add its own 00-moire-*.rules allowance.
  environment.etc."polkit-1/rules.d/00-moire-settings.rules".source = ./moire-settings.rules;
  # Administrator actions answer "ask for an administrator's password" (AUTH_ADMIN, every check)
  # of YES: moire-accounts' account changes and moire-dm's automatic login, both asked for by
  # Settings itself (docs/polkit-agent.md).
  environment.etc."polkit-1/rules.d/00-moire-admin.rules".source = ./moire-admin.rules;
  environment.etc."polkit-1/rules.d/01-moire-deny-unapproved.rules".source = ./moire-deny-unapproved.rules;
  # AccountsService's user-administration: YES for the moire-accounts account alone, so the
  # change it was asked for (one prompt, org.moire.accounts.administer above) needs no further
  # prompt; NO, with no prompt, for every other subject but root (no session calls it directly).
  # Ordered before 00-moire-admin.rules.
  environment.etc."polkit-1/rules.d/00-moire-accounts.rules".source = ./moire-accounts.rules;

  # moire-accounts (org.moire.AccountAdmin1). Settings calls it itself, so the prompt names
  # Settings. Its own unprivileged account, never root: root would also make AccountsService
  # read any file as an icon, and needs a far larger trust base. Nothing inherits from it, so
  # it gets moire-dm-settings' hardening (nix/moire-dm.nix).
  users.users.moire-accounts = { isSystemUser = true; group = "moire-accounts"; };
  users.groups.moire-accounts = { };
  environment.systemPackages = [
    (pkgs.writeTextDir "share/polkit-1/actions/org.moire.accounts.policy" (builtins.readFile ./moire-accounts.policy))
  ];
  services.dbus.packages = [
    (pkgs.writeTextDir "share/dbus-1/system.d/org.moire.AccountAdmin1.conf" (builtins.readFile ./moire-accounts-dbus.conf))
  ];
  systemd.services.moire-accounts = {
    description = "Moire account administration";
    wantedBy = [ "multi-user.target" ];
    after = [ "dbus.service" ];
    requires = [ "dbus.service" ];
    serviceConfig = {
      Type = "dbus";
      BusName = "org.moire.AccountAdmin1";
      ExecStart = "${accountsPackage}/bin/moire-accounts";
      User = "moire-accounts";
      Group = "moire-accounts";
      UMask = "0077";
      Restart = "on-failure";
      RestartSec = 2;
      UnsetEnvironment = [ "NODE_OPTIONS" ];
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      PrivateDevices = true;
      PrivateNetwork = true;
      PrivateIPC = true;
      ProtectHostname = true;
      ProtectClock = true;
      ProtectKernelTunables = true;
      ProtectKernelModules = true;
      ProtectKernelLogs = true;
      ProtectControlGroups = true;
      ProtectProc = "invisible";
      ProcSubset = "pid";
      RestrictAddressFamilies = [ "AF_UNIX" ];
      RestrictNamespaces = true;
      RestrictRealtime = true;
      RestrictSUIDSGID = true;
      RemoveIPC = true;
      LockPersonality = true;
      # Node runs --jitless here, so nothing needs writable executable memory.
      MemoryDenyWriteExecute = true;
      CapabilityBoundingSet = "";
      SystemCallArchitectures = "native";
      SystemCallFilter = [ "@system-service" "~@privileged" ];
      SystemCallErrorNumber = "EPERM";
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };

  assertions = [
    {
      # moire-accounts' grant is only safe while the account is a system account nothing else
      # runs as, and only its own unit (no login shell, no password).
      assertion = config.users.users.moire-accounts.isSystemUser &&
        !(config.users.users.moire-accounts.isNormalUser) &&
        config.systemd.services.moire-accounts.serviceConfig.User == "moire-accounts" &&
        config.systemd.services.moire-accounts.serviceConfig.CapabilityBoundingSet == "";
      message = "moire-accounts must stay an unprivileged system account used only by moire-accounts.service (00-moire-accounts.rules grants it user-administration).";
    }
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
      # The fallback patch is pinned to polkit 127 (nixpkgs 7fc6f2c). A bump fails here until
      # the patch is re-reviewed against the new get_authentication_agent_for_subject().
      assertion = pkgs.polkit.version == "127" &&
        (config.security.polkit.package.moireProcessAgentFallback or false);
      message = "polkitd must carry nix/patches/polkit-process-agent-fallback.patch, which is reviewed for polkit 127 only (found ${pkgs.polkit.version}); re-review it before bumping (docs/polkit-agent.md).";
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
