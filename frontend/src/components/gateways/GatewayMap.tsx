import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { GatewayListItem } from '../../api';
import { isSilent, mapPosition, statusMeta, gatewayName } from '../../lib/gateways';
import { int } from '../../lib/format';
import { L as T } from '../../lib/i18n';

/**
 * Fleet map: one circle marker per located gateway, colored by effective status and sized
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
      const radius = Math.max(7, Math.min(22, 5 + Math.sqrt(Math.max(g.uplinks_relayed, 1)) / 2));
      L.circleMarker(pos, {
        radius, color: '#fff', weight: 1.5, fillColor: meta.color, fillOpacity: 0.9,
      })
        .addTo(layer)
        .on('click', () => onOpen(g.gw_eui))
        .bindTooltip(`${gatewayName(g)} · ${int(g.uplinks_relayed)} ${T.gw.uplinks}`, { direction: 'top' });
      if (silent) {
        L.circleMarker(pos, {
          radius: radius + 3, color: '#f44b83', weight: 2, fill: false, className: 'gw-silent-ring',
        }).addTo(layer);
      }
    });
    if (!fittedRef.current && located.length > 0) {
      fittedRef.current = true;
      map.fitBounds(L.latLngBounds(located).pad(0.35), { maxZoom: 12 });
    }
  }, [gateways, onOpen]);

  return <div ref={elRef} className="map-el" />;
}
