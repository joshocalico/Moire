{ config, lib, ... }:

# Sound backend for the native desktop: PipeWire with WirePlumber, per user and socket-activated
# in the logind session. Moire's management service talks to it directly: the native protocol
# for devices, volume and defaults, libpipewire + libmoire-pwring for the alert sound and the
# input meter (docs/audio.md). The PulseAudio and ALSA shims cover apps that only speak those.
{
  options.moire.sound.testDevices = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = ''
      Add two PipeWire null devices from moire-sound-test-devices.json: "Moire Test Output"
      (Audio/Sink) and "Moire Test Input" (Audio/Source). For VMs run without an audio device
      (UTM's `-audio none`), so the sound stack has something to list, select and play into.
      Images for real hardware leave it off (the default).
    '';
  };

  config = {
    services.pipewire = {
      # mkOverride 40: moire-pam-test.nix forces PipeWire off (priority 50) for its text-only ISO.
      enable = lib.mkOverride 40 true;
      alsa.enable = true;
      pulse.enable = true;
      wireplumber.enable = true;
      # Lands in /etc/pipewire/pipewire.conf.d/90-moire-test-devices.conf.
      extraConfig.pipewire = lib.mkIf config.moire.sound.testDevices {
        "90-moire-test-devices" =
          builtins.fromJSON (builtins.readFile ./moire-sound-test-devices.json);
      };
    };
    # security.rtkit stays at its default, off: its acquire-real-time action would hit Moire's
    # Polkit deny fallback, and PipeWire runs at normal priority without it.
  };
}
