import {
  METHODS, applyModifier, singleWall, chain, compareInterpretations,
  warnings, edgeHint, historyToCsv, relativeChangePct, round,
} from './flow.js';
import { STRINGS, detectLang } from './i18n.js';
import { surfacePattern, gauge, historyChart, wallSection, wallDots, explainChart } from './charts.js';

const STORAGE_KEY = 'flow-kalkulator:v1';
const METHOD_ORDER = ['yolo', 'perfectionist', 'pass1', 'pass2', 'wall'];

// ---------- state ----------

const defaults = () => ({
  lang: detectLang(),
  theme: null,
  method: 'yolo',
  activeId: 'default',
  filaments: {
    default: { name: 'PLA', start: 1, current: 1, history: [] },
  },
  wall: { nominal: 0.45, readings: [null, null, null, null] },
});

let state = load();
try {
  const qLang = new URLSearchParams(location.search).get('lang');
  if (qLang === 'de' || qLang === 'en') state.lang = qLang;
} catch { /* ignore */ }
let selected = null; // modifier of the chosen block (not persisted)

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw);
    const base = defaults();
    if (!data.filaments || !data.filaments[data.activeId]) return base;
    return { ...base, ...data, wall: { ...base.wall, ...data.wall } };
  } catch {
    return defaults();
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode: keep working in memory */ }
}

const fil = () => state.filaments[state.activeId];
const t = (key) => STRINGS[state.lang][key] ?? STRINGS.en[key] ?? key;
const $ = (id) => document.getElementById(id);

// ---------- formatting ----------

const fmtRatio = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const fmtPct = (v, d = 2) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)} %` : '—');
const fmtSigned = (v, d) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`;

function modLabel(method, m) {
  if (METHODS[method].kind === 'percent') return fmtSigned(m, 0);
  return fmtSigned(m, method === 'perfectionist' ? 3 : 2);
}

// ---------- calculation for the current view ----------

function compute() {
  const current = fil().current;
  if (state.method === 'wall') {
    try {
      const w = singleWall(current, state.wall.nominal, state.wall.readings.map(Number).filter((v) => v > 0));
      return {
        value: w.newRatio,
        wall: w,
        formula: `${fmtRatio(current)} × ${state.wall.nominal.toFixed(3)} / ${w.mean.toFixed(3)}`,
        modifier: null,
      };
    } catch {
      return null;
    }
  }
  if (selected === null) return null;
  const m = METHODS[state.method];
  const value = applyModifier(current, selected, m.kind);
  const formula = m.kind === 'additive'
    ? `${fmtRatio(current)} ${selected < 0 ? '−' : '+'} ${Math.abs(selected).toFixed(3)}`
    : `${fmtRatio(current)} × (100 ${selected < 0 ? '−' : '+'} ${Math.abs(selected)}) / 100`;
  return { value, formula, modifier: selected };
}

// ---------- render ----------

function renderStatic() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === state.lang));
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
}

function renderFilaments() {
  const sel = $('filament-select');
  sel.replaceChildren(...Object.entries(state.filaments).map(([id, f]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `${f.name} · ${fmtRatio(f.current)}`;
    o.selected = id === state.activeId;
    return o;
  }));
  const input = $('current-ratio');
  if (document.activeElement !== input) input.value = fmtRatio(fil().current);
  const single = Object.keys(state.filaments).length < 2;
  const del = $('filament-delete');
  del.disabled = single;
  del.title = single ? t('lastFilament') : '';
  if (formMode) $('filament-save').textContent = t(formMode === 'create' ? 'create' : 'saveName');
}

function renderMethods() {
  const box = $('methods');
  box.replaceChildren(...METHOD_ORDER.map((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'method';
    b.role = 'tab';
    b.setAttribute('aria-selected', String(id === state.method));
    b.innerHTML = `<b></b><small></small>`;
    b.querySelector('b').textContent = t(`m_${id}`);
    b.querySelector('small').textContent = t(`m_${id}_sub`);
    b.addEventListener('click', () => { state.method = id; selected = null; save(); render(); });
    return b;
  }));
  $('panel-blocks').hidden = state.method === 'wall';
  $('panel-wall').hidden = state.method !== 'wall';
}

