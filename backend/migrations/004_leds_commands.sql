-- LEDs module — color state + downlink command queue.
--
-- device_color_state holds the *desired* state for each device: what colour
-- we want it to display. The retry runner pushes confirmed downlinks until
-- the device acknowledges (its keep-alive's downlinks_rx counter advances).
--
-- device_commands is the per-attempt log. One row per command we've decided
-- to send; the retry runner re-pushes pending rows on a fixed cadence until
-- they ACK or exceed max_attempts.

CREATE TABLE IF NOT EXISTS device_color_state (
  device_eui        text PRIMARY KEY,
  desired_color     text NOT NULL,
  last_acked_color  text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_commands (
  id                    bigserial PRIMARY KEY,
  device_eui            text NOT NULL,
  command_type          text NOT NULL CHECK (command_type IN ('color', 'adr_off', 'keepalive')),
  payload_b64           text NOT NULL,
  f_port                int NOT NULL,
  attempts              int NOT NULL DEFAULT 0,
  max_attempts          int NOT NULL DEFAULT 3,
  next_attempt_at       timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  acked_at              timestamptz,
  failed_at             timestamptz,
  downlinks_rx_at_send  int,
  correlation_ids       text[],
  last_error            text,
  details               jsonb
);

-- Pending queue lookup — the retry runner reads via this index.
CREATE INDEX IF NOT EXISTS device_commands_pending_idx
  ON device_commands (next_attempt_at)
  WHERE acked_at IS NULL AND failed_at IS NULL;

CREATE INDEX IF NOT EXISTS device_commands_device_idx
  ON device_commands (device_eui, created_at DESC);

-- At most one pending color command per device at a time. Without this a
-- rapid sequence of operator setColor calls would stack up identical
-- pending rows faster than they could be ACKed; instead, setColor updates
-- the existing pending row in place when one is present.
CREATE UNIQUE INDEX IF NOT EXISTS device_commands_one_pending_color_uq
  ON device_commands (device_eui)
  WHERE command_type = 'color' AND acked_at IS NULL AND failed_at IS NULL;
