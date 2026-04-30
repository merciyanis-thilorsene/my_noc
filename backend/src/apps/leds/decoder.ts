// Kuando Busylight LoRaWAN v3.1 — FPort 15 keep-alive decoder.
// Frame layout (6 bytes), per device firmware spec:
//   b0 — RSSI seen by device (signed int8, dBm)
//   b1 — SNR seen by device (signed int8, dB)
//   b2 — downlinks received counter (uint8)
//   b3 — uplinks transmitted counter (uint8)
//   b4 — reserved
//   b5 — bitfield: adr_state (bits 0-1), hw_revision (bits 2-3), sw_revision (bits 4-5)

export type BusylightUplink = {
  decoder: 'busylight_v3.1';
  rssi_device: number;
  snr_device: number;
  downlinks_rx: number;
  uplinks_tx: number;
  adr_state: number;
  hw_revision: number;
  sw_revision: number;
};

const BUSYLIGHT_FPORT = 15;
const KEEPALIVE_LEN = 6;

function decodeBase64(b64: string): Uint8Array | null {
  try {
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

function toSignedInt8(b: number): number {
  return b > 127 ? b - 256 : b;
}

export function decodeBusylightUplink(
  frmPayloadB64: string | null,
  fPort: number | null,
): BusylightUplink | null {
  if (fPort !== BUSYLIGHT_FPORT) return null;
  if (!frmPayloadB64) return null;
  const bytes = decodeBase64(frmPayloadB64);
  if (!bytes || bytes.length < KEEPALIVE_LEN) return null;

  const status = bytes[5]!;
  return {
    decoder: 'busylight_v3.1',
    rssi_device: toSignedInt8(bytes[0]!),
    snr_device: toSignedInt8(bytes[1]!),
    downlinks_rx: bytes[2]!,
    uplinks_tx: bytes[3]!,
    adr_state: status & 0x03,
    hw_revision: (status >> 2) & 0x03,
    sw_revision: (status >> 4) & 0x03,
  };
}
