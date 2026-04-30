import { config } from '../config.js';
import { logger } from '../logger.js';
import { evaluateAll } from '../alerts/engine.js';
import { pollTts } from './tts.js';
import { pollWmc } from './wmc.js';
import { runRetryTick, runWatchdogTick } from '../apps/leds/index.js';

type Timer = ReturnType<typeof setTimeout>;
const timers: Timer[] = [];
let stopped = false;

const RETRY_INTERVAL_SEC = 30;
const WATCHDOG_INTERVAL_SEC = 30 * 60;

function schedule(name: string, fn: () => Promise<void>, intervalSec: number, initialDelayMs: number): void {
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try { await fn(); }
    catch (err) { logger.error({ err, poller: name }, 'poller tick threw'); }
    if (stopped) return;
    timers.push(setTimeout(tick, intervalSec * 1_000));
  };
  timers.push(setTimeout(tick, initialDelayMs));
}

export function startPollers(): void {
  stopped = false;
  if (config.tts.baseUrl && config.tts.apiKey) {
    schedule('tts', pollTts, config.tts.pollIntervalSec, 3_000);
    logger.info({ interval_s: config.tts.pollIntervalSec }, 'tts poller scheduled');
  } else {
    logger.info('tts poller not scheduled (TTS_BASE_URL / TTS_API_KEY missing)');
  }
  if (config.wmc.baseUrl && config.wmc.login && config.wmc.password) {
    schedule('wmc', pollWmc, config.wmc.pollIntervalSec, 6_000);
    logger.info({ interval_s: config.wmc.pollIntervalSec }, 'wmc poller scheduled');
  } else {
    logger.info('wmc poller not scheduled (WMC_* env missing)');
  }

  // Alert engine runs regardless of integration availability; with no data
  // the evaluators early-exit on empty registries.
  schedule('alerts', evaluateAll, 60, 12_000);
  logger.info({ interval_s: 60 }, 'alert engine scheduled');

  // LEDs command queue. Retry runner pushes pending downlinks with a fixed
  // backoff; watchdog kicks idle devices so their session doesn't drift.
  if (config.tts.baseUrl && config.tts.apiKey) {
    schedule('leds_retry', runRetryTick, RETRY_INTERVAL_SEC, 15_000);
    schedule('leds_watchdog', runWatchdogTick, WATCHDOG_INTERVAL_SEC, 60_000);
    logger.info(
      { retry_s: RETRY_INTERVAL_SEC, watchdog_s: WATCHDOG_INTERVAL_SEC },
      'leds command queue scheduled',
    );
  }
}

export function stopPollers(): void {
  stopped = true;
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
}
