import { CATEGORY_LABELS, Category } from '../types';
import { Router, RoadGraph } from './router';

interface Facility {
  id: number;
  category: Category;
  name: string;
  lat: number;
  lon: number;
  address: string;
  distanceM: number;
  source: string;
  updatedAt: string;
}

interface Rule {
  id: number;
  category: Category;
  ward: string;
  title: string;
  body: string;
  source: string;
  sourceUrl: string;
  updatedAt: string;
}

interface AskResponse {
  answer: string;
  location: { lat: number; lon: number; displayName: string };
  facilities: Record<'shopping' | 'medical' | 'transport' | 'disaster', Facility[]>;
  rules: Rule[];
  risk?: { town: string; collapseRank: number; fireRank: number; totalRank: number } | null;
  crime?: { town: string; totalCrimes: number; year: number } | null;
  question: string;
}

const CAT_COLORS: Record<Category, string> = {
  shopping: '#a8620c',
  medical: '#26547c',
  transport: '#2e6b4f',
  disaster: '#c53a1f',
};

const CAT_ORDER: Array<Exclude<Category, 'garbage'>> = ['transport', 'shopping', 'medical', 'disaster'];

const MARKER_COLORS: Record<Exclude<Category, 'garbage'>, string> = {
  shopping: '#a8620c',
  medical: '#26547c',
  transport: '#2e6b4f',
  disaster: '#c53a1f',
};

const MARKER_LABELS: Record<Exclude<Category, 'garbage'>, string> = {
  transport: '駅',
  shopping: '買',
  medical: '医',
  disaster: '避',
};

declare const L: any;

const form = document.getElementById('search-form') as HTMLFormElement;
const addressInput = document.getElementById('address') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const hintEl = document.getElementById('hint') as HTMLParagraphElement;
const appEl = document.querySelector<HTMLElement>('main.app') as HTMLElement;
const panel = document.getElementById('panel') as HTMLElement;
const panelTitle = document.getElementById('panel-title') as HTMLElement;
const panelCoords = document.getElementById('panel-coords') as HTMLElement;
const reportEl = document.getElementById('report') as HTMLElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatSend = document.getElementById('chat-send') as HTMLButtonElement;
const chatLog = document.getElementById('chat-log') as HTMLDivElement;
const chatEmpty = document.getElementById('chat-empty') as HTMLDivElement;
const chatSuggest = document.getElementById('chat-suggest') as HTMLDivElement;
const chatEl = document.getElementById('chat') as HTMLDivElement;
const evidenceList = document.getElementById('evidence-list') as HTMLUListElement;
const panelClose = document.getElementById('panel-close') as HTMLButtonElement;

let map: any;
let markerLayer: any;
let routeLayer: any;
let floodLayer: any;
let current: { lat: number; lon: number; name: string } | null = null;
let router: Router | null = null;
let activeLayer = 'all';
let statusTimer: number | undefined;

function setStatus(msg: string, isErr = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status show' + (isErr ? ' err' : '');
  window.clearTimeout(statusTimer);
  if (msg) statusTimer = window.setTimeout(() => statusEl.classList.remove('show'), 3500);
}

