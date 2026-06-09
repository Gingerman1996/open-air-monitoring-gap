<script setup lang="ts">
import L from 'leaflet';
import 'leaflet.markercluster';

interface Monitor {
  id: string; name: string; city: string; country: string; iso2: string;
  manufacturer: string; type: 'low_cost' | 'reference'; owner: string;
  status: 'online' | 'offline'; pm25: number; aqi: number; lat: number; lng: number;
}
interface CountryDensity {
  country: string; population: number; monitors_total: number; monitors_online: number;
  reference: number; low_cost: number; monitors_per_100k: number; deaths_per_100k: number | null;
  avg_pm25: number | null; gap_ratio: number | null; gap_level: number | null; deaths: number | null;
}
interface GlobalStats {
  monitors: number; cities: number; countries_with_data: number;
  widest_gap: { name: string; gap_ratio: number } | null;
  gap_threshold_lv1: number | null;
}

const { lang, setLang, t } = useLang();
const api = useApi();

// ---- reactive UI state ----
const mapEl = ref<HTMLElement | null>(null);
const infoOpen = ref(false);
const infoHtml = ref('');
const filtersOpen = ref(true);
const exportOpen = ref(false);
const sourcesOpen = ref(false);
const monOn = ref(true);
const healOn = ref(true);
const visCount = ref(0);
const filterType = reactive<Record<string, boolean>>({ low_cost: true, reference: true });
const filterStatus = reactive<Record<string, boolean>>({ online: true, offline: true });
const filterMfg = reactive<Record<string, boolean>>({});
const manufacturers = ref<string[]>([]);
const story = reactive({ active: false, step: 0, title: '', body: '', label: '' });

// ---- plain (non-reactive) data + leaflet handles ----
let MONITORS: Monitor[] = [];
const densityByCountry = new Map<string, CountryDensity>();
let stats: GlobalStats | null = null;
let map: L.Map;
let cluster: L.MarkerClusterGroup;
const healthLayer = L.layerGroup();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let choroLayer: any = null; // Leaflet.VectorGrid layer (untyped lib)
let selName: string | null = null;
let selDeaths: number | null = null;
const seriesCache = new Map<string, { year: number; deaths: number; deaths_per_100k: number }[]>();

// ---- palettes (ported from the prototype) ----
const aqiColor = (a: number) =>
  a <= 50 ? '#36A45C' : a <= 100 ? '#E4BB36' : a <= 150 ? '#E68A38'
  : a <= 200 ? '#D8484A' : a <= 300 ? '#8C56AE' : '#7C3B3B';

