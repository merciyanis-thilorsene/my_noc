import { pool } from '../db.js';
import { broadcast } from '../ws/live.js';

export type Severity = 'info' | 'warning' | 'critical';
export type Source = 'TTS' | 'WMC' | 'DERIVED' | 'ML';
export type EntityType = 'gateway' | 'device' | 'network';

type AlertRow = {
  id: number;
  severity: Severity;
  source: Source;
  entity_type: EntityType;
  entity_id: string;
  rule_name: string;
  message: string;
  raised_at: string;
  cleared_at: string | null;
  details: Record<string, unknown> | null;
};

export type RaiseParams = {
  severity: Severity;
  source: Source;
  entity_type: EntityType;
  entity_id: string;
  rule_name: string;
  message: string;
  details?: Record<string, unknown>;
};

// Idempotent raise: inserts only if no active alert with the same
// (entity_type, entity_id, rule_name) key exists. The partial unique index
// `alerts_active_uq` also guarantees this at the DB level.
export async function raiseAlert(p: RaiseParams): Promise<AlertRow | null> {
  const { rows } = await pool.query<AlertRow>(
    `INSERT INTO alerts (severity, source, entity_type, entity_id, rule_name, message, details)
     SELECT $1, $2, $3, $4, $5, $6, $7::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM alerts
         WHERE entity_type = $3 AND entity_id = $4 AND rule_name = $5 AND cleared_at IS NULL
      )
     RETURNING *`,
    [p.severity, p.source, p.entity_type, p.entity_id, p.rule_name, p.message,
     p.details ? JSON.stringify(p.details) : null],
  );
  const row = rows[0];
  if (row) broadcast('alert_raised', row);
  return row ?? null;
}

export async function clearAlert(
  entity_type: EntityType,
  entity_id: string,
  rule_name: string,
): Promise<AlertRow | null> {
  const { rows } = await pool.query<AlertRow>(
    `UPDATE alerts SET cleared_at = now()
      WHERE entity_type = $1 AND entity_id = $2 AND rule_name = $3 AND cleared_at IS NULL
     RETURNING *`,
    [entity_type, entity_id, rule_name],
  );
  const row = rows[0];
  if (row) broadcast('alert_cleared', row);
  return row ?? null;
}
