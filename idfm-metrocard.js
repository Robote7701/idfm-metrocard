/*!
 * IDFM Metrocard — carte Lovelace façon panneau de quai pour les prochains passages
 * (métro, RER, Transilien, tram, bus) fournis par l'intégration « Ile de France Mobilités »
 * (https://github.com/droso-hass/idfm).
 * Licence MIT.
 */
const VERSION = '1.0.0';
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

const I18N = {
  fr: {
    nth: ['1<sup>er</sup>', '2<sup>e</sup>'],
    vehicle: { metro: 'métro', rer: 'train', train: 'train', tram: 'tram', bus: 'bus' },
    min: 'min', atStop: 'À quai', soon: 'Proche', none: 'Aucun départ annoncé pour l\'instant',
    late: 'retard', cancelled: (n) => `${n} départ${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}`,
    traffic: '⚠ Trafic perturbé · détails', from: 'depuis', noDevice: 'Appareil IDFM introuvable : choisis-le dans l\'éditeur de la carte.',
    noSensor: 'Aucun capteur d\'horaire trouvé pour cet appareil.',
  },
  en: {
    nth: ['1<sup>st</sup>', '2<sup>nd</sup>'],
    vehicle: { metro: 'metro', rer: 'train', train: 'train', tram: 'tram', bus: 'bus' },
    min: 'min', atStop: 'At platform', soon: 'Arriving', none: 'No departure announced yet',
    late: 'delayed', cancelled: (n) => `${n} departure${n > 1 ? 's' : ''} cancelled`,
    traffic: '⚠ Service disruption · details', from: 'from', noDevice: 'IDFM device not found: pick it in the card editor.',
    noSensor: 'No departure sensor found for this device.',
  },
};

