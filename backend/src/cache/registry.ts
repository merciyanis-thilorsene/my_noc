import { redis } from '../redis.js';
import { config } from '../config.js';

const GATEWAY_SET = 'gateway:registry:euis';
const DEVICE_SET = 'device:registry:euis';

// TTL set to 3× the longest poll interval. If a poller is temporarily
// unreachable the registry stays warm across a couple of missed cycles.
function ttlSeconds(): number {
  return Math.max(config.tts.pollIntervalSec, config.wmc.pollIntervalSec) * 3;
}

type RegistryRow = Record<string, unknown>;

async function mergePut(key: string, indexSet: string, id: string, patch: RegistryRow): Promise<void> {
  const existing = await redis.get(key);
  const base = existing ? (JSON.parse(existing) as RegistryRow) : {};
  const merged = { ...base, ...patch };
  await redis
    .multi()
    .set(key, JSON.stringify(merged), 'EX', ttlSeconds())
    .sadd(indexSet, id)
    .exec();
}

// -------- Gateways --------
export async function putGatewayRegistry(eui: string, data: RegistryRow): Promise<void> {
  await mergePut(`gateway:registry:${eui}`, GATEWAY_SET, eui, { ...data, gateway_eui: eui });
}
export async function getGateway(eui: string): Promise<RegistryRow | null> {
  const s = await redis.get(`gateway:registry:${eui}`);
  return s ? (JSON.parse(s) as RegistryRow) : null;
}
export async function listGatewayEuis(): Promise<string[]> {
  return redis.smembers(GATEWAY_SET);
}

// -------- Devices --------
export async function putDeviceRegistry(devEui: string, data: RegistryRow): Promise<void> {
  await mergePut(`device:registry:${devEui}`, DEVICE_SET, devEui, { ...data, dev_eui: devEui });
}
export async function getDevice(devEui: string): Promise<RegistryRow | null> {
  const s = await redis.get(`device:registry:${devEui}`);
  return s ? (JSON.parse(s) as RegistryRow) : null;
}
export async function listDeviceEuis(): Promise<string[]> {
  return redis.smembers(DEVICE_SET);
}

// -------- Applications --------
export async function putAppRegistry(id: string, data: RegistryRow): Promise<void> {
  await redis.set(`app:${id}`, JSON.stringify({ id, ...data }), 'EX', ttlSeconds());
}
