// ==UserScript==
// @name         TW - Notas de Relatório (manual + massa + Supabase + Mapa)
// @namespace    http://tampermonkey.net/
// @version      1.4.2
// @description  Cria nota (xD) a partir do relatório; criação em massa na lista; salva/baixa do Supabase; marcações no mapa via IndexedDB.
// @author       você
// @match        *://*.tribalwars.com.br/game.php*screen=report*
// @match        *://*.tribalwars.com.br/game.php*screen=info_village*
// @match        *://*.tribalwars.com.br/game.php*screen=map*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ================== Config do Supabase (fixo, conforme você passou) ================== */
  const SUPABASE_URL = 'https://tyskmvymaxzrmpbxgstt.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_TNyjnoIDqUsEwGWGm-2Y-A_dGHC1zGu';
  const SUPABASE_TABLE = 'tw_notes_latest';
  const SUPABASE_INTEL_TABLE = 'tw_village_intel_latest';

  let INTEL_SELECT_FIELDS = [
  'world','x','y','share_tag',
  'updated_at','created_by','source',
  'village_type','pop_survivors',
  'wall_level','watchtower_level','church_level','first_church'
];

// Flags para compatibilidade: se alguma coluna não existir, removemos dinamicamente após erro 400 (PGRST204).
let SUPABASE_HAS_POP = true;
  function sbSelectFields() {
    return SUPABASE_HAS_POP
      ? 'world,x,y,updated_at,note_text,pop_survivors'
      : 'world,x,y,updated_at,note_text';
  }
  const MASS_DELAY_MS = 600;

  /* ================== Utils / LS ================== */
  const LS = {
    prefix() { return `an_tw_notes_${getWorld()}`; },
    key(k) { return `${this.prefix()}_${k}`; },
    get(k, def = null) {
      const v = localStorage.getItem(this.key(k));
      return v === null ? def : v;
    },
    set(k, v) { localStorage.setItem(this.key(k), String(v)); },
    del(k) { localStorage.removeItem(this.key(k)); }
  };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function toast(msg, isError = false) {
    try {
      if (window.UI?.ErrorMessage && isError) return UI.ErrorMessage(msg, 3500);
      if (window.UI?.SuccessMessage && !isError) return UI.SuccessMessage(msg, 2500);
    } catch {}
    alert(msg);
  }

  function getWorld() {
    try {
      if (window.game_data?.world) return String(game_data.world);
    } catch {}
    // fallback: br135.tribalwars.com.br -> br135
    try { return location.hostname.split('.')[0]; } catch { return 'world'; }
  }

  function isScreen(name) {
    try { return new URL(location.href).searchParams.get('screen') === name; } catch { return false; }
  }

  function getCSRF() {
    try { return game_data.csrf; } catch { return null; }
  }

  function getClientTime() {
    try { return Math.round(Timing.getCurrentServerTime() / 1000); } catch { return Math.round(Date.now() / 1000); }
  }

  function isSitter() {
    try { return String(game_data.player?.sitter || '0') !== '0'; } catch { return false; }
  }

  function currentPlayerName() {
    try { return String(game_data.player?.name || ''); } catch { return ''; }
  }

  function getFarmWeights(archerActive) {
    return archerActive ? [1,1,1,1,2,4,5,6,5,8] : [1,1,1,2,4,6,5,8];
  }

  function getArcherActiveFromGameData() {
    try { return Array.isArray(game_data.units) && game_data.units.includes('archer'); } catch { return false; }
  }

  function sumPop(unitsArr, weights) {
    if (!unitsArr || !unitsArr.length) return 0;
    let total = 0;
    for (let i = 0; i < unitsArr.length; i++) total += (unitsArr[i] || 0) * (weights[i] || 1);
    return total;
  }

  /* ================== Share Tag (por mundo) ================== */
  function getShareTag() {
    return LS.get('share_tag', '');
  }
  function setShareTag(v) {
    LS.set('share_tag', (v || '').trim());
  }

  /* ================== Supabase REST helpers ================== */
  async function sbFetch(path, opts = {}) {
    const url = `${SUPABASE_URL}${path}`;
    const headers = Object.assign({
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }, opts.headers || {});
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err = new Error(`Supabase ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function sbUpsertLatest({ world, x, y, share_tag, created_by, source, note_text, pop_survivors }) {
    // Tenta com pop_survivors; se a coluna não existir ainda, tenta sem.
    const payload = {
      world, x, y, share_tag,
      created_by, source,
      note_text,
      updated_at: new Date().toISOString(),
      pop_survivors
    };
    const path = `/rest/v1/${SUPABASE_TABLE}?on_conflict=world,x,y,share_tag`;
    const headers = { 'Prefer': 'resolution=merge-duplicates,return=representation' };

    try {
      return await sbFetch(path, { method: 'POST', headers, body: JSON.stringify(payload) });
    } catch (e) {
      const msg = String(e?.data || e?.message || '');
      if (msg.toLowerCase().includes('pop_survivors') || msg.toLowerCase().includes('column')) {
        const payload2 = { ...payload };
        delete payload2.pop_survivors;
        return await sbFetch(path, { method: 'POST', headers, body: JSON.stringify(payload2) });
      }
      throw e;
    }
  }

  
async function sbUpsertIntelLatest({ world, x, y, share_tag, created_by, source, village_type, pop_survivors, wall_level, watchtower_level, church_level, first_church }) {
  // Upsert para tabela de "intel" (leve, para o mapa)
  let payload = {
    world, x, y, share_tag,
    created_by, source,
    village_type: (village_type ?? PT.unknown),
    pop_survivors: pop_survivors ?? 0,
    wall_level: wall_level ?? null,
    watchtower_level: watchtower_level ?? null,
    church_level: church_level ?? null,
    first_church: first_church ?? null,
    updated_at: new Date().toISOString()
  };

  const path = `/rest/v1/${SUPABASE_INTEL_TABLE}?on_conflict=world,x,y,share_tag`;
  const headers = { 'Prefer': 'resolution=merge-duplicates,return=representation' };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await sbFetch(path, { method: 'POST', headers, body: JSON.stringify(payload) });
    } catch (e) {
      const msg = String(e?.data || e?.message || '');
      const mcol = msg.match(/Could not find the '([^']+)' column/i);
      if (mcol && mcol[1]) {
        const missing = mcol[1];
        // Remove campo inexistente e tenta novamente (schema ainda não tem a coluna)
        delete payload[missing];
        INTEL_SELECT_FIELDS = INTEL_SELECT_FIELDS.filter(f => f !== missing);
        continue;
      }
      // fallback antigo: coluna pop_survivors pode não existir
      if (msg.toLowerCase().includes('pop_survivors')) {
        delete payload.pop_survivors;
        INTEL_SELECT_FIELDS = INTEL_SELECT_FIELDS.filter(f => f !== 'pop_survivors');
        continue;
      }
      throw e;
    }
  }
  return null;
}

async function sbFetchAllIntelLatest({ world, share_tag, pageSize = 1000 }) {
  // Paginação por offset/limit. Também faz fallback se o schema cache do Supabase ainda não "enxergou" alguma coluna.
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({
      world: `eq.${world}`,
      share_tag: `eq.${share_tag}`,
      select: INTEL_SELECT_FIELDS.join(','),
      limit: String(pageSize),
      offset: String(offset)
    });

    let chunk;
    try {
      chunk = await sbFetch(`/rest/v1/${SUPABASE_INTEL_TABLE}?${q.toString()}`, { method: 'GET' });
    } catch (e) {
      const msg = String(e?.data || e?.message || '');
      const mcol = msg.match(/Could not find the '([^']+)' column/i);
      if (mcol && mcol[1]) {
        const missing = mcol[1];
        INTEL_SELECT_FIELDS = INTEL_SELECT_FIELDS.filter(f => f !== missing);
        q.set('select', INTEL_SELECT_FIELDS.join(','));
        chunk = await sbFetch(`/rest/v1/${SUPABASE_INTEL_TABLE}?${q.toString()}`, { method: 'GET' });
      } else {
        throw e;
      }
    }

    if (!Array.isArray(chunk)) throw new Error('Supabase retornou formato inesperado (intel)');
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}

async function sbGetLatest({ world, x, y, share_tag }) {
    const q = new URLSearchParams({
      world: `eq.${world}`,
      x: `eq.${x}`,
      y: `eq.${y}`,
      share_tag: `eq.${share_tag}`,
      select: sbSelectFields()
    });
    let rows;
    try {
      rows = await sbFetch(`/rest/v1/${SUPABASE_TABLE}?${q.toString()}`, { method: 'GET' });
    } catch (e) {
      const msg = String(e?.data || e?.message || '');
      if (SUPABASE_HAS_POP && msg.includes('pop_survivors') && msg.includes('does not exist')) {
        SUPABASE_HAS_POP = false;
        q.set('select', sbSelectFields());
        rows = await sbFetch(`/rest/v1/${SUPABASE_TABLE}?${q.toString()}`, { method: 'GET' });
      } else {
        throw e;
      }
    }
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function sbFetchAllLatest({ world, share_tag, pageSize = 1000 }) {
  // Paginação por offset/limit (mais compatível que Range)
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({
      world: `eq.${world}`,
      share_tag: `eq.${share_tag}`,
      select: sbSelectFields(),
      limit: String(pageSize),
      offset: String(offset)
    });

    let chunk;
    try {
      chunk = await sbFetch(`/rest/v1/${SUPABASE_TABLE}?${q.toString()}`, { method: 'GET' });
    } catch (e) {
      const msg = String(e?.data || e?.message || '');
      if (SUPABASE_HAS_POP && msg.includes('pop_survivors') && msg.includes('does not exist')) {
        SUPABASE_HAS_POP = false;
        // Recria query sem a coluna
        q.set('select', sbSelectFields());
        chunk = await sbFetch(`/rest/v1/${SUPABASE_TABLE}?${q.toString()}`, { method: 'GET' });
      } else {
        throw e;
      }
    }
    if (!Array.isArray(chunk)) throw new Error('Supabase retornou formato inesperado');
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}

  /* ================== Parse do relatório (baseado no original que você passou) ================== */

  function parseUnitsRow(doc, selector, len) {
    const nodes = doc.querySelectorAll(selector);
    if (!nodes || !nodes.length) return null;
    const arr = new Array(len).fill(0);
    nodes.forEach((td, idx) => {
      if (idx >= len) return;
      const n = parseInt((td.textContent || '0').replace(/\D+/g, ''), 10);
      arr[idx] = isNaN(n) ? 0 : n;
    });
    return arr;
  }

  function parseBuildingsFromDoc(doc) {
    const res = {
      buildingsVisible: false,
      watchtower: { ok: false, lvl: 0 },
      wall: { ok: false, lvl: 0 },
      church_f: { ok: false, lvl: 0 },
      church: { ok: false, lvl: 0 }
    };

    const any = doc.querySelector("table[id^='attack_spy_buildings_']");
    if (!any) return res;

    const imgs = doc.querySelectorAll("table[id^='attack_spy_buildings_'] img");
    if (!imgs.length) return res;

    res.buildingsVisible = true;

    imgs.forEach(img => {
      const src = img.getAttribute('src') || '';
      const m = src.match(/graphic\/buildings\/([^\/]+)\.(png|webp)/i) || src.match(/\/([^\/]+)\.(png|webp)$/i);
      const key = (m && m[1]) ? m[1] : '';

      let lvl = 0;
      try {
        const tr = img.closest('tr');
        const tds = tr ? tr.querySelectorAll('td') : null;
        if (tds && tds.length >= 2) {
          const n = parseInt((tds[1].textContent || '0').replace(/\D+/g, ''), 10);
          lvl = isNaN(n) ? 0 : n;
        }
      } catch {}

      if (key === 'watchtower') res.watchtower = { ok: true, lvl };
      if (key === 'wall') res.wall = { ok: true, lvl };
      if (key === 'church_f') res.church_f = { ok: true, lvl };
      if (key === 'church') res.church = { ok: true, lvl };
    });

    return res;
  }

  function computeVillageTypeFromTroops(insideVisible, insideOff, insideDef, awayVisible, awayOff, awayDef) {
    // bem próximo da lógica do original:
    let tipo = PT.unknown;
    let apoios = 0;

    if (insideVisible) {
      if (insideOff > 3000) tipo = PT.offensive;
      else if (insideOff > 500) tipo = PT.probOffensive;
      else if (insideDef > 1000) tipo = PT.defensive;
      else if (insideDef > 500) tipo = PT.probDefensive;
      apoios = Math.round((insideDef / 20000) * 10) / 10;
    } else {
      tipo = PT.noSurvivors;
    }

    if (awayVisible) {
      // o original considera o "fora" também
      if (awayOff > 3000) tipo = PT.offensive;
      else if (awayOff > 1000) tipo = PT.probOffensive;
      else if (awayDef > 1000) tipo = PT.defensive;
      else if (awayDef > 500) tipo = PT.probDefensive;
      else if ((awayDef + awayOff) > 1000) {
        tipo = (awayOff > awayDef) ? PT.probOffensive : PT.probDefensive;
      }
      apoios += Math.round((awayDef / 20000) * 10) / 10;
    }

    return { tipo, apoios };
  }

  function extractReportHeaderLine(doc) {
    const title = doc.querySelector('.report-title .quickedit-label')?.textContent?.trim();
    if (title) return title;
    const h2 = doc.querySelector('#content_value h2')?.textContent?.trim();
    return h2 || '';
  }

  function extractVillageIdsAndPlayers(doc) {
    function findVillageId(containerSelector) {
      const container = doc.querySelector(containerSelector);
      if (!container) return null;
      const a = container.querySelector('a[href*="screen=info_village"]');
      if (!a) return null;
      const u = new URL(a.getAttribute('href'), location.origin);
      return u.searchParams.get('id') || null;
    }
    function findPlayerName(containerSelector) {
      const container = doc.querySelector(containerSelector);
      if (!container) return '';
      const a = container.querySelector('tbody tr:nth-child(1) th:nth-child(2) a') || container.querySelector('a');
      return (a?.textContent || '').trim();
    }
    function findVillageCoords(containerSelector) {
      const container = doc.querySelector(containerSelector);
      if (!container) return null;
      const txt = container.textContent || '';
      const m = txt.match(/(\d{1,3})\|(\d{1,3})/);
      if (!m) return null;
      return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
    }

    return {
      attackerVillageId: findVillageId('#attack_info_att'),
      defenderVillageId: findVillageId('#attack_info_def'),
      attackerName: findPlayerName('#attack_info_att'),
      defenderName: findPlayerName('#attack_info_def'),
      attackerCoords: findVillageCoords('#attack_info_att'),
      defenderCoords: findVillageCoords('#attack_info_def')
    };
  }

  function sumOffDef(unitsArr, weights, archerActive, side /* "att"|"def" */) {
    // igual ao que estava no seu script anterior (aprox fiel ao original)
    let off = 0, def = 0;
    for (let i = 0; i < unitsArr.length; i++) {
      const s = unitsArr[i] || 0;
      const w = weights[i] || 1;

      if (archerActive) {
        const offIdxDef = new Set([2,5,6,8]);
        const offIdxAtt = new Set([2,5,6]);
        if (side === 'def') {
          if (offIdxDef.has(i)) off += s * w;
          else def += s * w;
        } else {
          if (offIdxAtt.has(i)) off += s * w;
          else def += s * w;
        }
      } else {
        const offIdx = new Set([2,4,6]);
        if (offIdx.has(i)) off += s * w;
        else def += s * w;
      }
    }
    return { off, def };
  }

  function extractFullReportData(doc) {
    const bbcode = (doc.querySelector('#report_export_code')?.textContent || '').trim();
    const headerLine = extractReportHeaderLine(doc);

    const { attackerVillageId, defenderVillageId, attackerName, defenderName, attackerCoords, defenderCoords } = extractVillageIdsAndPlayers(doc);

    const archerActive = getArcherActiveFromGameData();
    const weights = getFarmWeights(archerActive);
    const len = archerActive ? 10 : 8;

    const defInside = parseUnitsRow(doc, "#attack_info_def_units td.unit-item", len);
    const attTroops = parseUnitsRow(doc, "#attack_info_att_units td.unit-item", len);

    const defInsideVisible = !!(defInside && defInside.some(x => x > 0));
    const attVisible = !!(attTroops && attTroops.some(x => x > 0));

    const defInsideSum = defInside ? sumOffDef(defInside, weights, archerActive, 'def') : { off: 0, def: 0 };
    const attSum = attTroops ? sumOffDef(attTroops, weights, archerActive, 'att') : { off: 0, def: 0 };

    const defAway = parseUnitsRow(doc, "#attack_spy_away td table tbody tr:nth-child(2) td", len);
    const defAwayVisible = !!(doc.querySelector("#attack_spy_away") && defAway && defAway.some(x => x > 0));
    const defAwaySum = defAway ? sumOffDef(defAway, weights, archerActive, 'def') : { off: 0, def: 0 };

    const buildings = parseBuildingsFromDoc(doc);

    const tipoDef = computeVillageTypeFromTroops(defInsideVisible, defInsideSum.off, defInsideSum.def, defAwayVisible, defAwaySum.off, defAwaySum.def);
    const tipoAtt = (attVisible
      ? (attSum.off > attSum.def ? { tipo: PT.offensive, apoios: 0 } : { tipo: PT.defensive, apoios: 0 })
      : { tipo: PT.unknown, apoios: 0 }
    );

    // quem sou eu nessa batalha?
    const me = currentPlayerName();
    const playerEstaDefender = defenderName === me;
    const playerEstaAtacar = attackerName === me;

    // pop de sobreviventes (para o lado defensor, somar dentro + fora; para atacante, só dentro)
    const popAtt = sumPop(attTroops, weights);
    const popDef = sumPop(defInside, weights) + sumPop(defAway, weights);

    return {
      bbcode,
      headerLine,
      attackerVillageId,
      defenderVillageId,
      attackerName,
      defenderName,
      attackerCoords,
      defenderCoords,
      playerEstaAtacar,
      playerEstaDefender,
      tipoDef,
      tipoAtt,
      buildings,
      popAtt,
      popDef
    };
  }

  function buildRichNoteText(data, chosen /* 'attacker'|'defender' */) {
    // Texto parecido ao original: tipo, buildings, apoios, header e report_export.
    const isDef = chosen === 'defender';
    const tipo = isDef ? data.tipoDef.tipo : data.tipoAtt.tipo;

    const color = (tipo === PT.offensive || tipo === PT.probOffensive) ? 'ff0000' : '0eae0e';
    let s = '';
    s += ` | [color=#${color}][b]${tipo}[/b][/color] | `;

    if (isDef) {
      if (data.buildings?.watchtower?.ok) s += `[building]watchtower[/building] ${PT.watchtower}${data.buildings.watchtower.lvl} | `;
      if (data.buildings?.wall?.ok) s += `[building]wall[/building][color=#5c3600][b] ${PT.wall}${data.buildings.wall.lvl}[/b][/color] | `;
      if (data.buildings?.church_f?.ok) s += `[building]church_f[/building] ${PT.firstChurch} | `;
      if (data.buildings?.church?.ok) s += `[building]church[/building] ${PT.church} ${data.buildings.church.lvl} | `;

      // apoios só faz sentido no defensor e quando não é ofensiva
      if (data.tipoDef && data.tipoDef.apoios && tipo !== PT.offensive && tipo !== PT.probOffensive && (data.tipoDef.tipo === PT.defensive || data.tipoDef.tipo === PT.probDefensive)) {
        s += `${data.tipoDef.apoios}${PT.defensiveNukes} | `;
      }
    }

    s += `[b][size=6]xD[/size][/b]`;
    s += `\n\n[b]${data.headerLine || 'Relatório'}[/b]\n`;
    s += `${data.bbcode}`;
    return s;
  }

  /* ================== Decide onde salvar (próprio vs encaminhado) ================== */
  function decideTargetVillage(data, forwardedTarget /* attacker|defender */) {
    // 1) se eu sou atacante -> salva no defensor (igual script original)
    // 2) se eu sou defensor -> salva no atacante
    // 3) se não sou nenhum -> é encaminhado -> usa dropdown
    if (data.playerEstaAtacar) return { mode: 'own', chosen: 'defender', villageId: data.defenderVillageId };
    if (data.playerEstaDefender) return { mode: 'own', chosen: 'attacker', villageId: data.attackerVillageId };
    // encaminhado
    const chosen = forwardedTarget === 'attacker' ? 'attacker' : 'defender';
    return { mode: 'forwarded', chosen, villageId: chosen === 'attacker' ? data.attackerVillageId : data.defenderVillageId };
  }

  function coordsForChosen(data, chosen) {
    return chosen === 'attacker' ? data.attackerCoords : data.defenderCoords;
  }

  function popForChosen(data, chosen) {
    return chosen === 'attacker' ? data.popAtt : data.popDef;
  }

  /* ================== Post note no TW + salvar no Supabase ================== */
  async function postVillageNote({ villageId, noteText }) {
    const h = getCSRF();
    if (!h) throw new Error('csrf não encontrado');
    const base = `https://${location.hostname}/game.php?village=${game_data.village.id}&screen=api&ajaxaction=village_note_edit`;

    const url = isSitter()
      ? `${base}&t=${game_data.player.id}`
      : `${base}&h=${h}&client_time=${getClientTime()}`;

    return new Promise((resolve, reject) => {
      $.post(url, { note: noteText, village_id: villageId, h }, () => resolve(true)).fail((xhr) => reject(xhr));
    });
  }

  
async function saveAlsoToSupabase({ chosen, coords, noteText, source, pop_survivors, village_type, buildings }) {
  const share_tag = getShareTag();
  if (!share_tag) {
    console.warn('[Supabase] share_tag vazio: não salvou.');
    return;
  }
  if (!coords) {
    console.warn('[Supabase] coords não encontradas: não salvou.');
    return;
  }
  const world = getWorld();
  const created_by = currentPlayerName() || 'unknown';

  // 1) Nota completa
  const payloadNote = {
    world,
    x: coords.x,
    y: coords.y,
    share_tag,
    created_by,
    source,
    note_text: noteText,
    pop_survivors
  };

  // 2) Intel leve (para o mapa)
  const payloadIntel = {
    world,
    x: coords.x,
    y: coords.y,
    share_tag,
    created_by,
    source,
    village_type: village_type || PT.unknown,
    pop_survivors: pop_survivors ?? 0,
    wall_level: buildings?.wall?.ok ? buildings.wall.lvl : null,
    watchtower_level: buildings?.watchtower?.ok ? buildings.watchtower.lvl : null,
    church_level: buildings?.church?.ok ? buildings.church.lvl : null,
    first_church: buildings?.church_f?.ok ? true : false
  };

  try {
    await sbUpsertLatest(payloadNote);
  } catch (e) {
    console.warn('[Supabase] erro upsert notes', e);
  }

  try {
    await sbUpsertIntelLatest(payloadIntel);
  } catch (e) {
    console.warn('[Supabase] erro upsert intel (tw_village_intel_latest)', e);
  }
}

/* ================== Fetch documento relatório (via iframe invisível / fetch) ================== */
  async function fetchReportDocument(url) {
    // usar fetch direto (funciona mesmo com X-Frame-Options estranho)
    const res = await fetch(url, { credentials: 'include' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc;
  }

  /* ================== UI: botão no relatório (view=) ================== */
  function injectSingleReportButton() {
    const h2 = document.querySelector('#content_value h2');
    if (!h2) return;

    if (document.getElementById('btn_create_note_xd')) return;

    const btn = document.createElement('button');
    btn.id = 'btn_create_note_xd';
    btn.className = 'btn btn-confirm-yes';
    btn.textContent = '☣️ Criar nota ☣️';
    btn.style.marginLeft = '10px';
    btn.style.verticalAlign = 'middle';

    // coloca ao lado do h2 (mesma linha)
    h2.style.display = 'inline-block';
    h2.parentElement?.insertBefore(btn, h2.nextSibling);

    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      try {
        const doc = document;
        const data = extractFullReportData(doc);
        if (!data.bbcode) return toast('Este relatório não tem export BBCode.', true);

        // se for encaminhado, perguntar
        let forwardedTarget = 'defender';
        const decision = decideTargetVillage(data, forwardedTarget);
        let chosen = decision.chosen;

        if (decision.mode === 'forwarded') {
          const html = `
            <div class="center" style="margin:6px 0;">Guardar nota na aldeia do:</div>
            <div class="center" style="display:flex; gap:8px; justify-content:center;">
              <button class="btn btn-confirm-yes" id="an_pick_att">Atacante</button>
              <button class="btn btn-confirm-yes" id="an_pick_def">Defensor</button>
            </div>`;
          Dialog.show('an_pick_target', html);
          chosen = await new Promise((resolve) => {
            document.getElementById('an_pick_att')?.addEventListener('click', () => { Dialog.close(); resolve('attacker'); });
            document.getElementById('an_pick_def')?.addEventListener('click', () => { Dialog.close(); resolve('defender'); });
          });
        }

        const noteText = buildRichNoteText(data, chosen);
        const villageId = chosen === 'attacker' ? data.attackerVillageId : data.defenderVillageId;

        await postVillageNote({ villageId, noteText });
        toast('Nota criada ✅');

        // salva no supabase
        await saveAlsoToSupabase({chosen,
          coords: coordsForChosen(data, chosen),
          noteText,
          source: 'manual',
          pop_survivors: popForChosen(data, chosen)
        ,
          village_type: (chosen === 'defender' ? data.tipoDef.tipo : data.tipoAtt.tipo),
          buildings: data.buildings});
} catch (e) {
        console.warn(e);
        toast('Erro ao criar nota.', true);
      }
    });
  }

  /* ================== UI: lista de relatórios (screen=report&mode=...) ================== */

  function getSelectedReportLinksFromList() {
    // IMPORTANT: usar checkbox original da primeira coluna (name="id_xxx")
    const rows = Array.from(document.querySelectorAll('tr[class*="report-"]'));
    const selected = [];
    for (const tr of rows) {
      const cb = tr.querySelector('td:first-child input[type="checkbox"][name^="id_"]');
      if (cb && cb.checked) {
        const a = tr.querySelector('a.report-link[href*="view="]');
        if (a) selected.push(new URL(a.getAttribute('href'), location.origin).toString());
      }
    }
    // processar de baixo para cima (mais novo por último, para sobrescrever no DB)
    return selected.reverse();
  }

  function ensureHeaderControls() {
    // achar TH "Assunto"
    const ths = Array.from(document.querySelectorAll('table.vis tr th'));
    const subjectTh = ths.find(th => (th.textContent || '').trim() === 'Assunto');
    if (!subjectTh) return;

    if (document.getElementById('btn_mass_notes')) return;

    // manter aparência original: NÃO mexer no th display, só inserir um wrapper inline
    const wrap = document.createElement('span');
    wrap.id = 'an_mass_wrap';
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    wrap.style.marginLeft = '10px';

    const btn = document.createElement('button');
    btn.id = 'btn_mass_notes';
    btn.className = 'btn btn-confirm-yes';
    btn.style.whiteSpace = 'nowrap';
    btn.textContent = '☣️ Criar notas em massa ☣️';

    const gear = document.createElement('a');
    gear.href = 'javascript:void(0)';
    gear.id = 'an_sharetag_gear';
    gear.textContent = '⚙️';
    gear.style.fontSize = '16px';
    gear.style.textDecoration = 'none';
    gear.title = 'Configurar Share Tag (por mundo)';

    const label = document.createElement('span');
    label.textContent = 'Guardar notas na aldeia do >';
    label.style.whiteSpace = 'nowrap';

    const sel = document.createElement('select');
    sel.id = 'mass_target_select';
    sel.style.padding = '2px 6px';
    sel.style.fontSize = '12px';
    sel.innerHTML = `
      <option value="attacker">atacante</option>
      <option value="defender">defensor</option>
    `;

    // progresso + status
    const prog = document.createElement('span');
    prog.id = 'an_mass_progress';
    prog.style.display = 'inline-flex';
    prog.style.alignItems = 'center';
    prog.style.gap = '6px';
    prog.style.minWidth = '180px';

    const barWrap = document.createElement('span');
    barWrap.style.width = '90px';
    barWrap.style.height = '10px';
    barWrap.style.border = '1px solid #7d510f';
    barWrap.style.background = '#f4e4bc';
    barWrap.style.position = 'relative';
    barWrap.style.borderRadius = '2px';
    barWrap.style.overflow = 'hidden';

    const bar = document.createElement('span');
    bar.id = 'an_mass_bar';
    bar.style.display = 'block';
    bar.style.height = '100%';
    bar.style.width = '0%';
    bar.style.background = '#0eae0e';

    barWrap.appendChild(bar);

    const counter = document.createElement('span');
    counter.id = 'an_mass_counter';
    counter.style.whiteSpace = 'nowrap';
    counter.textContent = '0/0';

    const status = document.createElement('span');
    status.id = 'an_mass_status';
    status.style.whiteSpace = 'nowrap';
    status.style.maxWidth = '260px';
    status.style.overflow = 'hidden';
    status.style.textOverflow = 'ellipsis';

    prog.appendChild(barWrap);
    prog.appendChild(counter);
    prog.appendChild(status);

    // ações: fixar no fim, mas com margem antes do final
    const actions = document.createElement('span');
    actions.id = 'an_mass_actions';
    actions.style.display = 'inline-flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '6px';
    actions.style.marginLeft = 'auto';
    actions.style.paddingRight = '16px'; // pequeno espaço antes do final
    actions.style.whiteSpace = 'nowrap';

    const btnPause = document.createElement('button');
    btnPause.id = 'an_mass_pause';
    btnPause.className = 'btn';
    btnPause.textContent = '⏸ Pausar';

    const btnStop = document.createElement('button');
    btnStop.id = 'an_mass_stop';
    btnStop.className = 'btn';
    btnStop.textContent = '⏹ Parar';

    // wrapper principal ocupa a linha toda (sem quebrar fundo do header)
    const rowWrap = document.createElement('div');
    rowWrap.id = 'an_mass_rowwrap';
    rowWrap.style.display = 'flex';
    rowWrap.style.alignItems = 'center';
    rowWrap.style.gap = '10px';
    rowWrap.style.width = '100%';

    const left = document.createElement('span');
    left.style.display = 'inline-flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';

    left.appendChild(btn);
    left.appendChild(gear);
    left.appendChild(label);
    left.appendChild(sel);
    left.appendChild(prog);

    actions.appendChild(btnPause);
    actions.appendChild(btnStop);

    rowWrap.appendChild(left);
    rowWrap.appendChild(actions);

    // coloca dentro do TH
    subjectTh.appendChild(rowWrap);

    // restore seleção antiga
    const last = LS.get('massTarget', 'defender');
    sel.value = last;

    // UI setters
    const ui = {
      setProgress(done, total) {
        const pct = total ? Math.round((done / total) * 100) : 0;
        bar.style.width = `${pct}%`;
        counter.textContent = `${done}/${total}`;
      },
      setStatus(text) { status.textContent = text || ''; },
      setRunning(r) {
        btn.disabled = r;
        sel.disabled = r;
      },
      setPaused(p) { btnPause.textContent = p ? '▶ Retomar' : '⏸ Pausar'; }
    };

    // ShareTag dialog (⚙️)
    gear.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const world = getWorld();
      const current = getShareTag();
      const html = `
        <div style="padding:10px; max-width:420px;">
          <div style="font-weight:bold; margin-bottom:8px;">Share Tag (mundo: ${world})</div>
          <div style="margin-bottom:6px;">Use a mesma senha para compartilhar notas com outros jogadores.</div>
          <input id="an_sharetag_input" type="text" style="width:100%; padding:6px;" placeholder="Ex: SENHA123_${world.toUpperCase()}" value="${$('<div>').text(current).html()}"/>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
            <button class="btn" id="an_sharetag_cancel">Cancelar</button>
            <button class="btn btn-confirm-yes" id="an_sharetag_save">Salvar</button>
          </div>
        </div>`;
      Dialog.show('an_sharetag', html);
      document.getElementById('an_sharetag_cancel')?.addEventListener('click', () => Dialog.close());
      document.getElementById('an_sharetag_save')?.addEventListener('click', () => {
        const v = (document.getElementById('an_sharetag_input')?.value || '').trim();
        setShareTag(v);
        Dialog.close();
        toast('Share Tag salva ✅');
      });
    });

    // Controller
    const controller = createMassController(ui);

    btn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();

      const selectedLinks = getSelectedReportLinksFromList();
      if (!selectedLinks.length) {
        toast('Selecione pelo menos 1 relatório (checkbox da primeira coluna).', true);
        return;
      }
      const share = getShareTag();
      if (!share) {
        toast('Configure a Share Tag (⚙️) antes de salvar no banco.', true);
        // ainda deixa criar as notas no jogo, mas DB não será usado.
      }

      const forwardedTarget = sel.value;
      LS.set('massTarget', forwardedTarget);

      ui.setProgress(0, selectedLinks.length);
      ui.setStatus('Iniciando...');
      controller.start(selectedLinks, forwardedTarget);
    });

    btnPause.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); controller.togglePause(); });
    btnStop.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); controller.stop(); });
  }

  /* ================== Mass Controller ================== */
  function createMassController(ui) {
    const state = {
      running: false,
      paused: false,
      stopped: false,
      queue: [],
      done: 0,
      forwardedTarget: 'defender'
    };

    function updateUI() {
      ui.setRunning(state.running);
      ui.setPaused(state.paused);
      ui.setProgress(state.done, state.queue.length);
    }

    async function waitIfPaused() {
      while (state.paused && !state.stopped) await sleep(200);
    }

    async function processOne(url, idx1) {
      ui.setStatus(`Buscando ${idx1}/${state.queue.length}...`);
      const doc = await fetchReportDocument(url);

      const data = extractFullReportData(doc);
      if (!data.bbcode) throw new Error('BBCode não encontrado');

      const decision = decideTargetVillage(data, state.forwardedTarget);
      const chosen = decision.chosen;
      const villageId = decision.villageId;
      if (!villageId) throw new Error('villageId ausente');

      ui.setStatus(decision.mode === 'own'
        ? `Próprio → ${chosen} (${idx1}/${state.queue.length})`
        : `Enc. → ${chosen} (${idx1}/${state.queue.length})`
      );

      const noteText = buildRichNoteText(data, chosen);
      await postVillageNote({ villageId, noteText });

      // salva no supabase
      await saveAlsoToSupabase({chosen,
        coords: coordsForChosen(data, chosen),
        noteText,
        source: 'mass',
        pop_survivors: popForChosen(data, chosen)
      ,
          village_type: (chosen === 'defender' ? data.tipoDef.tipo : data.tipoAtt.tipo),
          buildings: data.buildings});
ui.setStatus(`OK ${idx1}/${state.queue.length} ✅`);
    }

    return {
      async start(queue, forwardedTarget) {
        if (state.running) return;
        state.running = true;
        state.paused = false;
        state.stopped = false;
        state.queue = queue.slice();
        state.done = 0;
        state.forwardedTarget = forwardedTarget;

        updateUI();

        let failed = 0;

        while (state.done < state.queue.length) {
          if (state.stopped) break;
          await waitIfPaused();
          if (state.stopped) break;

          const idx1 = state.done + 1;
          const url = state.queue[state.done];

          try {
            await processOne(url, idx1);
          } catch (e) {
            failed++;
            console.warn('[Mass] erro', url, e);
            ui.setStatus(`Falhou ${idx1}/${state.queue.length} ❌`);
          }

          state.done += 1;
          updateUI();

          await sleep(MASS_DELAY_MS);
        }

        state.running = false;
        updateUI();

        ui.setProgress(state.queue.length, state.queue.length);
        ui.setStatus(failed ? `Finalizado com ${failed} falhas.` : 'Finalizado ✅');
      },

      togglePause() {
        if (!state.running) return;
        state.paused = !state.paused;
        updateUI();
      },

      stop() {
        if (!state.running) return;
        state.stopped = true;
        state.paused = false;
        state.running = false;
        updateUI();
        ui.setStatus('Parado ⏹');
      }
    };
  }

  /* ================== Baixar nota (screen=info_village) ================== */
  function injectDownloadButtonInVillage() {
    // só na aldeia do jogador (info_village tem id=...)
    const h2 = document.querySelector('#content_value h2');
    if (!h2) return;
    if (document.getElementById('an_btn_download_note')) return;

    const btn = document.createElement('button');
    btn.id = 'an_btn_download_note';
    btn.className = 'btn btn-confirm-yes';
    btn.textContent = '⬇️ Baixar nota';
    btn.style.marginLeft = '10px';
    h2.style.display = 'inline-block';
    h2.parentElement?.insertBefore(btn, h2.nextSibling);

    btn.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();

      const share_tag = getShareTag();
      if (!share_tag) {
        toast('Configure a Share Tag (na lista de relatórios, ⚙️) antes.', true);
        return;
      }

      // coordenadas da aldeia atual: geralmente aparecem no título "Aldeia (xxx|yyy) K.."
      const text = document.querySelector('#content_value')?.textContent || '';
      const m = text.match(/(\d{1,3})\|(\d{1,3})/);
      if (!m) return toast('Não consegui identificar as coordenadas desta aldeia.', true);
      const x = parseInt(m[1], 10), y = parseInt(m[2], 10);

      try {
        btn.disabled = true;
        btn.textContent = 'Baixando...';

        const row = await sbGetLatest({ world: getWorld(), x, y, share_tag });
        if (!row?.note_text) {
          toast('Nenhuma nota encontrada no banco para esta aldeia.', true);
          return;
        }

        // salvar no bloco de notas da aldeia (como se fosse o script)
        const villageId = new URL(location.href).searchParams.get('id');
        await postVillageNote({ villageId, noteText: row.note_text });

        toast('Nota baixada e salva ✅');
        location.reload();
      } catch (e) {
        console.warn(e);
        toast('Erro ao baixar/salvar nota.', true);
      } finally {
        btn.disabled = false;
        btn.textContent = '⬇️ Baixar nota';
      }
    });
  }

  /* ================== IndexedDB cache (para mapa) ================== */
  const IDB = {
    dbName: 'tw_notes_cache_v1',
    store: 'notes',
    async open() {
      return await new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.store)) {
            const os = db.createObjectStore(this.store, { keyPath: 'k' });
            os.createIndex('world', 'world', { unique: false });
            os.createIndex('share_tag', 'share_tag', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async putMany(rows) {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.store, 'readwrite');
        const os = tx.objectStore(this.store);
        for (const r of rows) os.put(r);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    async count() {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.store, 'readonly');
        const os = tx.objectStore(this.store);
        const req = os.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      });
    },
    async getAllFor(world, share_tag) {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.store, 'readonly');
        const os = tx.objectStore(this.store);
        const req = os.getAll();
        req.onsuccess = () => {
          const all = req.result || [];
          const filtered = all.filter(r => r.world === world && r.share_tag === share_tag);
          window.__AN_MAPLOG?.(`[IDB] getAllFor: total=${all.length} filtered=${filtered.length} world=${world} tag=${share_tag}`);
          if (all.length && filtered.length === 0) {
            const worlds = Array.from(new Set(all.map(r=>r.world))).slice(0,5).join(',');
            const tags = Array.from(new Set(all.map(r=>r.share_tag))).slice(0,5).join(',');
            window.__AN_MAPLOG?.(`[IDB] worlds no cache: ${worlds}`);
            window.__AN_MAPLOG?.(`[IDB] tags no cache: ${tags}`);
          }
          resolve(filtered);
        };
        req.onerror = () => reject(req.error);
      });
    }
  };

  function parseTypeAndWallFromNote(noteText) {
    const tipo =
      noteText.includes(PT.offensive) ? PT.offensive :
      noteText.includes(PT.probOffensive) ? PT.probOffensive :
      noteText.includes(PT.defensive) ? PT.defensive :
      noteText.includes(PT.probDefensive) ? PT.probDefensive :
      noteText.includes(PT.noSurvivors) ? PT.noSurvivors :
      PT.unknown;

    const wm = noteText.match(/Muralha\s*([0-9]{1,3})/i) || noteText.match(/Muralha([0-9]{1,3})/i);
    const wall = wm ? parseInt(wm[1], 10) : 0;
    return { tipo, wall };
  }

  async function updateIndexedDBFromSupabase(uiSetStatus) {
    const share_tag = getShareTag();
    if (!share_tag) { toast('Configure a Share Tag antes (⚙️ na lista de relatórios).', true); return; }

    uiSetStatus?.('Baixando do Supabase...');
    window.__AN_MAPLOG?.('Iniciando download do Supabase...');
let rows;
try {
  window.__AN_MAPLOG?.('Listando tw_village_intel_latest (paginado)...');
  rows = await sbFetchAllIntelLatest({ world: getWorld(), share_tag, log: window.__AN_MAPLOG });
} catch (e) {
  console.warn('[Supabase] falhou ao listar intel; caindo para notes:', e);
  window.__AN_MAPLOG?.('Fallback: listando tw_notes_latest (paginado)...');
  rows = await sbFetchAllLatest({ world: getWorld(), share_tag, log: window.__AN_MAPLOG });
}
    uiSetStatus?.(`Recebido: ${rows.length}. Salvando cache...`);
    window.__AN_MAPLOG?.(`Recebido ${rows.length} linhas. Montando cache...`);

    const mapped = rows.map(r => {
  const key = `${r.world}|${r.share_tag}|${r.x}|${r.y}`;

  // Se vier da tabela intel, pode não ter note_text
  const noteText = r.note_text || '';
  const extraFromNote = noteText ? parseTypeAndWallFromNote(noteText) : { tipo: null, wall: null };

  const tipo = (r.village_type ?? null) || extraFromNote.tipo;
  const wall = (r.wall_level ?? null) ?? extraFromNote.wall;

  return {
    k: key,
    world: r.world,
    share_tag: r.share_tag,
    x: r.x,
    y: r.y,
    updated_at: r.updated_at,
    note_text: noteText,
    pop_survivors: r.pop_survivors ?? 0,
    tipo,
    wall
  };
});

    window.__AN_MAPLOG?.(`Gravando no IndexedDB (${mapped.length} registros)...`);
    const __t0 = performance.now();
    await IDB.putMany(mapped);
    const __cnt = await IDB.count().catch(()=>null);
    window.__AN_MAPLOG?.(`IndexedDB OK em ${Math.round(performance.now()-__t0)}ms (count=${__cnt})`);
    uiSetStatus?.(`Cache atualizado ✅ (${mapped.length})`);
    window.__AN_MAPLOG?.('Cache atualizado. Redesenhando mapa...');
  }

  /* ================== Mapa: botão e overlay ================== */
  function injectMapButton() {
    const link = Array.from(document.querySelectorAll('a'))
      .find(a => (a.textContent || '').includes('Exibir mapa mundial'));
    if (!link) return;

    if (document.getElementById('an_btn_map_notes')) return;

    const btn = document.createElement('button');
    btn.id = 'an_btn_map_notes';
    btn.className = 'btn btn-confirm-yes';
    btn.textContent = 'Marcar notas no mapa';
    btn.style.display = 'block';
    btn.style.marginBottom = '6px';

    link.parentElement?.insertBefore(btn, link);

    let active = false;
    let panel = null;

    btn.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (!active) {
        active = true;
        btn.textContent = 'Desativar notas no mapa';
        panel = createFloatingPanel();
        await activateMapOverlay(panel);
      } else {
        active = false;
        btn.textContent = 'Marcar notas no mapa';
        deactivateMapOverlay();
        panel?.remove();
        panel = null;
      }
    });
  }

  function createFloatingPanel() {
    const panel = document.createElement('div');
    panel.id = 'an_notes_panel';
    panel.style.position = 'fixed';
    panel.style.right = '20px';
    panel.style.top = '120px';
    panel.style.zIndex = '99999';
    panel.style.background = '#f4e4bc';
    panel.style.border = '1px solid #7d510f';
    panel.style.padding = '10px';
    panel.style.width = '340px';
    panel.style.maxHeight = '60vh';
    panel.style.overflow = 'auto';
    panel.style.resize = 'both';
    panel.style.boxShadow = '0 2px 10px rgba(0,0,0,0.25)';
    panel.style.borderRadius = '4px';

    panel.innerHTML = `
      <div id="an_panel_header" style="cursor:move; font-weight:bold; display:flex; justify-content:space-between; align-items:center;">
        <span>Notas no mapa</span>
        <a href="javascript:void(0)" id="an_panel_close" style="text-decoration:none;">✖</a>
      </div>
      <div style="margin-top:8px; display:flex; flex-direction:column; gap:8px;">
        <div>
          <div style="font-size:12px; opacity:.9;">Share Tag (mundo: ${getWorld()})</div>
          <input id="an_panel_sharetag" type="text" style="width:100%; padding:6px;" value="${$('<div>').text(getShareTag()).html()}" placeholder="Sua senha deste mundo"/>
          <div style="font-size:11px; opacity:.8; margin-top:3px;">(Use ⚙️ na lista de relatórios para salvar a senha também.)</div>
        </div>

        <div style="display:flex; gap:8px;">
          <button class="btn btn-confirm-yes" id="an_panel_update_cache" style="flex:1;">Atualizar IndexedDB</button>
          <button class="btn" id="an_panel_redraw" style="flex:1;">Redesenhar</button>
        </div>

        <div style="display:flex; flex-direction:column; gap:6px; font-size:12px;">
          <label><input type="checkbox" id="an_opt_show_off" checked> Mostrar ofensivas</label>
          <label><input type="checkbox" id="an_opt_show_def" checked> Mostrar defensivas</label>
          <label><input type="checkbox" id="an_opt_show_prob" checked> Mostrar "provavelmente"</label>
          <label><input type="checkbox" id="an_opt_show_wall" checked> Mostrar nível de muralha</label>
          <label><input type="checkbox" id="an_opt_show_pop" checked> Mostrar população (sobreviventes)</label>
        </div>

        <div id="an_panel_status" style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></div>
        <div style="display:flex; gap:8px; margin-top:6px; align-items:center;">
          <button class="btn" id="an_panel_log_clear" style="flex:0 0 auto;">Limpar log</button>
          <span style="font-size:11px; opacity:.8;">(log do cache)</span>
        </div>
        <div id="an_panel_log" style="margin-top:6px; height:120px; background:rgba(0,0,0,.08); border:1px solid rgba(0,0,0,.25); padding:6px; font-family:monospace; font-size:11px; overflow:auto; white-space:pre-wrap;"></div>
      </div>
    `;

    document.body.appendChild(panel);

    // logger no painel (visível no mapa)
    try {
      const logEl = panel.querySelector('#an_panel_log');
      const push = (msg) => {
        if (!logEl) return;
        const t = new Date();
        const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
        logEl.textContent += `[${ts}] ${msg}\n`;
        logEl.scrollTop = logEl.scrollHeight;
      };
      window.__AN_MAPLOG = push;

      panel.querySelector('#an_panel_log_clear')?.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (logEl) logEl.textContent = '';
        push('Log limpo.');
      });

      push('Painel aberto.');
    } catch (e) {
      console.warn('[MAP] falha ao iniciar log:', e);
    }


    // fechar
    panel.querySelector('#an_panel_close')?.addEventListener('click', () => {
      deactivateMapOverlay();
      panel.remove();
      const btn = document.getElementById('an_btn_map_notes');
      if (btn) btn.textContent = 'Marcar notas no mapa';
    });

    // drag
    makeDraggable(panel, panel.querySelector('#an_panel_header'));

    // sync sharetag
    panel.querySelector('#an_panel_sharetag')?.addEventListener('change', () => {
      const v = (panel.querySelector('#an_panel_sharetag')?.value || '').trim();
      setShareTag(v);
    });

    return panel;
  }

  function makeDraggable(panel, handle) {
    if (!handle) return;
    let sx = 0, sy = 0, px = 0, py = 0, dragging = false;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const rect = panel.getBoundingClientRect();
      px = rect.left; py = rect.top;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      panel.style.left = `${px + dx}px`;
      panel.style.top = `${py + dy}px`;
      panel.style.right = 'auto';
      e.preventDefault();
    });

    window.addEventListener('mouseup', () => { dragging = false; });
  }

  let mapOverlayInstalled = false;
  let cachedNotes = [];
  let mapOptions = null;
  let __an_debugDrawOnce = false;
  let __an_spawnCount = 0;
  let __an_lastDrawAt = 0;

  async function activateMapOverlay(panel) {
    const statusEl = panel.querySelector('#an_panel_status');
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t || ''; };

    mapOptions = {
      showOff: () => panel.querySelector('#an_opt_show_off')?.checked,
      showDef: () => panel.querySelector('#an_opt_show_def')?.checked,
      showProb: () => panel.querySelector('#an_opt_show_prob')?.checked,
      showWall: () => panel.querySelector('#an_opt_show_wall')?.checked,
      showPop: () => panel.querySelector('#an_opt_show_pop')?.checked
    };

    panel.querySelector('#an_panel_update_cache')?.addEventListener('click', async () => {
      try {
        setStatus('Atualizando cache...');
        await updateIndexedDBFromSupabase(setStatus);
        await loadCacheForMap(setStatus);
        window.__AN_MAPLOG?.('Cache carregado. Garantindo hook do mapa antes do reload...');
        await waitForTWMap(12000);
        installMapOverlayHook();
        redrawMapOverlay();
      } catch (e) {
        console.warn(e);
        setStatus('Erro ao atualizar cache.');
      }
    });

    panel.querySelector('#an_panel_redraw')?.addEventListener('click', async () => {
      await loadCacheForMap(setStatus);
      setStatus('Redesenhando...');
      window.__AN_MAPLOG?.('Redesenhar clicado. Garantindo hook do mapa...');
      await waitForTWMap(12000);
      installMapOverlayHook();
      redrawMapOverlay();
      setStatus(`Redesenhado (${cachedNotes.length})`);
    });

    await loadCacheForMap(setStatus);
    setStatus('Preparando overlay do mapa...');
    window.__AN_MAPLOG?.('Aguardando TWMap ficar pronto...');
    const ok = await waitForTWMap(12000);
    if (!ok) {
      window.__AN_MAPLOG?.('TWMap não ficou pronto a tempo. Tente clicar em Redesenhar depois que o mapa carregar.');
    }
    // tenta instalar; se não estiver pronto ainda, o botão Redesenhar tentará novamente
    installMapOverlayHook();
    redrawMapOverlay();
    setStatus(`Ativo. Cache: ${cachedNotes.length} notas.`);
  }

  function deactivateMapOverlay() {
    // não desfaz o hook, mas para de desenhar
    cachedNotes = [];
    redrawMapOverlay();
  }

  async function loadCacheForMap(setStatus) {
    const share_tag = getShareTag();
    if (!share_tag) { setStatus?.('Defina a Share Tag.'); return; }
    setStatus?.('Carregando cache local...');
    cachedNotes = await IDB.getAllFor(getWorld(), share_tag);
    window.__AN_MAPLOG?.(`Cache local carregado: ${cachedNotes.length} registros (world=${getWorld()}, tag=${share_tag}).`);
  }

  function allowNote(note) {
    if (!mapOptions) return true;
    const t = note.tipo;
    const isProb = (t === PT.probOffensive || t === PT.probDefensive);
    const isOff = (t === PT.offensive || t === PT.probOffensive);
    const isDef = (t === PT.defensive || t === PT.probDefensive);

    if (isProb && !mapOptions.showProb()) return false;
    if (isOff && !mapOptions.showOff()) return false;
    if (isDef && !mapOptions.showDef()) return false;

    return true;
  }

  function typeColor(tipo) {
    if (tipo === PT.offensive) return 'rgba(255,0,0,0.70)';
    if (tipo === PT.probOffensive) return 'rgba(255,140,0,0.65)';
    if (tipo === PT.defensive) return 'rgba(0,180,0,0.65)';
    if (tipo === PT.probDefensive) return 'rgba(140,200,0,0.60)';
    if (tipo === PT.noSurvivors) return 'rgba(120,120,120,0.55)';
    return 'rgba(80,80,255,0.55)';
  }

  function typeFillColor(tipo) {
    // mesma cor do contorno, porém mais transparente para preencher o tile
    if (tipo === PT.offensive) return 'rgba(255,0,0,0.22)';
    if (tipo === PT.probOffensive) return 'rgba(255,140,0,0.20)';
    if (tipo === PT.defensive) return 'rgba(0,180,0,0.20)';
    if (tipo === PT.probDefensive) return 'rgba(140,200,0,0.18)';
    if (tipo === PT.noSurvivors) return 'rgba(120,120,120,0.16)';
    return 'rgba(80,80,255,0.16)';
  }


  
  async function waitForTWMap(timeoutMs = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (window.TWMap?.mapHandler?.spawnSector && window.TWMap?.map?.pixelByCoord) return true;
      await sleep(200);
    }
    return false;
  }