function renderBlocks() {
  if (state.method === 'wall') return;
  const m = METHODS[state.method];
  const maxAbs = Math.max(...m.modifiers.map(Math.abs));
  const current = fil().current;
  $('blocks').replaceChildren(...m.modifiers.map((mod, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'block';
    b.setAttribute('aria-pressed', String(selected === mod));
    // Surface look follows the absolute flow each block was printed with,
    // relative to an assumed optimum in the middle of the range.
    b.append(surfacePattern(mod / maxAbs, i));
    const lab = document.createElement('span');
    lab.className = 'mod';
    lab.textContent = modLabel(state.method, mod);
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = fmtRatio(applyModifier(current, mod, m.kind));
    b.append(lab, val);
    b.addEventListener('click', () => { selected = selected === mod ? null : mod; render(); });
    return b;
  }));
}

function renderWall() {
  if (state.method !== 'wall') return;
  const box = $('measurements');
  const readings = state.wall.readings;
  if (box.children.length !== readings.length) {
    box.replaceChildren(...readings.map((v, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'measurement';
      const label = document.createElement('label');
      label.textContent = `${t('side')} ${i + 1}`;
      label.htmlFor = `reading-${i}`;
      const input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'decimal';
      input.step = '0.01';
      input.min = '0';
      input.id = `reading-${i}`;
      input.placeholder = state.wall.nominal.toFixed(2);
      if (v) input.value = v;
      input.addEventListener('input', () => {
        const n = parseFloat(input.value.replace(',', '.'));
        state.wall.readings[i] = Number.isFinite(n) && n > 0 ? n : null;
        save();
        renderResult();
        renderWallViz();
      });
      wrap.append(label, input);
      if (readings.length > 1) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'rm';
        rm.textContent = '×';
        rm.ariaLabel = 'remove';
        rm.addEventListener('click', () => {
          state.wall.readings.splice(i, 1);
          save();
          $('measurements').replaceChildren();
          render();
        });
        wrap.append(rm);
      }
      return wrap;
    }));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn ghost small';
    add.textContent = t('wallAdd');
    add.addEventListener('click', () => {
      state.wall.readings.push(null);
      save();
      $('measurements').replaceChildren();
      render();
      $(`reading-${state.wall.readings.length - 1}`)?.focus();
    });
    box.append(add);
  }
  const nominal = $('wall-nominal');
  if (document.activeElement !== nominal) nominal.value = state.wall.nominal.toFixed(2);
  renderWallViz();
}

function renderWallViz() {
  const r = compute();
  const w = r?.wall ?? null;
  wallSection($('wall-section'), state.wall.nominal, w?.mean ?? null, { nominal: t('wallNominalLabel'), measured: t('wallMeasuredLabel') });
  wallDots($('wall-dots'), state.wall.nominal, state.wall.readings.filter((v) => v > 0), w);
  const stats = $('wall-stats');
  if (!w) { stats.replaceChildren(); return; }
  const items = [
    [t('mean'), `${w.mean.toFixed(3)} mm`],
    [t('deviation'), fmtPct(w.deviationPct, 1)],
    [t('spread'), `${w.spread.toFixed(3)} mm`],
    [t('sdev'), `${w.stdev.toFixed(3)} mm`],
  ];
  stats.replaceChildren(...items.map(([k, v]) => {
    const d = document.createElement('div');
    d.className = 'stat';
    d.innerHTML = '<small></small><b></b>';
    d.querySelector('small').textContent = k;
    d.querySelector('b').textContent = v;
    return d;
  }));
}

