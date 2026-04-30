# Specs — Module LoRaWAN Network Analysis pour NOC

**Projet:** Merciyanis NOC — Module LoRaWAN  
**Date:** Avril 2026  
**Stack:** Python / TTS Webhook / PostgreSQL (à adapter selon stack existante)

---

## 1. Contexte

Déploiement LoRaWAN privé sur TTS Cloud (merciyanis.eu2.cloud.thethings.industries) avec :
- ~75 devices Kuando IoT Busylight LoRaWAN v3.1 (Class C, OTAA, FPort 15)
- 8 gateways Kerlink iFemtoCell Evolution (Basics Station)
- Application TTS : `leds`
- Problème actuel : devices joinant en SF12 par défaut → scheduling conflicts → downlinks perdus

---

## 2. Objectif du module

Ajouter dans le NOC existant un module d'analyse réseau LoRaWAN qui :
1. Ingère les événements TTS en temps réel via webhook
2. Stocke et analyse les métriques RF par device
3. Détecte automatiquement les anomalies
4. Expose les données pour visualisation dans le NOC
5. Déclenche des actions correctives automatiques (force SF8, retry)

---

## 3. Architecture

```
TTS Cloud (merciyanis.eu2.cloud.thethings.industries)
    │
    │ Webhook HTTP POST (JSON)
    ▼
[NOC Backend — nouveau endpoint /lorawan/webhook]
    │
    ├── Parser d'événements TTS
    │       ↓
    ├── DB (table lorawan_events)
    │       ↓
    ├── Analyseur temps réel (détection anomalies)
    │       ↓
    ├── Action engine (force SF8, alertes)
    │       ↓
    └── API REST → Frontend NOC (dashboard)
```

---

## 4. Ingestion — Webhook TTS

### 4.1 Configuration TTS

Dans TTS Console → Application `leds` → Integrations → Webhooks → Add webhook :
```
Base URL:    https://votre-noc.com/lorawan/webhook
Format:      JSON
Events à activer:
  - Uplink message
  - Downlink message
  - Downlink scheduled
  - Downlink failed
  - Join accept
  - Join reject
```

### 4.2 Endpoint à créer

```
POST /lorawan/webhook
Content-Type: application/json
Authorization: (token TTS webhook si configuré)
```

### 4.3 Événements TTS à traiter

| Event name | Données utiles | Priorité |
|------------|----------------|----------|
| `as.up.data.forward` | RSSI, SNR, SF, f_cnt, airtime, gateway_id, frm_payload | Haute |
| `ns.down.data.schedule.attempt` | rx1_sf, rx2_sf, rx2_freq, downlink_paths | Haute |
| `ns.down.data.schedule.fail` | error name, path_errors, gateway_uid | Critique |
| `as.down.data.receive` | frm_payload, confirmed, priority, retry_attempt | Haute |
| `as.down.data.ack` | correlation_ids (pour matcher avec le downlink) | Haute |
| `ns.up.join.request` | dev_eui, join_eui | Moyenne |
| `js.up.join.reject` | cause | Critique |

### 4.4 Parser — champs à extraire

```python
def parse_tts_event(payload: dict) -> dict:
    event = {
        "event_type": payload.get("name"),
        "received_at": payload.get("time"),
        "device_id": payload["identifiers"][0]["device_ids"]["device_id"],
        "dev_eui": payload["identifiers"][0]["device_ids"].get("dev_eui"),
        "application_id": payload["identifiers"][0]["device_ids"]["application_ids"]["application_id"],
        "raw_payload": payload
    }

    data = payload.get("data", {})

    # Uplink
    if event["event_type"] == "as.up.data.forward":
        ul = data.get("uplink_message", {})
        rx = ul.get("rx_metadata", [{}])[0]
        settings = ul.get("settings", {}).get("data_rate", {}).get("lora", {})
        event.update({
            "rssi": rx.get("rssi"),
            "snr": rx.get("snr"),
            "gateway_id": rx.get("gateway_ids", {}).get("gateway_id"),
            "spreading_factor": settings.get("spreading_factor"),
            "bandwidth": settings.get("bandwidth"),
            "frequency": ul.get("settings", {}).get("frequency"),
            "consumed_airtime": float(ul.get("consumed_airtime", "0s").replace("s", "")),
            "f_cnt": ul.get("f_cnt"),
            "f_port": ul.get("f_port"),
            "frm_payload": ul.get("frm_payload"),
        })

    # Downlink scheduled
    elif event["event_type"] == "ns.down.data.schedule.attempt":
        req = data.get("request", {})
        event.update({
            "confirmed": data.get("payload", {}).get("m_hdr", {}).get("m_type") == "CONFIRMED_DOWN",
            "gateway_id": req.get("downlink_paths", [{}])[0].get("uplink_token", "")[:20],
            "rx2_sf": req.get("rx2_data_rate", {}).get("lora", {}).get("spreading_factor"),
            "rx2_frequency": req.get("rx2_frequency"),
        })

    # Schedule fail
    elif event["event_type"] == "ns.down.data.schedule.fail":
        event.update({
            "error_name": data.get("name"),
            "error_namespace": data.get("namespace"),
        })

    # Downlink received by AS
    elif event["event_type"] == "as.down.data.receive":
        event.update({
            "frm_payload": data.get("frm_payload"),
            "confirmed": data.get("confirmed", False),
            "priority": data.get("priority"),
            "retry_attempt": data.get("confirmed_retry", {}).get("attempt", 0),
            "f_port": data.get("f_port"),
        })

    return event
```

