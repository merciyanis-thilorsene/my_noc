// Kuando Busylight v3.1 — colour command set on FPort 15.
// Source: NOC_LoRaWAN_Specs.md §9. Five bytes per command:
//   b0..b2 — RGB intensity (0x00 / 0x99 / 0xFF used by the named presets)
//   b3     — duty / blink config (0xFF = solid)
//   b4     — reserved (0x00)

export const COLORS = {
  red:    '990000FF00',
  green:  '000099FF00',
  blue:   '00FF00FF00',
  yellow: 'FF00FFFF00',
  purple: 'FFFF00FF00',
  white:  'FFFFFFFF00',
  off:    '0000000000',
} as const;

export type ColorName = keyof typeof COLORS;
export const COLOR_NAMES = Object.keys(COLORS) as ColorName[];

const HEX_RE = /^[0-9a-fA-F]{10}$/;

// Accept either a named preset ("red") or a 5-byte hex string ("990000FF00").
// Returns the hex form (uppercase, validated) or null.
export function resolveColorHex(input: string): string | null {
  const lower = input.toLowerCase();
  if (lower in COLORS) return COLORS[lower as ColorName];
  return HEX_RE.test(input) ? input.toUpperCase() : null;
}

export function hexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

// Reverse lookup so we can label arbitrary hex back to a friendly name when
// it matches a known preset (used in API responses).
const BY_HEX: Map<string, ColorName> = new Map(
  Object.entries(COLORS).map(([name, hex]) => [hex, name as ColorName]),
);
export function colorNameForHex(hex: string): ColorName | null {
  return BY_HEX.get(hex.toUpperCase()) ?? null;
}