function renderResult() {
  const r = compute();
  const current = fil().current;
  const out = $('result-value');
  const warnList = $('warnings');
  warnList.replaceChildren();
  if (!r) {
    out.textContent = '—';
    out.classList.add('empty');
    $('result-step').textContent = '—';
    $('result-formula').textContent = t('noSelection');
    $('base-note').textContent = '';
    $('copy-btn').disabled = true;
    $('apply-btn').disabled = true;
    gauge($('gauge'), current, null);
    return;
  }
  out.classList.remove('empty');
  out.textContent = fmtRatio(r.value);
  out.title = String(r.value);
  const pct = relativeChangePct(current, r.value);
  const step = $('result-step');
  step.textContent = `${fmtSigned(r.value - current, 3)}  (${fmtPct(pct)})`;
  step.className = pct > 0 ? 'pos' : pct < 0 ? 'neg' : '';
  $('result-formula').textContent = `${r.formula} = ${fmtRatio(r.value, 4)}`;
  $('base-note').textContent = t('newBase').replace('{v}', fmtRatio(r.value));
  $('copy-btn').disabled = false;
  $('apply-btn').disabled = false;
  gauge($('gauge'), current, r.value);

  const notes = warnings(current, r.value).map((k) => ({ text: t(`w_${k}`) }));
  if (r.modifier !== null) {
    const edge = edgeHint(state.method, r.modifier);
    if (edge) notes.push({ text: t(edge), info: true });
    if (state.method === 'pass1') notes.push({ text: t('pass1Next'), info: true });
  }
  if (r.wall && r.wall.spread > 0.03) notes.push({ text: t('spreadWarn') });
  warnList.replaceChildren(...notes.map((n) => {
    const li = document.createElement('li');
    li.textContent = n.text;
    if (n.info) li.className = 'info';
    return li;
  }));
}

function renderHistory() {
  const f = fil();
  const rows = chain(f.start, f.history);
  const heading = document.querySelector('.history h2');
  heading.textContent = `${t('history')} · ${f.name}`;
  historyChart($('history-chart'), f.start, rows, { start: t('start') });
  const table = $('history-table');
  $('history-empty').hidden = rows.length > 0;
  table.hidden = rows.length === 0;
  $('undo-btn').disabled = rows.length === 0;
  $('csv-btn').disabled = rows.length === 0;
  $('reset-btn').disabled = rows.length === 0;
  $('print-btn').disabled = rows.length === 0;
  if (!rows.length) { table.replaceChildren(); return; }
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>#</th><th></th><th></th><th></th><th class="num"></th><th class="num"></th><th class="num"></th><th class="num"></th><th></th></tr>';
  const labels = ['#', t('date'), t('methodCol'), 'Modifier', t('from'), t('to'), t('step'), t('total'), t('noteCol')];
  head.querySelectorAll('th').forEach((th, i) => { th.textContent = labels[i]; });
  const body = document.createElement('tbody');
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const cells = [
      [String(i + 1)],
      [new Date(r.date).toLocaleDateString(state.lang === 'de' ? 'de-DE' : 'en-GB')],
      [t(`m_${r.method}`)],
      [r.modifier === null || r.modifier === undefined ? '—' : modLabel(r.method, r.modifier), 'num'],
      [fmtRatio(r.from), 'num'],
      [fmtRatio(r.to), 'num'],
      [fmtPct(r.stepPct), `num ${r.stepPct > 0 ? 'pos' : r.stepPct < 0 ? 'neg' : ''}`],
      [fmtPct(r.totalPct), 'num'],
      [r.note || '', 'note'],
    ];
    for (const [text, cls] of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }
    body.append(tr);
  });
  table.replaceChildren(head, body);
}

function renderExplain() {
  const base = parseFloat($('ex-base').value);
  const step = parseInt($('ex-step').value, 10);
  $('ex-base-out').textContent = base.toFixed(2);
  $('ex-step-out').textContent = `${fmtSigned(step, 0)} % / ${fmtSigned(step / 100, 2)}`;
  const c = compareInterpretations(base, step);
  explainChart($('explain-chart'), base, c, {
    additive: t('explainAdditive'),
    relative: t('explainRelative'),
    diff: t('explainDiff'),
    base: t('explainBase'),
  });
}

