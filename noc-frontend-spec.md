# LoRaWAN NOC Frontend — Technical Specification

## 1. Purpose

A React-based single-page application that presents real-time LoRaWAN network operations data to NOC operators. Consumes the NOC Core backend API exclusively (no direct calls to TTS or WMC). Designed as a read-heavy operational dashboard — operators observe, investigate, and receive alerts; management actions remain in TTS Console and WMC.

This spec assumes the backend spec (`noc-backend-spec.md`) is the source of truth for the API contract. Any divergence should be resolved by updating the backend spec first.

---

## 2. Scope

### 2.1 In Scope

- Unified gateway fleet view (TTS + WMC merged)
- Device fleet view with RF quality and battery monitoring
- Real-time event streaming via WebSocket
- Alert panel with severity filtering
- Drill-down detail panels for gateways and devices
- Time-series charts (traffic, RF quality, infrastructure KPIs)
- Forecast visualization (Phase 2, behind feature flag)
- Configuration panel for API key / backend URL
- Dark-theme NOC aesthetic suitable for wall-mounted screens

### 2.2 Out of Scope

- Device or gateway provisioning, editing, or deletion
- Downlink scheduling or payload injection
- Firmware or configuration management
- User management beyond single API key
- Direct connection to TTS or WMC (always through backend)
- Multi-organization / multi-tenant UI

---

## 3. Architecture

### 3.1 Application Type

Single-page React application, statically deployable. No server-side rendering needed — the app is an authenticated operator tool, not public-facing content.

### 3.2 Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    React Application                         │
│                                                              │
│  ┌────────────┐   ┌────────────┐   ┌─────────────────────┐ │
│  │   Pages    │──▶│   Hooks    │──▶│  API Client Layer   │ │
│  │ (routing)  │   │ (queries,  │   │  - REST (fetch)     │ │
│  │            │   │  mutations)│   │  - WebSocket client │ │
│  └────────────┘   └────────────┘   └──────────┬──────────┘ │
│                                                │            │
│                                                ▼            │
└────────────────────────────────────────────────┼────────────┘
                                                 │
                                   HTTPS + WSS (authenticated)
                                                 │
                                                 ▼
                                    NOC Core Backend (Perseid)