function escapeHtml(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

function focusFacility(name: string) {
  const f = facilityMarkers.find((x) => x.name === name);
  if (!f) return;
  // 選択ピンと施設の両方が見えるようフィット
  if (current) {
    const bounds = L.latLngBounds(
      [Math.min(current.lat, f.lat), Math.min(current.lon, f.lon)],
      [Math.max(current.lat, f.lat), Math.max(current.lon, f.lon)],
    );
    map.fitBounds(bounds.pad(0.3), { maxZoom: 18 });
  } else {
    map.setView([f.lat, f.lon], Math.max(map.getZoom(), 16));
  }
  f.marker.openPopup();
}

// アイコン/カードクリック時: その施設までの最短経路を単独で強調表示
function focusFacilityRoute(name: string, lat: number, lon: number) {
  if (!router || !current) {
    setStatus('道路データを読み込み中です。少し待ってからもう一度お試しください', true);
    return;
  }
  const r = router.route(current.lat, current.lon, lat, lon);
  if (!r) {
    setStatus('この施設までの経路が見つかりませんでした', true);
    return;
  }
  // 既存の経路を消して、この施設への経路だけを強調
  routeLayer.clearLayers();
  const slope = r.elevGainM > 0 ? ` 上り${Math.round(r.elevGainM)}m / 下り${Math.round(r.elevLossM)}m` : '';
  L.polyline(r.path, { className: 'route-line', color: 'var(--vermilion)', weight: 4, opacity: 0.95 })
    .addTo(routeLayer)
    .bindTooltip(`${escapeHtml(name)} まで ${fmtDist(r.distanceM)}${slope}`, { sticky: true });
  L.circleMarker([lat, lon], { className: 'route-end', radius: 5, color: 'var(--vermilion)' }).addTo(routeLayer);
  // 経路ライン全体と選択ピン・施設の両方が見えるようフィット
  const bounds = L.latLngBounds(
    [Math.min(current.lat, lat), Math.min(current.lon, lon)],
    [Math.max(current.lat, lat), Math.max(current.lon, lon)],
  );
  map.fitBounds(bounds.pad(0.25), { maxZoom: 18 });
  setStatus(`最短経路: ${name} まで ${fmtDist(r.distanceM)}${slope}`);
}

function openPanel(name: string, lat: number, lon: number) {
  panelTitle.textContent = name;
  panelCoords.textContent = `緯度 ${lat.toFixed(6)} / 経度 ${lon.toFixed(6)}`;
  panel.classList.add('open');
  panel.removeAttribute('inert');
  appEl.classList.add('panel-open'); // パネル分だけマップを詰める
  setTimeout(() => map.invalidateSize(), 350); // パネル展開後に地図リサイズ
}

function closePanel() {
  panel.classList.remove('open');
  panel.setAttribute('inert', '');
  appEl.classList.remove('panel-open'); // パネルを閉じるとマップが広がる
  setTimeout(() => map.invalidateSize(), 350);
}

// 新宿区の対象範囲（選択可能な範囲のフォールバック）
const WARD_BBOX = { south: 35.672, west: 139.665, north: 35.735, east: 139.755 };

let wardRing: Array<[number, number]> | null = null; // 行政境界の外環座標 [lon, lat]

function isInsideWard(lat: number, lon: number): boolean {
  // 境界ポリゴンがあれば点内判定、なければbboxで代用
  if (wardRing && wardRing.length > 3) return pointInPolygon(lat, lon, wardRing);
  return lat >= WARD_BBOX.south && lat <= WARD_BBOX.north && lon >= WARD_BBOX.west && lon <= WARD_BBOX.east;
}

// 点がポリゴン内にあるか（レイキャスティング）。ring は [lon, lat]
function pointInPolygon(lat: number, lon: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // [lon, lat]
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function initMap() {
  map = L.map('map', { zoomControl: true, minZoom: 13 }).setView([35.6902, 139.7008], 14);
  // パン制限: タイル収集範囲（新宿区周辺）外へは移動できないようにする
  map.setMaxBounds(L.latLngBounds([35.60, 139.60], [35.78, 139.82]));
  // 自前ホストしたタイルを使用（R2配信）。OSMタイルサーバーには依存しない
  L.tileLayer('/tiles/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  floodLayer = L.layerGroup().addTo(map);
  addBoundaryOverlay();
  map.on('click', (e: any) => {
    // 対象範囲外は選択しない
    if (!isInsideWard(e.latlng.lat, e.latlng.lng)) {
      setStatus('選択できるのは新宿区内です', true);
      return;
    }
    selectProperty('選択した地点（名称なし）', e.latlng.lat, e.latlng.lng);
  });
}

// 新宿区の外側（選択不可エリア）を赤い斜線ハッチで覆う
function addBoundaryOverlay() {
  // 赤ハッチパターン定義
  const pane = (map as any).getPane('overlayPane');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
  pattern.setAttribute('id', 'ward-hatch');
  pattern.setAttribute('width', '12');
  pattern.setAttribute('height', '12');
  pattern.setAttribute('patternTransform', 'rotate(45)');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', '0');
  line.setAttribute('y1', '0');
  line.setAttribute('x2', '0');
  line.setAttribute('y2', '12');
  line.setAttribute('stroke', 'rgba(216, 60, 40, 0.55)');
  line.setAttribute('stroke-width', '4');
  pattern.appendChild(line);
  defs.appendChild(pattern);
  svg.appendChild(defs);
  pane.appendChild(svg);

  // 外側広域（タイル収集範囲の外側まで覆う）と、内側＝新宿区（穴）
  const outer: Array<[number, number]> = [
    [35.50, 139.50],
    [35.50, 139.92],
    [35.92, 139.92],
    [35.92, 139.50],
  ];

  // 行政境界を取得し、ドーナツ型（外側広域・穴＝新宿区）で描画
  void fetch('/api/boundary')
    .then((r) => (r.ok ? r.json() : null))
    .then((geojson: any) => {
      const ring = geojson?.features?.[0]?.geometry?.coordinates?.[0];
      if (!ring || ring.length < 4) return;
      // 判定用: [lon, lat]
      wardRing = ring.map((c: [number, number]) => [c[0], c[1]] as [number, number]);
      // 描画用: [lat, lon]
      const leafletRing = ring.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
      // 穴付きポリゴン。fillRule: evenodd で確実に内側を切り抜く
      L.polygon([outer, leafletRing] as any, {
        className: 'ward-hatch',
        fillRule: 'evenodd' as any,
        interactive: false,
      }).addTo(map);
      // 新宿区の境界線
      L.polygon(leafletRing, {
        className: 'ward-boundary',
        interactive: false,
      }).addTo(map);
    })
    .catch(() => {
      wardRing = null;
    });
}

async function selectProperty(name: string, lat: number, lon: number) {
  current = { lat, lon, name };
  openPanel(name, lat, lon);
  hintEl.classList.add('hidden');

  // ピンを即時表示（ネットワーク待ちなし）
  markerLayer.clearLayers();
  routeLayer.clearLayers();
  floodLayer.clearLayers();
  L.marker([lat, lon], {
    icon: L.divIcon({
      className: '',
      html: '<div class="poi-marker sel">◆</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
  }).addTo(markerLayer).bindPopup('<b>選択した物件</b><br>' + escapeHtml(name));
  map.setView([lat, lon], Math.max(map.getZoom(), 15));

  reportEl.innerHTML = '<p style="color:var(--ink-dim);font-size:0.85rem">暮らしの事実を調べています…</p>';
  evidenceList.innerHTML = '';
  resetChat();
  // 逆ジオコーディングで住所を取得し、パネルタイトルを更新
  void fetch('/api/reverse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: unknown) => {
      const addr = (d as { address?: string } | null)?.address;
      if (addr) {
        current = { lat, lon, name: addr };
        panelTitle.textContent = addr;
      }
    })
    .catch(() => {
      // 逆ジオコーディング失敗時はクリック地点名のまま
    });
  // 物件レビューを並行取得（左上のレビューカードに表示）
  void loadReview(lat, lon);
  try {
    const data = await ask({ lat, lon });
    renderReport(data);
    renderMap(data);
    renderEvidence(data);
  } catch (e) {
    reportEl.innerHTML = '';
    setStatus(`データ取得に失敗: ${(e as Error).message}`, true);
  }
}

// 物件レビューAIの総評をパネル上部に表示する
async function loadReview(lat: number, lon: number) {
  const reviewCard = document.getElementById('review-card') as HTMLElement | null;
  if (!reviewCard) return;
  reviewCard.hidden = false;
  const body = reviewCard.querySelector('.review-body') as HTMLElement;
  const meta = reviewCard.querySelector('.review-meta') as HTMLElement | null;
  body.textContent = '物件レビューを生成中…';
  if (meta) meta.innerHTML = '';
  setReviewBusy(true); // レビュー完了まで質問不可
  try {
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
    });
    if (!res.ok) throw new Error('review failed');
    const data = (await res.json()) as {
      review?: string;
      facilities?: Record<string, Array<{ name: string; distanceM: number }>>;
    };
    // 改行で段落に分割して表示（途中で切れない・段落が読みやすい）
    body.innerHTML = (data.review || 'レビューを生成できませんでした')
      .split(/\n{2,}|\n/)
      .map((para) => `<p>${escapeHtml(para)}</p>`)
      .join('');
    // 最寄り駅の徒歩情報を付加
    const stations = data.facilities?.transport?.slice(0, 3) || [];
    if (meta && stations.length) {
      meta.innerHTML = stations
        .map((s) => {
          const min = Math.max(1, Math.round(s.distanceM / 80)); // 徒歩80m/分で概算
          return `<span class="review-meta-item">駅 ${escapeHtml(s.name)} まで徒歩${min}分（${fmtDist(s.distanceM)}）</span>`;
        })
        .join('');
    }
  } catch {
    body.textContent = '（レビューの生成に失敗しました。施設情報は下記をご覧ください）';
  } finally {
    setReviewBusy(false); // レビュー完了で質問可能に
  }
}

// レビュー生成中は質問UIを無効化
function setReviewBusy(busy: boolean) {
  chatInput.disabled = busy;
  chatSend.disabled = busy;
  chatSuggest.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.disabled = busy;
  });
  chatInput.placeholder = busy ? 'レビューを生成中です…' : 'この物件について質問…';
}