---

## 5. Stockage — Schéma DB

```sql
CREATE TABLE lorawan_events (
    id                  BIGSERIAL PRIMARY KEY,
    received_at         TIMESTAMPTZ NOT NULL,
    event_type          VARCHAR(64) NOT NULL,
    device_id           VARCHAR(64) NOT NULL,
    dev_eui             VARCHAR(16),
    application_id      VARCHAR(64) NOT NULL,
    gateway_id          VARCHAR(64),
    rssi                FLOAT,
    snr                 FLOAT,
    spreading_factor    INT,
    bandwidth           INT,
    frequency           BIGINT,
    consumed_airtime    FLOAT,
    f_cnt               INT,
    f_port              INT,
    frm_payload         TEXT,
    confirmed           BOOLEAN,
    priority            VARCHAR(16),
    retry_attempt       INT,
    rx2_sf              INT,
    rx2_frequency       BIGINT,
    error_name          VARCHAR(64),
    error_namespace     VARCHAR(128),
    raw_payload         JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lorawan_events_device_id ON lorawan_events(device_id);
CREATE INDEX idx_lorawan_events_received_at ON lorawan_events(received_at DESC);
CREATE INDEX idx_lorawan_events_event_type ON lorawan_events(event_type);
CREATE INDEX idx_lorawan_events_gateway_id ON lorawan_events(gateway_id);
```

---

## 6. Analyse — Règles de détection

### 6.1 Anomalies à détecter en temps réel

```python
ANOMALY_RULES = [
    {
        "id": "SF12_UPLINK",
        "severity": "CRITICAL",
        "condition": lambda e: e["event_type"] == "as.up.data.forward" and e["spreading_factor"] == 12,
        "message": "Device transmitting on SF12 — causes gateway scheduling conflicts",
        "action": "force_sf8"
    },
    {
        "id": "SCHEDULE_FAIL",
        "severity": "CRITICAL",
        "condition": lambda e: e["event_type"] == "ns.down.data.schedule.fail",
        "message": "Downlink scheduling conflict — device will not receive command",
        "action": "alert"
    },
    {
        "id": "RSSI_CRITICAL",
        "severity": "CRITICAL",
        "condition": lambda e: e["event_type"] == "as.up.data.forward" and e.get("rssi", 0) < -110,
        "message": "RSSI below -110 dBm — device at RF coverage limit",
        "action": "alert_position"
    },
    {
        "id": "SNR_CRITICAL",
        "severity": "CRITICAL",
        "condition": lambda e: e["event_type"] == "as.up.data.forward" and e.get("snr", 0) < -5,
        "message": "SNR below -5 dB — device in RF dead zone",
        "action": "alert_position"
    },
    {
        "id": "JOIN_REJECT",
        "severity": "CRITICAL",
        "condition": lambda e: e["event_type"] == "js.up.join.reject",
        "message": "Join rejected — AppKey mismatch or device misconfigured",
        "action": "alert_config"
    },
    {
        "id": "HIGH_RETRY",
        "severity": "WARNING",
        "condition": lambda e: e["event_type"] == "as.down.data.receive" and e.get("retry_attempt", 0) > 0,
        "message": "Downlink retry — first attempt failed",
        "action": "monitor"
    },
    {
        "id": "DEVICE_SILENT",
        "severity": "WARNING",
        "condition": "periodic_check",  # check toutes les 60 min
        "query": "SELECT device_id FROM lorawan_events WHERE event_type='as.up.data.forward' GROUP BY device_id HAVING MAX(received_at) < NOW() - INTERVAL '65 minutes'",
        "message": "Device has not sent uplink in >65 min — possibly disconnected",
        "action": "alert"
    }
]
```

### 6.2 Action engine

