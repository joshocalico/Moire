# dmBackend selects the login daemon: "moire-dm" (default) or "greetd" to roll back
# (scripts/build-native-login-probe.py --desktop --dm greetd; docs/moire-dm.md).
{ dmBackend ? "moire-dm" }:
let
  base = builtins.getFlake ("path:" + toString ../.);
  system = "aarch64-linux";
  pkgs = import base.inputs.nixpkgs { inherit system; };
  moire = pkgs.callPackage ./moire.nix {};
  # The session may change networking: moire-network-services.nix grants the NetworkManager
  # actions to the active local session (asserted below).
  desktop = import ./moire-native-desktop.nix {
    inherit pkgs moire; inherit (pkgs) lib;
    networkControl = "interactive";
  };
  sessionLabel = "Moire desktop · C63 R65 polkit";
  greeter = import ./moire-native-login.nix {
    inherit pkgs moire;
    inherit (pkgs) lib;
    sessionExecutable = "${desktop}/bin/moire-native-desktop";
    inherit sessionLabel;
    discoverUsers = true;
  };
  machine = base.inputs.nixpkgs.lib.nixosSystem {
    inherit system;
    specialArgs = { inherit moire; };
    modules = [ ./moire-pam-test.nix ./moire-native-login-probe.nix ./moire-native-boot.nix ./moire-settings-services.nix ./moire-power-services.nix ./moire-network-services.nix ./moire-sound-services.nix ./moire-portal-services.nix ./moire-dm.nix ({ config, lib, ... }: {
      image.baseName = lib.mkOverride 30 "moire-aarch64-native-desktop";
      isoImage.volumeID = lib.mkOverride 40 "MOIRE_NATIVE_DESK";
      environment.systemPackages = [ desktop ];
      # This image is the UTM VM image, which runs with `-audio none`: PipeWire gets null test
      # devices. An image for real hardware sets this false (or leaves it out; it defaults off).
      moire.sound.testDevices = true;
      # AccountsService (guest metadata for the user picker and Settings) comes from
      # moire-settings-services.nix; PAM remains greetd-owned.
      assertions = [
        {
          assertion = config.environment.etc ? "polkit-1/rules.d/00-moire-network.rules";
          message = "The session runs MOIRE_NETWORK_CONTROL=interactive; it needs moire-network-services.nix.";
        }
      ];
      services.greetd.settings.default_session.command =
        lib.mkOverride 40 "${greeter}/bin/moire-native-login";
      # TEST IMAGE ONLY, public disposable credential like moire-pam-test's: an administrator, so
      # Settings' admin flows and automatic login (an administrator's password) can be exercised.
      # moire-pam-test stays a standard account.
      users.users.moire-admin-test = {
        isNormalUser = true;
        uid = 1001;
        extraGroups = [ "wheel" ];
        initialPassword = "moire-admin-test-only-20261011";
      };
      moire.dm = {
        backend = dmBackend;
        # This is a test image (public credentials): crash, restart and fresh-boot controls
        # in /run/moire-dm-test (docs/moire-dm.md, "VM test plan").
        testControls = true;
        greeter = "${greeter}/bin/moire-native-login";
        sessions = [
          { id = "moire"; label = sessionLabel; command = "${desktop}/bin/moire-native-desktop"; }
        ];
      };
      environment.etc."moire-build.json".text = lib.mkForce (builtins.toJSON ({
        milestone = "c63-native-desktop";
        revision = "r10-visible-virtual-wave";
        userPickerAcceptance = false;
        waveAcceptance = false;
        desktopAcceptance = false;
        sources = builtins.listToAttrs (map (name: {
          inherit name;
          value = builtins.hashFile "sha256" (../. + "/${name}");
        }) [
          "apps/system/compositor/src/main.ts"
          "apps/system/compositor/src/native-session.ts"
          "apps/system/compositor/src/owned-apps.ts"
          "apps/system/compositor/src/pre-login.ts"
          "apps/system/display-manager/src/native-greetd-client.ts"
          "apps/system/display-manager/src/native-greetd-client.smoke.ts"
          "apps/system/compositor/src/local-users.ts"
          "apps/system/compositor/src/local-users.smoke.ts"
          "packages/core/src/server.ts"
          "packages/core/src/session-lock.ts"
          "packages/core/src/lock-screen-paint.ts"
          "apps/system/compositor/src/lock-session.ts"
          "packages/system-management/src/password-check.ts"
          "packages/sys/src/seat.ts"
          "packages/sys/src/index.ts"
          "packages/sys/src/keymap.ts"
          "packages/sys/src/keyboard-state.ts"
          "packages/sys/test/keyboard-state.native.smoke.ts"
          "packages/core/test/files-interaction.native.smoke.tsx"
          "packages/ui/src/platforms/wayland/keyboard.ts"
          "packages/ui/src/platforms/wayland/xkb.ts"
          "apps/bundled/files/src/main.tsx"
          "packages/shell/src/controller.tsx"
          "packages/shell/src/QuickSettingsDetails.tsx"
          "packages/ui/src/window.ts"
          "packages/ui/src/platform.ts"
          "packages/ui/src/retained-motion-admission.ts"
          "packages/ui/src/retained-motion-admission.smoke.ts"
          "packages/ui/src/backdrop/backdrop.tsx"
          "packages/ui/src/backdrop/placement.ts"
          "packages/ui/src/platforms/wayland/index.ts"
          "packages/ui/src/platforms/wayland/rendering.ts"
          "packages/ui/src/platforms/wayland/rendering.smoke.ts"
          "apps/system/greeter/src/native/main.tsx"
          "apps/system/greeter/src/native/view.tsx"
          "apps/system/greeter/src/native/wave.smoke.tsx"
          "apps/system/greeter/src/native/local-users.ts"
          "apps/system/greeter/src/native/user-selection.ts"
          "apps/system/greeter/src/native/user-picker.smoke.tsx"
          "nix/moire-native-login.nix"
          "packages/react-host/src/index.ts"
          "nix/moire-native-desktop.nix"
          "nix/moire-native-desktop-image.nix"
          "nix/moire-settings-services.nix"
          "nix/moire-settings.rules"
          "nix/moire-admin.rules"
          "apps/system/compositor/src/polkit-agent.ts"
          "apps/system/compositor/src/polkit-helper.ts"
          "apps/system/compositor/src/sleep-blockers.ts"
          "packages/core/src/secure-prompt.ts"
          "nix/moire-power-services.nix"
          "nix/moire-power.rules"
          "nix/moire-network-services.nix"
          "nix/moire-networkmanager.nix"
          "nix/moire-network.rules"
          "nix/moire-deny-unapproved.rules"
          "nix/moire-sound-services.nix"
          "nix/moire-portal-services.nix"
          "nix/moire-sound-test-devices.json"
          "apps/system/management-service/src/network-manager.ts"
          "apps/system/management-service/src/network-vpn.ts"
          "apps/system/management-service/src/airplane-mode.ts"
          "apps/system/management-service/src/time-settings.ts"
          "apps/system/management-service/src/accounts-settings.ts"
          "nix/moire-dm.nix"
          "nix/moire-dm-package.nix"
          "nix/moire-dm.policy"
          "apps/system/moire-dm/src/main.ts"
          "apps/system/moire-dm/src/autologin-file.ts"
          "apps/system/moire-dm/src/login-manager.ts"
          "apps/system/management-service/src/login-settings.ts"
          "apps/core/settings/src/pages/users.tsx"
          "nix/moire-native-boot.nix"
          "nix/boot.nix"
          "apps/system/boot/src/renderer.tsx"
          "apps/system/boot/src/scene-silk.tsx"
          "packages/sys/src/boot-handoff.ts"
          "packages/sys/src/egl-output.ts"
          "nix/moire.nix"
          "pnpm-lock.yaml"
          "flake.lock"
        ]);
      } // lib.optionalAttrs (dmBackend != "greetd") { loginBackend = dmBackend; }));
    }) ];
  };
in machine.config.system.build.isoImage
