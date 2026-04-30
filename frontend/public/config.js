// Dev default. Overwritten at container start by /docker-entrypoint.d/99-noc-config.sh
// so the same image can point to different backends without a rebuild.
window.__NOC_CONFIG__ = {
  backendUrl: "",
  wsUrl: ""
};
