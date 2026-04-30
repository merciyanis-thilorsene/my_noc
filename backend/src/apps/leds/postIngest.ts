import { markAckedFromUplink } from './commands.js';

// Called by the apps dispatcher after every successful uplink persist for an
// `leds` app device. The decoded payload is the busylight v3.1 keep-alive
// shape (see decoder.ts) — when its downlinks_rx counter differs from the
// snapshot we took before our last push, that downlink ACKed.
export async function onLedsUplinkPersisted(
  devEui: string,
  decoded: unknown,
): Promise<void> {
  if (!decoded || typeof decoded !== 'object') return;
  const d = decoded as Record<string, unknown>;
  if (d.decoder !== 'busylight_v3.1') return;
  const dlrx = d.downlinks_rx;
  if (typeof dlrx !== 'number') return;
  await markAckedFromUplink(devEui, dlrx);
}
