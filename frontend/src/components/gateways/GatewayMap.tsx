import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { GatewayListItem } from '../../api';
import { isSilent, mapPosition, statusMeta, gatewayName } from '../../lib/gateways';
import { int } from '../../lib/format';
import { L as T } from '../../lib/i18n';

/**
 * Builds an antenna-badge icon for one gateway: a small circular marker (colored by effective
 * status, mildly sized by 24h traffic) with a "cell_tower" glyph, plus a pulsing berry ring
 * for silent gateways.
 */
function gatewayIcon(color: string, uplinks: number, silent: boolean): L.DivIcon {
  const size = Math.round(Math.max(22, Math.min(32, 18 + Math.sqrt(Math.max(uplinks, 0)))));
  const glyphSize = Math.round(size * 0.52);
  return L.divIcon({
    className: 'gw-marker-icon',
    html: `<div class="gw-marker" style="background:${color}">`
      + `<span class="icon" style="font-size:${glyphSize}px">cell_tower</span>`
      + (silent ? '<span class="gw-marker-ring"></span>' : '')
      + '</div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Fleet map: one antenna marker per located gateway, colored by effective status and sized
 * by 24h traffic; silent gateways get a pulsing berry ring. Unlocated gateways only appear
 * in the table below.
 */
export default function GatewayMap({ gateways, tileUrl, onOpen }: {
  gateways: GatewayListItem[];
  tileUrl: string;
  onOpen: (gwEui: string) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return undefined;
    const map = L.map(elRef.current, { zoomControl: true, scrollWheelZoom: true })
      .setView([46.8, 2.6], 6);
    L.tileLayer(tileUrl, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // The container is sized by the grid; Leaflet measures too early on first paint.
    const t = setTimeout(() => map.invalidateSize(), 150);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // The tile URL is fixed for the app's lifetime (served by /api/config).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileUrl]);

  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    const located: [number, number][] = [];
    gateways.forEach((g) => {
      const pos = mapPosition(g);
      if (pos === null) return;
      located.push(pos);
      const meta = statusMeta(g);
      const silent = isSilent(g);
      L.marker(pos, { icon: gatewayIcon(meta.color, g.uplinks_relayed, silent) })
        .addTo(layer)
        .on('click', () => onOpen(g.gw_eui))
        .bindTooltip(`${gatewayName(g)} · ${int(g.uplinks_relayed)} ${T.gw.uplinks}`, { direction: 'top' });
    });
    if (!fittedRef.current && located.length > 0) {
      fittedRef.current = true;
      map.fitBounds(L.latLngBounds(located).pad(0.35), { maxZoom: 12 });
    }
  }, [gateways, onOpen]);

  return <div ref={elRef} className="map-el" />;
}
