/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { type Logger } from 'scripts/lib/logger';

/** Per-request timeout for WMC calls. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A gateway location as reported by WMC. `location_type` distinguishes a surveyed/GPS fix from
 * a manually-entered one and gates the deployment-address sync (see the read API).
 */
export interface WmcGatewayLocation {
  latitude?: number;
  longitude?: number;
  location_type?: string;
}

/**
 * The subset of WMC's `GatewayStatusModel` the NOC consumes.
 */
export interface WmcGateway {
  gwEui: string;
  name?: string;
  customerId?: number;
  creationDate?: string;
  connectionStatus?: {
    status?: string;
    lastUpdateTime?: string;
    messageInterval?: number;
  };
  locations?: WmcGatewayLocation[];
}

/**
 * A single gateway vital (health metric) from WMC.
 */
export interface WmcVital {
  name?: string;
  value?: string | number;
  date?: string;
}

/**
 * A page of gateways plus the total count WMC reports for the customer.
 */
export interface WmcGatewayPage {
  gateways: WmcGateway[];
  total: number;
}

/**
 * WMC client settings.
 */
export interface WmcClientSettings {
  baseUrl: string;
  login: string;
  password: string;
}

/**
 * Extracts customer IDs from a Cognito access token's `cognito:groups` claim
 * (entries shaped `WMP4:CUSTOMER:<id>:`). The token is our own and already trusted, so the
 * signature is not verified — only the payload segment is decoded.
 */
function extractCustomerIds(accessToken: string): number[] {
  const segments = accessToken.split('.');
  if (segments.length < 2) {
    return [];
  }
  let payload: { 'cognito:groups'?: unknown };
  try {
    payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as {
      'cognito:groups'?: unknown;
    };
  } catch {
    return [];
  }
  const groups = payload['cognito:groups'];
  if (!Array.isArray(groups)) {
    return [];
  }
  const ids: number[] = [];
  groups.forEach((group) => {
    if (typeof group === 'string') {
      const match = /^WMP4:CUSTOMER:(\d+):/.exec(group);
      if (match !== null) {
        ids.push(parseInt(match[1], 10));
      }
    }
  });
  return ids;
}

/**
 * Minimal client for the Kerlink WMC (Wanesy Management Center) REST API.
 *
 * Auth is a Cognito JWT obtained with HTTP Basic credentials; accessible customer IDs are read
 * from the token's `cognito:groups` claim. Subsequent calls use a Bearer token, and a `401`
 * triggers a single re-login before the call is retried.
 */
export default class WmcClient {
  protected baseUrl: string;

  protected login: string;

  protected password: string;

  protected logger: Logger;

  protected accessToken: string | null;

  protected customerIds: number[];

  /**
   * Class constructor.
   *
   * @param logger Logger instance.
   *
   * @param settings WMC connection settings.
   */
  public constructor(logger: Logger, settings: WmcClientSettings) {
    this.logger = logger;
    this.baseUrl = `${settings.baseUrl}/api/v1`;
    this.login = settings.login;
    this.password = settings.password;
    this.accessToken = null;
    this.customerIds = [];
  }

  /**
   * Authenticates against WMC and caches the access token plus the accessible customer IDs.
   */
  protected async authenticate(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const credentials = Buffer.from(`${this.login}:${this.password}`).toString('base64');
      const response = await fetch(`${this.baseUrl}/users/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`WMC authentication failed with status ${String(response.status)}.`);
      }
      const body = await response.json() as { data?: { AccessToken?: string } };
      const token = body.data?.AccessToken;
      if (token === undefined || token === '') {
        throw new Error('WMC authentication response did not contain an access token.');
      }
      this.accessToken = token;
      this.customerIds = extractCustomerIds(token);
      this.logger.info({ customerIds: this.customerIds }, '[wmc] Authenticated.');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Performs an authenticated GET/PUT, re-authenticating once on a `401`.
   *
   * @param path Path relative to the API base (e.g. `/customers/1/gateways`).
   *
   * @param init Fetch options (method, body, headers).
   *
   * @param allowRetry Whether a `401` should trigger a re-login and one retry.
   *
   * @returns The parsed JSON response, or `null` for an empty body.
   */
  protected async request<T>(
    path: string,
    init: RequestInit = {},
    allowRetry = true,
  ): Promise<T> {
    if (this.accessToken === null) {
      await this.authenticate();
    }
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        body: init.body,
        headers: {
          Authorization: `Bearer ${String(this.accessToken)}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      if (response.status === 401 && allowRetry) {
        this.accessToken = null;
        clearTimeout(timer);
        await this.authenticate();
        return await this.request<T>(path, init, false);
      }
      if (!response.ok) {
        throw new Error(`WMC request to ${path} failed with status ${String(response.status)}.`);
      }
      const text = await response.text();
      return (text === '' ? null : JSON.parse(text)) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Returns the customer IDs the authenticated account can access, authenticating if needed.
   */
  public async getCustomerIds(): Promise<number[]> {
    if (this.accessToken === null) {
      await this.authenticate();
    }
    return this.customerIds;
  }

  /**
   * Fetches one page of gateways for a customer.
   *
   * @param customerId WMC customer ID.
   *
   * @param offset Zero-based page offset.
   *
   * @param limit Page size.
   *
   * @returns The gateways on this page plus WMC's reported total.
   */
  public async listGateways(
    customerId: number,
    offset: number,
    limit: number,
  ): Promise<WmcGatewayPage> {
    const body = await this.request<{
      data?: WmcGateway[];
      metadata?: { totalCount?: number };
    }>(`/customers/${String(customerId)}/gateways?offset=${String(offset)}&limit=${String(limit)}`);
    return {
      gateways: body.data ?? [],
      total: body.metadata?.totalCount ?? 0,
    };
  }

  /**
   * Fetches a gateway's vitals (health metrics) for the detail page.
   *
   * @param customerId WMC customer ID.
   *
   * @param gwEui Canonical gateway EUI.
   *
   * @returns The list of vitals, or an empty array.
   */
  public async getGatewayHealth(customerId: number, gwEui: string): Promise<WmcVital[]> {
    const body = await this.request<{ vitals?: WmcVital[] }>(
      `/customers/${String(customerId)}/gateways/${gwEui}/health`,
    );
    return body.vitals ?? [];
  }

  /**
   * Writes a gateway's location back to WMC (the deployment-address sync).
   *
   * @param customerId WMC customer ID.
   *
   * @param gwEui Canonical gateway EUI.
   *
   * @param latitude Latitude to write.
   *
   * @param longitude Longitude to write.
   */
  public async putGatewayLocation(
    customerId: number,
    gwEui: string,
    latitude: number,
    longitude: number,
  ): Promise<void> {
    await this.request<unknown>(
      `/customers/${String(customerId)}/gateways/${gwEui}/location`,
      { method: 'PUT', body: JSON.stringify({ latitude, longitude }) },
    );
  }
}
