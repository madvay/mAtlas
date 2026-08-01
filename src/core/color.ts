const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#0f172a';
const DARK_SURFACE = '#0b1220';

interface RgbColor { r: number; g: number; b: number }

function parseHexColor(value: string): RgbColor | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1]!.length === 3
    ? match[1]!.split('').map((digit) => digit + digit).join('')
    : match[1]!;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function toHex({ r, g, b }: RgbColor): string {
  const channel = (value: number): string => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function linearChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(left: string, right: string): number {
  const a = parseHexColor(left);
  const b = parseHexColor(right);
  if (!a || !b) return 1;
  const luminance = (color: RgbColor): number => 0.2126 * linearChannel(color.r)
    + 0.7152 * linearChannel(color.g)
    + 0.0722 * linearChannel(color.b);
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function mixHexColors(color: string, toward: string, amount: number): string {
  const source = parseHexColor(color);
  const target = parseHexColor(toward);
  if (!source || !target) return color;
  const weight = Math.max(0, Math.min(1, amount));
  return toHex({
    r: source.r + (target.r - source.r) * weight,
    g: source.g + (target.g - source.g) * weight,
    b: source.b + (target.b - source.b) * weight
  });
}

export function readableTextColor(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

export function colorForDarkSurface(color: string, minimumContrast = 4.5): string {
  if (!parseHexColor(color) || contrastRatio(color, DARK_SURFACE) >= minimumContrast) return color;
  for (let step = 1; step <= 12; step += 1) {
    const candidate = mixHexColors(color, LIGHT_TEXT, step / 16);
    if (contrastRatio(candidate, DARK_SURFACE) >= minimumContrast) return candidate;
  }
  return LIGHT_TEXT;
}
