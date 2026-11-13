/*!
 * IDFM Metrocard — carte Lovelace façon panneau de quai pour les prochains passages
 * (métro, RER, Transilien, tram, bus) fournis par l'intégration « Ile de France Mobilités »
 * (https://github.com/droso-hass/idfm).
 * Licence MIT.
 */
const VERSION = '1.2.0';
const CARD_TAG = 'idfm-metrocard';
const EDITOR_TAG = 'idfm-metrocard-editor';

// Couleurs par défaut des lignes (modifiables avec line_color).
const LINE_COLORS = {
  metro: {
    1: '#FFCD00', 2: '#003CA6', 3: '#837902', '3B': '#6EC4E8', 4: '#CF009E', 5: '#FF7E2E',
    6: '#6ECA97', 7: '#FA9ABA', '7B': '#6ECA97', 8: '#E19BDF', 9: '#B6BD00', 10: '#C9910D',
    11: '#704B1C', 12: '#007852', 13: '#6EC4E8', 14: '#62259D',
  },
  rer: { A: '#E3051C', B: '#5291CE', C: '#FFCE00', D: '#00814F', E: '#C04191' },
  train: {
    H: '#8D5E2A', J: '#CEC92B', K: '#9B9842', L: '#C4A4CC', N: '#00A092', P: '#F58F53',
    R: '#F49FB3', U: '#B90845',
  },
};
const DEFAULT_COLOR = { metro: '#9a9a9a', rer: '#9a9a9a', train: '#9a9a9a', tram: '#2E8B57', bus: '#3B6BB5' };
const LEVEL_COLORS = { ok: '#2e9d4f', info: '#7b8794', works: '#e0b000', warn: '#ef7d00', bad: '#d7261e' };

const I18N = {
  fr: {
    nth: ['1<sup>er</sup>', '2<sup>e</sup>'],
    vehicle: { metro: 'métro', rer: 'train', train: 'train', tram: 'tram', bus: 'bus' },
    min: 'min', atStop: 'À quai', soon: 'Proche', none: 'Aucun départ annoncé pour l\'instant',
    late: 'retard', cancelled: (n) => `${n} départ${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}`,
    traffic: '⚠ Trafic perturbé · détails', from: 'depuis', noDevice: 'Appareil IDFM introuvable : choisis-le dans l\'éditeur de la carte.',
    noSensor: 'Aucun capteur d\'horaire trouvé pour cet appareil.', next: 'Prochains départs',
    status: {
      ok: 'Trafic normal', strike: 'Grève', stopped: 'Interrompu', reduced: 'Trafic réduit', delays: 'Retards',
      modified: 'Trafic modifié', works: 'Travaux', disrupted: 'Perturbé', elsewhere: 'Info ligne',
    },
    until: (t, sameDay) => (sameDay ? `jusqu'à ${t}` : `jusqu'au ${t}`),
    night: 'Fin de service', goodnight: 'Bonne nuit !',
    asleep: { metro: 'Les métros dorment', rer: 'Les trains dorment', train: 'Les trains dorment', tram: 'Les trams dorment', bus: 'Les bus dorment' },
    tomorrow: 'reprise demain matin',
  },
  en: {
    nth: ['1<sup>st</sup>', '2<sup>nd</sup>'],
    vehicle: { metro: 'metro', rer: 'train', train: 'train', tram: 'tram', bus: 'bus' },
    min: 'min', atStop: 'At platform', soon: 'Arriving', none: 'No departure announced yet',
    late: 'delayed', cancelled: (n) => `${n} departure${n > 1 ? 's' : ''} cancelled`,
    traffic: '⚠ Service disruption · details', from: 'from', noDevice: 'IDFM device not found: pick it in the card editor.',
    noSensor: 'No departure sensor found for this device.', next: 'Next departures',
    status: {
      ok: 'Good service', strike: 'Strike', stopped: 'Suspended', reduced: 'Reduced service', delays: 'Delays',
      modified: 'Modified service', works: 'Works', disrupted: 'Disrupted', elsewhere: 'Line info',
    },
    until: (t) => `until ${t}`,
    night: 'End of service', goodnight: 'Good night!',
    asleep: { metro: 'The metro is asleep', rer: 'Trains are asleep', train: 'Trains are asleep', tram: 'Trams are asleep', bus: 'Buses are asleep' },
    tomorrow: 'back tomorrow morning',
  },
};

const lang = (hass) => ((hass && (hass.locale?.language || hass.language)) || 'fr').startsWith('fr') ? 'fr' : 'en';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const toList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validColor = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c || '').trim());

