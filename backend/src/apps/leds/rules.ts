import { pool } from '../../db.js';
import { logger } from '../../logger.js';
import { clearAlert, raiseAlert } from '../../alerts/broadcast.js';
import { forceSf8 } from './actions.js';
import { enqueueAdrOff } from './commands.js';
import { loadSfExclusions } from './exclusions.js';

// SF12 on EU868 means the device joined or fell back to the slowest data rate.
// At ~75 devices on one app this saturates gateway downlink scheduling, which
// is the original symptom we are trying to surface and auto-correct.
const SF12 = 12;

type LatestUplink = {
  device_eui: string;
  sf: number | null;
  timestamp: string;
};

export async function evaluateLedsSf12(): Promise<void> {
  const exclusions = await loadSfExclusions();
  const { rows } = await pool.query<LatestUplink>(
    `SELECT DISTINCT ON (device_eui) device_eui, sf, timestamp
       FROM leds_uplinks
      ORDER BY device_eui, timestamp DESC`,
  );

  for (const r of rows) {
    if (r.sf === SF12) {
      const raised = await raiseAlert({
        severity: 'critical',
        source: 'DERIVED',
        entity_type: 'device',
        entity_id: r.device_eui,
        rule_name: 'leds_sf12',
        message: `Device ${r.device_eui} transmitting on SF12 — causes gateway scheduling conflicts`,
        details: { sf: r.sf, last_uplink_at: r.timestamp },
      });

      // Auto-remediate only on the *transition* edge: raiseAlert returns the
      // new row when it actually inserts (idempotent against active alerts),
      // so this fires once per SF12 episode rather than every minute it stays
      // active. Skip devices on the exclusion list — those genuinely need SF12
      // to reach a gateway and forcing SF8 would silence them.
      if (raised && !exclusions.has(r.device_eui)) {
        try {
          await forceSf8(r.device_eui);
        } catch (err) {
          logger.error(
            { err: (err as Error).message, device_eui: r.device_eui },
            'leds: auto force_sf8 failed',
          );
        }
      } else if (raised && exclusions.has(r.device_eui)) {
        logger.info(
          { device_eui: r.device_eui },
          'leds: SF12 detected but device excluded from auto force_sf8',
        );
      }
    } else if (r.sf != null) {
      await clearAlert('device', r.device_eui, 'leds_sf12');
    }
  }
}

type LatestAdrSample = {
  device_eui: string;
  adr_state: number | null;
  timestamp: string;
};

// Plenom Busylight reports its current ADR enable/disable state in byte 5
// of the keep-alive payload (decoded as adr_state, bits 0–1). 0 means ADR is
// disabled — the configuration we want, since otherwise the device drifts
// back to SF12 after a session reset.
export async function evaluateLedsAdrState(): Promise<void> {
  const { rows } = await pool.query<LatestAdrSample>(
    `SELECT DISTINCT ON (device_eui)
            device_eui,
            (decoded_payload->>'adr_state')::int AS adr_state,
            timestamp
       FROM leds_uplinks
      WHERE decoded_payload->>'decoder' = 'busylight_v3.1'
      ORDER BY device_eui, timestamp DESC`,
  );

  for (const r of rows) {
    if (r.adr_state == null) continue;
    if (r.adr_state !== 0) {
      const raised = await raiseAlert({
        severity: 'warning',
        source: 'DERIVED',
        entity_type: 'device',
        entity_id: r.device_eui,
        rule_name: 'leds_adr_enabled',
        message: `Device ${r.device_eui} reports ADR still enabled (state=${r.adr_state}) — sending ADR-disable`,
        details: { adr_state: r.adr_state, last_uplink_at: r.timestamp },
      });
      if (raised) {
        try {
          await enqueueAdrOff(r.device_eui);
        } catch (err) {
          logger.error(
            { err: (err as Error).message, device_eui: r.device_eui },
            'leds: enqueueAdrOff failed',
          );
        }
      }
    } else {
      await clearAlert('device', r.device_eui, 'leds_adr_enabled');
    }
  }
}

// Many devices joining the network at once saturates downlink duty cycle
// (the gateway has to send a join_accept per device, each taking airtime).
// The threshold (>5 distinct devices in 60s) is from the spec; tune once we
// have baseline traffic.
const JOIN_STORM_WINDOW_SEC = 60;
const JOIN_STORM_THRESHOLD = 5;
const NETWORK_ENTITY_ID = 'leds';

type JoinStormSample = {
  count: number;
  devices: string[];
};

export async function evaluateLedsJoinStorm(): Promise<void> {
  const { rows } = await pool.query<JoinStormSample>(
    `SELECT count(DISTINCT device_eui)::int AS count,
            array_agg(DISTINCT device_eui) AS devices
       FROM device_events
      WHERE event_type = 'join_accept'
        AND timestamp > now() - ($1 || ' seconds')::interval`,
    [String(JOIN_STORM_WINDOW_SEC)],
  );
  const sample = rows[0];
  const count = sample?.count ?? 0;

  if (count > JOIN_STORM_THRESHOLD) {
    await raiseAlert({
      severity: 'critical',
      source: 'DERIVED',
      entity_type: 'network',
      entity_id: NETWORK_ENTITY_ID,
      rule_name: 'leds_join_storm',
      message: `${count} devices joined within ${JOIN_STORM_WINDOW_SEC}s — duty-cycle saturation risk`,
      details: {
        count,
        threshold: JOIN_STORM_THRESHOLD,
        window_sec: JOIN_STORM_WINDOW_SEC,
        devices: sample?.devices ?? [],
      },
    });
  } else {
    await clearAlert('network', NETWORK_ENTITY_ID, 'leds_join_storm');
  }
}

export async function evaluateLedsRules(): Promise<void> {
  await Promise.all([
    evaluateLedsSf12(),
    evaluateLedsAdrState(),
    evaluateLedsJoinStorm(),
  ]);
}
