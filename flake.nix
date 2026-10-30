{
  description = "Moire ARM64 NixOS session image";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      system = "aarch64-linux";
      pkgs = import nixpkgs { inherit system; };
      moire = pkgs.callPackage ./nix/moire.nix { };
      moireBoot = pkgs.callPackage ./nix/boot.nix { pnpmDeps = moire.pnpmDeps; };
      machine = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit moire moireBoot; };
        modules = [ ./nix/moire-vm.nix ];
      };
      image = machine.config.system.build.isoImage;
      pamTest = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [ ./nix/moire-pam-test.nix ];
      };
      storageProbe = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit moire moireBoot; };
        modules = [ ./nix/moire-vm.nix ./nix/moire-storage-probe.nix ];
      };
      removableDesktop = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit moire moireBoot; };
        modules = [ ./nix/moire-vm.nix ./nix/moire-removable-desktop.nix ];
      };
    in {
      nixosConfigurations.moire-vm = machine;
      nixosConfigurations.moire-pam-test = pamTest;
      nixosConfigurations.moire-storage-probe = storageProbe;
      nixosConfigurations.moire-removable-desktop = removableDesktop;
      packages.${system} = {
        moire-pam-test = pamTest.config.system.build.isoImage;
        inherit moire;
        moire-boot = moireBoot;
        # moire-dm (bundled); its build runs every moire-dm smoke incl. real Linux-PAM.
        moire-dm = import ./nix/moire-dm-package.nix { inherit moire pkgs; inherit (pkgs) lib; };
        moire-vm = image;
        moire-storage-probe = storageProbe.config.system.build.isoImage;
        moire-removable-desktop = removableDesktop.config.system.build.isoImage;
        default = image;
      };
      # Evaluation on macOS still requires an aarch64-linux Nix builder.
      packages.aarch64-darwin = {
        moire-pam-test = pamTest.config.system.build.isoImage;
        moire-vm = image;
        moire-storage-probe = storageProbe.config.system.build.isoImage;
        moire-removable-desktop = removableDesktop.config.system.build.isoImage;
        default = image;
      };
    };
}
