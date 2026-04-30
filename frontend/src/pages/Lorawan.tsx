import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDevices } from '../hooks/useDevices';
import { useAlerts } from '../hooks/useAlerts';
import { useAdrOff, useForceSf8, useLorawanStats, useSetColor } from '../hooks/useLorawan';
import type { Device, Alert } from '../api/types';
import { MetricBox } from '../components/MetricBox';
import { EmptyState } from '../components/EmptyState';
import { StatusDot } from '../components/StatusDot';

const COLOR_OPTIONS = ['red', 'green', 'blue', 'yellow', 'purple', 'white', 'off'] as const;

const COLOR_SWATCH: Record<string, string> = {
  red:    'bg-[#990000]',
  green:  'bg-[#009900]',
  blue:   'bg-[#0000ff]',
  yellow: 'bg-[#999900]',
  purple: 'bg-[#990099]',
  white:  'bg-[#cccccc]',
  off:    'bg-noc-bg border border-noc-border',
};

function isLeds(d: Device): boolean {
  return d.app_id === 'leds';
}

function isActive(lastSeen: unknown): boolean {
  if (typeof lastSeen !== 'string') return false;
  const age = Date.now() - new Date(lastSeen).getTime();
  return Number.isFinite(age) && age < 60 * 60 * 1_000;
}