function render() {
  renderStatic();
  renderFilaments();
  renderMethods();
  renderBlocks();
  renderWall();
  renderResult();
  renderHistory();
  renderExplain();
}

// ---------- actions ----------

function setCurrent(v) {
  if (!Number.isFinite(v) || v <= 0) return;
  const f = fil();
  const value = round(v, 4);
  // Before the first calibration the typed value is the starting point.
  if (!f.history.length) f.start = value;
  f.current = value;
  save();
  renderFilaments();
  renderBlocks();
  renderResult();
  renderHistory();
}

function applyResult() {
  const r = compute();
  if (!r) return;
  const f = fil();
  f.history.push({
    date: new Date().toISOString(),
    method: state.method,
    modifier: r.modifier,
    from: f.current,
    to: r.value,
    note: $('note').value.trim(),
  });
  f.current = r.value;
  $('note').value = '';
  selected = null;
  // Orca's legacy flow: pass 2 always follows pass 1.
  if (state.method === 'pass1') state.method = 'pass2';
  if (state.method === 'wall') state.wall.readings = state.wall.readings.map(() => null);
  $('measurements').replaceChildren();
  save();
  render();
  $('result').animate(
    [{ boxShadow: '0 0 0 0 var(--good)' }, { boxShadow: '0 0 0 12px transparent' }],
    { duration: 600, easing: 'ease-out' },
  );
}

function undo() {
  const f = fil();
  const last = f.history.pop();
  if (!last) return;
  f.current = last.from;
  save();
  render();
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'filament';
}

// ---------- filament management ----------

let formMode = null; // 'create' | 'rename' | null

function openFilamentForm(mode) {
  formMode = mode;
  const form = $('filament-form');
  form.hidden = false;
  $('filament-error').textContent = '';
  $('filament-start-field').hidden = mode !== 'create';
  $('filament-name').value = mode === 'rename' ? fil().name : '';
  $('filament-start').value = fmtRatio(mode === 'create' ? 1 : fil().current);
  $('filament-save').textContent = t(mode === 'create' ? 'create' : 'saveName');
  $('filament-name').focus();
  $('filament-name').select();
}

function closeFilamentForm() {
  formMode = null;
  $('filament-form').hidden = true;
  $('filament-error').textContent = '';
}

function submitFilamentForm() {
  const name = $('filament-name').value.trim().replace(/\s+/g, ' ');
  const error = $('filament-error');
  if (!name) { error.textContent = t('errNameEmpty'); return; }
  const taken = Object.entries(state.filaments).some(([id, f]) =>
    f.name.toLowerCase() === name.toLowerCase() && !(formMode === 'rename' && id === state.activeId));
  if (taken) { error.textContent = t('errNameTaken'); return; }

  if (formMode === 'create') {
    const start = parseFloat($('filament-start').value.replace(',', '.'));
    if (!(start >= 0.5 && start <= 1.5)) { error.textContent = t('errRatio'); return; }
    const id = `${slug(name)}-${Date.now().toString(36)}`;
    state.filaments[id] = { name, start: round(start, 4), current: round(start, 4), history: [] };
    state.activeId = id;
    selected = null;
  } else if (formMode === 'rename') {
    fil().name = name;
  }
  save();
  closeFilamentForm();
  render();
}

function deleteFilament() {
  const ids = Object.keys(state.filaments);
  if (ids.length < 2) return;
  const idx = ids.indexOf(state.activeId);
  delete state.filaments[state.activeId];
  const rest = Object.keys(state.filaments);
  state.activeId = rest[Math.max(0, idx - 1)];
  selected = null;
  closeFilamentForm();
  save();
  render();
}