// チャットを初期状態に戻す
function resetChat() {
  chatHistory = [];
  chatEl.hidden = false;
  chatLog.innerHTML = '';
  chatEmpty.hidden = false;
  chatSuggest.hidden = false;
  chatInput.disabled = true;
  chatSend.disabled = true;
  chatInput.placeholder = '物件レビューを生成中です…';
  chatInput.value = '';
}

// 吹き出しメッセージを追加する
function appendMsg(role: 'user' | 'ai', text: string) {
  chatEmpty.hidden = true;
  chatSuggest.hidden = true; // 会話が始まったら提案チップを隠す
  const msg = document.createElement('div');
  msg.className = `msg ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? '私' : 'AI';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatLog.appendChild(msg);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// タイピングインジケーターを表示
function showTyping() {
  chatEmpty.hidden = true;
  const msg = document.createElement('div');
  msg.className = 'msg ai typing-msg';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = 'AI';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatLog.appendChild(msg);
  chatLog.scrollTop = chatLog.scrollHeight;
  return msg;
}

async function ask(body: {
  address?: string;
  lat?: number;
  lon?: number;
  question?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<AskResponse> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error || `エラー（HTTP ${res.status}）`);
  }
  return res.json();
}

function renderReport(data: AskResponse) {
  reportEl.innerHTML = '';
  const rulesByCat = new Map<string, Rule[]>();
  for (const r of data.rules) {
    if (!rulesByCat.has(r.category)) rulesByCat.set(r.category, []);
    rulesByCat.get(r.category)!.push(r);
  }

  const cards: Array<{ key: string; title: string; color: string }> = [
    { key: 'transport', title: '最寄り駅', color: CAT_COLORS.transport },
    { key: 'shopping', title: '買い物', color: CAT_COLORS.shopping },
    { key: 'medical', title: '医療', color: CAT_COLORS.medical },
    { key: 'disaster', title: '災害・避難', color: CAT_COLORS.disaster },
  ];

  for (const card of cards) {
    const el = document.createElement('article');
    el.className = 'rep';
    el.style.setProperty('--rc', card.color);
    let inner = `<div class="r-cat">${escapeHtml(card.title)}</div>`;

    {
      const key = card.key as Exclude<Category, 'garbage'>;
      const facs = data.facilities[key] || [];
      inner += facs.length
        ? facs.slice(0, 3).map((f) =>
            `<button type="button" class="r-fac" data-name="${escapeHtml(f.name)}" data-cat="${key}" data-lat="${f.lat}" data-lon="${f.lon}">${escapeHtml(f.name)} <span class="r-meta">${fmtDist(f.distanceM)}</span></button>`,
          ).join('') +
          `<span class="r-src">出典: ${escapeHtml(facs[0].source)}（${escapeHtml(facs[0].updatedAt)}）</span>`
        : '<div class="r-name">周辺に見つかりませんでした</div>';
      if (card.key === 'disaster' || card.key === 'medical') {
        const rules = rulesByCat.get(card.key) || [];
        if (rules.length) {
          inner += rules.slice(0, 1).map((r) =>
            `<div class="r-note">${escapeHtml(r.title)} — ${escapeHtml(r.body)}</div>` +
            `<span class="r-src">出典: <a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(r.source)}</a>（${escapeHtml(r.updatedAt)}）</span>`,
          ).join('');
        }
      }
      if (card.key === 'disaster') {
        inner += `<button type="button" class="r-flood">浸水想定区域を地図に表示</button>`;
      }
    }

    el.innerHTML = inner;
    el.querySelectorAll<HTMLButtonElement>('.r-flood').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        void toggleFlood();
      });
    });
    el.querySelectorAll<HTMLButtonElement>('.r-fac').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = btn.dataset.name || '';
        const cat = btn.dataset.cat as Category;
        const lat = Number(btn.dataset.lat);
        const lon = Number(btn.dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          focusFacilityRoute(name, lat, lon);
        } else {
          focusFacility(name);
        }
      });
    });
    reportEl.appendChild(el);
  }

// デメリット情報（地震危険度・犯罪件数）
// 危険度ランク1〜5を5段階のレベルバーで表示
function rankBar(rank: number): string {
  const filled = Math.min(5, Math.max(1, Math.round(rank)));
  let cells = '';
  for (let i = 1; i <= 5; i++) {
    cells += `<span class="risk-cell${i <= filled ? ' on' : ''}"></span>`;
  }
  return `<span class="risk-cells">${cells}</span><span class="risk-rank">${rank}</span>`;
}

const demeritCards: Array<{ title: string; color: string; html: string }> = [];
  if (data.risk) {
    demeritCards.push({
      title: '地震危険度',
      color: '#8d5a2a',
      html:
        `<div class="r-name">${escapeHtml(data.risk.town)}</div>` +
        `<div class="risk-meter">総合 ${rankBar(data.risk.totalRank)}</div>` +
        `<div class="risk-meter">倒壊 ${rankBar(data.risk.collapseRank)}</div>` +
        `<div class="risk-meter">火災 ${rankBar(data.risk.fireRank)}</div>` +
        `<div class="risk-scale">ランクは1（低い）〜5（高い）</div>` +
        `<span class="r-src">出典: 東京都 地震地域危険度調査（第9回）</span>`,
    });
  }
  if (data.crime) {
    demeritCards.push({
      title: '犯罪件数',
      color: '#8d2a2a',
      html:
        `<div class="r-name">${escapeHtml(data.crime.town)}</div>` +
        `<div class="r-note">${data.crime.year}年 認知件数 <b>${data.crime.totalCrimes}件</b></div>` +
        `<span class="r-src">出典: 警視庁 町丁字別犯罪情報</span>`,
    });
  }
  if (demeritCards.length) {
    const sec = document.createElement('div');
    sec.className = 'demerit-section';
    sec.innerHTML = '<div class="sec-head">住むうえでの留意点</div>';
    const grid = document.createElement('div');
    grid.className = 'report-grid';
    for (const d of demeritCards) {
      const el = document.createElement('article');
      el.className = 'rep demerit';
      el.style.setProperty('--rc', d.color);
      el.innerHTML = `<div class="r-cat">${escapeHtml(d.title)}</div>${d.html}`;
      grid.appendChild(el);
    }
    sec.appendChild(grid);
    reportEl.appendChild(sec);
  }
  // 坂道情報（drawRoutes後に反映される）
}

function renderEvidence(data: AskResponse) {
  evidenceList.innerHTML = '';
  const items: Array<{ cat: string; text: string; src?: string; url?: string; date: string }> = [];

  for (const key of CAT_ORDER) {
    for (const f of data.facilities[key] || []) {
      items.push({ cat: CATEGORY_LABELS[key], text: `${f.name}（${fmtDist(f.distanceM)}）`, src: f.source, date: f.updatedAt });
    }
  }
  for (const r of data.rules) {
    items.push({ cat: CATEGORY_LABELS[r.category] || r.category, text: `${r.title}: ${r.body}`, src: r.source, url: r.sourceUrl, date: r.updatedAt });
  }

  if (!items.length) {
    evidenceList.innerHTML = '<li><span class="ev-body">該当データがありません。</span></li>';
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    const srcLine = it.url
      ? `出典: <a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.src || '')}</a>（更新 ${escapeHtml(it.date)}）`
      : `出典: ${escapeHtml(it.src || '')}（更新 ${escapeHtml(it.date)}）`;
    li.innerHTML =
      `<span class="ev-cat">${escapeHtml(it.cat)}</span>` +
      `<div class="ev-body">${escapeHtml(it.text)}<div class="ev-src">${srcLine}</div></div>`;
    evidenceList.appendChild(li);
  }
}

let facilityMarkers: Array<{ lat: number; lon: number; marker: any; name: string; cat: string; elevGainM?: number; elevLossM?: number }> = [];

function renderMap(data: AskResponse) {
  markerLayer.clearLayers();
  facilityMarkers = [];
  const c = data.location;

  // 選択した物件地点
  L.marker([c.lat, c.lon], {
    icon: L.divIcon({
      className: '',
      html: '<div class="poi-marker sel">◆</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
  }).addTo(markerLayer).bindPopup('<b>選択した物件</b><br>' + escapeHtml(c.displayName));

  // アクティブレイヤーに応じてマーカーをフィルタ
  const showAll = activeLayer === 'all';
  for (const key of CAT_ORDER) {
    if (!showAll && key !== activeLayer) continue;
    for (const f of data.facilities[key] || []) {
      const marker = L.marker([f.lat, f.lon], {
        icon: L.divIcon({
          className: '',
          html: `<div class="poi-marker" style="background:${MARKER_COLORS[key]}">${MARKER_LABELS[key]}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      })
        .addTo(markerLayer)
        .bindTooltip(`${escapeHtml(f.name)}（${fmtDist(f.distanceM)}） — クリックで経路`, { sticky: true })
        .on('click', (e: any) => {
          L.DomEvent.stopPropagation(e);
          // アイコンクリック → その施設までの最短経路を表示
          if (!current) {
            setStatus('先に地図上の地点をクリックして物件を選択してください', true);
            return;
          }
          focusFacilityRoute(f.name, f.lat, f.lon);
        });
      facilityMarkers.push({ lat: f.lat, lon: f.lon, marker, name: f.name, cat: key });
    }
  }

  // 経路は自動描画しない（アイコン/カードクリック時のみ focusFacilityRoute で表示）

  if (c.lat && c.lon) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 15));
}

