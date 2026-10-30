# The login backend switch: moire-dm (default) or greetd for rollback (docs/moire-dm.md).
#
#   moire.dm.backend = "greetd";   # roll back
#
# With greetd this module only asserts; with moire-dm it disables greetd and installs
# moire-dm.service, its PAM services, accounts and configuration, and moire-dm-settings (the
# automatic-login writer Settings uses). The greeter itself is the same binary either way: it
# picks its client by MOIRE_DM_SOCK / GREETD_SOCK.
{ config, lib, pkgs, moire, ... }:
let
  cfg = config.moire.dm;
  package = import ./moire-dm-package.nix { inherit lib pkgs moire; };
  pamModule = name: "${pkgs.pam}/lib/security/${name}.so";
  pamSystemd = "${config.systemd.package}/lib/security/pam_systemd.so";
  testDirectory = "/run/moire-dm-test";
  # TEST IMAGES ONLY (moire.dm.testControls): a file a test user creates in /run/moire-dm-test
  # asks root to exercise moire-dm. The directory is emptied first, so each file acts once.
  testControl = pkgs.writeShellScript "moire-dm-test-control" ''
    set -u
    requested=
    for action in fresh-boot restart crash; do
      if [ -e "${testDirectory}/$action" ] || [ -L "${testDirectory}/$action" ]; then
        requested=$action
      fi
    done
    # Physical walk, never following a link the test user placed there.
    ${pkgs.findutils}/bin/find ${testDirectory} -xdev -mindepth 1 -delete
    systemctl=${config.systemd.package}/bin/systemctl
    case "$requested" in
      crash)
        # The broker dies as if it crashed; Restart=always brings it back, and it recovers.
        echo "moire-dm-test: crash (SIGKILL to the broker)"
        $systemctl kill --kill-whom=main --signal=SIGKILL moire-dm.service ;;
      restart)
        # A clean stop and start: SIGTERM ends the sessions moire-dm started, then a greeter.
        echo "moire-dm-test: restart"
        $systemctl restart --no-block moire-dm.service ;;
      fresh-boot)
        # As after a reboot: moire-dm stops, every session on the seat ends (or the new broker
        # would see a busy seat and treat it as a recovery), the once-per-boot automatic-login
        # marker is cleared, and moire-dm starts as at boot.
        echo "moire-dm-test: fresh-boot (stop, end seat sessions, marker cleared, start)"
        loginctl=${config.systemd.package}/bin/loginctl
        $systemctl stop moire-dm.service
        $loginctl terminate-seat seat0 || true
        for _ in $(${pkgs.coreutils}/bin/seq 50); do
          [ -z "$($loginctl show-seat seat0 -p Sessions --value 2>/dev/null)" ] && break
          ${pkgs.coreutils}/bin/sleep 0.2
        done
        ${pkgs.coreutils}/bin/rm -f /run/moire-dm/autologin-attempted
        $systemctl start --no-block moire-dm.service ;;
      *) echo "moire-dm-test: nothing requested (create crash, restart or fresh-boot)" ;;
    esac
  '';
  # The login session stack without password authentication, for the greeter and automatic
  # login. Accounts are still checked (expired or locked fails), and pam_systemd registers the
  # session with logind exactly as for a password login.
  trustedStack = account: ''
    auth     required ${pamModule "pam_permit"}
    account  required ${pamModule account}
    password required ${pamModule "pam_deny"}
    session  required ${pamModule "pam_env"} conffile=/etc/pam/environment readenv=0
    session  required ${pamModule "pam_unix"}
    session  required ${pamModule "pam_loginuid"}
    session  optional ${pamModule "pam_keyinit"} force revoke
    session  optional ${pamSystemd}
  '';
