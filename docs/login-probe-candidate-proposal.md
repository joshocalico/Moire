# Login probe candidate proposal

**Written proposal only.** No configuration below has been installed, evaluated,
built or booted. Accounts, credentials, PAM policy and VM activation remain a
separate approval scope. Preserve the production image and all fallback images.

The next candidate would use stock pinned greetd/agreety, PAM/logind and the fixed
unprivileged probe supervisor. It would be a separate minimal ISO configuration,
rather than importing `moire-vm.nix`, whose automatic desktop, boot coordinator,
recovery autologin and persistent device groups belong to the existing image.

## Proposed separate configuration

Add `nix/moire-login-probe.nix` after approval. This sketch packages only the two
entries and supervisor source; it does not package the command fixture. Runtime
interpreters and the probe's `id` command are supplied explicitly.

```nix
{ lib, pkgs, modulesPath, ... }:
let
  session = pkgs.stdenvNoCC.mkDerivation {
    pname = "moire-login-probe";
    version = "0.1";
    src = ../apps/system/session;
    nativeBuildInputs = [ pkgs.makeWrapper ];
    dontBuild = true;
    installPhase = ''
      mkdir -p $out/libexec/moire-session/src $out/bin
      cp moire-authenticated-session moire-session-probe $out/libexec/moire-session/
      cp src/authenticated-session.mjs $out/libexec/moire-session/src/
      patchShebangs $out/libexec/moire-session
      wrapProgram $out/libexec/moire-session/moire-session-probe \
        --prefix PATH : ${lib.makeBinPath [ pkgs.coreutils ]}
      makeWrapper $out/libexec/moire-session/moire-authenticated-session \
        $out/bin/moire-authenticated-session \
        --unset MOIRE_SESSION_FIXTURE_CONFIG \
        --prefix PATH : ${lib.makeBinPath [ pkgs.nodejs pkgs.coreutils ]}
    '';
  };
in {
  imports = [
    (modulesPath + "/profiles/minimal.nix")
    (modulesPath + "/installer/cd-dvd/iso-image.nix")
  ];
  nixpkgs.hostPlatform = "aarch64-linux";
  system.stateVersion = "26.05";
  networking.hostName = "moire-login-probe";
  image.baseName = lib.mkForce "moire-aarch64-login-probe";
  isoImage.makeEfiBootable = true;
  isoImage.makeBiosBootable = false;
  boot.kernelParams = [ "console=tty1" "console=ttyAMA0,115200" ];
  services.getty.autologinUser = lib.mkForce null;
  services.openssh.enable = false;
  users.users.root.initialHashedPassword = lib.mkForce "!";
  users.users.moire-probe = {
    isNormalUser = true;
    initialHashedPassword = "!";
    extraGroups = [ ];
  };
  services.greetd = {
    enable = true;
    settings = {
      terminal.vt = 1;
      default_session = {
        user = "greeter";
        command = "${pkgs.greetd}/bin/agreety --cmd ${session}/bin/moire-authenticated-session";
      };
    };
  };
  security.pam.services.greetd.allowNullPassword = lib.mkForce false;
  environment.systemPackages = [ session ];
}
```

The proposed `flake.nix` diff adds one independent configuration and ISO output,
leaving the default outputs unchanged:

```diff
@@
       image = machine.config.system.build.isoImage;
+      loginProbe = nixpkgs.lib.nixosSystem {
+        inherit system;
+        modules = [ ./nix/moire-login-probe.nix ];
+      };
@@
       nixosConfigurations.moire-vm = machine;
+      nixosConfigurations.moire-login-probe = loginProbe;
@@
       packages.${system} = {
+        moire-login-probe = loginProbe.config.system.build.isoImage;
@@
       packages.aarch64-darwin = {
+        moire-login-probe = loginProbe.config.system.build.isoImage;
```

Its prospective build command is `nix build .#moire-login-probe`. Exact evaluated
module defaults, locked-root policy, agreety packaging and service availability
must be checked before any build or activation claim.

## Human credentials and native test steps

The locked accounts deliberately cannot pass password authentication. Positive
login tests need a **separately approved local credential-provisioning path** to
the disposable guest. No password, hash or credential file goes into this flake,
the Nix store, test fixtures or chat logs.

1. Recovery coordination identifies the disposable VM and a local provisioning
   console, explains any temporary root-console access it requires, and obtains
   approval for that exact mechanism. No usable provisioning console exists in
   the locked-root sketch above; that is an explicit unresolved prerequisite.
2. At that approved guest console, the human runs `passwd moire-probe` and types a
   temporary password privately. Use ordinary OS provisioning, without a custom
   credential daemon. Close temporary provisioning access and verify root remains
   locked, serial autologin is disabled, SSH is disabled and the test user has no
   persistent video/input groups before testing login.
3. Verify the selected account's actual UID and user manager, separately recording
   the supervisor's PAM/logind session and the probe unit's cgroup. A command
   fixture or an environment variable cannot substitute for these observations.
4. Test an incorrect password and a blank password. Both must fail. Then have the
   human complete two successful agreety logins. Each probe must exit and return
   to a fresh greeter. Observe exact owned-unit deactivation and command closure.
5. Qualify interruption, delayed registration, supervisor crash and a surviving
   ordinary child in a separately reviewed harmless native workload. The present
   fixed probe exits too quickly to reproduce all of these native cases; do not
   treat the fixture's controlled delays as native evidence.
6. Discard the disposable guest's credential state after the test. Preserve every
   fallback and keep personal storage detached throughout.

The pinned [greetd module](https://raw.githubusercontent.com/NixOS/nixpkgs/7fc6f2c20af09cdcaf48b92ec3121860139ec668/nixos/modules/services/display-managers/greetd.nix)
supplies normal PAM login integration. The [greetd IPC protocol](https://raw.githubusercontent.com/kennylevinsen/greetd/0.10.3/man/greetd-ipc-7.scd)
treats successful session scheduling as a committed start; it does not promise
the stronger C55 fixture cancellation/cleanup barriers.

Graphical Moire activation remains a later task. It needs supported seat/device
ownership and release, and a restricted graphical greeter host. The existing
welcome screen is not authentication. C55/C56 remain unchanged fixtures.
