import { BusylightPayload } from '../api';
import { L } from '../lib/i18n';

export type LightMode = 'solid' | 'blink' | 'off';

const PRESETS = ['#ff0000', '#00e000', '#0066ff', '#ffaa00', '#ffffff'];

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (m === null) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Computes the Kuando downlink payload from a colour + mode. */
export function busylightPayload(hex: string, mode: LightMode): BusylightPayload {
  if (mode === 'off') {
    return {
      red: 0, green: 0, blue: 0, ontime: 0, offtime: 0,
    };
  }
  const { r, g, b } = hexToRgb(hex);
  return {
    red: r,
    green: g,
    blue: b,
    ontime: mode === 'blink' ? 5 : 255,
    offtime: mode === 'blink' ? 5 : 0,
  };
}

/** Controlled colour + mode picker for a Kuando Busylight (no send action). */
export default function BusylightControls({
  hex, mode, onHex, onMode,
}: {
  hex: string;
  mode: LightMode;
  onHex: (hex: string) => void;
  onMode: (mode: LightMode) => void;
}) {
  const off = mode === 'off';
  return (
    <div style={{
      display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap',
    }}
    >
      <div style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        background: off ? 'var(--bg-2)' : hex,
        boxShadow: off ? 'none' : `0 0 18px ${hex}`,
        border: '2px solid var(--border)',
      }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {L.ctl.color}
          <input type="color" value={hex} disabled={off} onChange={(e) => onHex(e.target.value)} />
          <span className="mono">{hex}</span>
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="pill"
              style={{ borderColor: p, cursor: 'pointer' }}
              onClick={() => onHex(p)}
              aria-label={`set ${p}`}
            >
              <span style={{
                display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: p,
              }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="seg">
        {(['solid', 'blink', 'off'] as const).map((m) => (
          <button key={m} type="button" className={mode === m ? 'active' : ''} onClick={() => onMode(m)}>{{ solid: L.ctl.solid, blink: L.ctl.blink, off: L.ctl.off }[m]}</button>
        ))}
      </div>
    </div>
  );
}
