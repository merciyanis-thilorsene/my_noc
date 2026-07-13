/**
 * Minimal typed i18n. The active language is resolved once at module load (saved
 * preference, else browser language); the topbar toggle saves the new choice and
 * reloads, so every consumer can simply read `L.<group>.<key>` as constants.
 */
export type Lang = 'fr' | 'en';

const KEY = 'sharingan.lang';

export function getLang(): Lang {
  const saved = localStorage.getItem(KEY);
  if (saved === 'fr' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function setLang(lang: Lang): void {
  localStorage.setItem(KEY, lang);
}

/** Every user-facing string of the app. Parameterized entries are functions. */
export interface Strings {
  locale: string;
  timeAgo: (secs: number) => string;
  nav: {
    overview: string; gateways: string; devices: string; control: string; export: string;
    updated: (rel: string) => string;
    updating: string;
    alertsTitle: (n: number) => string;
    toLight: string; toDark: string; apiHealth: string;
    toLang: string;
  };
  common: {
    loading: string; loadError: string; noData: string; name: string; seen: string;
    search: string; filterDevices: string; selectAll: string; clearAll: string;
    selected: (n: number) => string; sortBy: (col: string) => string;
    active: string; silent: string; actionNeeded: string;
  };
  status: {
    operational: string; warning: string; unreachable: string; unknown: string;
    stale: string; noWmc: string;
  };
  gw: {
    title: string;
    subtitle: (total: number, customers: number, wmc: boolean) => string;
    pollActive: (rel: string) => string;
    pollEvery: (secs: number) => string;
    pollInactive: string;
    kpiOk: string; kpiOkSub: (total: number) => string;
    kpiWarn: string; kpiWarnSub: string;
    kpiUnreach: string; kpiUnreachSub: string;
    kpiStale: string; kpiStaleSub: string;
    kpiSilent: string; kpiSilentSub: string; kpiSilentHint: string;
    map: string; mapHint: string;
    legendOk: string; legendWarn: string; legendUnreach: string; legendSilent: string;
    mapLoading: string;
    watchlist: string; watchlistEmpty: string;
    heardAgo: (rel: string) => string;
    feed: string; feedHint: string; feedEmpty: string;
    sevCritical: string; sevAlert: string; sevResolved: string;
    fleet: string;
    fAll: string; fOk: string; fWarn: string; fUnreach: string; fStale: string; fSilent: string;
    colStatus: string; colGateway: string; colHeard: string; colUplinks: string;
    colDevices: string; colRssi: string; colAlerts: string;
    silenceChip: string;
    noCoords: string;
    emptyAll: string; emptyFilter: string;
    uplinks: string;
  };
  drawer: {
    close: string;
    silentChip: string;
    client: (id: number) => string; noWmcClient: string;
    vitals: string;
    vStatus: string; vLastStatus: string; vInterval: string; vPolled: string;
    wmcNotConfigured: string;
    address: string;
    siteName: string; addressPh: string; latPh: string; lngPh: string; notesPh: string;
    coordinate: string;
    srcManual: string; srcGeocoded: string; srcWmc: string; srcNone: string;
    save: string; sync: string;
    saved: string; savedBody: string; saveFailed: string;
    syncOk: string;
    syncOkBody: (lat: number, lng: number) => string;
    syncOkBodyPlain: string;
    syncRefused: string; syncRefusedBody: string; forceSync: string;
    syncNoWmc: string; syncNoWmcBody: string;
    syncFailed: string; unknownError: string;
    traffic: string;
    trafficStat: (uplinks: string, devices: string) => string;
    rf: string;
    devicesHeard: string; devicesHeardEmpty: string;
    alertHistory: string; alertOngoing: string; alertNone: string;
    active: string; resolved: string;
    notEnoughData: string;
  };
  ov: {
    title: string;
    kDevices: string;
    kDevicesSub: (active: number, silent: number) => string;
    kUplinks: string; kDownlinks: string;
    kDlSub: (rate: string) => string;
    kLoss: string; kRssi: string; kSnr: string;
    cUplinks: string; cLoss: string; cLossSeries: string; cActive: string; cActiveSeries: string; cSf: string;
    worstLoss: string; worstRssi: string;
    colDevice: string; colLoss: string; colUplinks: string;
    noDevices: string;
    joins: string; colTime: string;
    joinsEmpty: string;
  };
  dev: {
    title: string;
    colName: string; colSeen: string; colUplinks: string; colLoss: string; colBatt: string;
    empty: string;
  };
  dd: {
    back: string;
    linkCrit: string; linkWarn: string;
    jsonTitle: string; csvTitle: string;
    mDeviceId: string; mFirstSeen: string; mLastSeen: string;
    kUplinks: (range: string) => string;
    kLoss: string; kNbTrans: string; kRssi: string; kSnr: string; kGw: string;
    kDlSuccess: string; kDlTotal: (n: string) => string; kAirtime: string;
    tabTraffic: string; tabRf: string; tabNetwork: string; tabDownlinks: string; tabControl: string;
    cTimeline: string; cUplinks: string; cLoss: string; cLossSeries: string; cInterArrival: string;
    cGwPerUplink: string; cSfDist: string; cNbTrans: string; cAirtime: string;
    cDlLifecycle: string; cDlRate: string; cDlRateSeries: string;
    ctlTitle: string; ctlSend: string; ctlSending: string; ctlQueued: string; ctlHint1: string; ctlHint2: string;
    tUplinks: string; tTime: string; tAir: string; tUplinksEmpty: string;
    tDownlinks: string; tFirstSeen: string; tLifecycle: string; tDownlinksEmpty: string;
    tJoins: string; tJoinsEmpty: string;
    tGateways: string; tGatewaysEmpty: string; tHeardVia: (n: number) => string;
    loading: string; notFound: string;
  };
  exp: {
    title: string;
    summary: (fmt: string, range: string) => string;
    download: string;
    colDeviceId: string;
  };
  ctl: {
    title: string; cardTitle: string;
    send: (n: number) => string; sending: string;
    sent: (n: number) => string; failed: (n: number) => string; applies: string;
    colResult: string; sentOne: string; failedOne: string;
    color: string; solid: string; blink: string; off: string;
  };
  auth: {
    title: string; subtitle: string;
    codePlaceholder: string; submit: string; submitting: string;
    wrongCode: string; tooMany: (secs: number) => string; networkError: string;
    logout: string;
  };
}

const fr: Strings = {
  locale: 'fr-FR',
  timeAgo: (secs) => {
    if (secs < 60) return `il y a ${Math.max(secs, 0)}s`;
    const m = Math.floor(secs / 60);
    if (m < 60) return `il y a ${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `il y a ${h}h`;
    return `il y a ${Math.floor(h / 24)}j`;
  },
  nav: {
    overview: 'Aperçu',
    gateways: 'Passerelles',
    devices: 'Appareils',
    control: 'Contrôle',
    export: 'Export',
    updated: (rel) => `MAJ ${rel}`,
    updating: '…',
    alertsTitle: (n) => `${n} alerte${n === 1 ? '' : 's'} active${n === 1 ? '' : 's'} — voir les passerelles`,
    toLight: 'Passer en thème clair',
    toDark: 'Passer en thème sombre',
    apiHealth: 'État de l’API',
    toLang: 'Switch to English',
  },
  common: {
    loading: 'Chargement…',
    loadError: 'Échec du chargement',
    noData: 'Aucune donnée sur la période',
    name: 'Nom',
    seen: 'Vu',
    search: 'Rechercher nom, DevEUI, id…',
    filterDevices: 'Filtrer les appareils…',
    selectAll: 'Tout sélectionner',
    clearAll: 'Tout désélectionner',
    selected: (n) => `${n} sélectionné${n > 1 ? 's' : ''}`,
    sortBy: (col) => `Trier par ${col}`,
    active: 'actif',
    silent: 'silencieux',
    actionNeeded: 'action requise',
  },
  status: {
    operational: 'Opérationnelle',
    warning: 'Avertissement',
    unreachable: 'Injoignable',
    unknown: 'Inconnu',
    stale: 'Obsolète',
    noWmc: 'Hors WMC',
  },
  gw: {
    title: 'Passerelles',
    subtitle: (total, customers, wmc) => `${total} passerelle${total === 1 ? '' : 's'}${wmc ? ` · ${customers} client${customers === 1 ? '' : 's'} WMC` : ' · WMC non configuré'} · réseau LoRaWAN`,
    pollActive: (rel) => `Sondage WMC · ${rel}`,
    pollEvery: (secs) => `Sondage WMC · toutes les ${secs}s`,
    pollInactive: 'Sondage WMC inactif — passerelles observées via le trafic',
    kpiOk: 'Opérationnelles',
    kpiOkSub: (total) => `sur ${total} · WMC`,
    kpiWarn: 'Avertissement',
    kpiWarnSub: 'à surveiller',
    kpiUnreach: 'Injoignables',
    kpiUnreachSub: 'hors connexion',
    kpiStale: 'Obsolètes',
    kpiStaleSub: 'calcul NOC · intervalle dépassé',
    kpiSilent: 'Opérationnelles mais silencieuses',
    kpiSilentSub: 'WMC = OK, plus aucun trafic relayé',
    kpiSilentHint: 'anomalie de transition (§B.9) · jointure gw_eui',
    map: 'Carte du parc',
    mapHint: 'position déploiement → WMC · taille = trafic 24h',
    legendOk: 'OK',
    legendWarn: 'Avert.',
    legendUnreach: 'Injoign.',
    legendSilent: 'Silenc.',
    mapLoading: 'Chargement de la carte…',
    watchlist: 'Silencieuses — à investiguer',
    watchlistEmpty: 'Aucune anomalie détectée',
    heardAgo: (rel) => `entendue ${rel}`,
    feed: 'Flux d’alertes WMC',
    feedHint: 'réception push · /webhooks/wmc/alerts',
    feedEmpty: 'Aucune alerte reçue — configurez le webhook sortant côté WMC',
    sevCritical: 'Critique',
    sevAlert: 'Alerte',
    sevResolved: 'Résolu',
    fleet: 'Parc de passerelles',
    fAll: 'Toutes',
    fOk: 'OK',
    fWarn: 'Avert.',
    fUnreach: 'Injoign.',
    fStale: 'Obsolètes',
    fSilent: 'Silencieuses',
    colStatus: 'Statut',
    colGateway: 'Passerelle / site',
    colHeard: 'Entendue',
    colUplinks: 'Uplinks 24h',
    colDevices: 'Appareils',
    colRssi: 'RSSI moy',
    colAlerts: 'Alertes',
    silenceChip: 'Silence',
    noCoords: 'Sans coordonnées — absente de la carte',
    emptyAll: 'Aucune passerelle — elles apparaîtront dès qu’un uplink est relayé ou que le sondage WMC est actif.',
    emptyFilter: 'Aucune passerelle ne correspond à ce filtre.',
    uplinks: 'uplinks',
  },
  drawer: {
    close: 'Fermer',
    silentChip: 'Silencieuse',
    client: (id) => `client WMC #${id}`,
    noWmcClient: 'hors WMC',
    vitals: 'Vitals (santé WMC)',
    vStatus: 'Statut WMC',
    vLastStatus: 'Dernier statut',
    vInterval: 'Intervalle msg',
    vPolled: 'Sondé',
    wmcNotConfigured: 'WMC non configuré — les vitals détaillés apparaîtront une fois la connexion WMC renseignée.',
    address: 'Adresse de déploiement',
    siteName: 'Nom du site (ex. Toit tour A)',
    addressPh: 'Saisir une adresse…',
    latPh: 'Latitude (manuel)',
    lngPh: 'Longitude (manuel)',
    notesPh: 'Notes (accès, contact…)',
    coordinate: 'Coordonnée :',
    srcManual: 'Manuel / relevé',
    srcGeocoded: 'Géocodé (Nominatim)',
    srcWmc: 'Position WMC',
    srcNone: 'Aucune',
    save: 'Enregistrer (NOC)',
    sync: 'Synchroniser vers WMC',
    saved: 'Enregistré',
    savedBody: 'Champs NOC mis à jour.',
    saveFailed: 'Échec de l’enregistrement',
    syncOk: 'Poussée vers WMC effectuée',
    syncOkBody: (lat, lng) => `Position ${lat.toFixed(5)}, ${lng.toFixed(5)} écrite via PUT /gateways/{eui}/location.`,
    syncOkBodyPlain: 'Position écrite dans WMC.',
    syncRefused: 'Synchronisation refusée',
    syncRefusedBody: 'WMC détient une coordonnée GPS/relevée et la valeur NOC est géocodée (centroïde de rue, possiblement à des dizaines de mètres). On ne remplace pas un point relevé par une approximation sans confirmation explicite.',
    forceSync: 'Forcer le remplacement',
    syncNoWmc: 'WMC non configuré',
    syncNoWmcBody: 'Renseignez WMC_BASE_URL, WMC_LOGIN et WMC_PASSWORD côté serveur pour activer la synchronisation.',
    syncFailed: 'Échec de la synchronisation',
    unknownError: 'Erreur inconnue.',
    traffic: 'Trafic observé (24h)',
    trafficStat: (uplinks, devices) => `${uplinks} uplinks · ${devices} appareils`,
    rf: 'Qualité RF (RSSI moyen)',
    devicesHeard: 'Appareils entendus (24h)',
    devicesHeardEmpty: 'Aucun appareil entendu sur la fenêtre',
    alertHistory: 'Historique des alertes',
    alertOngoing: 'en cours',
    alertNone: 'Aucune alerte enregistrée pour cette passerelle',
    active: 'Actif',
    resolved: 'Résolu',
    notEnoughData: 'Pas assez de données',
  },
  ov: {
    title: 'Aperçu du parc',
    kDevices: 'Appareils',
    kDevicesSub: (active, silent) => `${active} actifs · ${silent} silencieux (24h)`,
    kUplinks: 'Uplinks 24h',
    kDownlinks: 'Downlinks 24h',
    kDlSub: (rate) => `succès ${rate}`,
    kLoss: 'Perte de paquets',
    kRssi: 'RSSI moyen',
    kSnr: 'SNR moyen',
    cUplinks: 'Uplinks par intervalle',
    cLoss: 'Perte de paquets du parc %',
    cLossSeries: 'perte %',
    cActive: 'Appareils actifs',
    cActiveSeries: 'appareils',
    cSf: 'Distribution SF',
    worstLoss: 'Pires pertes de paquets',
    worstRssi: 'RSSI le plus faible',
    colDevice: 'Appareil',
    colLoss: 'Perte %',
    colUplinks: 'Uplinks 24h',
    noDevices: 'Aucun appareil pour le moment',
    joins: 'Joins récents (24h)',
    colTime: 'Heure',
    joinsEmpty: 'Aucun join sur les dernières 24h',
  },
  dev: {
    title: 'Appareils',
    colName: 'Nom',
    colSeen: 'Vu',
    colUplinks: 'Uplinks 24h',
    colLoss: 'Perte %',
    colBatt: 'Batt %',
    empty: 'Aucun appareil ne correspond. Ils apparaissent dès leur première émission.',
  },
  dd: {
    back: '← Appareils',
    linkCrit: '⚠ lien critique',
    linkWarn: '⚠ lien à risque',
    jsonTitle: 'Télécharger les uplinks bruts (JSON, RF par passerelle inclus)',
    csvTitle: 'Télécharger les uplinks bruts (CSV, une ligne par uplink)',
    mDeviceId: 'ID appareil',
    mFirstSeen: 'Première vue',
    mLastSeen: 'Dernière vue',
    kUplinks: (range) => `Uplinks (${range})`,
    kLoss: 'Perte de paquets',
    kNbTrans: 'NbTrans moy',
    kRssi: 'RSSI moyen',
    kSnr: 'SNR moyen',
    kGw: 'Passerelles/uplink',
    kDlSuccess: 'Succès downlink',
    kDlTotal: (n) => `${n} total`,
    kAirtime: 'Temps d’antenne',
    tabTraffic: 'Trafic',
    tabRf: 'Qualité RF',
    tabNetwork: 'Réseau',
    tabDownlinks: 'Downlinks',
    tabControl: 'Contrôle',
    cTimeline: 'Chronologie des uplinks — un point par paquet reçu',
    cUplinks: 'Uplinks par intervalle',
    cLoss: 'Perte de paquets %',
    cLossSeries: 'perte %',
    cInterArrival: 'Temps inter-arrivées (s)',
    cGwPerUplink: 'Passerelles par uplink',
    cSfDist: 'Distribution des spreading factors',
    cNbTrans: 'NbTrans moyen (seuils 1.5 / 2.5)',
    cAirtime: 'Temps d’antenne par intervalle (s)',
    cDlLifecycle: 'Cycle de vie des downlinks',
    cDlRate: 'Taux de succès downlink',
    cDlRateSeries: 'succès',
    ctlTitle: 'Kuando Busylight — contrôle downlink',
    ctlSend: '⤓ Envoyer le downlink',
    ctlSending: 'Envoi…',
    ctlQueued: 'En file — appliqué au prochain uplink de l’appareil.',
    ctlHint1: 'fPort 15 · octets [rouge, bleu, vert, allumé, éteint]. Classe A : la lampe change au prochain uplink.',
    ctlHint2: 'Les downlinks envoyés apparaissent dans l’onglet Downlinks dès que TTN les signale. Envoi groupé depuis la page Contrôle.',
    tUplinks: 'Uplinks récents',
    tTime: 'Heure',
    tAir: 'Antenne s',
    tUplinksEmpty: 'Aucun uplink sur la période',
    tDownlinks: 'Downlinks récents',
    tFirstSeen: 'Première vue',
    tLifecycle: 'Cycle de vie',
    tDownlinksEmpty: 'Aucun downlink sur la période',
    tJoins: 'Joins',
    tJoinsEmpty: 'Aucun join sur la période',
    tGateways: 'Passerelles réceptrices',
    tGatewaysEmpty: 'Aucune passerelle identifiée (les uplinks Orange n’exposent pas les EUI des passerelles)',
    tHeardVia: (n) => `${n} passerelle${n === 1 ? '' : 's'}`,
    loading: 'Chargement de l’appareil…',
    notFound: 'Appareil introuvable.',
  },
  exp: {
    title: 'Exporter les uplinks',
    summary: (fmt, range) => `${fmt} · ${range} · max 50k uplinks`,
    download: '⤓ Exporter',
    colDeviceId: 'ID appareil',
  },
  ctl: {
    title: 'Contrôle Busylight',
    cardTitle: 'Kuando Busylight — envoyer aux appareils sélectionnés',
    send: (n) => `⤓ Envoyer à ${n} appareil${n === 1 ? '' : 's'}`,
    sending: 'Envoi…',
    sent: (n) => `${n} envoyé${n > 1 ? 's' : ''}`,
    failed: (n) => `, ${n} en échec`,
    applies: '— appliqué au prochain uplink de chaque appareil.',
    colResult: 'Résultat',
    sentOne: 'envoyé',
    failedOne: 'échec',
    color: 'Couleur',
    solid: 'fixe',
    blink: 'clignotant',
    off: 'éteint',
  },
  auth: {
    title: 'Accès sécurisé',
    subtitle: 'Saisissez le code d’accès pour continuer.',
    codePlaceholder: 'Code d’accès',
    submit: 'Déverrouiller',
    submitting: 'Vérification…',
    wrongCode: 'Code incorrect.',
    tooMany: (secs) => `Trop de tentatives. Réessayez dans ${secs}s.`,
    networkError: 'Connexion impossible. Réessayez.',
    logout: 'Se déconnecter',
  },
};

const en: Strings = {
  locale: 'en-GB',
  timeAgo: (secs) => {
    if (secs < 60) return `${Math.max(secs, 0)}s ago`;
    const m = Math.floor(secs / 60);
    if (m < 60) return `${m}min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  },
  nav: {
    overview: 'Overview',
    gateways: 'Gateways',
    devices: 'Devices',
    control: 'Control',
    export: 'Export',
    updated: (rel) => `Updated ${rel}`,
    updating: '…',
    alertsTitle: (n) => `${n} active alert${n === 1 ? '' : 's'} — open gateways`,
    toLight: 'Switch to light theme',
    toDark: 'Switch to dark theme',
    apiHealth: 'API health',
    toLang: 'Passer en français',
  },
  common: {
    loading: 'Loading…',
    loadError: 'Failed to load',
    noData: 'No data in range',
    name: 'Name',
    seen: 'Seen',
    search: 'Search name, DevEUI, id…',
    filterDevices: 'Filter devices…',
    selectAll: 'Select all',
    clearAll: 'Clear all',
    selected: (n) => `${n} selected`,
    sortBy: (col) => `Sort by ${col}`,
    active: 'active',
    silent: 'silent',
    actionNeeded: 'needs action',
  },
  status: {
    operational: 'Operational',
    warning: 'Warning',
    unreachable: 'Unreachable',
    unknown: 'Unknown',
    stale: 'Stale',
    noWmc: 'Not in WMC',
  },
  gw: {
    title: 'Gateways',
    subtitle: (total, customers, wmc) => `${total} gateway${total === 1 ? '' : 's'}${wmc ? ` · ${customers} WMC customer${customers === 1 ? '' : 's'}` : ' · WMC not configured'} · LoRaWAN network`,
    pollActive: (rel) => `WMC poll · ${rel}`,
    pollEvery: (secs) => `WMC poll · every ${secs}s`,
    pollInactive: 'WMC poll inactive — gateways observed from traffic',
    kpiOk: 'Operational',
    kpiOkSub: (total) => `of ${total} · WMC`,
    kpiWarn: 'Warning',
    kpiWarnSub: 'to watch',
    kpiUnreach: 'Unreachable',
    kpiUnreachSub: 'offline',
    kpiStale: 'Stale',
    kpiStaleSub: 'NOC-derived · interval exceeded',
    kpiSilent: 'Operational but silent',
    kpiSilentSub: 'WMC = OK, no traffic relayed anymore',
    kpiSilentHint: 'transition anomaly (§B.9) · gw_eui join',
    map: 'Fleet map',
    mapHint: 'deployment position → WMC · size = 24h traffic',
    legendOk: 'OK',
    legendWarn: 'Warn.',
    legendUnreach: 'Unreach.',
    legendSilent: 'Silent',
    mapLoading: 'Loading map…',
    watchlist: 'Silent — investigate',
    watchlistEmpty: 'No anomaly detected',
    heardAgo: (rel) => `heard ${rel}`,
    feed: 'WMC alert feed',
    feedHint: 'push intake · /webhooks/wmc/alerts',
    feedEmpty: 'No alerts received — configure the outbound webhook on the WMC side',
    sevCritical: 'Critical',
    sevAlert: 'Alert',
    sevResolved: 'Resolved',
    fleet: 'Gateway fleet',
    fAll: 'All',
    fOk: 'OK',
    fWarn: 'Warn.',
    fUnreach: 'Unreach.',
    fStale: 'Stale',
    fSilent: 'Silent',
    colStatus: 'Status',
    colGateway: 'Gateway / site',
    colHeard: 'Heard',
    colUplinks: 'Uplinks 24h',
    colDevices: 'Devices',
    colRssi: 'Avg RSSI',
    colAlerts: 'Alerts',
    silenceChip: 'Silence',
    noCoords: 'No coordinates — not shown on the map',
    emptyAll: 'No gateways yet — they appear as soon as an uplink is relayed or the WMC poll is active.',
    emptyFilter: 'No gateway matches this filter.',
    uplinks: 'uplinks',
  },
  drawer: {
    close: 'Close',
    silentChip: 'Silent',
    client: (id) => `WMC customer #${id}`,
    noWmcClient: 'not in WMC',
    vitals: 'Vitals (WMC health)',
    vStatus: 'WMC status',
    vLastStatus: 'Last status',
    vInterval: 'Msg interval',
    vPolled: 'Polled',
    wmcNotConfigured: 'WMC not configured — detailed vitals will appear once the WMC connection is set.',
    address: 'Deployment address',
    siteName: 'Site name (e.g. Tower A roof)',
    addressPh: 'Type an address…',
    latPh: 'Latitude (manual)',
    lngPh: 'Longitude (manual)',
    notesPh: 'Notes (access, contact…)',
    coordinate: 'Coordinate:',
    srcManual: 'Manual / surveyed',
    srcGeocoded: 'Geocoded (Nominatim)',
    srcWmc: 'WMC position',
    srcNone: 'None',
    save: 'Save (NOC)',
    sync: 'Sync to WMC',
    saved: 'Saved',
    savedBody: 'NOC fields updated.',
    saveFailed: 'Save failed',
    syncOk: 'Pushed to WMC',
    syncOkBody: (lat, lng) => `Position ${lat.toFixed(5)}, ${lng.toFixed(5)} written via PUT /gateways/{eui}/location.`,
    syncOkBodyPlain: 'Position written to WMC.',
    syncRefused: 'Sync refused',
    syncRefusedBody: 'WMC holds a GPS/surveyed coordinate and the NOC value is geocoded (a street centroid, possibly tens of metres off). A surveyed point is not replaced by an approximation without explicit confirmation.',
    forceSync: 'Force overwrite',
    syncNoWmc: 'WMC not configured',
    syncNoWmcBody: 'Set WMC_BASE_URL, WMC_LOGIN and WMC_PASSWORD server-side to enable syncing.',
    syncFailed: 'Sync failed',
    unknownError: 'Unknown error.',
    traffic: 'Observed traffic (24h)',
    trafficStat: (uplinks, devices) => `${uplinks} uplinks · ${devices} devices`,
    rf: 'RF quality (avg RSSI)',
    devicesHeard: 'Devices heard (24h)',
    devicesHeardEmpty: 'No device heard in the window',
    alertHistory: 'Alert history',
    alertOngoing: 'ongoing',
    alertNone: 'No alert recorded for this gateway',
    active: 'Active',
    resolved: 'Resolved',
    notEnoughData: 'Not enough data',
  },
  ov: {
    title: 'Fleet overview',
    kDevices: 'Devices',
    kDevicesSub: (active, silent) => `${active} active · ${silent} silent (24h)`,
    kUplinks: 'Uplinks 24h',
    kDownlinks: 'Downlinks 24h',
    kDlSub: (rate) => `success ${rate}`,
    kLoss: 'Packet loss',
    kRssi: 'Avg RSSI',
    kSnr: 'Avg SNR',
    cUplinks: 'Uplinks per bucket',
    cLoss: 'Fleet packet loss %',
    cLossSeries: 'loss %',
    cActive: 'Active devices',
    cActiveSeries: 'devices',
    cSf: 'SF distribution',
    worstLoss: 'Worst packet loss',
    worstRssi: 'Weakest RSSI',
    colDevice: 'Device',
    colLoss: 'Loss %',
    colUplinks: 'Uplinks 24h',
    noDevices: 'No devices yet',
    joins: 'Recent joins (24h)',
    colTime: 'Time',
    joinsEmpty: 'No joins in the last 24h',
  },
  dev: {
    title: 'Devices',
    colName: 'Name',
    colSeen: 'Seen',
    colUplinks: 'Uplinks 24h',
    colLoss: 'Loss %',
    colBatt: 'Batt %',
    empty: 'No devices match. They appear here once they transmit.',
  },
  dd: {
    back: '← Devices',
    linkCrit: '⚠ link critical',
    linkWarn: '⚠ link at risk',
    jsonTitle: 'Download raw uplinks (JSON, incl. per-gateway RF)',
    csvTitle: 'Download raw uplinks (CSV, one row per uplink)',
    mDeviceId: 'Device ID',
    mFirstSeen: 'First seen',
    mLastSeen: 'Last seen',
    kUplinks: (range) => `Uplinks (${range})`,
    kLoss: 'Packet loss',
    kNbTrans: 'NbTrans avg',
    kRssi: 'Avg RSSI',
    kSnr: 'Avg SNR',
    kGw: 'Gateways/uplink',
    kDlSuccess: 'Downlink success',
    kDlTotal: (n) => `${n} total`,
    kAirtime: 'Airtime',
    tabTraffic: 'Traffic',
    tabRf: 'RF quality',
    tabNetwork: 'Network',
    tabDownlinks: 'Downlinks',
    tabControl: 'Control',
    cTimeline: 'Uplink timeline — one dot per received packet',
    cUplinks: 'Uplinks per bucket',
    cLoss: 'Packet loss %',
    cLossSeries: 'loss %',
    cInterArrival: 'Inter-arrival time (s)',
    cGwPerUplink: 'Gateways per uplink',
    cSfDist: 'Spreading factor distribution',
    cNbTrans: 'NbTrans average (thresholds 1.5 / 2.5)',
    cAirtime: 'Airtime per bucket (s)',
    cDlLifecycle: 'Downlink lifecycle',
    cDlRate: 'Downlink success rate',
    cDlRateSeries: 'success',
    ctlTitle: 'Kuando Busylight — downlink control',
    ctlSend: '⤓ Send downlink',
    ctlSending: 'Sending…',
    ctlQueued: 'Queued — applies on the device’s next uplink.',
    ctlHint1: 'fPort 15 · bytes [red, blue, green, ontime, offtime]. Class A: the light updates on its next uplink.',
    ctlHint2: 'Sent downlinks appear in the Downlinks tab once TTN reports them. Bulk send from the Control page.',
    tUplinks: 'Recent uplinks',
    tTime: 'Time',
    tAir: 'Air s',
    tUplinksEmpty: 'No uplinks in range',
    tDownlinks: 'Recent downlinks',
    tFirstSeen: 'First seen',
    tLifecycle: 'Lifecycle',
    tDownlinksEmpty: 'No downlinks in range',
    tJoins: 'Joins',
    tJoinsEmpty: 'No joins in range',
    tGateways: 'Gateways heard',
    tGatewaysEmpty: 'No gateways identified (Orange uplinks carry no per-gateway EUIs)',
    tHeardVia: (n) => `${n} gateway${n === 1 ? '' : 's'}`,
    loading: 'Loading device…',
    notFound: 'Device not found.',
  },
  exp: {
    title: 'Export uplinks',
    summary: (fmt, range) => `${fmt} · ${range} · max 50k uplinks`,
    download: '⤓ Export',
    colDeviceId: 'Device ID',
  },
  ctl: {
    title: 'Busylight control',
    cardTitle: 'Kuando Busylight — send to selected devices',
    send: (n) => `⤓ Send to ${n} device${n === 1 ? '' : 's'}`,
    sending: 'Sending…',
    sent: (n) => `${n} sent`,
    failed: (n) => `, ${n} failed`,
    applies: '— applies on each device’s next uplink.',
    colResult: 'Result',
    sentOne: 'sent',
    failedOne: 'failed',
    color: 'Color',
    solid: 'solid',
    blink: 'blink',
    off: 'off',
  },
  auth: {
    title: 'Secure access',
    subtitle: 'Enter the access code to continue.',
    codePlaceholder: 'Access code',
    submit: 'Unlock',
    submitting: 'Checking…',
    wrongCode: 'Incorrect code.',
    tooMany: (secs) => `Too many attempts. Retry in ${secs}s.`,
    networkError: 'Connection failed. Try again.',
    logout: 'Log out',
  },
};

/** The active language's strings, resolved once at module load. */
export const L: Strings = getLang() === 'fr' ? fr : en;