async function drawRoutes(data: AskResponse) {
  routeLayer.clearLayers();
  const c = data.location;
  if (!router || !current) return;

  const showAll = activeLayer === 'all';
  const targets: Array<{ lat: number; lon: number; name: string; cat: string }> = [];
  for (const key of CAT_ORDER) {
    if (!showAll && key !== activeLayer) continue;
    for (const f of data.facilities[key] || []) {
      targets.push({ lat: f.lat, lon: f.lon, name: f.name, cat: key });
    }
  }
  // 最寄り上位3件に経路を描画
  targets.sort((a, b) => {
    const da = haversine(c.lat, c.lon, a.lat, a.lon);
    const db = haversine(c.lat, c.lon, b.lat, b.lon);
    return da - db;
  });
  for (const t of targets.slice(0, 3)) {
    const r = router.route(c.lat, c.lon, t.lat, t.lon);
    if (!r) continue;
    const slope = r.elevGainM > 0
      ? ` 上り${Math.round(r.elevGainM)}m / 下り${Math.round(r.elevLossM)}m`
      : '';
    L.polyline(r.path, { className: 'route-line', color: 'var(--vermilion)', weight: 3, opacity: 0.85 })
      .addTo(routeLayer)
      .bindTooltip(`${t.cat} ${escapeHtml(t.name)} 経路 ${fmtDist(r.distanceM)}${slope}`, { sticky: true });
    L.circleMarker([t.lat, t.lon], { className: 'route-end', radius: 4, color: 'var(--vermilion)' }).addTo(routeLayer);
    // 施設カードの坂道情報に反映
    const fm = facilityMarkers.find((x) => x.name === t.name && x.cat === t.cat);
    if (fm) {
      fm.elevGainM = r.elevGainM;
      fm.elevLossM = r.elevLossM;
      if (r.elevGainM > 5) {
        const btn = reportEl.querySelector<HTMLButtonElement>(`.r-fac[data-name="${CSS.escape(t.name)}"]`);
        if (btn && !btn.querySelector('.r-slope')) {
          const span = document.createElement('span');
          span.className = 'r-slope';
          span.textContent = ` 坂道 上り${Math.round(r.elevGainM)}m`;
          btn.appendChild(span);
        }
      }
    }
  }
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const addr = addressInput.value.trim();
  if (!addr) return;
  const btn = form.querySelector('button');
  if (btn) btn.disabled = true;
  setStatus('住所を検索中…');
  try {
    const data = await ask({ address: addr });
    selectProperty(data.location.displayName, data.location.lat, data.location.lon);
    addressInput.value = '';
  } catch (err) {
    setStatus((err as Error).message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
});

// チャット送信
function sendQuestion() {
  const q = chatInput.value.trim();
  if (!q) return;
  if (!current) { setStatus('先に地図上の地点をクリックして物件を選択してください', true); return; }
  chatInput.value = '';
  void askReview(current.lat, current.lon, q);
}

document.querySelectorAll<HTMLButtonElement>('#chat-suggest button').forEach((b) => {
  b.addEventListener('click', () => {
    const q = b.dataset.q || '';
    if (!current) { setStatus('先に地図上の地点をクリックして物件を選択してください', true); return; }
    void askReview(current.lat, current.lon, q);
  });
});

chatSend.addEventListener('click', sendQuestion);
chatInput.addEventListener('keydown', (e) => {
  // 日本語IMEの変換確定（isComposing）や未確定入力中のEnterでは送信しない
  const isImeEnter = e.isComposing || e.keyCode === 229;
  if (e.key === 'Enter' && !e.shiftKey && !isImeEnter) {
    e.preventDefault();
    sendQuestion();
  }
});

let chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

async function askReview(lat: number, lon: number, q: string) {
  chatSend.disabled = true;
  chatInput.disabled = true;
  // ユーザーの質問を表示
  appendMsg('user', q);
  // タイピングインジケーター
  const typing = showTyping();
  try {
    const data = await ask({ lat, lon, question: q, history: chatHistory });
    typing.remove();
    // 会話履歴を更新
    chatHistory.push({ role: 'user', content: q });
    chatHistory.push({ role: 'assistant', content: data.answer });
    if (chatHistory.length > 8) chatHistory = chatHistory.slice(-8); // 直近4往復のみ保持
    appendMsg('ai', data.answer);
  } catch (e) {
    typing.remove();
    appendMsg('ai', `エラー: ${escapeHtml((e as Error).message)}`);
  } finally {
    chatSend.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
}

panelClose.addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});

