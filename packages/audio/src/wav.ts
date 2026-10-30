/**
 * WAV PCM to interleaved F32 and back. Reads integer PCM (8/16/24/32-bit), IEEE float (32/64-bit)
 * and WAVE_FORMAT_EXTENSIBLE wrapping either; 1–8 channels. Enough for alert sounds and short
 * clips; compressed WAV and RF64 are refused.
 */
export type Pcm = {
  readonly rate: number;
  readonly channels: number;
  /** Interleaved, nominally -1..1. */
  readonly samples: Float32Array;
};

export class WavError extends Error {}

/** Larger files aren't sounds Moire plays this way. */
export const MAX_WAV_BYTES = 16 * 1024 * 1024;

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

export function decodeWav(bytes: Uint8Array): Pcm {
  if (bytes.length > MAX_WAV_BYTES) throw new WavError("The sound file is too large.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw new WavError("Not a WAV file.");
  let format: { tag: number; channels: number; rate: number; bits: number; align: number } | null =
    null;
  let data: Uint8Array | null = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (body + size > bytes.length && id !== "data") throw new WavError("Truncated WAV chunk.");
    if (id === "fmt ") {
      if (size < 16) throw new WavError("Short WAV format chunk.");
      let formatTag = view.getUint16(body, true);
      if (formatTag === EXTENSIBLE) {
        if (size < 40) throw new WavError("Short WAV extensible format.");
        formatTag = view.getUint16(body + 24, true);
      }
      format = {
        tag: formatTag,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        align: view.getUint16(body + 12, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      // Some writers leave a streaming size; take what is there.
      data = bytes.subarray(body, Math.min(bytes.length, body + size));
      break;
    }
    at = body + size + (size & 1);
  }
  if (!format) throw new WavError("WAV has no format chunk.");
  if (!data) throw new WavError("WAV has no data.");
  const { channels, rate, bits } = format;
  if (channels < 1 || channels > 8) throw new WavError("WAV must have 1 to 8 channels.");
  if (rate < 1000 || rate > 384000) throw new WavError("WAV sample rate is out of range.");
  const width = bits / 8;
  const supported =
    (format.tag === PCM && [8, 16, 24, 32].includes(bits)) ||
    (format.tag === FLOAT && (bits === 32 || bits === 64));
  if (!supported) throw new WavError(`Unsupported WAV encoding (${format.tag}, ${bits}-bit).`);
  if (format.align !== width * channels) throw new WavError("WAV block size doesn't match.");
  const count = Math.floor(data.length / width / channels) * channels;
  const samples = new Float32Array(count);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0, at = 0; i < count; i++, at += width) {
    if (format.tag === FLOAT)
      samples[i] = bits === 32 ? dv.getFloat32(at, true) : dv.getFloat64(at, true);
    else if (bits === 8) samples[i] = (dv.getUint8(at) - 128) / 128;
    else if (bits === 16) samples[i] = dv.getInt16(at, true) / 32768;
    else if (bits === 24)
      samples[i] =
        (dv.getUint8(at) | (dv.getUint8(at + 1) << 8) | (dv.getInt8(at + 2) << 16)) / 8388608;
    else samples[i] = dv.getInt32(at, true) / 2147483648;
  }
  return { rate, channels, samples };
}

/** 16-bit PCM WAV, clipped to range. */
export function encodeWav(pcm: Pcm): Uint8Array {
  const data = encodePcm16(pcm.samples);
  const out = new Uint8Array(WAV_HEADER_BYTES + data.length);
  out.set(wavHeader(pcm.rate, pcm.channels, data.length));
  out.set(data, WAV_HEADER_BYTES);
  return out;
}

/** The canonical header before 16-bit PCM data; a streaming writer rewrites it at the end. */
export const WAV_HEADER_BYTES = 44;
/** The RIFF size field is 32-bit: this much 16-bit data fits under one header. */
export const MAX_WAV_DATA_BYTES = 0xffffffff - (WAV_HEADER_BYTES - 8);

export function wavHeader(rate: number, channels: number, dataBytes: number): Uint8Array {
  const out = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return out;
}

/** F32 samples as little-endian 16-bit PCM, clipped to range. */
export function encodePcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, Math.round(clipped * 32767), true);
  }
  return out;
}

export function durationMs(pcm: Pcm): number {
  return (pcm.samples.length / pcm.channels / pcm.rate) * 1000;
}
