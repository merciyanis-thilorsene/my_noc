/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

/**
 * Pure metric computations shared by the API layer.
 *
 * Anything that requires sequential reasoning across ordered rows (frame-counter gaps,
 * inter-arrival times) lives here; simple per-bucket aggregations (avg/min/max/sum)
 * stay in SQL where the engine does the work.
 */

/**
 * Computes the percentile `p` (0..100) of an already-sorted ascending array.
 * Returns `null` for an empty array. Uses nearest-rank interpolation.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) {
    return null;
  }
  if (sortedAsc.length === 1) {
    return sortedAsc[0];
  }
  const rank = (p / 100) * (sortedAsc.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sortedAsc[low];
  }
  return sortedAsc[low] + (sortedAsc[high] - sortedAsc[low]) * (rank - low);
}

/**
 * Result of a packet-loss computation over an ordered frame-counter sequence.
 */
export interface PacketLoss {
  received: number;
  missing: number;
  expected: number;
  /** `null` when fewer than two frames are present (loss is undefined). */
  lossRate: number | null;
}

/**
 * Computes packet loss from frame counters ordered by time.
 *
 * For each consecutive pair the gap is `next - prev - 1`. A decrease (`next < prev`)
 * marks a session boundary (rejoin / counter reset) and its gap is ignored.
 */
export function packetLoss(fCntsInTimeOrder: number[]): PacketLoss {
  const received = fCntsInTimeOrder.length;
  let missing = 0;
  for (let i = 1; i < received; i += 1) {
    const gap = fCntsInTimeOrder[i] - fCntsInTimeOrder[i - 1] - 1;
    if (gap > 0) {
      missing += gap;
    }
  }
  const expected = received + missing;
  return {
    received,
    missing,
    expected,
    lossRate: received < 2 ? null : missing / expected,
  };
}

/**
 * Computes inter-arrival seconds between consecutive timestamps (ms epoch), in time order.
 * Pairs spanning a session boundary should be excluded by the caller before passing them in.
 */
export function interArrivalSeconds(timestampsMs: number[]): number[] {
  const deltas: number[] = [];
  for (let i = 1; i < timestampsMs.length; i += 1) {
    deltas.push((timestampsMs[i] - timestampsMs[i - 1]) / 1000);
  }
  return deltas;
}

/**
 * Returns the median of an unsorted numeric array, or `null` when empty.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}