```python
TTS_BASE_URL = "https://merciyanis.eu2.cloud.thethings.industries"
TTS_APP_ID = "leds"

def force_sf8(device_id: str, api_key: str):
    """Force SF8 (DR4) on a device via TTS NS API"""
    url = f"{TTS_BASE_URL}/api/v3/ns/applications/{TTS_APP_ID}/devices/{device_id}"
    payload = {
        "end_device": {
            "ids": {
                "device_id": device_id,
                "application_ids": {"application_id": TTS_APP_ID}
            },
            "mac_settings": {
                "desired_rx2_data_rate_index": 4,
                "desired_rx2_frequency": "869525000",
                "desired_rx1_delay": "RX_DELAY_1",
                "adr": {"disabled": {}}
            }
        },
        "field_mask": {
            "paths": [
                "mac_settings.desired_rx2_data_rate_index",
                "mac_settings.desired_rx2_frequency",
                "mac_settings.desired_rx1_delay",
                "mac_settings.adr"
            ]
        }
    }
    requests.put(url, json=payload,
                 headers={"Authorization": f"Bearer {api_key}",
                          "Content-Type": "application/json"})

def send_adr_off(device_id: str, api_key: str):
    """Send Plenom ADR disable command 0x02 to device"""
    import base64
    payload_b64 = base64.b64encode(bytes.fromhex("0200")).decode()
    url = f"{TTS_BASE_URL}/api/v3/as/applications/{TTS_APP_ID}/devices/{device_id}/down/push"
    requests.post(url,
        json={"downlinks": [{"frm_payload": payload_b64, "f_port": 15,
                              "confirmed": True, "priority": "NORMAL"}]},
        headers={"Authorization": f"Bearer {api_key}",
                 "Content-Type": "application/json"})
```

---

## 7. API REST — Endpoints NOC

```
GET  /api/lorawan/devices                    → liste tous les devices avec health status
GET  /api/lorawan/devices/:dev_eui           → détail d'un device (RSSI/SNR historique, SF, dernière vue)
GET  /api/lorawan/devices/:dev_eui/events    → historique des événements
GET  /api/lorawan/gateways                   → santé par gateway (conflict rate, nb devices)
GET  /api/lorawan/alerts                     → alertes actives (SF12, schedule fail, device silent)
GET  /api/lorawan/stats                      → métriques globales (ACK rate, conflict rate, nb SF12)
POST /api/lorawan/devices/:dev_eui/force-sf8 → déclenche force_sf8 manuellement
POST /api/lorawan/devices/:dev_eui/adr-off   → envoie commande ADR disable
GET  /api/lorawan/health                     → résumé santé réseau (OK/WARNING/CRITICAL)
```

---

## 8. Dashboard NOC — Composants

### 8.1 Vue globale réseau

- Compteurs : Total devices / OK / WARNING / CRITICAL
- Taux ACK global (dernières 24h)
- Taux scheduling conflicts (dernière heure)
- Nombre de devices en SF12 (temps réel)

### 8.2 Table devices

Colonnes : Device ID | Last seen | RSSI | SNR | SF | Airtime | ACK rate | Status | Actions

Filtres : Par gateway / Par SF / Par statut / Par étage (si tag ajouté)

### 8.3 Alertes temps réel

Feed d'alertes avec : timestamp / device_id / type d'anomalie / action suggérée / bouton action

### 8.4 Vue par gateway

Pour chaque gateway : nb devices visibles / conflict rate / RSSI moyen / devices en SF12

---

## 9. Payload Busylight — Décodeur FPort 15

Uplink keep-alive (6 bytes) :

```python
def decode_busylight_uplink(hex_payload: str) -> dict:
    b = bytes.fromhex(hex_payload) if not hex_payload.startswith('base64:') else \
        __import__('base64').b64decode(hex_payload)
    if len(b) < 6:
        return {}
    return {
        "rssi_device":   b[0] - 256 if b[0] > 127 else b[0],
        "snr_device":    b[1] - 256 if b[1] > 127 else b[1],
        "downlinks_rx":  b[2],
        "uplinks_tx":    b[3],
        "adr_state":     b[5] & 0x03,
        "hw_revision":   (b[5] >> 2) & 0x03,
        "sw_revision":   (b[5] >> 4) & 0x03,
    }
```

Downlink couleur (5 bytes, FPort 15) :

```python
COLORS = {
    "red":    "990000FF00",
    "green":  "000099FF00",
    "blue":   "00FF00FF00",
    "yellow": "FF00FFFF00",
    "purple": "FFFF00FF00",
    "white":  "FFFFFFFF00",
    "off":    "0000000000",
}
```

---

## 10. Checklist d'implémentation

- [ ] Créer endpoint POST /lorawan/webhook
- [ ] Implémenter parser TTS events
- [ ] Créer table lorawan_events + index
- [ ] Implémenter détection anomalies temps réel
- [ ] Implémenter action engine (force_sf8, adr_off)
- [ ] Créer API REST (8 endpoints)
- [ ] Ajouter composants dashboard
- [ ] Configurer webhook dans TTS Console
- [ ] Tester avec device `2020203712140302` (led2 — device de référence)
- [ ] Vérifier décodeur payload Busylight FPort 15