function guessMode(line) {
  const l = String(line || '').toUpperCase().replace(/\s+/g, '');
  if (/^[A-E]$/.test(l)) return 'rer';
  if (/^[HJKLNPRUV]$/.test(l)) return 'train';
  if (/^T\d/.test(l)) return 'tram';
  if (/^(\d{1,2})(B|BIS)?$/.test(l) && parseInt(l, 10) <= 18) return 'metro';
  return 'bus';
}

function textColorFor(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#1d1d1b' : '#ffffff';
}

// Résumé court d'un message IDFM : 1re phrase + motif.
function summarize(desc) {
  const text = String(desc || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const motif = (text.match(/Motif\s*:\s*([^.]+)/i) || [])[1];
  const sentences = text.split(/\.(?=[A-ZÀ-Ý])|\.\s+|(?<=\))(?=[A-ZÀ-Ý])/).map((s) => s.trim()).filter(Boolean);
  let first = sentences.find((s) => !/^(p[ée]riode|dates?|motif|horaires?|rendez-vous|pour plus)/i.test(s)) || sentences[0];
  first = first.split(/\s*:\s*-\s*/)[0].replace(/\s*:\s*$/, '').trim();
  let out = first.length > 230 ? `${first.slice(0, first.lastIndexOf(' ', 226))}…` : first;
  if (motif && !norm(out).includes(norm(motif))) out += ` · Motif : ${motif.trim()}`;
  return out;
}

// Mode nuit : de 21 h à 7 h, s'il n'y a aucun départ annoncé et que le trafic n'est pas perturbé.
// Les nuits de circulation exceptionnelle (fête de la musique, réveillon…), les départs
// sont annoncés et la carte reste en affichage normal.
const NIGHT_START = 21, NIGHT_END = 7;

// Petit train vu de face qui dort (phares fermés) avec des « z » qui s'envolent.
function sleepyTrain(color, size) {
  return `<div class="zzt" style="width:${size}px;height:${Math.round(size * 1.12)}px">
    <svg viewBox="0 0 64 72" aria-hidden="true">
      <path d="M18 60 L10 71 M46 60 L54 71" stroke="#5a5a5a" stroke-width="3" stroke-linecap="round"/>
      <rect x="8" y="6" width="48" height="54" rx="13" fill="#e9e9e9"/>
      <rect x="22" y="9" width="20" height="5" rx="1.5" fill="#2b2b2b"/>
      <rect x="14" y="17" width="36" height="17" rx="4" fill="#2b3440"/>
      <path d="M18 20 L26 20 L20 30" fill="#ffffff" opacity=".12"/>
      <rect x="8" y="37" width="48" height="6" fill="${color}"/>
      <path d="M15 49 q5 4.5 10 0 M39 49 q5 4.5 10 0" stroke="#1d1d1b" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <rect x="13" y="55" width="38" height="4" rx="2" fill="#9a9a9a"/>
    </svg>
    <span class="z z1">z</span><span class="z z2">z</span><span class="z z3">Z</span>
  </div>`;
}

class IdfmMetrocard extends HTMLElement {
  static getConfigElement() { return document.createElement(EDITOR_TAG); }

  static getStubConfig(hass) {
    const ent = hass && hass.entities ? Object.values(hass.entities).find((e) => e.platform === 'idfm' && e.device_id) : null;
    return { device: ent ? ent.device_id : '' };
  }

  setConfig(config) {
    const multi = Array.isArray(config && config.lines) && config.lines.length;
    if (!config || (!multi && !config.device && !config.entities)) {
      throw new Error('idfm-metrocard : indique « device » (appareil IDFM), « entities » ou « lines ».');
    }
    this._config = Object.assign({
      show_info: true, show_traffic: true, show_clock: true, show_status: true, show_ticker: true, night_mode: true, mode: 'auto',
    }, config);
    this._resolved = {};
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._sig = null;
    this._render();
  }

  set hass(hass) {
    const n = Object.keys(hass.entities || {}).length;
    if (!this._hass || n !== this._entityCount) this._resolved = {};
    this._entityCount = n;
    this._hass = hass;
    this._refresh();
  }

