type NocRuntimeConfig = {
  backendUrl: string;
  wsUrl: string;
};

declare global {
  interface Window {
    __NOC_CONFIG__?: Partial<NocRuntimeConfig>;
  }
}

const rc = window.__NOC_CONFIG__ ?? {};

const backendUrl =
  rc.backendUrl && rc.backendUrl.trim() !== ''
    ? rc.backendUrl.replace(/\/$/, '')
    : ''; // empty = same origin

const wsUrl = (() => {
  if (rc.wsUrl && rc.wsUrl.trim() !== '') return rc.wsUrl.replace(/\/$/, '');
  if (backendUrl) return backendUrl.replace(/^http/, 'ws');
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
})();

export const runtimeConfig = { backendUrl, wsUrl };
