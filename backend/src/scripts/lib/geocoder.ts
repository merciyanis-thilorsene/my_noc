/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Logger } from 'scripts/lib/logger';

/** Per-request timeout for geocoder calls. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * A resolved coordinate pair.
 */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Turns a free-text address into coordinates using a Nominatim-compatible geocoder.
 *
 * Nominatim requires an identifying `User-Agent`, rate-limits to ~1 request/second, and returns
 * an empty array for an unresolvable address. This client makes a single best-effort lookup and
 * returns `null` on any failure (miss, timeout, non-2xx) so an address can always be stored even
 * when it cannot be geocoded — the operator can still enter coordinates manually.
 */
export default class Geocoder {
  protected baseUrl: string;

  protected logger: Logger;

  /**
   * Class constructor.
   *
   * @param logger Logger instance.
   *
   * @param baseUrl Geocoder base URL (no trailing slash).
   */
  public constructor(logger: Logger, baseUrl: string) {
    this.logger = logger;
    this.baseUrl = baseUrl;
  }

  /**
   * Resolves an address to coordinates, or `null` when it cannot be geocoded.
   *
   * @param address Free-text address.
   *
   * @returns Coordinates, or `null`.
   */
  public async geocode(address: string): Promise<Coordinates | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const query = new URLSearchParams({ q: address, format: 'json', limit: '1' });
      const response = await fetch(`${this.baseUrl}/search?${query.toString()}`, {
        headers: { 'User-Agent': 'MerciYanis-NOC/1.0 (gateway deployment geocoding)' },
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, '[geocoder] Lookup returned a non-2xx status.');
        return null;
      }
      const results = await response.json() as { lat?: string; lon?: string }[];
      if (results.length === 0) {
        return null;
      }
      const { lat, lon } = results[0];
      if (lat === undefined || lon === undefined) {
        return null;
      }
      const latitude = Number.parseFloat(lat);
      const longitude = Number.parseFloat(lon);
      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        return null;
      }
      return { latitude, longitude };
    } catch (error) {
      this.logger.warn({ err: error }, '[geocoder] Lookup failed.');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