  connectedCallback() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this._refresh(), 15000);
  }

  disconnectedCallback() { clearInterval(this._timer); }

  _refresh() {
    const sig = this._signature();
    if (sig !== this._sig) { this._sig = sig; this._render(); }
  }

  getCardSize() { return 4; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  // Lignes à afficher : la config elle-même, ou chaque entrée de « lines ».
  _specs() {
    const c = this._config;
    const keys = ['mode', 'show_traffic', 'only_my_stop'];
    if (Array.isArray(c.lines) && c.lines.length) {
      return c.lines.map((l) => Object.assign(Object.fromEntries(keys.map((k) => [k, c[k]])), l));
    }
    return [c];
  }

  // Retrouve les capteurs d'horaires, le capteur trafic et les infos de ligne d'un appareil.
  _resolve(spec, idx) {
    if (this._resolved[idx]) return this._resolved[idx];
    const h = this._hass;
    const res = { timing: [], traffic: null, line: '', stop: '', direction: '', found: true };
    if (spec.entities) {
      res.timing = toList(spec.entities);
    } else {
      const ents = Object.values(h.entities || {}).filter((e) => e.device_id === spec.device && e.platform === 'idfm');
      if (!ents.length) res.found = false;
      for (const e of ents) {
        const st = h.states[e.entity_id];
        if (e.entity_id.startsWith('sensor.') && (!st || st.attributes.device_class === 'timestamp')) res.timing.push(e.entity_id);
        else if (e.entity_id.startsWith('binary_sensor.') && !res.traffic) res.traffic = e.entity_id;
      }
      const dev = h.devices && h.devices[spec.device];
      // Nom d'appareil de l'intégration : « C - Athis-Mons - Athis-Mons -> any »
      if (dev && dev.name) {
        const [left, dir] = dev.name.split(' -> ');
        const parts = left.split(' - ');
        res.line = parts[0] || '';
        res.stop = parts[1] || '';
        res.direction = dir && dir !== 'any' ? dir : '';
      }
    }
    if (spec.traffic_entity) res.traffic = spec.traffic_entity;
    this._resolved[idx] = res;
    return res;
  }

  _signature() {
    if (!this._hass || !this._config) return '';
    let s = String(Math.floor(Date.now() / 60000));
    this._specs().forEach((spec, i) => {
      const r = this._resolve(spec, i);
      for (const id of r.timing) {
        const st = this._hass.states[id];
        s += '|' + (st ? st.state + JSON.stringify(st.attributes) : '');
      }
      if (r.traffic) { const t = this._hass.states[r.traffic]; s += '|' + (t ? t.state + (t.attributes.description || '') : ''); }
    });
    return s;
  }

  _departures(spec, r) {
    const h = this._hass, out = [];
    let cancelled = 0;
    const inc = toList(spec.include_destinations).map(norm);
    const exc = toList(spec.exclude_destinations).map(norm);
    const now = Date.now();
    for (const id of r.timing) {
      const st = h.states[id];
      if (!st || ['unknown', 'unavailable', ''].includes(st.state)) continue;
      const a = st.attributes || {};
      const dest = a.destination || a.direction || '';
      const nd = norm(dest);
      if (inc.length && !inc.some((k) => nd.includes(k))) continue;
      if (exc.some((k) => nd.includes(k))) continue;
      const t = new Date(String(st.state).replace(' ', 'T'));
      if (isNaN(t)) continue;
      const m = Math.floor((t.getTime() - now) / 60000);
      if (m < 0) continue;
      if (a.status === 'cancelled') { cancelled++; continue; }
      out.push({ m, t, dest, atStop: a.at_stop === true, status: a.status });
    }
    out.sort((x, y) => x.t - y.t);
    return { trains: out.slice(0, 2), cancelled };
  }

  // État du trafic de la ligne : niveau (couleur), libellé court, résumé, fin prévue.
  _status(spec, r, t) {
    const ent = spec.show_traffic !== false && r.traffic ? this._hass.states[r.traffic] : null;
    if (!ent || ent.state !== 'on') return { level: 'ok', label: t.status.ok, text: '' };
    const a = ent.attributes || {};
    const d = norm(a.description);
    const effect = String(a.effect || '').toUpperCase();
    const cause = norm(a.cause);
    let level = 'warn', label = t.status.disrupted;
    if (/greve|mouvement social/.test(d)) { level = 'bad'; label = t.status.strike; }
    else if (effect === 'NO_SERVICE' || /interrompu/.test(d)) { level = 'bad'; label = t.status.stopped; }
    else if (cause === 'travaux') { level = 'works'; label = t.status.works; }
    else if (effect === 'REDUCED_SERVICE') label = t.status.reduced;
    else if (effect === 'SIGNIFICANT_DELAYS') label = t.status.delays;
    else if (['MODIFIED_SERVICE', 'DETOUR', 'STOP_MOVED'].includes(effect)) label = t.status.modified;
    // Option : ne pas alarmer si le message ne cite ni l'arrêt ni les destinations suivies.
    if (spec.only_my_stop) {
      const keys = [r.stop, ...toList(spec.include_destinations)].map(norm).filter(Boolean);
      if (keys.length && !keys.some((k) => d.includes(k))) { level = 'info'; label = t.status.elsewhere; }
    }
    let until = '';
    const end = a.end_time ? new Date(a.end_time) : null;
    if (end && !isNaN(end)) {
      const sameDay = end.toDateString() === new Date().toDateString();
      until = t.until(sameDay ? this._hhmm(end) : end.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), sameDay);
    }
    return { level, label, text: summarize(a.description), until, entity: r.traffic };
  }

  _hhmm(d) {
    const tz = this._hass?.config?.time_zone;
    try {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined });
    } catch (e) {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
  }

  _isNight() {
    if (this._config.night_mode === false) return false;
    let h;
    try {
      h = parseInt(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: this._hass?.config?.time_zone || undefined }).format(new Date()), 10);
    } catch (e) { h = new Date().getHours(); }
    return h >= NIGHT_START || h < NIGHT_END;
  }

  // La ligne « dort » : aucun départ, rien de supprimé, trafic normal, et c'est la nuit.
  _asleep(it) {
    return !it.trains.length && !it.cancelled && ['ok', 'info'].includes(it.st.level) && this._isNight();
  }

  _line(spec, r) {
    const line = String(spec.line || r.line || '?');
    const mode = spec.mode && spec.mode !== 'auto' ? spec.mode : guessMode(line);
    const key = line.toUpperCase().replace(/BIS$/, 'B');
    const color = validColor(spec.line_color) ? spec.line_color.trim()
      : ((LINE_COLORS[mode] || {})[key] || DEFAULT_COLOR[mode] || '#9a9a9a');
    const modeLabel = { metro: 'M', rer: 'RER', train: 'TRAIN', tram: 'T', bus: 'BUS' }[mode] || '';
    return { line, mode, color, txt: textColorFor(color), modeLabel, shape: mode === 'metro' || mode === 'rer' ? '50%' : '6px' };
  }

  _badges(L, small) {
    const s = small ? 28 : 34;
    const modeFs = L.modeLabel.length > 3 ? 9 : L.modeLabel.length > 1 ? (small ? 9 : 11) : (small ? 15 : 18);
    const lnFs = L.line.length > 2 ? (small ? 12 : 14) : (small ? 16 : 20);
    return `${L.modeLabel ? `<div class="mode" style="min-width:${s}px;height:${s}px;font-size:${modeFs}px">${L.modeLabel}</div>` : ''}`
      + `<div class="ln" style="min-width:${s}px;height:${s}px;font-size:${lnFs}px;background:${L.color};color:${L.txt};border-radius:${L.line.length > 2 ? `${s / 2}px` : L.shape}">${esc(L.line)}</div>`;
  }

  _pill(st) {
    if (!this._config.show_status) return '';
    return `<span class="pill" style="--lv:${LEVEL_COLORS[st.level]}"><i></i>${esc(st.label)}</span>`;
  }

  _slot(label, tr, t) {
    if (!tr) return `<div class="slot"><div class="lbl">${label}</div><div class="num none">--</div><div class="at">&nbsp;</div></div>`;
    let big;
    if (tr.atStop) big = `<div class="num txt blink">${t.atStop}</div>`;
    else if (tr.m === 0) big = `<div class="num txt blink">${t.soon}</div>`;
    else big = `<div class="num">${tr.m}<span class="unit">${t.min}</span></div>`;
    const late = tr.status === 'delayed' ? ` <span class="late">${t.late}</span>` : '';
    return `<div class="slot"><div class="lbl">${label}</div>${big}<div class="at">${this._hhmm(tr.t)}${late}</div></div>`;
  }

  // Bandeau défilant façon panneau : messages des lignes perturbées.
  _ticker(items) {
    const msgs = items.filter((x) => x.st.level !== 'ok' && x.st.text);
    if (!this._config.show_ticker || !msgs.length) return '';
    const parts = msgs.map((x) => `<span class="tk-item"><b style="background:${x.L.color};color:${x.L.txt}">${esc(x.L.line)}</b>`
      + `${x.st.until ? `<em>${esc(x.st.until)}</em> ` : ''}${esc(x.st.text)}</span>`).join('');
    const len = msgs.reduce((n, x) => n + x.st.text.length + 20, 0);
    const dur = Math.max(14, Math.round(len * 0.16));
    const delay = -((Date.now() / 1000) % dur).toFixed(1); // reprend à la même position après un rafraîchissement
    const ent = msgs[0].st.entity;
    return `<div class="ticker" data-entity="${esc(ent || '')}"><div class="tk-run" style="animation-duration:${dur}s;animation-delay:${delay}s">${parts}</div></div>`;
  }

  _message(text) {
    this.shadowRoot.innerHTML = `<style>ha-card{display:block;padding:16px}</style><ha-card>${esc(text)}</ha-card>`;
  }

  _render() {
    if (!this.shadowRoot || !this._config || !this._hass) return;
    const t = I18N[lang(this._hass)];
    const specs = this._specs();
    const items = [];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i], r = this._resolve(spec, i);
      if (!r.found) return this._message(t.noDevice);
      if (!r.timing.length) return this._message(t.noSensor);
      items.push({ spec, r, L: this._line(spec, r), st: this._status(spec, r, t), ...this._departures(spec, r) });
    }
    const body = specs.length > 1 ? this._renderMulti(items, t) : this._renderSingle(items[0], t);
    this.shadowRoot.innerHTML = `<style>${this._css()}</style><ha-card>${body}${this._ticker(items)}<div class="foot" style="background:${items[0].L.color}"></div></ha-card>`;
    this.shadowRoot.querySelectorAll('[data-entity]').forEach((el) => {
      const id = el.getAttribute('data-entity');
      if (!id) return;
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true })));
    });
  }

  _renderSingle(it, t) {
    const c = this._config, { spec, r, L, st, trains, cancelled } = it;
    const title = spec.title || r.direction || r.stop || L.line;
    const subtitle = spec.subtitle !== undefined ? spec.subtitle : (r.stop && title !== r.stop ? `${t.from} ${r.stop}` : '');
    const veh = t.vehicle[L.mode] || 'train';
    const asleep = this._asleep(it);
    let info = '';
    trains.forEach((tr, i) => { info += `<div class="dl"><b>${t.nth[i]}</b> ${esc(tr.dest)}</div>`; });
    if (!trains.length) info += `<div class="dl">${asleep ? t.goodnight : t.none}</div>`;
    if (cancelled) info += `<div class="warn">${t.cancelled(cancelled)}</div>`;
    if (!c.show_status && st.level !== 'ok') info += `<div class="warn">${t.traffic}</div>`;
    return `
      <div class="head">${this._badges(L)}
        <div class="dest"><div class="d">${esc(title)}</div>${subtitle ? `<div class="o">${esc(subtitle)}</div>` : ''}</div>
        <div class="hp" ${st.entity ? `data-entity="${esc(st.entity)}"` : ''}>${this._pill(st)}</div>
      </div>
      <div class="body ${c.show_info ? '' : 'noinfo'}">
        ${asleep ? `<div class="night">${sleepyTrain(L.color, 62)}<div class="nt"><div class="nb">${t.night}</div>
          <div class="ns">${t.asleep[L.mode] || t.asleep.train}… ${t.tomorrow}</div></div></div>`
        : `${this._slot(`${t.nth[0]} ${veh}`, trains[0], t)}
        <div class="sep"></div>
        ${this._slot(`${t.nth[1]} ${veh}`, trains[1], t)}`}
        ${c.show_info ? `<div class="info"><span class="i">i</span>${c.show_clock ? `<span class="clk">${this._hhmm(new Date())}</span>` : ''}
          <div class="txt2">${info}</div></div>` : ''}
      </div>`;
  }

  _renderMulti(items, t) {
    const c = this._config;
    const rows = items.map((it) => {
      const { spec, r, L, st, trains } = it;
      const title = spec.title || r.direction || r.stop || L.line;
      const sub = spec.subtitle !== undefined ? spec.subtitle : (r.stop && title !== r.stop ? `${t.from} ${r.stop}` : '');
      const cell = (tr) => {
        if (!tr) return '<div class="mc"><div class="mn none">--</div><div class="mt">&nbsp;</div></div>';
        const big = tr.atStop ? `<div class="mn txt blink">${t.atStop}</div>` : tr.m === 0 ? `<div class="mn txt blink">${t.soon}</div>`
          : `<div class="mn">${tr.m}<span class="unit">${t.min}</span></div>`;
        return `<div class="mc">${big}<div class="mt">${this._hhmm(tr.t)}${tr.status === 'delayed' ? ` <span class="late">${t.late}</span>` : ''}</div></div>`;
      };
      return `<div class="row">
        <div class="rb">${this._badges(L, true)}</div>
        <div class="rd"><div class="rt">${esc(title)}</div>${sub ? `<div class="rs">${esc(sub)}</div>` : ''}
          <div ${st.entity ? `data-entity="${esc(st.entity)}"` : ''}>${this._pill(st)}</div></div>
        ${this._asleep(it) ? `<div class="mz">${sleepyTrain(L.color, 30)}<span>${t.night}</span></div>`
          : `${cell(trains[0])}<div class="msep"></div>${cell(trains[1])}`}
      </div>`;
    }).join('');
    return `<div class="head mhead"><div class="dest"><div class="d">${esc(c.title || t.next)}</div></div>
      ${c.show_clock ? `<span class="hclk">${this._hhmm(new Date())}</span>` : ''}</div>
      <div class="board">${rows}</div>`;
  }

  _css() {
    return `
      :host { display: block; }
      ha-card { display: block; overflow: hidden; background: #1b1b1d; padding: 0; border: none;
        border-radius: var(--ha-card-border-radius, 12px); container-type: inline-size; }
      .head { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
        background: linear-gradient(#f6f3f4, #e7e2e4); color: #1d1d1b; }
      .mode { padding: 0 4px; border-radius: 17px; border: 2.5px solid #1d2f6b; color: #1d2f6b;
        display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: Roboto, Arial, sans-serif;
        line-height: 1; box-sizing: border-box; flex: none; }
      .ln { padding: 0 6px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-family: Roboto, Arial, sans-serif; line-height: 1; flex: none; }
      .dest { display: flex; flex-direction: column; min-width: 0; flex: 1; }
      .dest .d { font: 700 22px/1.1 Roboto, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dest .o { font: 500 12px/1.2 Roboto, Arial, sans-serif; color: #6b6467; }
      .hp { flex: none; }
      .pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 6px; border-radius: 999px;
        background: color-mix(in srgb, var(--lv) 16%, white); color: color-mix(in srgb, var(--lv) 75%, black);
        border: 1.5px solid var(--lv); font: 700 11px/1.1 Roboto, Arial, sans-serif; white-space: nowrap; }
      .pill i { width: 8px; height: 8px; border-radius: 50%; background: var(--lv); }
      .body { display: grid; grid-template-columns: 1fr auto 1fr 1.25fr; align-items: stretch;
        background: #0c0c0d; margin: 0 6px; padding: 10px 12px 12px 12px; gap: 0 10px; }
      .body.noinfo { grid-template-columns: 1fr auto 1fr; }
      .slot { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
      .lbl { color: #f2f2f2; font: 500 12px/1 Roboto, Arial, sans-serif; margin-bottom: 4px; }
      sup { font-size: 8px; }
      .num { color: #f7c11e; font: 700 56px/1 Roboto, "Arial Narrow", Arial, sans-serif;
        font-variant-numeric: tabular-nums; letter-spacing: -1px; white-space: nowrap; }
      .unit { font-size: 15px; font-weight: 600; margin-left: 3px; letter-spacing: 0; }
      .num.txt { font-size: 24px; line-height: 56px; letter-spacing: 0; }
      .none { color: #5a5a5a !important; }
      .at, .mt { color: #cfcfcf; font: 500 14px/1.2 Roboto, Arial, sans-serif; margin-top: 4px; font-variant-numeric: tabular-nums; }
      .late { color: #ff8a3d; font-weight: 700; }
      .sep { width: 3px; background: #e9e9e9; border-radius: 2px; margin: 18px 0 22px; }
      .info { background: #dceef9; color: #102a43; border-radius: 3px; padding: 8px 10px; position: relative;
        font: 500 13px/1.3 Roboto, Arial, sans-serif; min-width: 0; }
      .info .i { display: inline-flex; width: 18px; height: 18px; border: 2px solid #102a43; border-radius: 2px;
        align-items: center; justify-content: center; font: 800 12px/1 Georgia, serif; box-sizing: border-box; }
      .clk, .hclk { background: #2b2b2b; color: #f7c11e; font: 700 12px/1 Roboto, Arial, sans-serif; padding: 3px 5px;
        border-radius: 2px; font-variant-numeric: tabular-nums; }
      .info .clk { position: absolute; top: 6px; right: 6px; }
      .info .txt2 { margin-top: 6px; }
      .dl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dl b { display: inline-block; min-width: 26px; }
      .warn { margin-top: 4px; color: #b3261e; font-weight: 700; }
      .board { background: #0c0c0d; margin: 0 6px; padding: 2px 12px; }
      .row { display: grid; grid-template-columns: auto 1fr auto auto auto; align-items: center; gap: 10px;
        padding: 10px 0; border-bottom: 1px solid #2a2a2c; }
      .row:last-child { border-bottom: none; }
      .rb { display: flex; gap: 5px; }
      .row .mode { border-color: #e9e9e9; color: #e9e9e9; }
      .rd { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .rt { color: #f2f2f2; font: 700 16px/1.15 Roboto, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .rs { color: #9a9a9a; font: 500 11px/1.1 Roboto, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .rd .pill { font-size: 10px; padding: 2px 7px 2px 5px; }
      .mc { text-align: right; min-width: 52px; }
      .mn { color: #f7c11e; font: 700 34px/1 Roboto, Arial, sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .mn .unit { font-size: 11px; }
      .mn.txt { font-size: 15px; line-height: 34px; }
      .mt { font-size: 12px; margin-top: 2px; }
      .msep { width: 2px; align-self: stretch; background: #3a3a3c; margin: 6px 0; }
      .ticker { margin: 0 6px; background: #0c0c0d; border-top: 1px solid #2a2a2c; overflow: hidden; height: 26px;
        display: flex; align-items: center; }
      .tk-run { display: inline-flex; gap: 48px; white-space: nowrap; padding-left: 100%;
        color: #ffb000; font: 600 13px/26px "Courier New", ui-monospace, monospace; animation: tk linear infinite; }
      .tk-item b { display: inline-block; min-width: 18px; padding: 0 5px; margin-right: 8px; border-radius: 4px;
        font: 800 12px/18px Roboto, Arial, sans-serif; text-align: center; }
      .tk-item em { font-style: normal; color: #fff; margin-right: 4px; }
      @keyframes tk { from { transform: translateX(0); } to { transform: translateX(-100%); } }
      .night { grid-column: 1 / 4; display: flex; align-items: center; gap: 26px; min-width: 0; padding: 4px 0; }
      .nt { min-width: 0; }
      .nb { color: #f7c11e; font: 700 26px/1.1 Roboto, Arial, sans-serif; }
      .ns { color: #cfcfcf; font: 500 13px/1.3 Roboto, Arial, sans-serif; margin-top: 4px; }
      .zzt { position: relative; flex: none; --zx: 14px; --zy: -20px; }
      .zzt svg { width: 100%; height: 100%; display: block; animation: snore 4s ease-in-out infinite; transform-origin: 50% 100%; }
      .z { position: absolute; left: 92%; top: 20%; color: #f7c11e; font: 800 14px/1 Roboto, Arial, sans-serif;
        opacity: 0; animation: zfly 3.6s ease-out infinite; }
      .z2 { animation-delay: 1.2s; font-size: 17px; }
      .z3 { animation-delay: 2.4s; font-size: 21px; }
      @keyframes zfly { 0% { opacity: 0; transform: translate(0, 10px) scale(.5); } 25% { opacity: 1; }
        100% { opacity: 0; transform: translate(var(--zx), var(--zy)) scale(1.15); } }
      @keyframes snore { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.02, .97); } }
      .mz { grid-column: span 3; display: flex; align-items: center; justify-content: flex-end; gap: 16px;
        color: #f7c11e; font: 700 14px/1 Roboto, Arial, sans-serif; white-space: nowrap; }
      .mz .zzt { --zx: 8px; --zy: -11px; } .mz .zzt .z { font-size: 9px; } .mz .zzt .z2 { font-size: 11px; } .mz .zzt .z3 { font-size: 13px; }
      @media (prefers-reduced-motion: reduce) { .zzt svg, .z { animation: none; } .z { opacity: 1; } .z1 { transform: translate(2px, 6px); } .z3 { transform: translate(12px, -14px); } }
      .foot { height: 8px; margin-top: 6px; }
      .blink { animation: blink 1.2s steps(2, start) infinite; }
      @keyframes blink { to { visibility: hidden; } }
      @container (max-width: 430px) {
        .body { grid-template-columns: 1fr auto 1fr; gap: 10px 10px; }
        .info { grid-column: 1 / -1; }
        .num { font-size: 52px; }
        .head .pill { font-size: 10px; }
        .dest .d { font-size: 20px; }
        .mn { font-size: 28px; }
        .mc { min-width: 44px; }
        .row { gap: 8px; }
      }`;
  }
}