export default function Lorawan() {
  const stats = useLorawanStats();
  const devices = useDevices();
  const alerts = useAlerts('active');

  const ledsDevices = useMemo(
    () => (devices.data?.items ?? []).filter(isLeds),
    [devices.data],
  );
  const ledsAlerts = useMemo(
    () => (alerts.data?.items ?? []).filter((a) => a.rule_name.startsWith('leds_')),
    [alerts.data],
  );

  const sf12 = stats.data?.devices.on_sf12 ?? 0;
  const adrEnabled = stats.data?.devices.adr_enabled ?? 0;
  const total = stats.data?.devices.total ?? ledsDevices.length;
  const pendingTotal =
    (stats.data?.commands.pending.color ?? 0) +
    (stats.data?.commands.pending.adr_off ?? 0) +
    (stats.data?.commands.pending.keepalive ?? 0);

  return (
    <div className="grid gap-4">
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricBox label="LEDs Devices" value={total} />
        <MetricBox
          label="On SF12"
          value={sf12}
          source="DERIVED"
        >
          <div className="text-xs text-noc-text-dim">
            {sf12 > 0 ? `auto-remediating via force_sf8` : 'all clear'}
          </div>
        </MetricBox>
        <MetricBox
          label="ADR enabled"
          value={adrEnabled}
          source="DERIVED"
        >
          <div className="text-xs text-noc-text-dim">
            {adrEnabled > 0 ? 'auto-disabling via downlink' : 'all clear'}
          </div>
        </MetricBox>
        <MetricBox label="Pending downlinks" value={pendingTotal}>
          <div className="text-xs text-noc-text-dim mono">
            color: {stats.data?.commands.pending.color ?? 0}
            {' · '}adr: {stats.data?.commands.pending.adr_off ?? 0}
            {' · '}keepalive: {stats.data?.commands.pending.keepalive ?? 0}
          </div>
        </MetricBox>
        <MetricBox
          label="Failed (24h)"
          value={stats.data?.commands.failed_24h ?? 0}
        >
          <div className="text-xs text-noc-text-dim">commands that hit max attempts</div>
        </MetricBox>
      </section>

      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-noc-border flex items-center justify-between">
          <div className="label m-0">LEDs Devices ({ledsDevices.length})</div>
          <div className="text-xs text-noc-text-dim">
            App <span className="mono">leds</span> · Busylight v3.1
          </div>
        </div>
        {devices.isLoading ? (
          <div className="p-6 text-noc-text-dim text-sm">Loading…</div>
        ) : ledsDevices.length === 0 ? (
          <EmptyState
            title="No LEDs devices yet"
            hint="Devices appear after the TTS poller runs (TTS_APP_IDS must include 'leds') or once a webhook arrives."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-noc-text-dim text-xs uppercase">
              <tr>
                <th className="p-3"></th>
                <th>DevEUI</th>
                <th>Name</th>
                <th>SF</th>
                <th>RSSI</th>
                <th>SNR</th>
                <th>Last seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ledsDevices.map((d) => (
                <DeviceRow key={d.dev_eui} device={d} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="p-3 border-b border-noc-border label m-0">
          Active LEDs alerts ({ledsAlerts.length})
        </div>
        {alerts.isLoading ? (
          <div className="p-6 text-noc-text-dim text-sm">Loading…</div>
        ) : ledsAlerts.length === 0 ? (
          <EmptyState title="No active LEDs alerts" hint="The fleet is healthy." />
        ) : (
          <ul className="divide-y divide-noc-border">
            {ledsAlerts.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DeviceRow({ device }: { device: Device }) {
  const force = useForceSf8();
  const adr   = useAdrOff();
  const color = useSetColor();
  const [picker, setPicker] = useState(false);
  const active = isActive(device.last_seen);
  const last = typeof device.last_seen === 'string'
    ? new Date(device.last_seen).toLocaleTimeString()
    : '—';
  const sf = device.last_sf;
  const sfClass = sf === 12 ? 'text-noc-critical' : sf === 7 || sf === 8 ? 'text-noc-accent' : '';

  const busy = force.isPending || adr.isPending || color.isPending;

  return (
    <tr className="border-t border-noc-border hover:bg-noc-hover">
      <td className="p-3">
        <StatusDot status={active ? 'operational' : 'unknown'} />
      </td>
      <td className="mono">
        <Link to={`/devices/${device.dev_eui}`} className="hover:text-noc-text">
          {device.dev_eui}
        </Link>
      </td>
      <td className="truncate max-w-[14rem]">{String(device.name ?? device.device_id ?? '—')}</td>
      <td className={`mono ${sfClass}`}>{sf ?? '—'}</td>
      <td className="mono">{device.last_rssi ?? '—'}</td>
      <td className="mono">{device.last_snr ?? '—'}</td>
      <td className="mono text-xs">{last}</td>
      <td>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            className="btn"
            disabled={busy}
            onClick={() => force.mutate(device.dev_eui)}
            title="Force SF8 + disable ADR via TTS NS API"
          >
            Force SF8
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => adr.mutate(device.dev_eui)}
            title="Send 0x0200 ADR-disable downlink"
          >
            ADR off
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => setPicker((p) => !p)}
          >
            Color
          </button>
          {picker && (
            <div className="flex items-center gap-1">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  className={`w-6 h-6 rounded ${COLOR_SWATCH[c]} hover:ring-2 hover:ring-noc-info disabled:opacity-50`}
                  disabled={busy}
                  title={c}
                  onClick={() => {
                    color.mutate(
                      { devEui: device.dev_eui, color: c },
                      { onSettled: () => setPicker(false) },
                    );
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {(force.isError || adr.isError || color.isError) && (
          <div className="text-xs text-noc-critical mt-1">
            {(force.error as Error | undefined)?.message ??
              (adr.error as Error | undefined)?.message ??
              (color.error as Error | undefined)?.message}
          </div>
        )}
      </td>
    </tr>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <li className="p-3 flex items-center gap-3">
      <span
        className={`w-1.5 h-10 rounded ${
          alert.severity === 'critical' ? 'bg-noc-critical'
          : alert.severity === 'warning' ? 'bg-noc-warning'
          : 'bg-noc-info'
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{alert.message}</div>
        <div className="text-xs text-noc-text-dim mono">
          {alert.entity_type === 'device' ? (
            <Link to={`/devices/${alert.entity_id}`} className="hover:text-noc-text">
              {alert.entity_type}:{alert.entity_id}
            </Link>
          ) : (
            <span>{alert.entity_type}:{alert.entity_id}</span>
          )}
          {' · '}raised {new Date(alert.raised_at).toLocaleString()}
          {' · '}<span className="opacity-70">{alert.rule_name}</span>
        </div>
      </div>
    </li>
  );
}
