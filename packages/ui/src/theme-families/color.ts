export function colorChannel(color: number, shift: number): number {
  return (color >>> shift) & 0xff;
}

export function mixColor(from: number, to: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return (
    ((mix(colorChannel(from, 24), colorChannel(to, 24)) << 24) |
      (mix(colorChannel(from, 16), colorChannel(to, 16)) << 16) |
      (mix(colorChannel(from, 8), colorChannel(to, 8)) << 8) |
      mix(colorChannel(from, 0), colorChannel(to, 0))) >>>
    0
  );
}

export function colorWithAlpha(color: number, alpha: number): number {
  return (((alpha & 0xff) << 24) | (color & 0x00ffffff)) >>> 0;
}

function luminance(color: number): number {
  const linear = (shift: number) => {
    const value = colorChannel(color, shift) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return linear(16) * 0.2126 + linear(8) * 0.7152 + linear(0) * 0.0722;
}

/** Contrast for opaque control fills and their text/artwork. */
export function contrastRatio(a: number, b: number): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function foregroundOn(fill: number): number {
  const dark = 0xff0d0e13;
  return contrastRatio(fill, 0xffffffff) >= contrastRatio(fill, dark) ? 0xffffffff : dark;
}

/** Hover/press shading keeps the control's resting foreground readable. */
export function mixControlFill(fill: number, target: number, amount: number): number {
  const foreground = foregroundOn(fill);
  let mixed = mixColor(fill, target, amount);
  while (contrastRatio(mixed, foreground) < 4.5 && amount > 1 / 256) {
    amount /= 2;
    mixed = mixColor(fill, target, amount);
  }
  return mixed;
}