in {
  options.moire.dm = {
    backend = lib.mkOption {
      type = lib.types.enum [ "greetd" "moire-dm" ];
      default = "moire-dm";
      description = "Which login daemon owns the seat. Rolling back is setting this to greetd.";
    };
    testControls = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        TEST IMAGES ONLY. Lets a member of `users` exercise moire-dm without a root shell by
        creating crash, restart or fresh-boot in ${testDirectory} (docs/moire-dm.md). Allowed
        only in an image with the public PAM test account.
      '';
    };
    vt = lib.mkOption { type = lib.types.ints.between 1 63; default = 1; };
    greeter = lib.mkOption {
      type = lib.types.str;
      description = "The greeter executable, run as the greeter account in a greeter session.";
    };
    sessions = lib.mkOption {
      description = "The session catalog; the greeter picks by id, the first is the default.";
      type = lib.types.listOf (lib.types.submodule {
        options = {
          id = lib.mkOption { type = lib.types.strMatching "[a-z0-9][a-z0-9._-]*"; };
          label = lib.mkOption { type = lib.types.str; };
          command = lib.mkOption { type = lib.types.str; };
          desktop = lib.mkOption { type = lib.types.str; default = "moire"; };
        };
      });
      default = [ ];
    };
  };

  config = lib.mkMerge [
    {
      # Moire's own boot stage replaced Plymouth in the native image; it must not creep back,
      # since it would fight the boot stage and the greeter for the display.
      assertions = [
        {
          assertion = !config.boot.plymouth.enable;
          message = "The Moire native image draws its own boot stage; boot.plymouth must stay off.";
        }
      ];
    }
    (lib.mkIf (cfg.backend == "moire-dm") {
      assertions = [
        {
          assertion = !config.services.greetd.enable;
          message = "moire.dm.backend = \"moire-dm\" replaces greetd; both can't own the seat.";
        }
        {
          assertion = cfg.sessions != [ ];
          message = "moire-dm needs at least one session in moire.dm.sessions.";
        }
        {
          assertion = config.security.polkit.enable &&
            config.environment.etc ? "polkit-1/rules.d/00-moire-admin.rules" &&
            config.environment.etc ? "polkit-1/rules.d/01-moire-deny-unapproved.rules";
          message = "moire-dm-settings relies on polkit, Moire's administrator rule and its deny fallback (moire-settings-services.nix).";
        }
      ];
      services.greetd.enable = lib.mkForce false;
      systemd.defaultUnit = "graphical.target";

      users.users.greeter = { isSystemUser = true; group = "greeter"; };
      users.groups.greeter = { };
      # The front: the only moire-dm process that reads greeter bytes. No groups, no home.
      users.users.moire-dm-front = { isSystemUser = true; group = "moire-dm-front"; };
      users.groups.moire-dm-front = { };
      # The automatic-login writer: owns /var/lib/moire-dm and nothing else.
      users.users.moire-dm-settings = { isSystemUser = true; group = "moire-dm-settings"; };
      users.groups.moire-dm-settings = { };

      environment.etc."moire-dm/config.json".text = builtins.toJSON {
        inherit (cfg) vt;
        socket = "/run/moire-dm-front/greeter.sock";
        frontUser = "moire-dm-front";
        path = "/run/wrappers/bin:/run/current-system/sw/bin";
        greeter = { user = "greeter"; argv = [ cfg.greeter ]; };
        sessions = map (session: {
          inherit (session) id label desktop;
          argv = [ session.command ];
        }) cfg.sessions;
      };

      security.pam.services.moire-dm = {
        startSession = true;
        allowNullPassword = false;
      };
      security.pam.services.moire-dm-greeter.text = trustedStack "pam_permit";
      security.pam.services.moire-dm-autologin.text = trustedStack "pam_unix";

      # As greetd does: logind must not auto-spawn a getty on the login VT.
      systemd.services."autovt@tty${toString cfg.vt}".enable = false;
      # The broker (root) only reads here: autologin.json must be a regular file owned by root or
      # moire-dm-settings and writable by no one else, or it means "off".
      systemd.tmpfiles.rules = [ "d /var/lib/moire-dm 0755 moire-dm-settings moire-dm-settings -" ];

      # Automatic login's write path (Phase 5): the org.moire.dm.set-autologin action and the
      # system-bus policy for the service. The action's rule is in 00-moire-admin.rules
      # (moire-settings-services.nix, asserted above): it asks for an administrator's password.
      environment.systemPackages = [
        (pkgs.writeTextDir "share/polkit-1/actions/org.moire.dm.policy" (builtins.readFile ./moire-dm.policy))
      ];
      services.dbus.packages = [
        (pkgs.writeTextDir "share/dbus-1/system.d/org.moire.LoginManager1.conf" (builtins.readFile ./moire-dm-dbus.conf))
      ];

      # The native image's boot stage and keymap checks are ordered before greetd today; take
      # greetd's place. (Only native images select this backend, and both units exist there.)
      systemd.services.moire-boot-stage.before = [ "moire-dm.service" ];
      systemd.services.moire-native-keymap-checks.before = [ "moire-dm.service" ];

      systemd.services.moire-dm = {
        description = "Moire login daemon";
        aliases = [ "display-manager.service" ];
        wantedBy = [ "graphical.target" ];
        # Same place in boot as greetd: after logind and user sessions are allowed, on the boot
        # stage's handoff (moire-native-boot.nix orders the stage before us), and after the
        # probe image's keymap checks when they exist. No Plymouth: the boot stage replaced it.
        wants = [
          "systemd-user-sessions.service"
          "moire-boot-stage.service"
          "moire-native-keymap-checks.service"
        ];
        after = [
          "systemd-user-sessions.service"
          "systemd-logind.service"
          "getty@tty${toString cfg.vt}.service"
          "moire-boot-stage.service"
          "moire-native-keymap-checks.service"
        ];
        conflicts = [ "getty@tty${toString cfg.vt}.service" ];
        # Restarting under a live session is safe (it waits for the session) but pointless.
        restartIfChanged = false;
        unitConfig = {
          StartLimitIntervalSec = 60;
          StartLimitBurst = 5;
        };
        serviceConfig = {
          Type = "simple";
          ExecStart = "${package}/bin/moire-dm";
          Restart = "always";
          RestartSec = 1;
          IgnoreSIGPIPE = false;
          UnsetEnvironment = [ "NODE_OPTIONS" ];
          # Sessions get their own keyring from pam_keyinit.
          KeyringMode = "shared";
          StandardOutput = "journal";
          StandardError = "journal";
        };
      };

      # Unprivileged, and nothing inherits from it, so it gets the hardening the broker can't.
      systemd.services.moire-dm-settings = {
        description = "Moire automatic-login settings";
        wantedBy = [ "multi-user.target" ];
        after = [ "dbus.service" "systemd-tmpfiles-setup.service" ];
        requires = [ "dbus.service" ];
        serviceConfig = {
          Type = "dbus";
          BusName = "org.moire.LoginManager1";
          ExecStart = "${package}/bin/moire-dm-settings";
          User = "moire-dm-settings";
          Group = "moire-dm-settings";
          UMask = "0022";
          Restart = "on-failure";
          RestartSec = 2;
          UnsetEnvironment = [ "NODE_OPTIONS" ];
          ReadWritePaths = [ "/var/lib/moire-dm" ];
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
    })
    (lib.mkIf (cfg.backend == "moire-dm" && cfg.testControls) {
      assertions = [
        {
          assertion = config.users.users ? moire-pam-test;
          message = "moire.dm.testControls is for test images (with the public moire-pam-test account) only.";
        }
      ];
      systemd.tmpfiles.rules = [ "d ${testDirectory} 0770 root users -" ];
      systemd.paths.moire-dm-test = {
        description = "Moire login daemon test controls (test images only)";
        wantedBy = [ "multi-user.target" ];
        pathConfig.DirectoryNotEmpty = testDirectory;
      };
      systemd.services.moire-dm-test = {
        description = "Moire login daemon test control (test images only)";
        serviceConfig = {
          Type = "oneshot";
          ExecStart = testControl;
        };
      };
    })
  ];
}