```

### 3.3 State Management Layers

Three distinct concerns, each with its own approach:

- **Server state** (gateways, devices, alerts, metrics) — managed by a data-fetching library with cache, retry, and invalidation. TanStack Query (React Query) recommended; if the team prefers Perseid-ecosystem tooling, use whatever the team already uses, as long as it provides caching and stale-while-revalidate semantics.
- **Real-time state** (WebSocket events) — merged into the server-state cache on receipt. A WebSocket event triggers a targeted cache update, not a full refetch.
- **UI state** (selected row, filter, active tab, modal open) — local React state or a minimal store (Zustand or equivalent). No global state library needed for Phase 1.

### 3.4 Routing

Routes correspond to top-level tabs and drill-downs:

- `/` — Overview dashboard (landing)
- `/gateways` — gateway fleet list
- `/gateways/:eui` — gateway detail page
- `/devices` — device fleet list
- `/devices/:eui` — device detail page
- `/alerts` — alert history and active alerts
- `/settings` — backend URL, API key, preferences

Route state determines tab highlighting, breadcrumbs, and browser back/forward behavior.

---

## 4. Page Structure

### 4.1 Overview Page

The landing page. Single-glance health view for someone walking up to the dashboard.

**Top section — fleet health strip:**
- Network health score ring (composite of gateway status, TTS connectivity, packet loss, SNR)
- Gateway counts by status (operational / unreachable / unknown)
- Device counts by status (active / inactive / low battery)
- Live uplink rate (last minute)
- Active alerts count by severity

**Middle section — traffic:**
- 24h uplinks-per-hour chart
- 24h downlinks-per-hour chart (smaller)
- Current sub-band duty cycle utilization

**Bottom section — recent activity:**
- Last 10 alerts
- Last 10 significant events (gateway status changes, device joins, device silences)

All data from `GET /api/overview` with a 30s refresh, plus WebSocket-driven updates for alerts and events.

### 4.2 Gateways Page

**Layout:** Two-pane split — list on the left (≈60% width), detail on the right. Detail pane is empty until a row is selected.

**List (table):**
Columns: status dot, name, EUI, location, TTS connection indicator, RSSI, SNR, SF distribution bar, CPU, temperature, last seen.

Filters: status (All / Operational / Unreachable / Unknown), search by name/EUI.
Sorting: click column headers; default sort puts Unreachable first.

**Detail pane:**
- Header: name, EUI, WMC status badge, TTS connection badge, last seen
- Identity grid: model, location, backhaul, firmware, uptime, frequency plan
- RF metrics block (source: TTS): RSSI, SNR, packet loss, round-trip time
- Infrastructure metrics block (source: WMC): CPU, RAM, temperature, ping
- Traffic section: 24h uplinks/downlinks, SF distribution breakdown
- Time-series charts: RSSI history (last 24h), CPU/RAM history, temperature history
- Link to gateway's devices: list of devices that used this gateway as best-signal in the last 24h

Each metric tagged with its source (TTS or WMC badge) for operator clarity.

### 4.3 Devices Page

**Layout:** Same two-pane split as gateways.

**List (table):**
Columns: active dot, name, type, DevEUI, RSSI, SNR, SF, FCnt up, battery icon, best gateway, last seen.

Filters: All / Active / Inactive / Low battery / Poor signal / Silent, search by name/DevEUI.
Sorting: click column headers; default sort by last-seen descending.

**Detail pane:**
- Header: name, DevEUI, active/inactive badge, battery indicator
- Identity grid: model, type, description, transmit interval, join date, FPort
- Last uplink RF block: RSSI, SNR, SF, number of receiving gateways
- Frame counters: FCnt up, FCnt down (flag if large gap since last check — possible reset)
- Best gateway: name + link to that gateway's detail page
- Airtime, last seen
- Decoded payload: pretty-printed JSON of the last uplink
- Time-series charts: RSSI trend (last 7 days), battery decay (if historical data exists), uplink frequency (last 24h)
- Uplink history: paginated list of last N uplinks with their RF metadata, receiving gateways, and decoded payload summary
- **Phase 2:** Forecast cards — predicted battery life, predicted next uplink time, anomaly score

### 4.4 Alerts Page

**Sections:**
- Active alerts at the top, grouped by severity
- Alert history below, filterable by date range, severity, source (TTS/WMC/Derived/ML), entity type (gateway/device)

**Each alert row:**
- Severity icon and color
- Source badge (TTS / WMC / Derived / ML)
- Entity link (clickable — navigates to gateway or device detail)
- Message
- Raised at / cleared at timestamps
- Duration if cleared, or "ongoing" badge if still active

Filtering is local (already-loaded alerts) until the filter crosses the loaded range, then triggers a new API call.

### 4.5 Settings Page

- Backend URL
- API key (masked by default, show/hide toggle)
- Test connection button (calls `GET /api/health`)
- Dashboard preferences: refresh interval, default tab on load, theme variant if multiple supported
- About section: app version, backend version (fetched from `/api/health`), connection status

---

## 5. API Client Layer

### 5.1 REST Client

A thin typed wrapper around `fetch` (or the HTTP client conventional in Perseid ecosystem).

**Responsibilities:**
- Inject `Authorization` header with API key from settings
- Centralized error handling (401 → redirect to settings, 5xx → toast notification)
- Response normalization (unwrap common envelope if backend uses one)
- Request deduplication (handled by the data-fetching library's cache)

**Type safety:**
Every endpoint has a matching TypeScript interface generated from or manually kept in sync with the backend's OpenAPI / JSON schema. If backend exposes OpenAPI at `/openapi.json`, use `openapi-typescript` or equivalent to auto-generate.

### 5.2 WebSocket Client

Single persistent connection to `wss://{backend}/ws/live`, authenticated via query-param token at handshake.

**Event handling:**
- `gateway_status_change` → update `gateways` cache entry for that EUI
- `device_uplink` → update `devices` cache entry + increment fleet uplink counter
- `alert_raised` → prepend to alerts cache + trigger toast notification
- `alert_cleared` → update alert cache entry with `cleared_at`

**Reconnection:**
- Exponential backoff on disconnect (1s, 2s, 4s, 8s, capped at 30s)
- Visual indicator in the header when disconnected
- On reconnect, trigger a full refresh of currently-viewed data to recover missed events

### 5.3 Data-Fetching Patterns

