/**
 * LoRa link-quality assessment based on the LoRaWAN/Semtech RF physics.
 *
 * A LoRa frame only demodulates if its SNR is above the spreading-factor's demodulation
 * floor. The reliable predictor of message loss is therefore the SNR *margin* over that
 * floor (operators target ~10 dB of fade margin), not the raw SNR. RSSI is the coarser
 * companion: near the receiver sensitivity (~−120 dBm) frames drop regardless of SNR.
 */

/** Semtech LoRa demodulator SNR floor (dB) per spreading factor. */
export const SNR_DEMOD_FLOOR: Record<number, number> = {
  7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20,
};

export type Health = 'ok' | 'warn' | 'crit';

export interface LinkHealth {
  level: Health;
  reasons: string[];
}

const RANK: Record<Health, number> = { ok: 0, warn: 1, crit: 2 };

/** SNR margin over the SF demod floor, or null if SNR/SF unavailable. */
export function snrMargin(snr: number | null, sf: number | null): number | null {
  if (snr === null || sf === null || SNR_DEMOD_FLOOR[sf] === undefined) return null;
  return snr - SNR_DEMOD_FLOOR[sf];
}

/** Severity of a device's RSSI on its own (sensitivity-band heuristic). */
export function rssiTone(rssi: number | null): Health {
  if (rssi === null) return 'ok';
  if (rssi < -120) return 'crit';
  if (rssi < -115) return 'warn';
  return 'ok';
}

/** Severity of the SNR margin over the SF demod floor. */
export function snrTone(snr: number | null, sf: number | null): Health {
  const m = snrMargin(snr, sf);
  if (m === null) {
    // No SF context: fall back to an absolute SNR check.
    if (snr === null) return 'ok';
    if (snr < -13) return 'crit';
    if (snr < -7) return 'warn';
    return 'ok';
  }
  if (m < 5) return 'crit';
  if (m < 10) return 'warn';
  return 'ok';
}

/**
 * Overall link health = worst of the SNR-margin and RSSI assessments, with human reasons
 * explaining what needs action.
 */
export function linkHealth(rssi: number | null, snr: number | null, sf: number | null): LinkHealth {
  const reasons: string[] = [];
  let level: Health = 'ok';
  const bump = (l: Health) => { if (RANK[l] > RANK[level]) level = l; };

  const sTone = snrTone(snr, sf);
  if (sTone !== 'ok') {
    bump(sTone);
    const m = snrMargin(snr, sf);
    if (m !== null && sf !== null) {
      reasons.push(`SNR margin ${m.toFixed(1)} dB over SF${sf} demod floor (${SNR_DEMOD_FLOOR[sf]} dB)`);
    } else if (snr !== null) {
      reasons.push(`low SNR ${snr.toFixed(1)} dB`);
    }
  }

  const rTone = rssiTone(rssi);
  if (rTone !== 'ok' && rssi !== null) {
    bump(rTone);
    reasons.push(`${rTone === 'crit' ? 'RSSI near receiver sensitivity' : 'weak RSSI'} ${rssi.toFixed(0)} dBm`);
  }

  return { level, reasons };
}