let floodCells: Array<{ lat: number; lon: number; depth: number }> | null = null;
let floodShown = false;

// 洪水レイヤーを表示/非表示トグル（災害カードから呼ぶ）
async function toggleFlood() {
  if (floodShown) {
    floodLayer.clearLayers();
    floodShown = false;
    setStatus('浸水想定区域を非表示にしました');
    return;
  }
  if (!floodCells) {
    try {
      const res = await fetch('/api/flood');
      if (res.ok) floodCells = await res.json();
    } catch {
      floodCells = [];
    }
  }
  if (floodCells && floodCells.length) {
    drawFlood(floodCells);
    floodShown = true;
    setStatus('浸水想定区域を表示（外水・内水氾濫含む。出典: 東京都建設局 神田川流域浸水予想区域図）');
  } else {
    floodLayer.clearLayers();
    setStatus('浸水想定区域データがありません');
  }
  // ボタンの表示を更新
  document.querySelectorAll<HTMLButtonElement>('.r-flood').forEach((b) => {
    b.textContent = floodShown ? '浸水想定区域を非表示' : '浸水想定区域を地図に表示';
  });
}

// マーチングスクエアで浸水深の等高線ポリゴンをなめらかに描画する
function drawFlood(cells: Array<{ lat: number; lon: number; depth: number }>) {
  floodLayer.clearLayers();
  // グリッドへ展開
  const grid = new Map<string, number>();
  for (const c of cells) grid.set(`${c.lat},${c.lon}`, c.depth);
  const lats = [...new Set(cells.map((c) => c.lat))].sort((a, b) => a - b);
  const lons = [...new Set(cells.map((c) => c.lon))].sort((a, b) => a - b);
  const dLat = lats[1] - lats[0] || 0.001;
  const dLon = lons[1] - lons[0] || 0.001;

  // 閾値クラス: [下限, 色]
  const classes: Array<[number, string]> = [
    [0.5, 'rgba(224,182,77,0.5)'],
    [1.0, 'rgba(255,107,61,0.55)'],
    [2.0, 'rgba(216,74,31,0.6)'],
    [5.0, 'rgba(169,44,26,0.7)'],
  ];

  for (const [threshold, color] of classes) {
    const rings = marchingSquares(grid, lats, lons, dLat, dLon, threshold);
    for (const ring of rings) {
      if (ring.length < 3) continue;
      // 浸水区域はクリック不可（視覚表示のみ）
      L.polygon(ring, {
        color: 'rgba(169,44,26,0.5)',
        weight: 1,
        fillColor: color,
        fillOpacity: 1,
        className: 'flood-zone',
        interactive: false,
      }).addTo(floodLayer);
    }
  }
}