const EDITOR_LABELS = {
  fr: {
    device: 'Arrêt (appareil IDFM)', title: 'Titre (destination affichée)', subtitle: 'Sous-titre',
    include_destinations: 'Garder seulement les départs vers…', exclude_destinations: 'Exclure les départs vers…',
    mode: 'Type de ligne', line_color: 'Couleur de ligne (#RRVVBB)', show_info: 'Encart info',
    show_traffic: 'Info trafic', show_clock: 'Horloge', show_status: 'Pastille d\'état', show_ticker: 'Bandeau défilant',
    only_my_stop: 'Info trafic : seulement si mon arrêt est cité',
    night_mode: 'Mode nuit (train endormi quand il n\'y a plus de départ)',
  },
  en: {
    device: 'Stop (IDFM device)', title: 'Title (shown destination)', subtitle: 'Subtitle',
    include_destinations: 'Only keep departures to…', exclude_destinations: 'Exclude departures to…',
    mode: 'Line type', line_color: 'Line colour (#RRGGBB)', show_info: 'Info panel',
    show_traffic: 'Traffic info', show_clock: 'Clock', show_status: 'Status pill', show_ticker: 'Scrolling banner',
    only_my_stop: 'Traffic info: only when my stop is mentioned',
    night_mode: 'Night mode (sleeping train when there are no more departures)',
  },
};
const EDITOR_HELPERS = {
  fr: {
    include_destinations: 'Un bout de nom suffit (ex. « Juvisy »). Vide = tous.',
    exclude_destinations: 'Ex. les terminus de l\'autre sens.',
    title: 'Vide = direction de l\'intégration ou nom de l\'arrêt.',
  },
  en: {
    include_destinations: 'Part of a name is enough (e.g. “Juvisy”). Empty = all.',
    exclude_destinations: 'E.g. the terminus stations of the other direction.',
    title: 'Empty = integration direction or stop name.',
  },
};

class IdfmMetrocardEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._render(); }

  set hass(hass) { this._hass = hass; this._render(); }

  _schema() {
    const fr = lang(this._hass) === 'fr';
    return [
      { name: 'device', required: true, selector: { device: { filter: { integration: 'idfm' } } } },
      { type: 'grid', name: '', schema: [
        { name: 'title', selector: { text: {} } },
        { name: 'subtitle', selector: { text: {} } },
      ] },
      { name: 'include_destinations', selector: { text: { multiple: true } } },
      { name: 'exclude_destinations', selector: { text: { multiple: true } } },
      { type: 'grid', name: '', schema: [
        { name: 'mode', selector: { select: { mode: 'dropdown', options: [
          { value: 'auto', label: fr ? 'Automatique' : 'Automatic' },
          { value: 'metro', label: fr ? 'Métro' : 'Metro' },
          { value: 'rer', label: 'RER' },
          { value: 'train', label: 'Transilien' },
          { value: 'tram', label: 'Tram' },
          { value: 'bus', label: 'Bus' },
        ] } } },
        { name: 'line_color', selector: { text: {} } },
      ] },
      { type: 'grid', name: '', schema: [
        { name: 'show_status', selector: { boolean: {} } },
        { name: 'show_ticker', selector: { boolean: {} } },
        { name: 'show_info', selector: { boolean: {} } },
        { name: 'show_clock', selector: { boolean: {} } },
        { name: 'show_traffic', selector: { boolean: {} } },
      ] },
      { name: 'only_my_stop', selector: { boolean: {} } },
      { name: 'night_mode', selector: { boolean: {} } },
    ];
  }

  _render() {
    if (!this._hass || !this._config) return;
    const l = lang(this._hass);
    if (Array.isArray(this._config.lines)) {
      // Le mode multi-lignes se règle en YAML.
      this.innerHTML = `<p style="padding:8px">${l === 'fr' ? 'Carte multi-lignes : modifie-la dans l\'éditeur YAML.' : 'Multi-line card: edit it in the YAML editor.'}</p>`;
      this._form = null;
      return;
    }
    if (!this._form) {
      this.innerHTML = '';
      this._form = document.createElement('ha-form');
      this._form.computeLabel = (s) => EDITOR_LABELS[l][s.name] || s.name;
      this._form.computeHelper = (s) => EDITOR_HELPERS[l][s.name];
      this._form.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        const cfg = Object.assign({}, ev.detail.value);
        for (const k of Object.keys(cfg)) {
          if (cfg[k] === '' || (Array.isArray(cfg[k]) && !cfg[k].length)) delete cfg[k];
        }
        this._config = cfg;
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: cfg }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = Object.assign({
      mode: 'auto', show_info: true, show_traffic: true, show_clock: true, show_status: true, show_ticker: true, only_my_stop: false, night_mode: true,
    }, this._config);
  }
}

if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, IdfmMetrocard);
if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, IdfmMetrocardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((x) => x.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: 'IDFM Metrocard',
    description: 'Prochains passages façon panneau de quai (intégration Ile de France Mobilités)',
    preview: true,
    documentationURL: 'https://github.com/robote7701/idfm-metrocard',
  });
}
console.info(`%c IDFM-METROCARD %c v${VERSION} `, 'color:#1d1d1b;background:#f7c11e;font-weight:700', 'color:#f7c11e;background:#1d1d1b');
