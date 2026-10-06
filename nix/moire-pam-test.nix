{ lib, pkgs, modulesPath, ... }:
let
  node = pkgs.nodejs_22;
  session = pkgs.stdenvNoCC.mkDerivation {
    pname = "moire-pam-test-session";
    version = "0.1";
    src = ../apps/system/session;
    nativeBuildInputs = [ pkgs.makeWrapper ];
    dontBuild = true;
    installPhase = ''
      mkdir -p $out/libexec/moire-session/src $out/bin
      cp moire-authenticated-session moire-session-probe $out/libexec/moire-session/
      cp src/authenticated-session.mjs src/pam-test-identity.mjs $out/libexec/moire-session/src/
      patchShebangs $out/libexec/moire-session
      wrapProgram $out/libexec/moire-session/moire-session-probe \
        --prefix PATH : ${lib.makeBinPath [ pkgs.coreutils ]} \
        --run "${node}/bin/node $out/libexec/moire-session/src/pam-test-identity.mjs unit || exit 126"
      makeWrapper ${pkgs.systemd}/bin/systemd-cat \
        $out/bin/moire-authenticated-session \
        --add-flags "--identifier=moire-pam-test-supervisor --priority=info --level-prefix=false -- $out/libexec/moire-session/moire-authenticated-session" \
        --unset MOIRE_SESSION_FIXTURE_CONFIG \
        --prefix PATH : ${lib.makeBinPath [ node pkgs.coreutils ]} \
        --run "${node}/bin/node $out/libexec/moire-session/src/pam-test-identity.mjs login || exit 126"
    '';
  };
in {
  imports = [
    (modulesPath + "/profiles/minimal.nix")
    (modulesPath + "/installer/cd-dvd/iso-image.nix")
  ];
  nixpkgs.hostPlatform = "aarch64-linux";
  system.stateVersion = "26.05";
  networking.hostName = "moire-pam-test";
  image.baseName = lib.mkForce "moire-aarch64-pam-test";
  isoImage = {
    volumeID = "MOIRE_PAM_TEST";
    makeEfiBootable = true;
    makeUsbBootable = true;
    makeBiosBootable = false;
    squashfsCompression = "xz -Xdict-size 100%";
  };
  boot.loader.timeout = lib.mkForce 1;
  boot.initrd.availableKernelModules = [ "virtio_pci" "virtio_scsi" "sr_mod" "virtio_gpu" "virtio_input" ];
  boot.kernelModules = [ "virtio_gpu" "virtio_input" ];
  boot.kernelParams = [ "console=tty1" "console=ttyAMA0,115200" ];
  users.mutableUsers = true;
  users.users.root.initialHashedPassword = lib.mkForce "!";
  users.users.moire-pam-test = {
    isNormalUser = true;
    uid = 1000;
    extraGroups = [ ];
    # PUBLIC disposable test credential. Never reuse or attach real data to this ISO.
    initialPassword = "moire-pam-test-only-20261004";
  };
  services.getty.autologinUser = lib.mkForce null;
  services.openssh.enable = lib.mkForce false;
  services.xserver.enable = false;
  fonts.enableDefaultPackages = false;
  services.speechd.enable = lib.mkForce false;
  services.pipewire.enable = lib.mkForce false;
  services.dbus.enable = true;
  services.greetd = {
    enable = true;
    useTextGreeter = true;
    settings.general.source_profile = false;
    settings.default_session = {
      user = "greeter";
      command = "${pkgs.greetd}/bin/agreety --cmd ${session}/bin/moire-authenticated-session";
    };
  };
  security.pam.services.greetd.allowNullPassword = lib.mkForce false;
  services.journald.extraConfig = ''
    ForwardToConsole=yes
    TTYPath=/dev/ttyAMA0
    MaxLevelConsole=info
  '';
  environment.systemPackages = [ session pkgs.util-linux ];
  environment.etc."issue".text = "Moire REAL PAM TEST ONLY. Public disposable password. No personal data.\n";
}
