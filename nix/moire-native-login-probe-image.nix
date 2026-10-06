let
  base = builtins.getFlake ("path:" + toString ../.);
  system = "aarch64-linux";
  pkgs = import base.inputs.nixpkgs { inherit system; };
  moire = pkgs.callPackage ./moire.nix {};
  machine = base.inputs.nixpkgs.lib.nixosSystem {
    inherit system;
    specialArgs = { inherit moire; };
    modules = [ ./moire-pam-test.nix ./moire-native-login-probe.nix ];
  };
in machine.config.system.build.isoImage