function installMapOverlayHook() {
    window.__AN_MAPLOG?.('Verificando TWMap/mapHandler...');
    if (mapOverlayInstalled) return;
    if (!window.TWMap?.mapHandler) { window.__AN_MAPLOG?.('TWMap ainda não pronto (sem mapHandler). Vou tentar novamente.'); return; }

    mapOverlayInstalled = true;
    window.__AN_MAPLOG?.('Hook do mapa instalado (spawnSector sobrescrito).');
    const mapOverlay = TWMap;

    if (!mapOverlay.mapHandler._an_spawnSector) {
      mapOverlay.mapHandler._an_spawnSector = mapOverlay.mapHandler.spawnSector;
    }

    mapOverlay.mapHandler.spawnSector = function (data, sector) {
      mapOverlay.mapHandler._an_spawnSector(data, sector);

      // desenhar por setor (5x5)
      const elId = `an_notes_canvas_${sector.x}_${sector.y}`;
      let el = document.getElementById(elId);

      // remove canvas se não tem nada
      if (el) el.remove();

      if (!cachedNotes || !cachedNotes.length) return;

      // cria canvas
      const canvas = document.createElement('canvas');
      canvas.id = elId;
      canvas.style.position = 'absolute';
      canvas.width = (mapOverlay.map.scale[0] * mapOverlay.map.sectorSize);
      canvas.height = (mapOverlay.map.scale[1] * mapOverlay.map.sectorSize);
      canvas.style.zIndex = 12;
      canvas.className = 'an_notes_map_canvas';
      canvas.id = elId;

      const ctx = canvas.getContext('2d');
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const st_pixel = mapOverlay.map.pixelByCoord(sector.x, sector.y);
      __an_spawnCount++;
      // loga 1 vez por 'ciclo' de redraw para evitar spam
      if (__an_debugDrawOnce && (__an_spawnCount <= 5)) {
        window.__AN_MAPLOG?.(`spawnSector chamado: setor ${sector.x}|${sector.y} (cached=${cachedNotes.length})`);
      }

      // desenhar apenas notas dentro do setor (x..x+5, y..y+5)
      let __matches = 0;
      for (const note of cachedNotes) {
        if (!allowNote(note)) continue;
        const x = note.x, y = note.y;
        if (x < sector.x || x >= sector.x + 5 || y < sector.y || y >= sector.y + 5) continue;

        const originXY = mapOverlay.map.pixelByCoord(x, y);
        const tileW = mapOverlay.tileSize[0];
        const tileH = mapOverlay.tileSize[1];
        const topX = (originXY[0] - st_pixel[0]);
        const topY = (originXY[1] - st_pixel[1]);

        __matches++;

        // estilo "overwatch": retângulo cobrindo a aldeia
        const border = typeColor(note.tipo);
        const fill = typeFillColor(note.tipo);

        // Preenche o tile, mas deixa um "recorte" no canto superior esquerdo
        // para não esconder o pontinho colorido do mapa (preto/vermelho/azul/amarelo).
        const notch = 11; // tamanho do recorte

        ctx.fillStyle = fill;
        ctx.fillRect(topX, topY, tileW, tileH);

        // borda sem cobrir o recorte
        ctx.strokeStyle = border;
        ctx.lineWidth = 2;
        ctx.beginPath();
        // topo (pula o recorte)
        ctx.moveTo(topX + notch, topY + 1);
        ctx.lineTo(topX + tileW - 1, topY + 1);
        // direita
        ctx.moveTo(topX + tileW - 1, topY + 1);
        ctx.lineTo(topX + tileW - 1, topY + tileH - 1);
        // base
        ctx.moveTo(topX + tileW - 1, topY + tileH - 1);
        ctx.lineTo(topX + 1, topY + tileH - 1);
        // esquerda (pula o recorte)
        ctx.moveTo(topX + 1, topY + notch);
        ctx.lineTo(topX + 1, topY + tileH - 1);
        ctx.stroke();

        // recorte (limpa o preenchimento e evita borda nessa área)
        ctx.clearRect(topX, topY, notch, notch);

        // badges (pop e muralha)
        const drawBadge = (txt, bx, by, alignRight = false) => {
          if (!txt) return;
          ctx.font = 'bold 11px Arial';
          const w = Math.ceil(ctx.measureText(txt).width);
          const padX = 4, padY = 2;
          const bw = w + padX * 2;
          const bh = 14 + padY * 2;

          const finalX = alignRight ? (topX + tileW - bw - 2) : bx;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(finalX, by, bw, bh);
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(txt, finalX + padX, by + padY);
        };

        const fmtPop = (n) => {
          const v = Number(n || 0);
          if (!v) return '';
          if (v >= 1000000) return `${Math.round(v / 100000) / 10}m`;
          if (v >= 1000) return `${Math.round(v / 1000)}k`;
          return String(v);
        };

        if (mapOptions?.showPop && mapOptions.showPop()) {
          const popTxt = fmtPop(note.pop_survivors);
          // topo direito
          drawBadge(popTxt, topX + 2, topY + 2, true);
        }

        if (mapOptions?.showWall && mapOptions.showWall() && note.wall) {
          // canto inferior direito
          drawBadge(`🧱${note.wall}`, topX + 2, topY + tileH - 20, true);
        }
      }

      if (__an_debugDrawOnce && (__an_spawnCount <= 5)) {
        window.__AN_MAPLOG?.(`setor ${sector.x}|${sector.y}: ${__matches} marcas`);
      }
      sector.appendElement(canvas, 0, 0);
    };

    // força reload
    mapOverlay.reload();
  }

  function redrawMapOverlay() {
    if (!window.TWMap) return;
    __an_debugDrawOnce = true;
    __an_spawnCount = 0;
    __an_lastDrawAt = Date.now();
    window.__AN_MAPLOG?.('Forçando refresh do mapa (reload) para redesenhar...');
    try { TWMap.reload(); } catch (e) { window.__AN_MAPLOG?.('TWMap.reload falhou: ' + (e?.message||e)); }
    try { TWMap.mapHandler?.reload?.(); } catch (e) { /* ignore */ }
    try { TWMap.map?.reload?.(); } catch (e) { /* ignore */ }
    // desliga debug após alguns segundos
    setTimeout(() => { __an_debugDrawOnce = false; }, 4000);
  }

  /* ================== Texto PT (somente o necessário) ================== */
  const PT = {
    unknown: 'Desconhecido',
    offensive: 'Ofensiva',
    defensive: 'Defensiva',
    probOffensive: 'Provavelmente Ofensiva',
    probDefensive: 'Provavelmente Defensiva',
    noSurvivors: 'Nenhuma tropa sobreviveu',
    watchtower: 'Torre',
    wall: 'Muralha',
    firstChurch: 'Igreja Principal',
    church: 'Igreja',
    defensiveNukes: 'fulls defesa'
  };

  /* ================== Boot ================== */
  function boot() {
    const view = new URL(location.href).searchParams.get('view');

    if (isScreen('report')) {
      if (view) {
        // relatório aberto
        injectSingleReportButton();
      } else {
        // lista de relatórios
        ensureHeaderControls();
      }
    }

    if (isScreen('info_village')) {
      injectDownloadButtonInVillage();
    }

    if (isScreen('map')) {
      injectMapButton();
    }
  }

  // alguns screens demoram para montar DOM
  setTimeout(boot, 200);
  setTimeout(boot, 1200);

  // Helper de debug (console):
  // Use: TWNotesResetCache()  -> apaga o IndexedDB e recarrega a página
  window.TWNotesResetCache = function() {
    try {
      indexedDB.deleteDatabase(DB_NAME);
      console.log('[TWNotes] IndexedDB apagado:', DB_NAME);
      location.reload();
    } catch (e) {
      console.error('[TWNotes] falha ao apagar IndexedDB', e);
    }
  };

})();