const EDITOR_LABELS = {
  fr: {
    device: 'Arrêt (appareil IDFM)', title: 'Titre (destination affichée)', subtitle: 'Sous-titre',
    include_destinations: 'Garder seulement les départs vers…', exclude_destinations: 'Exclure les départs vers…',
    mode: 'Type de ligne', line_color: 'Couleur de ligne (#RRVVBB)', show_info: 'Encart info',
    show_traffic: 'Alerte trafic', show_clock: 'Horloge',
  },
  en: {
    device: 'Stop (IDFM device)', title: 'Title (shown destination)', subtitle: 'Subtitle',
    include_destinations: 'Only keep departures to…', exclude_destinations: 'Exclude departures to…',
    mode: 'Line type', line_color: 'Line colour (#RRGGBB)', show_info: 'Info panel',
    show_traffic: 'Traffic alert', show_clock: 'Clock',
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

class IdfmMetrocard extends HTMLElement {
  static getConfigElement() { return document.createElement(EDITOR_TAG); }

  static getStubConfig(hass) {
    const ent = hass && hass.entities ? Object.values(hass.entities).find((e) => e.platform === 'idfm' && e.device_id) : null;
    return { device: ent ? ent.device_id : '' };
  }

  setConfig(config) {
    if (!config || (!config.device && !config.entities)) {
      throw new Error('idfm-metrocard : indique « device » (appareil IDFM) ou « entities ».');
    }
    this._config = Object.assign({ show_info: true, show_traffic: true, show_clock: true, mode: 'auto' }, config);
    this._resolved = null;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._sig = null;
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first || (this._resolved && this._resolved.entityCount !== Object.keys(hass.entities || {}).length)) this._resolved = null;
    const sig = this._signature();
    if (sig !== this._sig) { this._sig = sig; this._render(); }
  }

  connectedCallback() {
    clearInterval(this._timer);
    this._timer = setInterval(() => { this._sig = this._signature(); this._render(); }, 15000);
  }

  disconnectedCallback() { clearInterval(this._timer); }

  getCardSize() { return 4; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  // Retrouve les capteurs d'horaires, le capteur trafic et les infos de ligne de l'appareil choisi.
  _resolve() {
    if (this._resolved) return this._resolved;
    const c = this._config, h = this._hass;
    const res = { timing: [], traffic: null, line: '', stop: '', direction: '', found: true, entityCount: Object.keys(h.entities || {}).length };
    if (c.entities) {
      res.timing = toList(c.entities);
    } else {
      const ents = Object.values(h.entities || {}).filter((e) => e.device_id === c.device && e.platform === 'idfm');
      if (!ents.length) res.found = false;
      for (const e of ents) {
        const st = h.states[e.entity_id];
        if (e.entity_id.startsWith('sensor.') && (!st || st.attributes.device_class === 'timestamp')) res.timing.push(e.entity_id);
        else if (e.entity_id.startsWith('binary_sensor.') && !res.traffic) res.traffic = e.entity_id;
      }
      const dev = h.devices && h.devices[c.device];
      // Nom d'appareil de l'intégration : « C - Athis-Mons - Athis-Mons -> any »
      if (dev && dev.name) {
        const [left, dir] = dev.name.split(' -> ');
        const parts = left.split(' - ');
        res.line = parts[0] || '';
        res.stop = parts[1] || '';
        res.direction = dir && dir !== 'any' ? dir : '';
      }
    }
    if (c.traffic_entity) res.traffic = c.traffic_entity;
    this._resolved = res;
    return res;
  }

  _signature() {
    if (!this._hass || !this._config) return '';
    const r = this._resolve();
    let s = String(Math.floor(Date.now() / 60000));
    for (const id of r.timing) {
      const st = this._hass.states[id];
      s += '|' + (st ? st.state + JSON.stringify(st.attributes) : '');
    }
    if (r.traffic) { const t = this._hass.states[r.traffic]; s += '|' + (t ? t.state : ''); }
    return s;
  }

  _departures(r) {
    const c = this._config, h = this._hass, out = [];
    let cancelled = 0;
    const inc = toList(c.include_destinations).map(norm);
    const exc = toList(c.exclude_destinations).map(norm);
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

  _hhmm(d) {
    const tz = this._hass?.config?.time_zone;
    try {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined });
    } catch (e) {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
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

  _message(text) {
    this.shadowRoot.innerHTML = `<style>ha-card{display:block;padding:16px}</style><ha-card>${esc(text)}</ha-card>`;
  }

  _render() {
    if (!this.shadowRoot || !this._config || !this._hass) return;
    const c = this._config, t = I18N[lang(this._hass)];
    const r = this._resolve();
    if (!r.found) return this._message(t.noDevice);
    if (!r.timing.length) return this._message(t.noSensor);

    const line = String(c.line || r.line || '?');
    const mode = c.mode && c.mode !== 'auto' ? c.mode : guessMode(line);
    const key = line.toUpperCase().replace(/BIS$/, 'B');
    const color = validColor(c.line_color) ? c.line_color.trim()
      : ((LINE_COLORS[mode] || {})[key] || DEFAULT_COLOR[mode] || '#9a9a9a');
    const txtColor = textColorFor(color);
    const title = c.title || r.direction || r.stop || line;
    const subtitle = c.subtitle !== undefined ? c.subtitle : (r.stop && title !== r.stop ? `${t.from} ${r.stop}` : '');
    const modeLabel = { metro: 'M', rer: 'RER', train: 'TRAIN', tram: 'T', bus: 'BUS' }[mode] || '';
    const veh = t.vehicle[mode] || 'train';

    const { trains, cancelled } = this._departures(r);
    const tEnt = c.show_traffic && r.traffic ? this._hass.states[r.traffic] : null;
    const perturbe = !!(tEnt && tEnt.state === 'on');

    let info = '';
    trains.forEach((tr, i) => { info += `<div class="dl"><b>${t.nth[i]}</b> ${esc(tr.dest)}</div>`; });
    if (!trains.length) info += `<div class="dl">${t.none}</div>`;
    if (cancelled) info += `<div class="warn">${t.cancelled(cancelled)}</div>`;
    if (perturbe) info += `<div class="warn">${t.traffic}</div>`;
    const shape = mode === 'metro' || mode === 'rer' ? '50%' : '6px';

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { display: block; overflow: hidden; background: #1b1b1d; padding: 0; border: none;
          border-radius: var(--ha-card-border-radius, 12px); container-type: inline-size; }
        .head { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
          background: linear-gradient(#f6f3f4, #e7e2e4); color: #1d1d1b; }
        .mode { min-width: 34px; height: 34px; padding: 0 4px; border-radius: 17px; border: 2.5px solid #1d2f6b; color: #1d2f6b;
          display: flex; align-items: center; justify-content: center; font: 800 ${modeLabel.length > 3 ? 9 : modeLabel.length > 1 ? 11 : 18}px/1 Roboto, Arial, sans-serif;
          box-sizing: border-box; flex: none; }
        .ln { min-width: 34px; height: 34px; padding: 0 6px; box-sizing: border-box; border-radius: ${line.length > 2 ? '17px' : shape};
          background: ${color}; color: ${txtColor}; display: flex; align-items: center; justify-content: center;
          font: 800 ${line.length > 2 ? 14 : 20}px/1 Roboto, Arial, sans-serif; flex: none; }
        .dest { display: flex; flex-direction: column; min-width: 0; }
        .dest .d { font: 700 22px/1.1 Roboto, Arial, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dest .o { font: 500 12px/1.2 Roboto, Arial, sans-serif; color: #6b6467; }
        .body { display: grid; grid-template-columns: ${c.show_info ? '1fr auto 1fr 1.25fr' : '1fr auto 1fr'}; align-items: stretch;
          background: #0c0c0d; margin: 0 6px; padding: 10px 12px 12px 12px; gap: 0 10px; }
        .slot { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
        .lbl { color: #f2f2f2; font: 500 12px/1 Roboto, Arial, sans-serif; margin-bottom: 4px; }
        .lbl sup, .dl sup { font-size: 8px; }
        .num { color: #f7c11e; font: 700 56px/1 Roboto, "Arial Narrow", Arial, sans-serif;
          font-variant-numeric: tabular-nums; letter-spacing: -1px; white-space: nowrap; }
        .num .unit { font-size: 15px; font-weight: 600; margin-left: 3px; letter-spacing: 0; }
        .num.txt { font-size: 24px; line-height: 56px; letter-spacing: 0; }
        .num.none { color: #5a5a5a; }
        .at { color: #cfcfcf; font: 500 14px/1.2 Roboto, Arial, sans-serif; margin-top: 4px; font-variant-numeric: tabular-nums; }
        .late { color: #ff8a3d; font-weight: 700; }
        .sep { width: 3px; background: #e9e9e9; border-radius: 2px; margin: 18px 0 22px; }
        .info { background: #dceef9; color: #102a43; border-radius: 3px; padding: 8px 10px; position: relative;
          font: 500 13px/1.3 Roboto, Arial, sans-serif; min-width: 0; cursor: ${perturbe ? 'pointer' : 'default'}; }
        .info .i { display: inline-flex; width: 18px; height: 18px; border: 2px solid #102a43; border-radius: 2px;
          align-items: center; justify-content: center; font: 800 12px/1 Georgia, serif; box-sizing: border-box; }
        .info .clk { position: absolute; top: 6px; right: 6px; background: #2b2b2b; color: #f7c11e;
          font: 700 12px/1 Roboto, Arial, sans-serif; padding: 3px 5px; border-radius: 2px; font-variant-numeric: tabular-nums; }
        .info .txt2 { margin-top: 6px; }
        .dl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dl b { display: inline-block; min-width: 26px; }
        .warn { margin-top: 4px; color: #b3261e; font-weight: 700; }
        .foot { height: 8px; background: ${color}; margin-top: 6px; }
        .blink { animation: blink 1.2s steps(2, start) infinite; }
        @keyframes blink { to { visibility: hidden; } }
        @container (max-width: 430px) {
          .body { grid-template-columns: 1fr auto 1fr; gap: 10px 10px; }
          .info { grid-column: 1 / -1; }
          .num { font-size: 52px; }
        }
      </style>
      <ha-card>
        <div class="head">
          ${modeLabel ? `<div class="mode">${modeLabel}</div>` : ''}<div class="ln">${esc(line)}</div>
          <div class="dest"><div class="d">${esc(title)}</div>${subtitle ? `<div class="o">${esc(subtitle)}</div>` : ''}</div>
        </div>
        <div class="body">
          ${this._slot(`${t.nth[0]} ${veh}`, trains[0], t)}
          <div class="sep"></div>
          ${this._slot(`${t.nth[1]} ${veh}`, trains[1], t)}
          ${c.show_info ? `<div class="info" id="info">
            <span class="i">i</span>${c.show_clock ? `<span class="clk">${this._hhmm(new Date())}</span>` : ''}
            <div class="txt2">${info}</div></div>` : ''}
        </div>
        <div class="foot"></div>
      </ha-card>`;
    const infoEl = this.shadowRoot.getElementById('info');
    if (perturbe && infoEl) {
      infoEl.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: r.traffic }, bubbles: true, composed: true }));
      });
    }
  }
}

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
        { name: 'show_info', selector: { boolean: {} } },
        { name: 'show_traffic', selector: { boolean: {} } },
        { name: 'show_clock', selector: { boolean: {} } },
      ] },
    ];
  }

  _render() {
    if (!this._hass || !this._config) return;
    const l = lang(this._hass);
    if (!this._form) {
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
    this._form.data = Object.assign({ mode: 'auto', show_info: true, show_traffic: true, show_clock: true }, this._config);
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