// 浸水区域の輪郭抽出: 閾値以上のセルの外周をなめらかなポリゴンにする
// 各セルは lat/lon を中心とする正方形。閾値以上のセルを連結し、
// その外縁の頂点列を返す。
// グリッド座標（整数インデックス）で計算し、最後に実座標へ変換して
// 浮動小数点誤差によるエッジ不一致を防ぐ。
function marchingSquares(
  grid: Map<string, number>,
  lats: number[],
  lons: number[],
  dLat: number,
  dLon: number,
  threshold: number,
): Array<Array<[number, number]>> {
  const ny = lats.length;
  const nx = lons.length;
  const above = (gi: number, gj: number): boolean => {
    if (gi < 0 || gi >= ny || gj < 0 || gj >= nx) return false;
    const v = grid.get(`${lats[gi]},${lons[gj]}`);
    return v !== undefined && v >= threshold;
  };

  // 閾値以上のセルのグリッド座標
  const cells: Array<[number, number]> = [];
  for (let gi = 0; gi < ny; gi++) {
    for (let gj = 0; gj < nx; gj++) {
      if (above(gi, gj)) cells.push([gi, gj]);
    }
  }
  if (!cells.length) return [];

  // 各セルの4辺のうち「外側」のエッジを収集。
  // エッジは整数グリッド角点 (i, j) のペアで表現（セル角のグリッド座標）。
  // セル(gi,gj)の角: 左下(gi,j), 右下(gi,j+1), 右上(gi+1,j+1), 左上(gi+1,j)
  const edges: Map<string, [[number, number], [number, number]]> = new Map();
  for (const [gi, gj] of cells) {
    // 4角点 (整数)
    const bl: [number, number] = [gi, gj];
    const br: [number, number] = [gi, gj + 1];
    const tr: [number, number] = [gi + 1, gj + 1];
    const tl: [number, number] = [gi + 1, gj];
    // 下・右・上・左（時計回り）
    if (!above(gi - 1, gj)) edges.set(`b${gi},${gj}`, [bl, br]);
    if (!above(gi, gj + 1)) edges.set(`r${gi},${gj}`, [br, tr]);
    if (!above(gi + 1, gj)) edges.set(`t${gi},${gj}`, [tr, tl]);
    if (!above(gi, gj - 1)) edges.set(`l${gi},${gj}`, [tl, bl]);
  }

  // エッジを連結してリング化（整数角点で一致判定）
  const rings: Array<Array<[number, number]>> = [];
  const unused = new Set(edges.keys());
  while (unused.size) {
    const startKey = unused.values().next().value as string;
    unused.delete(startKey);
    const ringInt: Array<[number, number]> = [];
    let cur = edges.get(startKey)!;
    ringInt.push(cur[0], cur[1]);
    let guard = 0;
    const guardMax = edges.size * 2;
    while (unused.size && guard < guardMax) {
      guard++;
      const tail = cur[1];
      let found = false;
      for (const key of unused) {
        const e = edges.get(key)!;
        if (e[0][0] === tail[0] && e[0][1] === tail[1]) {
          ringInt.push(e[1]);
          cur = e;
          unused.delete(key);
          found = true;
          break;
        } else if (e[1][0] === tail[0] && e[1][1] === tail[1]) {
          ringInt.push(e[0]);
          cur = [e[1], e[0]];
          unused.delete(key);
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    if (ringInt.length >= 4) {
      // 整数角点 → 実座標
      const ring = ringInt.map(([gi, gj]) => [latOf(lats, dLat, gi), lonOf(lons, dLon, gj)] as [number, number]);
      rings.push(smoothRing(ring, 3));
    }
  }
  return rings;
}

function latOf(lats: number[], dLat: number, gi: number): number {
  return lats[0] + gi * dLat - dLat * 0.5;
}
function lonOf(lons: number[], dLon: number, gj: number): number {
  return lons[0] + gj * dLon - dLon * 0.5;
}

function smoothRing(ring: Array<[number, number]>, iter = 2): Array<[number, number]> {
  let r = ring;
  for (let k = 0; k < iter; k++) {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < r.length; i++) {
      const prev = r[(i - 1 + r.length) % r.length];
      const cur = r[i];
      const next = r[(i + 1) % r.length];
      out.push([(prev[0] + cur[0] * 2 + next[0]) / 4, (prev[1] + cur[1] * 2 + next[1]) / 4]);
    }
    r = out;
  }
  return r;
}

async function loadRouter() {
  try {
    const res = await fetch('/api/roads');
    if (!res.ok) throw new Error('道路データ取得失敗');
    const graph = (await res.json()) as RoadGraph;
    router = new Router(graph);
    // ルーター準備後に、選択中の物件があれば経路を再描画
    if (current) {
      try {
        const data = await ask({ lat: current.lat, lon: current.lon });
        renderMap(data);
      } catch {
        // 無視
      }
    }
  } catch (e) {
    console.warn('道路データの読み込みに失敗:', e);
  }
}

initMap();
void loadRouter();

// 初回オンボーディング（一度だけ表示）
const onboard = document.getElementById('onboard') as HTMLElement | null;
const onboardClose = document.getElementById('onboard-close') as HTMLButtonElement | null;
if (onboard && onboardClose) {
  const onboarded = localStorage.getItem('odh-onboarded') === '1';
  if (onboarded) {
    onboard.setAttribute('hidden', '');
  } else {
    // 初回のみ表示し、閉じるまで保持
    onboard.removeAttribute('hidden');
    onboardClose.addEventListener('click', () => {
      onboard.setAttribute('hidden', '');
      localStorage.setItem('odh-onboarded', '1');
    });
  }
}
