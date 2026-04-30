-- `leds` application — convenience view scoping the canonical uplinks table
-- to the Busylight fleet. App-specific rules and routes query this view so
-- they don't have to repeat WHERE app_id = 'leds' on every read.
--
-- Read-only by design; the underlying uplinks hypertable remains the single
-- source of truth and keeps its own compression / retention policies.

CREATE OR REPLACE VIEW leds_uplinks AS
  SELECT * FROM uplinks WHERE app_id = 'leds';