const BUCKETS = [
  { max: 20600, c: '#1f5c8b', label: '0 – 20,600' },
  { max: 63300, c: '#a8cce4', label: '20,600 – 63,300' },
  { max: 147100, c: '#d4a73c', label: '63,300 – 147,100' },
  { max: 969700, c: '#ec9a81', label: '147,100 – 969,700' },
  { max: Infinity, c: '#cc4b3f', label: '969,700 – 1,790,000' },
];
const deathColor = (d: number | null) => {
  if (d == null) return '#c2c2c2';
  for (const b of BUCKETS) if (d < b.max) return b.c;
  return '#cc4b3f';
};
const bucketLabel = (d: number | null) => {
  if (d == null) return t('No data', 'ไม่มีข้อมูล');
  for (const b of BUCKETS) if (d < b.max) return b.label;
  return BUCKETS[4].label;
};
const GAP_LEVELS = [
  { c: '#1f5c8b', en: 'Well covered', th: 'ครอบคลุมดี' },
  { c: '#5b9bd5', en: 'Moderate', th: 'ปานกลาง' },
  { c: '#d4a73c', en: 'Notable gap', th: 'ช่องว่างชัด' },
  { c: '#E68A38', en: 'High gap', th: 'ช่องว่างสูง' },
  { c: '#cc4b3f', en: 'Severe gap', th: 'ช่องว่างรุนแรง' },
];
const PRICE = { low_cost: 250, reference: 25000 };
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString();
const fmt = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString() : String(n));
const escTip = (s: string) => s.replace(/"/g, '&quot;');
const qmark = (tip: string) => ` <span class="qmark" tabindex="0" data-tip="${escTip(tip)}">?</span>`;

// ---- choropleth (PostGIS → Martin vector tiles, rendered by Leaflet.VectorGrid) ----
// deaths are baked into each tile feature, so the colour comes straight off the tile.
/* eslint-disable @typescript-eslint/no-explicit-any */
function vgStyle(deaths: number | null | undefined, sel: boolean) {
  return {
    fill: true,
    fillColor: deathColor(deaths ?? 0), // not-in-dataset → 0 → navy (lowest bucket), as in SoGA maps
    fillOpacity: sel ? 0.55 : 0.38,
    color: sel ? '#0A3550' : '#ffffff',
    weight: sel ? 2 : 0.5,
    stroke: true,
  };
}
async function buildChoropleth() {
  (window as any).L = L; // leaflet.vectorgrid is an old UMD that attaches to the global L
  await import('leaflet.vectorgrid');
  const VG = (L as any).vectorGrid;
  choroLayer = VG.protobuf(`${api.tileBase}/country_tiles/{z}/{x}/{y}`, {
    rendererFactory: (L as any).svg.tile,
    interactive: true,
    maxZoom: 19,
    getFeatureId: (f: any) => f.properties.name,
    vectorTileLayerStyles: {
      country_tiles: (props: any) => vgStyle(props.deaths, false),
    },
  });
  choroLayer.on('click', (e: any) => selectCountry(e.layer.properties.name, e.layer.properties.deaths ?? null));
  choroLayer.on('mouseover', (e: any) => {
    const { name, deaths } = e.layer.properties;
    if (name !== selName) choroLayer.setFeatureStyle(name, { ...vgStyle(deaths, false), fillOpacity: 0.6, weight: 1.4 });
  });
  choroLayer.on('mouseout', (e: any) => {
    const name = e.layer.properties.name;
    if (name !== selName) choroLayer.resetFeatureStyle(name);
  });
  healthLayer.addLayer(choroLayer);
}
function selectCountry(name: string, deaths: number | null) {
  if (selName && choroLayer) choroLayer.resetFeatureStyle(selName);
  selName = name;
  selDeaths = deaths;
  choroLayer?.setFeatureStyle(name, vgStyle(deaths, true));
  openCountry(name, deaths);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- monitors / clusters ----
function monMarker(m: Monitor) {
  const off = m.status === 'offline';
  const icon = L.divIcon({
    className: 'pm-pin',
    html: `<div class="pm${off ? ' off' : ''}" style="background:${aqiColor(m.aqi)}">${m.aqi}</div>`,
    iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -15],
  });
  const mk = L.marker([m.lat, m.lng], { icon }) as L.Marker & { __aqi: number };
  mk.__aqi = m.aqi;
  mk.bindPopup(popupHtml(m), { closeButton: false });
  return mk;
}
function popupHtml(m: Monitor) {
  const typeLabel = t(m.type === 'reference' ? 'Reference' : 'Low-cost', m.type === 'reference' ? 'อ้างอิง' : 'ราคาประหยัด');
  return `<div class="mpop"><div class="mt">${m.id}</div>` +
    `<div class="ms">${m.manufacturer} · ${typeLabel}<br>${m.country} · ${m.owner}</div>` +
    `<div class="mrow"><span style="width:11px;height:11px;border-radius:50%;background:${aqiColor(m.aqi)};display:inline-block"></span> AQI ${m.aqi} · PM2.5 ${m.pm25}</div>` +
    (m.status === 'offline' ? `<div class="mrow off">● ${t('Offline', 'ออฟไลน์')}</div>` : '') +
    `<div class="mhist" data-id="${m.id}"></div>` +
    '</div>';
}

/** small PM2.5-over-time sparkline for a monitor's recent history */
function pm25Spark(points: { ts: string; pm25: number; aqi: number }[]): string {
  if (points.length < 2) {
    return `<div style="font-size:10.5px;color:#8B988F;margin-top:6px">${t('PM2.5 history builds every 10 min', 'ประวัติ PM2.5 จะสะสมทุก 10 นาที')}</div>`;
  }
  const W = 190, H = 46, pl = 4, pr = 4, pt = 10, pb = 4;
  const vals = points.map((p) => p.pm25);
  const max = Math.max(...vals), min = Math.min(...vals), iw = W - pl - pr, ih = H - pt - pb;
  const X = (i: number) => pl + (iw * i) / (points.length - 1);
  const Y = (v: number) => pt + ih * (1 - (v - min) / Math.max(max - min, 1));
  const last = points[points.length - 1];
  const col = aqiColor(last.aqi);
  let line = '';
  points.forEach((p, i) => { line += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.pm25).toFixed(1) + ' '; });
  return `<div style="margin-top:8px">` +
    `<div style="font-size:10px;color:#8B988F;display:flex;justify-content:space-between">` +
      `<span>${t('PM2.5 trend', 'แนวโน้ม PM2.5')} · ${points.length} ${t('pts', 'จุด')}</span><span>${last.pm25} µg/m³</span></div>` +
    `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">` +
      `<path d="${line}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<circle cx="${X(points.length - 1).toFixed(1)}" cy="${Y(last.pm25).toFixed(1)}" r="2.4" fill="${col}"/>` +
    `</svg></div>`;
}
async function onPopupOpen(e: L.PopupEvent): Promise<void> {
  const root = e.popup.getElement();
  const el = root?.querySelector('.mhist') as HTMLElement | null;
  if (!el || el.dataset.loaded) return;
  el.dataset.loaded = '1';
  const id = el.getAttribute('data-id');
  if (!id) return;
  try {
    const hist = await api.get<{ ts: string; pm25: number; aqi: number }[]>(
      `/monitors/${encodeURIComponent(id)}/measurements`,
    );
    el.innerHTML = pm25Spark(hist.slice().reverse());
  } catch {
    el.innerHTML = '';
  }
}
function passes(m: Monitor) {
  return filterType[m.type] && filterStatus[m.status] && filterMfg[m.manufacturer];
}
function currentMonitors() {
  return MONITORS.filter(passes);
}
function rebuildMonitors() {
  cluster.clearLayers();
  const list = currentMonitors();
  for (const m of list) cluster.addLayer(monMarker(m));
  visCount.value = list.length;
  updatePill();
}

// ---- count pill ----
const pill = ref('');
function updatePill() {
  if (!stats) return;
  const worst = stats.widest_gap;
  pill.value =
    `<span>${t('Monitors', 'เครื่องตรวจวัด')}: <b>${currentMonitors().length.toLocaleString()}</b></span>` +
    `<span>${t('Cities', 'เมือง')}: <b>${stats.cities}</b></span>` +
    (worst ? `<span class="gp">${t('Widest gap', 'ช่องว่างมากสุด')}: ${worst.name}</span>` : '');
}

