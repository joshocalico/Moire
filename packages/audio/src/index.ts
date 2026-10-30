/**
 * PipeWire for Moire: a native-protocol control client (devices, volumes, defaults, app
 * streams) and sound playback and level metering over libpipewire. See docs/audio.md.
 */
export { decodePod, encodePod, P, PodError, type Pod, type PodProp, type PodScalar } from "./pod";
export {
  PipeWireConnection,
  PipeWireError,
  type ConnectionOptions,
  type PipeWireErrorKind,
} from "./connection";
export {
  pipewireSocketPath,
  socketTransport,
  unixFdTransport,
  type TransportFactory,
} from "./transport";
export {
  AudioControl,
  type AudioControlOptions,
  type AudioDeviceInfo,
  type AudioNode,
  type AudioNodeKind,
  type AudioProfile,
  type AudioRoute,
  type AudioSnapshot,
} from "./control";
export {
  createAudioStatusAdapter,
  type AudioReady,
  type AudioSink,
  type AudioStatus,
  type AudioStatusAdapter,
} from "./audio-status";
export {
  createAudioDevicesAdapter,
  MAX_AUDIO_ITEMS,
  type AudioBackend,
  type AudioDevice,
  type AudioDevicesAdapter,
  type AudioDevicesReady,
  type AudioDevicesStatus,
  type AudioInput,
  type AudioStream,
} from "./audio-devices";
export {
  createInputMeter,
  type InputMeter,
  type InputMeterState,
  type LevelRecorder,
} from "./input-meter";
export {
  audioFormatPod,
  createAlertPlayer,
  playSound,
  recordLevels,
  recordStream,
  type CaptureEnd,
  type Levels,
  type LevelRecording,
  type PlayOptions,
  type PlayResult,
  type RecordLevelsResult,
  type RecordStreamResult,
  type StreamRecording,
  type StreamOpener,
} from "./sound";
export { ALERT_SOUND_PATH, alertPcm } from "./alert";
export {
  decodeWav,
  encodePcm16,
  encodeWav,
  MAX_WAV_DATA_BYTES,
  WAV_HEADER_BYTES,
  wavHeader,
  WavError,
  type Pcm,
} from "./wav";