- **Lists** (gateways, devices, alerts): query with 30s stale time, refetch on window focus
- **Detail views**: query with 10s stale time, refetch on mount
- **Time-series charts**: query with 60s stale time, manual refresh button available
- **Overview**: query with 30s stale time + WebSocket-driven invalidation
- **Health check**: query every 15s with short timeout, shows connection status in header

---

## 6. Visual Design

### 6.1 Overall Aesthetic

Dark theme, industrial NOC style. Information-dense without being cluttered. Readable from 2+ meters for wall-mounted displays.

### 6.2 Design Tokens

- **Background scale:** `#050910` (page), `#0c1118` (panels), `#15202e` (borders), `#111a25` (hover)
- **Text scale:** `#dce4ec` (primary), `#5a6e80` (secondary), `#263040` (muted)
- **Semantic colors:**
  - Accent/success: `#00e699`
  - Warning: `#ffaa22`
  - Critical: `#ff3050`
  - Info/blue: `#2888ff`
- **Source colors** (for TTS/WMC attribution):
  - TTS: `#6c3dff` (purple)
  - WMC: `#ff8800` (orange)
- **Spreading factor palette** (SF7 to SF12): green → blue → purple → pink → red gradient to visually encode data rate quality
- **Fonts:** `DM Sans` for UI text, monospace for all numeric values, EUIs, and IDs

### 6.3 Component Patterns

**Status dots:** Pulsing animation when operational, solid when degraded or down. Consistent across gateways and devices.

**Source badges:** Small uppercase pill next to any metric indicating data origin. Helps operators reason about which system to troubleshoot when a metric looks wrong.

**Health rings:** SVG circular progress indicators for composite scores (network health, device battery). Color transitions from green through amber to red based on value.

**Metric boxes:** Standard card for displaying single values — label, big number, unit, optional trend, optional source tag.

**Spark bars / SF distribution bars:** Compact horizontal stacked bars showing proportional breakdowns without axes, relying on hover tooltips for detail.

### 6.4 Layout Responsiveness

- Primary target: 1920×1080 NOC screens
- Secondary target: 1440×900 laptop screens
- Tertiary target: tablet (768px+) with collapsible side panels
- Not optimized for phones — the information density doesn't map well to narrow screens. A "mobile alert" view (alerts-only, large text) could be added later if operators need on-call triage.

Breakpoints collapse the two-pane detail view into stacked mode on narrower screens. Tables use horizontal scroll rather than hiding columns.

### 6.5 Accessibility

- WCAG AA contrast ratios on all text (the dark theme palette has been chosen with this in mind)
- Keyboard navigation: tab through rows, Enter to select, Escape to close detail
- Screen-reader labels on status dots and source badges
- No information conveyed by color alone — always paired with text or shape

---

## 7. Real-Time Behavior

### 7.1 Update Granularity

- **Gateway status changes** propagate within 2s of backend receiving the event
- **Device uplinks** update the list within 2s; the selected device's detail updates immediately if it matches
- **Alerts** appear as toast notifications + update the alert count in the header + prepend to the alerts page
- **Metric charts** refresh on their configured interval; no real-time streaming into charts (keeps CPU load reasonable)

### 7.2 Visual Feedback for Updates

Subtle highlight animation on rows that just changed (1s fade from accent background). Avoids the "everything's moving all the time" problem while still drawing the eye to what's new.

### 7.3 Stale Data Handling

Each query exposes `isStale`, `isError`, `lastFetched`. If the backend is unreachable, the UI shows cached data with a clear "stale" indicator rather than erroring out — operators can still see what they last knew. A persistent banner appears in the header when the backend connection has been unavailable for more than 30s.

---

## 8. Error Handling

### 8.1 Classification

- **Auth errors (401)**: redirect to settings page with a prompt to update API key
- **Network errors**: show cached data + stale indicator + header banner
- **Server errors (5xx)**: toast with error message, retry automatically per query library config
- **Not found (404)**: detail pages show a "not found or no longer available" state
- **Validation errors (400)**: only applies to settings form, shown inline

### 8.2 Empty States

- No gateways: prompt to check backend configuration
- No devices: prompt to verify `TTS_APP_IDS` in backend config
- No alerts: positive empty state ("All systems operational")
- No uplinks in chart range: "No data in selected range" with a range picker