/**
 * Two-step destructive button: first click arms it ("Really delete?"),
 * second click within 4 s runs the action. No blocking browser dialogs.
 */
function armable(btn, labelKey, action) {
  let timer = null;
  const disarm = () => {
    clearTimeout(timer);
    timer = null;
    btn.classList.remove('armed');
    btn.textContent = t(labelKey);
  };
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    if (!timer) {
      btn.classList.add('armed');
      btn.textContent = t(labelKey === 'reset' ? 'confirmReset' : 'confirmDelete');
      timer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    action();
  });
  btn.addEventListener('blur', () => { if (timer) disarm(); });
}

// ---------- wiring ----------

function bind() {
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    state.lang = b.dataset.lang;
    save();
    $('measurements').replaceChildren();
    render();
  }));

  $('theme-toggle').addEventListener('click', () => {
    const isDark = state.theme ? state.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
    state.theme = isDark ? 'light' : 'dark';
    save();
    renderStatic();
    renderHistory();
    renderExplain();
  });

  $('filament-select').addEventListener('change', (e) => {
    closeFilamentForm();
    state.activeId = e.target.value;
    selected = null;
    save();
    render();
  });

  $('filament-add').addEventListener('click', () => openFilamentForm('create'));
  $('filament-rename').addEventListener('click', () => openFilamentForm('rename'));
  $('filament-cancel').addEventListener('click', closeFilamentForm);
  $('filament-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitFilamentForm();
  });
  $('filament-form').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFilamentForm();
  });
  armable($('filament-delete'), 'deleteFilament', deleteFilament);

  const ratio = $('current-ratio');
  ratio.addEventListener('input', () => setCurrent(parseFloat(ratio.value.replace(',', '.'))));
  ratio.addEventListener('blur', () => { ratio.value = fmtRatio(fil().current); });
  document.querySelectorAll('[data-nudge]').forEach((b) => b.addEventListener('click', () => {
    setCurrent(round(fil().current + parseFloat(b.dataset.nudge), 4));
    ratio.value = fmtRatio(fil().current);
  }));

  $('wall-nominal').addEventListener('input', (e) => {
    const n = parseFloat(e.target.value.replace(',', '.'));
    if (!(n > 0)) return;
    state.wall.nominal = n;
    save();
    renderResult();
    renderWallViz();
  });

  $('copy-btn').addEventListener('click', async () => {
    const r = compute();
    if (!r) return;
    const btn = $('copy-btn');
    try {
      await navigator.clipboard.writeText(fmtRatio(r.value));
      btn.textContent = t('copied');
      setTimeout(() => { btn.textContent = t('copy'); }, 1400);
    } catch { /* clipboard blocked: value is still visible */ }
  });

  $('apply-btn').addEventListener('click', applyResult);
  $('undo-btn').addEventListener('click', undo);
  $('csv-btn').addEventListener('click', () => {
    const f = fil();
    download(`flow-${slug(f.name)}.csv`, historyToCsv(f.name, chain(f.start, f.history)), 'text/csv;charset=utf-8');
  });
  $('print-btn').addEventListener('click', () => window.print());
  armable($('reset-btn'), 'reset', () => {
    const f = fil();
    f.history = [];
    f.start = f.current;
    save();
    render();
  });

  $('ex-base').addEventListener('input', renderExplain);
  $('ex-step').addEventListener('input', renderExplain);

  // Keyboard: arrow keys move through the blocks.
  document.addEventListener('keydown', (e) => {
    if (state.method === 'wall' || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.target.matches('input, select, textarea')) return;
    const mods = METHODS[state.method].modifiers;
    const i = selected === null ? Math.floor(mods.length / 2) - (e.key === 'ArrowRight' ? 1 : 0) : mods.indexOf(selected);
    const next = mods[Math.min(mods.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)))];
    selected = next;
    renderBlocks();
    renderResult();
    e.preventDefault();
  });

  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (!state.theme) render(); });
}

bind();
render();
