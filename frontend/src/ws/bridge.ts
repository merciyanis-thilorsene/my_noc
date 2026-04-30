import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onLive } from './client';

// When the backend broadcasts, nudge the right query caches so the UI
// updates without waiting for the next refetchInterval tick.
export function useLiveBridge(): void {
  const qc = useQueryClient();

  useEffect(() => {
    return onLive((ev) => {
      switch (ev.type) {
        case 'device_uplink':
          qc.invalidateQueries({ queryKey: ['devices'] });
          qc.invalidateQueries({ queryKey: ['overview'] });
          break;
        case 'gateway_status_change':
          qc.invalidateQueries({ queryKey: ['gateways'] });
          qc.invalidateQueries({ queryKey: ['overview'] });
          break;
        case 'alert_raised':
        case 'alert_cleared':
          qc.invalidateQueries({ queryKey: ['alerts'] });
          qc.invalidateQueries({ queryKey: ['overview'] });
          break;
      }
    });
  }, [qc]);
}