// ---- deaths sparkline (data from /health-impacts series) ----
function sparkline(series: { year: number; deaths: number }[], color: string) {
  const data = series.map((p) => ({ y: p.year, v: p.deaths }));
  const W = 276, H = 118, pl = 8, pr = 8, pt = 12, pb = 20;
  const max = Math.max(...data.map((p) => p.v)), iw = W - pl - pr, ih = H - pt - pb;
  const X = (i: number) => pl + (iw * i) / (data.length - 1);
  const Y = (v: number) => pt + ih * (1 - v / max);
  let line = '', area = 'M' + X(0) + ' ' + Y(data[0].v);
  data.forEach((p, i) => {
    const x = X(i).toFixed(1), y = Y(p.v).toFixed(1);
    line += (i ? 'L' : 'M') + x + ' ' + y + ' ';
    area += ' L' + x + ' ' + y;
  });
  area += ' L' + X(data.length - 1) + ' ' + (pt + ih) + ' L' + X(0) + ' ' + (pt + ih) + ' Z';
  const lastIdx = data.length - 1;
  const tickIdx = [...new Set(lastIdx <= 1 ? [0, lastIdx] : [0, Math.round(lastIdx / 2), lastIdx])];
  const xlab = tickIdx.map((i) => {
    const anchor = i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle';
    return `<text x="${X(i).toFixed(1)}" y="${H - 5}" font-size="9" fill="#8B988F" text-anchor="${anchor}" font-family="IBM Plex Mono,monospace">${data[i].y}</text>`;
  }).join('');
  const dot = `<circle cx="${X(lastIdx).toFixed(1)}" cy="${Y(data[lastIdx].v).toFixed(1)}" r="3" fill="${color}"/>`;
  const geo = { W, H, pl, pr, pt, ih, iw, max, color, data };
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="100%" style="display:block" data-geo='${JSON.stringify(geo)}'>` +
    `<path d="${area}" fill="${color}" opacity="0.12"/>` +
    `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dot}` +
    `<text x="${pl}" y="${pt - 2}" font-size="9" fill="#8B988F" font-family="IBM Plex Mono,monospace">${fmt(max)}</text>${xlab}` +
    `<g class="spark-hover" style="display:none">` +
      `<line class="sh-line" y1="${pt}" y2="${pt + ih}" stroke="${color}" stroke-width="1" stroke-dasharray="3 2" opacity=".6"/>` +
      `<circle class="sh-dot" r="3.5" fill="#fff" stroke="${color}" stroke-width="2"/>` +
      `<g class="sh-tipg"><rect class="sh-tip" rx="4" height="30" fill="#14201B"/>` +
        `<text class="sh-yr" fill="#9fb0a9" font-size="8.5" font-family="IBM Plex Mono,monospace"></text>` +
        `<text class="sh-val" fill="#fff" font-size="11" font-weight="600" font-family="IBM Plex Mono,monospace"></text></g>` +
    `</g>` +
    `<rect class="spark-hit" x="${pl}" y="${pt}" width="${iw}" height="${ih}" fill="transparent" style="cursor:crosshair"/>` +
  `</svg>`;
}

// ---- info panel ----
async function openCountry(name: string, deathsArg: number | null = null) {
  const rec = densityByCountry.get(name);
  const deaths = rec?.deaths ?? deathsArg ?? null;
  const ms = rec?.monitors_total ?? 0;
  const online = rec?.monitors_online ?? 0;
  const per100k = rec?.monitors_per_100k ?? null;
  const deathsPer100k = rec?.deaths_per_100k ?? null;
  const gap = rec?.gap_ratio ?? null;
  const lvl = rec?.gap_level ?? null;

  infoOpen.value = true;
  let body =
    `<div class="metric"><div class="ml">${t('Deaths attributable to PM2.5', 'ผู้เสียชีวิตจาก PM2.5')}${qmark(t('Estimated annual deaths attributable to PM2.5 air pollution — source: State of Global Air / GBD (IHME).', 'ประมาณการผู้เสียชีวิตต่อปีจากมลพิษ PM2.5 — ที่มา: State of Global Air / GBD (IHME)'))}</div>` +
      `<div class="mv">${deaths != null ? fmt(deaths) : '—'} <small>${t('per year', 'ต่อปี')}</small></div>` +
      (deathsPer100k != null ? `<div class="sub">${deathsPer100k} ${t('per 100k people', 'ต่อแสนคน')}</div>` : '') +
    '</div>';

  if (deaths != null) {
    const series = await loadSeries(name);
    if (series.length) {
      const y0 = series[0].year, y1 = series[series.length - 1].year;
      body += `<div class="metric"><div class="ml">${t(`Deaths trend · ${y0}–${y1}`, `แนวโน้มผู้เสียชีวิต · ${y0}–${y1}`)}</div>${sparkline(series, deathColor(deaths))}</div>`;
    }
  }
  body += '<div class="divider"></div>';

  if (ms > 0) {
    body +=
      `<div class="metric"><div class="ml">${t('Monitors in sample', 'เครื่องตรวจในตัวอย่าง')}${qmark(t('Number of public air-quality monitors in this dataset for the country (online + offline).', 'จำนวนเครื่องตรวจวัดคุณภาพอากาศสาธารณะในชุดข้อมูลสำหรับประเทศนี้ (ออนไลน์ + ออฟไลน์)'))}</div>` +
        `<div class="mv">${ms} <small>${online} ${t('online', 'ออนไลน์')}</small></div>` +
        (per100k != null ? `<div class="sub">${per100k} ${t('per 100k people', 'ต่อแสนคน')}</div>` : '') +
      '</div>';
    body += gapBlock(lvl, gap);
    body += investBlock(deathsPer100k, rec?.population ?? null, ms);
  } else {
    body +=
      `<div class="metric"><div class="ml">${t('Monitors in sample', 'เครื่องตรวจในตัวอย่าง')}</div>` +
        `<div class="mv">0</div>` +
        `<div class="sub">${t('No public monitors here — a coverage blind spot.', 'ไม่มีเครื่องตรวจวัดสาธารณะ — จุดบอดของการตรวจวัด')}</div>` +
      '</div>';
  }

  selName = name;
  infoTitle.value = name;
  infoFlag.value = t('Country', 'ประเทศ');
  infoSrc.value = deaths != null ? bucketLabel(deaths) + ' ' + t('deaths/yr', 'ราย/ปี') : t('Not in dataset (assumed low)', 'ไม่อยู่ในชุดข้อมูล (ถือว่าต่ำ)');
  infoHtml.value = body;
}
const infoTitle = ref('—');
const infoFlag = ref('COUNTRY');
const infoSrc = ref('');

function gapBlock(lvl: number | null, gap: number | null) {
  const idx = lvl != null ? lvl - 1 : 4;
  const b = GAP_LEVELS[idx];
  const scale = '<div class="gap-scale">' + GAP_LEVELS.map((x, i) =>
    `<i style="background:${x.c};opacity:${i === idx ? 1 : 0.3}${i === idx ? ';transform:scaleY(1.5)' : ''}"></i>`).join('') + '</div>';
  const desc = idx >= 2
    ? t('High death toll, thin monitoring — a coverage gap.', 'ผู้เสียชีวิตสูงแต่การตรวจวัดบาง — ช่องว่างการตรวจวัด')
    : t('Reasonably monitored for its burden.', 'ตรวจวัดพอเหมาะกับภาระ');
  return `<div class="gapflag" style="background:${b.c}1f;border-left:3px solid ${b.c}">` +
    `<div class="gaprow"><b>${t('Monitoring gap', 'ช่องว่างการตรวจวัด')}${gap != null ? ': ' + gap.toLocaleString() : ''}${qmark(t('gap = deaths per 100k ÷ monitors per 100k. The level is the quintile rank among countries that have monitors (1 = lowest gap, 5 = highest).', 'gap = ผู้เสียชีวิตต่อแสนคน ÷ เครื่องตรวจต่อแสนคน · ระดับคือลำดับ quintile เทียบประเทศที่มีเครื่องตรวจ (1 = gap ต่ำสุด, 5 = สูงสุด)'))}</b>` +
      `<span class="gaplvl" style="color:${b.c}">${t('Lv', 'ระดับ')} ${idx + 1}/5 · ${lang.value === 'th' ? b.th : b.en}</span></div>` +
    scale +
    `<div class="gapdesc">${desc}</div></div>`;
}

function investBlock(deathsPer100k: number | null, pop: number | null, ms: number) {
  const t0 = stats?.gap_threshold_lv1;
  if (deathsPer100k == null || !pop || !t0) return '';
  const gap = ms > 0 ? deathsPer100k / Math.max(ms / (pop / 100000), 0.001) : null;
  if (gap != null && gap < t0) return `<div class="gapfix ok">${t('✓ Already in the good zone (Lv 1)', '✓ อยู่ในโซนที่ดีแล้ว (Lv 1)')}</div>`;
  const need = Math.max(0, Math.ceil((deathsPer100k / t0) * pop / 100000) - ms);
  if (need <= 0) return '';
  const raised = ms * PRICE.low_cost, goal = (ms + need) * PRICE.low_cost, stillNeed = need * PRICE.low_cost;
  const pct = goal ? Math.round((raised / goal) * 100) : 0;
  return '<div class="gapfix">' +
    `<div class="gf-h">${t('To reach the good zone (Lv 1) — add', 'เพื่อเข้าโซนที่ดี (Lv 1) — ต้องเพิ่ม')}${qmark(t('Monitors needed so the gap drops into Level 1 (the lowest quintile). Cost = monitors needed × average sensor price. Avg prices: low-cost ~$250 (AirGradient / PurpleAir store listings), reference ~$25,000 (regulatory FEM/BAM units, e.g. Met One BAM-1020). Indicative, configurable.', 'จำนวนเครื่องที่ต้องเพิ่มเพื่อให้ gap ลงมาอยู่ระดับ 1 (quintile ต่ำสุด) · ค่าใช้จ่าย = จำนวนเครื่อง × ราคาเฉลี่ย · ราคาเฉลี่ย: ราคาประหยัด ~$250 (จากราคาขาย AirGradient / PurpleAir), อ้างอิง ~$25,000 (เครื่องระดับมาตรฐาน FEM/BAM เช่น Met One BAM-1020) — เป็นค่าประมาณ ปรับได้'))}</div>` +
    `<div class="gf-need">+${need.toLocaleString()} <small>${t('monitors', 'เครื่อง')}</small></div>` +
    `<div class="gf-opt"><span><i class="d good"></i>${t('Low-cost', 'ราคาประหยัด')} × ${fmtMoney(PRICE.low_cost)}</span><b>${fmtMoney(need * PRICE.low_cost)}</b></div>` +
    `<div class="gf-opt"><span><i class="d ref"></i>${t('Reference', 'อ้างอิง')} × ${fmtMoney(PRICE.reference)}</span><b>${fmtMoney(need * PRICE.reference)}</b></div>` +
    '<div class="gf-donate">' +
      `<div class="gf-dh">${t('Donation to fully equip (low-cost)', 'เงินบริจาคเพื่อจัดให้ครบ (ราคาประหยัด)')}</div>` +
      `<div class="donatebar"><i style="width:${pct}%"></i></div>` +
      `<div class="gf-drow"><span>${t('Raised', 'ระดมได้')} ${fmtMoney(raised)} / ${fmtMoney(goal)}</span><b>${t('need', 'ต้องการอีก')} ${fmtMoney(stillNeed)}</b></div>` +
    '</div></div>';
}

async function loadSeries(name: string) {
  if (seriesCache.has(name)) return seriesCache.get(name)!;
  try {
    const s = await api.get<{ year: number; deaths: number; deaths_per_100k: number }[]>(
      `/health-impacts?country=${encodeURIComponent(name)}`,
    );
    seriesCache.set(name, s);
    return s;
  } catch {
    return [];
  }
}

function closeInfo() {
  infoOpen.value = false;
  if (selName && choroLayer) choroLayer.resetFeatureStyle(selName);
  selName = null;
  selDeaths = null;
}

// ---- layer toggles ----
function toggleMon() {
  monOn.value = !monOn.value;
  if (monOn.value) cluster.addTo(map);
  else map.removeLayer(cluster);
}
function toggleHeal() {
  healOn.value = !healOn.value;
  if (healOn.value) healthLayer.addTo(map);
  else map.removeLayer(healthLayer);
}

// ---- export / sources menus ----
function exportDataset(ds: string) {
  const q: Record<string, string> = {};
  if (ds === 'monitors') {
    q.type = Object.keys(filterType).filter((k) => filterType[k]).join(',');
    q.status = Object.keys(filterStatus).filter((k) => filterStatus[k]).join(',');
    q.manufacturer = Object.keys(filterMfg).filter((k) => filterMfg[k]).join(',');
  }
  const a = document.createElement('a');
  a.href = api.exportUrl(ds, q);
  a.click();
  exportOpen.value = false;
}

// ---- story mode ----
const STEPS = [
  { step: '01', title: ['Air pollution is not shared equally', 'มลพิษทางอากาศไม่ได้กระจายอย่างเท่าเทียม'],
    body: ['Each country is shaded by the number of deaths attributable to PM2.5 pollution each year. The deepest reds sit over China, India and South Asia.', 'แต่ละประเทศถูกระบายสีตามจำนวนผู้เสียชีวิตจากมลพิษ PM2.5 ต่อปี สีแดงเข้มสุดอยู่ที่จีน อินเดีย และเอเชียใต้'],
    view: [20, 75, 3.4] as [number, number, number], mon: false, heal: true },
  { step: '02', title: ['Some places carry a huge burden', 'บางพื้นที่แบกรับภาระมหาศาล'],
    body: ['India, Pakistan and parts of Africa lose over 95 people per 100,000 every year to dirty air.', 'อินเดีย ปากีสถาน และบางส่วนของแอฟริกา สูญเสียคนกว่า 95 ต่อแสนคนต่อปีจากอากาศสกปรก'],
    view: [24, 72, 4] as [number, number, number], mon: false, heal: true },
  { step: '03', title: ['Now — where are the monitors?', 'แล้ว...เครื่องตรวจวัดอยู่ที่ไหน?'],
    body: ['The same regions go almost dark. The instruments that measure the air cluster in wealthy, low-death countries instead.', 'ภูมิภาคเดียวกันกลับแทบมืดสนิท เครื่องมือที่วัดอากาศกลับกระจุกอยู่ในประเทศร่ำรวยที่มีผู้เสียชีวิตน้อยแทน'],
    view: [24, 72, 4] as [number, number, number], mon: true, heal: false },
  { step: '04', title: ['This is the monitoring gap', 'นี่คือช่องว่างของการตรวจวัด'],
    body: ['Where people suffer most, we measure least. Closing this gap is the first step to fixing it — and this map makes it impossible to ignore.', 'ที่ที่ผู้คนเดือดร้อนที่สุด เรากลับวัดน้อยที่สุด การปิดช่องว่างนี้คือก้าวแรกของการแก้ไข — และแผนที่นี้ทำให้มองข้ามไม่ได้'],
    view: [20, 40, 2.6] as [number, number, number], mon: true, heal: true },
];
function showStep(i: number) {
  const s = STEPS[i];
  story.label = t('Story', 'เล่าเรื่อง') + ' · ' + s.step + '/' + STEPS.length;
  story.title = lang.value === 'th' ? s.title[1] : s.title[0];
  story.body = lang.value === 'th' ? s.body[1] : s.body[0];
  monOn.value = s.mon; if (s.mon) cluster.addTo(map); else map.removeLayer(cluster);
  healOn.value = s.heal; if (s.heal) healthLayer.addTo(map); else map.removeLayer(healthLayer);
  map.flyTo([s.view[0], s.view[1]], s.view[2], { duration: 1.4 });
}
function startStory() {
  closeInfo();
  story.active = true;
  story.step = 0;
  showStep(0);
}
function nextStep() {
  story.step++;
  if (story.step >= STEPS.length) { exitStory(); return; }
  showStep(story.step);
}
function exitStory() {
  story.active = false;
  monOn.value = true; cluster.addTo(map);
  healOn.value = true; healthLayer.addTo(map);
  map.flyTo([26, 30], 3, { duration: 1.2 });
}

// ---- mount ----
onMounted(async () => {
  map = L.map(mapEl.value!, { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([26, 30], 3);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);
  map.createPane('labels');
  map.getPane('labels')!.style.zIndex = '550';
  map.getPane('labels')!.style.pointerEvents = 'none';
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 19, pane: 'labels',
  }).addTo(map);
  map.on('popupopen', onPopupOpen);

  cluster = L.markerClusterGroup({
    maxClusterRadius: 48, showCoverageOnHover: false, chunkedLoading: true,
    iconCreateFunction: (cl) => {
      const kids = cl.getAllChildMarkers() as Array<L.Marker & { __aqi?: number }>;
      let s = 0; for (const k of kids) s += k.__aqi ?? 0;
      const avg = Math.round(s / Math.max(kids.length, 1));
      const col = aqiColor(avg);
      const n = cl.getChildCount();
      const w = n < 10 ? 36 : n < 50 ? 44 : n < 200 ? 52 : 60;
      return L.divIcon({
        className: 'pm-cluster',
        html: `<div class="cl" style="width:${w}px;height:${w}px;background:${col};box-shadow:0 0 0 6px ${col}44,0 2px 7px rgba(20,32,27,.3)">${n}</div>`,
        iconSize: [w, w],
      });
    },
  });
  healthLayer.addTo(map);
  cluster.addTo(map);

  // restore language
  try {
    const saved = localStorage.getItem('demo-lang');
    if (saved === 'th' || saved === 'en') setLang(saved);
  } catch { /* ignore */ }

  // load data from the API (choropleth comes from Martin vector tiles, not GeoJSON)
  const [monitors, density, gstats] = await Promise.all([
    api.get<Monitor[]>('/monitors'),
    api.get<CountryDensity[]>('/density'),
    api.get<GlobalStats>('/stats/global'),
  ]);
  MONITORS = monitors;
  for (const d of density) densityByCountry.set(d.country, d);
  stats = gstats;

  // manufacturers + filters
  manufacturers.value = [...new Set(MONITORS.map((m) => m.manufacturer))].sort();
  for (const mf of manufacturers.value) filterMfg[mf] = true;

  await buildChoropleth();
  rebuildMonitors();
  updatePill();
  installTooltips();
  installSparkHover();

  setTimeout(() => { const el = document.getElementById('toast'); if (el) el.style.display = 'none'; }, 6000);
});

// re-render dynamic chrome on language change
watch(lang, () => {
  updatePill();
  if (infoOpen.value && selName) openCountry(selName, selDeaths);
  if (cluster) rebuildMonitors();
});

// counts for the filter UI
const cntLowCost = computed(() => MONITORS.filter((m) => m.type === 'low_cost').length);
const cntReference = computed(() => MONITORS.filter((m) => m.type === 'reference').length);
const cntOnline = computed(() => MONITORS.filter((m) => m.status === 'online').length);
const cntOffline = computed(() => MONITORS.filter((m) => m.status === 'offline').length);
const cntMfg = (mf: string) => MONITORS.filter((m) => m.manufacturer === mf).length;

watch([filterType, filterStatus, filterMfg], () => { if (cluster) rebuildMonitors(); }, { deep: true });

// ---- instant "?" tooltip (no native-title delay, escapes panel clipping) ----
function installTooltips() {
  const tip = document.createElement('div');
  tip.className = 'qtip';
  document.body.appendChild(tip);
  const show = (el: HTMLElement) => {
    const txt = el.getAttribute('data-tip');
    if (!txt) return;
    tip.textContent = txt;
    tip.style.display = 'block';
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
    let top = r.bottom + 8;
    if (top + th > window.innerHeight - 8) top = r.top - th - 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    requestAnimationFrame(() => tip.classList.add('on'));
  };
  const hide = () => {
    tip.classList.remove('on');
    setTimeout(() => { if (!tip.classList.contains('on')) tip.style.display = 'none'; }, 150);
  };
  document.addEventListener('mouseover', (e) => {
    const q = (e.target as HTMLElement).closest?.('.qmark') as HTMLElement | null;
    if (q) show(q);
  });
  document.addEventListener('mouseout', (e) => {
    const q = (e.target as HTMLElement).closest?.('.qmark');
    if (q) hide();
  });
  document.addEventListener('focusin', (e) => {
    const q = (e.target as HTMLElement).closest?.('.qmark') as HTMLElement | null;
    if (q) show(q);
  });
  document.addEventListener('focusout', hide);
}

// ---- deaths-sparkline hover ----
function installSparkHover() {
  const move = (e: PointerEvent) => {
    const svg = (e.target as HTMLElement).closest?.('svg.spark') as SVGSVGElement | null;
    if (!svg) return;
    const g = JSON.parse(svg.getAttribute('data-geo')!) as {
      W: number; pl: number; iw: number; pt: number; ih: number; max: number;
      data: { y: number; v: number }[];
    };
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * g.W;
    let i = Math.round(((vx - g.pl) / g.iw) * (g.data.length - 1));
    i = Math.max(0, Math.min(g.data.length - 1, i));
    const p = g.data[i];
    const x = g.pl + (g.iw * i) / (g.data.length - 1);
    const y = g.pt + g.ih * (1 - p.v / g.max);
    const hov = svg.querySelector('.spark-hover') as SVGGElement;
    hov.style.display = '';
    (svg.querySelector('.sh-line') as SVGLineElement).setAttribute('x1', String(x));
    (svg.querySelector('.sh-line') as SVGLineElement).setAttribute('x2', String(x));
    (svg.querySelector('.sh-dot') as SVGCircleElement).setAttribute('cx', String(x));
    (svg.querySelector('.sh-dot') as SVGCircleElement).setAttribute('cy', String(y));
    const yr = svg.querySelector('.sh-yr') as SVGTextElement;
    const val = svg.querySelector('.sh-val') as SVGTextElement;
    const tipR = svg.querySelector('.sh-tip') as SVGRectElement;
    yr.textContent = String(p.y);
    val.textContent = p.v.toLocaleString();
    const tw = Math.max(val.getComputedTextLength ? val.getComputedTextLength() : 0, 44) + 14;
    let tx = x - tw / 2;
    tx = Math.max(g.pl, Math.min(tx, g.W - g.pl - tw));
    const ty = Math.max(g.pt, y - 38);
    tipR.setAttribute('width', String(tw));
    tipR.setAttribute('x', String(tx));
    tipR.setAttribute('y', String(ty));
    yr.setAttribute('x', String(tx + 7)); yr.setAttribute('y', String(ty + 12));
    val.setAttribute('x', String(tx + 7)); val.setAttribute('y', String(ty + 24));
  };
  const leave = (e: PointerEvent) => {
    const svg = (e.target as HTMLElement).closest?.('svg.spark') as SVGSVGElement | null;
    if (svg) { const h = svg.querySelector('.spark-hover') as SVGGElement | null; if (h) h.style.display = 'none'; }
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerout', leave);
}
</script>

<template>
  <header class="hdr">
    <div class="brand">
      <div class="logo-wrap" id="logoWrap">
        <img class="brand-logo" src="/logo-colored.png" alt="Open Air Foundation" />
      </div>
      <div class="brand-divider" />
      <div>
        <b>{{ t('Monitoring Density Map', 'แผนที่ความหนาแน่นการตรวจวัด') }}</b>
        <span>{{ t('Live demo · sample data', 'เดโม่ · ข้อมูลตัวอย่าง') }}</span>
      </div>
    </div>

    <div class="layers">
      <button class="lyr mon" :aria-pressed="monOn" @click="toggleMon">
        <span class="dot" /><span>{{ t('Monitors', 'เครื่องตรวจวัด') }}</span>
      </button>
      <button class="lyr heal" :aria-pressed="healOn" @click="toggleHeal">
        <span class="dot" /><span>{{ t('Health burden', 'ภาระสุขภาพ') }}</span>
      </button>
    </div>

    <div class="sp" />

    <button class="btn" @click="filtersOpen = !filtersOpen">
      <span class="ic">⛃</span><span class="lbl">{{ t('Filters', 'ตัวกรอง') }}</span>
    </button>
    <button class="btn" @click="startStory">
      <span class="ic">▶</span><span class="lbl">{{ t('Story mode', 'โหมดเล่าเรื่อง') }}</span>
    </button>
    <div class="exportwrap">
      <button class="btn solid" @click.stop="exportOpen = !exportOpen; sourcesOpen = false">
        <span class="ic">↓</span><span class="lbl">{{ t('Export CSV', 'ส่งออก CSV') }}</span>
      </button>
      <div class="menu" :class="{ show: exportOpen }" @click.stop>
        <div class="mh">{{ t('Choose a dataset', 'เลือกชุดข้อมูล') }}</div>
        <div class="mi star" @click="exportDataset('gap')">
          <div class="mc" style="background:var(--teal)" />
          <div><div class="mt">{{ t('Monitoring gap (by city)', 'ช่องว่างการตรวจวัด (รายเมือง)') }}</div><div class="md">density × health · gap_ratio</div></div>
        </div>
        <div class="mi" @click="exportDataset('monitors')">
          <div class="mc" style="background:var(--aqi-good)" />
          <div><div class="mt">{{ t('Monitors (filtered)', 'เครื่องตรวจวัด (ตามตัวกรอง)') }}</div><div class="md">one row per monitor</div></div>
        </div>
        <div class="mi" @click="exportDataset('density')">
          <div class="mc" style="background:var(--teal-deep)" />
          <div><div class="mt">{{ t('Density by city', 'ความหนาแน่นรายเมือง') }}</div><div class="md">one row per city</div></div>
        </div>
        <div class="mi" @click="exportDataset('health')">
          <div class="mc" style="background:var(--aqi-bad)" />
          <div><div class="mt">{{ t('Health impacts', 'ผลกระทบสุขภาพ') }}</div><div class="md">deaths · rate_per_100k</div></div>
        </div>
      </div>
    </div>
    <div class="exportwrap">
      <button class="btn" @click.stop="sourcesOpen = !sourcesOpen; exportOpen = false">
        <span class="ic">⊙</span><span class="lbl">{{ t('Sources', 'แหล่งข้อมูล') }}</span>
      </button>
      <div class="menu" :class="{ show: sourcesOpen }" @click.stop>
        <div class="mh">{{ t('Data sources', 'ที่มาของข้อมูล') }}</div>
        <a class="mi" href="https://www.stateofglobalair.org/data" target="_blank" rel="noopener">
          <div class="mc" style="background:var(--aqi-bad)" />
          <div><div class="mt">{{ t('Deaths · State of Global Air', 'ผู้เสียชีวิต · State of Global Air') }}</div><div class="md">GBD / IHME ↗</div></div>
        </a>
        <a class="mi" href="https://population.un.org/wpp/" target="_blank" rel="noopener">
          <div class="mc" style="background:var(--teal-deep)" />
          <div><div class="mt">{{ t('Population · UN WPP', 'ประชากร · UN WPP') }}</div><div class="md">+ World Bank ↗</div></div>
        </a>
        <a class="mi" href="https://map-data-int.airgradient.com/map/api/v1/docs" target="_blank" rel="noopener">
          <div class="mc" style="background:var(--aqi-good)" />
          <div><div class="mt">{{ t('Monitors · AirGradient API', 'เครื่องตรวจวัด · AirGradient API') }}</div><div class="md">map data ↗</div></div>
        </a>
      </div>
    </div>
    <div class="lang">
      <button :class="{ active: lang === 'en' }" @click="setLang('en')">EN</button>
      <button :class="{ active: lang === 'th' }" @click="setLang('th')">ไทย</button>
    </div>
  </header>

  <div class="body">
    <div id="map" ref="mapEl" />

    <div class="toast" id="toast">
      <span class="k">{{ t('Tip', 'คลิก') }}</span>
      <span>{{ t('Click a country for its death toll & monitoring, or an AQI pin for a monitor', 'คลิกประเทศเพื่อดูจำนวนผู้เสียชีวิตและการตรวจวัด หรือคลิกหมุด AQI เพื่อดูเครื่องตรวจ') }}</span>
    </div>

    <aside class="panel filters" v-show="filtersOpen">
      <div class="fhead">
        <h3>{{ t('Filters', 'ตัวกรอง') }}</h3>
        <button class="x" @click="filtersOpen = false">×</button>
      </div>
      <div class="fbody">
        <div class="fgrp">
          <div class="flabel">{{ t('Monitor type', 'ประเภทเครื่อง') }}</div>
          <div class="opts">
            <label class="opt"><input type="checkbox" v-model="filterType.low_cost" /><span>{{ t('Low-cost', 'ราคาประหยัด (low-cost)') }}</span><span class="cnt">{{ cntLowCost }}</span></label>
            <label class="opt"><input type="checkbox" v-model="filterType.reference" /><span>{{ t('Reference', 'อ้างอิง (reference)') }}</span><span class="cnt">{{ cntReference }}</span></label>
          </div>
        </div>
        <div class="fgrp">
          <div class="flabel">{{ t('Manufacturer', 'ผู้ผลิต') }}</div>
          <div class="opts">
            <label class="opt" v-for="mf in manufacturers" :key="mf">
              <input type="checkbox" v-model="filterMfg[mf]" /><span>{{ mf }}</span><span class="cnt">{{ cntMfg(mf) }}</span>
            </label>
          </div>
        </div>
        <div class="fgrp">
          <div class="flabel">{{ t('Status', 'สถานะ') }}</div>
          <div class="opts">
            <label class="opt"><input type="checkbox" v-model="filterStatus.online" /><span>{{ t('Online', 'ออนไลน์') }}</span><span class="cnt">{{ cntOnline }}</span></label>
            <label class="opt"><input type="checkbox" v-model="filterStatus.offline" /><span>{{ t('Offline', 'ออฟไลน์') }}</span><span class="cnt">{{ cntOffline }}</span></label>
          </div>
        </div>
        <div class="fstat">
          <b>{{ visCount.toLocaleString() }}</b>
          <span>{{ t('monitors shown', 'เครื่องตรวจวัดที่แสดงอยู่') }}</span>
        </div>
      </div>
    </aside>

    <aside class="panel info" :class="{ show: infoOpen }">
      <div class="ihead">
        <button class="x" @click="closeInfo">×</button>
        <div class="flag">{{ infoFlag }}</div>
        <h2>{{ infoTitle }}</h2>
        <div class="bsrc">{{ infoSrc }}</div>
      </div>
      <div class="ibody" v-html="infoHtml" />
    </aside>

    <div class="panel legend">
      <div class="lt">{{ t('Deaths attributable to PM2.5 (per year)', 'ผู้เสียชีวิตจาก PM2.5 (ราย/ปี)') }}</div>
      <div class="dbk"><i style="background:#1f5c8b" /><span>0 – 20,600</span></div>
      <div class="dbk"><i style="background:#a8cce4" /><span>20,600 – 63,300</span></div>
      <div class="dbk"><i style="background:#d4a73c" /><span>63,300 – 147,100</span></div>
      <div class="dbk"><i style="background:#ec9a81" /><span>147,100 – 969,700</span></div>
      <div class="dbk"><i style="background:#cc4b3f" /><span>969,700 – 1,790,000</span></div>
      <div class="dbk"><i style="background:#c2c2c2" /><span>{{ t('No data', 'ไม่มีข้อมูล') }}</span></div>
      <div class="lt" style="margin-top:13px">{{ t('PM sensors · AQI colour', 'เซ็นเซอร์ PM · สีตาม AQI') }}</div>
      <div class="scale">
        <i style="background:#36A45C" /><i style="background:#E4BB36" /><i style="background:#E68A38" /><i style="background:#D8484A" /><i style="background:#8C56AE" /><i style="background:#7C3B3B" />
      </div>
      <div class="ends"><span>{{ t('Good', 'ดี') }}</span><span>{{ t('Hazard', 'อันตราย') }}</span></div>
    </div>

    <div class="countpill" v-html="pill" />

    <div class="story-dim" :class="{ on: story.active }" />
    <div class="story-cap" :class="{ on: story.active }">
      <div class="step">{{ story.label }}</div>
      <h2>{{ story.title }}</h2>
      <p>{{ story.body }}</p>
    </div>
    <div class="story-ctrl" :class="{ on: story.active }">
      <button @click="exitStory">{{ t('Exit', 'ออก') }}</button>
      <button class="solid" @click="nextStep">{{ story.step === STEPS.length - 1 ? t('Finish', 'จบ') : t('Next →', 'ถัดไป →') }}</button>
    </div>
  </div>
</template>
