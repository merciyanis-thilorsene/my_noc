-- LEDs module — state tables for the action engine.
--
-- sf_exclusions: devices we must NOT auto-force to SF8. Devices at the edge of
-- RF coverage (RSSI < -110 dBm) genuinely need SF12 to reach a gateway at all;
-- forcing SF8 on them silences the device. Curated by hand for now.

CREATE TABLE IF NOT EXISTS sf_exclusions (
  device_eui  text PRIMARY KEY,
  reason      text NOT NULL,
  excluded_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sf_exclusions (device_eui, reason)
VALUES ('20202037202B0202', 'RSSI < -110 dBm — at RF coverage limit, needs SF12 to reach a gateway')
ON CONFLICT (device_eui) DO NOTHING;