### 8.3 Logging

Client-side errors logged to console in dev, sent to an optional error-tracking endpoint (Sentry or similar) in production. Not required for Phase 1.

---

## 9. Authentication

### 9.1 Phase 1

Single API key stored in browser (localStorage or equivalent). Entered via settings page. Injected into every REST and WebSocket request.

The backend validates the key against its `FRONTEND_API_KEYS` config. No user accounts, no roles.

### 9.2 Future (not required now)

If multi-user becomes needed, switch to OAuth/OIDC with the org's identity provider. The API client layer should be structured to make this swap localized — ideally just replacing the auth header injection logic.

---

## 10. Configuration

Runtime configuration via:
- `window.__NOC_CONFIG__` injected at load time (for backend URL, defaults)
- Settings page for user-configurable values (API key, preferences)
- Feature flags in config for Phase 2 features (ML predictions, forecasts)

Build-time configuration via environment variables at bundling.

---

## 11. Performance

### 11.1 Targets

- First meaningful paint under 1.5s on a typical corporate laptop
- Route transitions under 200ms
- Smooth 60fps scrolling on tables with 500+ rows
- No perceivable lag when selecting rows in lists

### 11.2 Techniques

- Code-splitting by route (Overview, Gateways, Devices, Alerts as separate chunks)
- Virtual scrolling on tables that can exceed 100 rows (react-virtual or equivalent)
- Memoization of heavy cell renderers (SF bars, status dots)
- Chart libraries that handle 1000+ points efficiently (Recharts with downsampling, or uPlot for very high-density)
- Avoid re-renders cascading through the tree — hoist real-time updates to the cache layer, not component state

### 11.3 Bundle Size

Target < 500KB gzipped for the initial chunk. Chart libraries lazy-loaded on detail pages.

---

## 12. Testing Strategy

### 12.1 Unit Tests

Components with non-trivial logic (health score calculation, SF distribution rendering, filter/sort logic). Target 70%+ coverage on logic code, less strict on pure presentational components.

### 12.2 Integration Tests

Key user flows with mocked API:
- Select a gateway and verify detail renders
- Filter devices by low battery and verify list updates
- Receive a WebSocket alert event and verify toast appears
- Lose connection and verify stale indicator appears

### 12.3 End-to-End Tests

Minimal Playwright or Cypress suite against a dev backend, covering the critical paths above. Runs in CI on main branch only.

### 12.4 Visual Regression

Optional, not required Phase 1. Recommended before public launch if the dashboard gets a design review process.

---

## 13. Phase Roadmap

**Phase 1 (now):** Overview, Gateways, Devices, Alerts, Settings pages. Real-time WebSocket. All metrics from TTS + WMC via backend. Predictions section present in device detail but shows "not available" placeholder when backend returns the `ml_service_not_deployed` flag.

**Phase 2 (ML enabled):** Predictions render real forecasts. New chart types for forecast visualization (value + confidence interval band). Anomaly scores appear as badges on device rows. No routing or navigation changes.

**Phase 3 (optimization features):** Recommendations panel surfaces ML-suggested actions (SF changes, gateway rebalancing). Operators can review but not yet apply from the UI — actions still executed in TTS/WMC directly. A future phase could add action-taking with proper guardrails and audit.

---

## 14. Success Criteria

- All metrics shown in the current dashboard prototype are present and fed by real backend data
- Operators can identify a failing gateway within 10 seconds of opening the dashboard
- Operators can find a specific device by name or DevEUI within 3 clicks
- Real-time alerts visible within 2 seconds of the backend detecting them
- Dashboard remains usable in degraded mode (backend slow/unreachable) with clear stale indicators
- Phase 2 ML features can be added without restructuring any existing page or component

---

## 15. Open Questions to Resolve Before Implementation

These are decisions Claude Code should surface early rather than guess:

- Which Perseid-compatible data-fetching library does the team prefer? (TanStack Query works framework-agnostically, but the team may have a house choice)
- Which chart library? (Recharts for simplicity, uPlot for performance, ECharts for richness — all valid)
- Does the team have an existing design system or component library to build on, or is this greenfield?
- Should the app be embedded in a larger Perseid product shell, or deployed standalone?
- Is a map view (gateway/device positions) desired for Phase 1 or deferred?
