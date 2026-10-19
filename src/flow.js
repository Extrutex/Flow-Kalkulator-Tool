// Pure calculation core. No DOM access here, so everything is testable in Node.
//
// Formulas follow the OrcaSlicer wiki (flow_ratio_calib):
//   YOLO / YOLO Perfectionist:  new = old + modifier          (absolute step)
//   2-Pass (legacy):            new = old * (100 + modifier) / 100   (percent step)
// Classic single-wall method (calipers):
//   new = old * nominal_line_width / measured_wall_thickness

const EPS = 1e-9;

/** Inclusive numeric range without floating point drift (0.1 + 0.2 problem). */
export function range(start, end, step) {
  if (!(step > 0)) throw new RangeError('step must be > 0');
  const decimals = Math.max(countDecimals(start), countDecimals(step));
  const factor = 10 ** decimals;
  const s = Math.round(start * factor);
  const e = Math.round(end * factor);
  const st = Math.round(step * factor);
  const out = [];
  for (let v = s; v <= e; v += st) out.push(v / factor);
  return out;
}

function countDecimals(n) {
  const str = String(n);
  if (str.includes('e-')) return Number(str.split('e-')[1]);
  const dot = str.indexOf('.');
  return dot === -1 ? 0 : str.length - dot - 1;
}

export const METHODS = {
  yolo: {
    id: 'yolo',
    kind: 'additive',
    modifiers: range(-0.05, 0.05, 0.01),
  },
  perfectionist: {
    id: 'perfectionist',
    kind: 'additive',
    modifiers: range(-0.04, 0.035, 0.005),
  },
  pass1: {
    id: 'pass1',
    kind: 'percent',
    modifiers: range(-20, 20, 5),
  },
  pass2: {
    id: 'pass2',
    kind: 'percent',
    modifiers: range(-9, 0, 1),
  },
};

/** Round to n decimals, avoiding -0 and binary noise. */
export function round(value, decimals = 4) {
  const f = 10 ** decimals;
  const r = Math.round((value + Math.sign(value) * EPS) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Apply a block modifier to the current flow ratio. */
export function applyModifier(oldRatio, modifier, kind) {
  assertRatio(oldRatio);
  if (!Number.isFinite(modifier)) throw new TypeError('modifier must be a finite number');
  if (kind === 'additive') return round(oldRatio + modifier, 6);
  if (kind === 'percent') return round((oldRatio * (100 + modifier)) / 100, 6);
  throw new TypeError(`unknown modifier kind: ${kind}`);
}

/** The value the block with this modifier was actually printed with. */
export function blockRatio(oldRatio, modifier, kind) {
  return applyModifier(oldRatio, modifier, kind);
}

export function mean(values) {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1). Returns 0 for a single value. */
export function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sq = values.reduce((a, v) => a + (v - m) ** 2, 0);
  return Math.sqrt(sq / (values.length - 1));
}

/**
 * Classic single-wall calibration: print a single-perimeter cube (vase mode),
 * measure the wall with calipers on several sides, compare with the line width
 * set in the slicer.
 */
export function singleWall(oldRatio, nominalWidth, measurements) {
  assertRatio(oldRatio);
  if (!(nominalWidth > 0)) throw new RangeError('nominal line width must be > 0');
  const values = measurements.filter((v) => Number.isFinite(v) && v > 0);
  if (!values.length) throw new RangeError('at least one valid measurement is required');
  const m = mean(values);
  const sd = stdev(values);
  return {
    count: values.length,
    mean: m,
    stdev: sd,
    min: Math.min(...values),
    max: Math.max(...values),
    spread: Math.max(...values) - Math.min(...values),
    deviationPct: (m / nominalWidth - 1) * 100,
    newRatio: round((oldRatio * nominalWidth) / m, 6),
  };
}

/** Relative change in percent between two ratios. */
export function relativeChangePct(from, to) {
  assertRatio(from);
  return (to / from - 1) * 100;
}

/**
 * Walk a calibration history and report every step both relative to the
 * previous value (what the slicer shows as "100 %" at that point) and
 * relative to the very first value.
 */
export function chain(startRatio, steps) {
  assertRatio(startRatio);
  const rows = [];
  let current = startRatio;
  for (const step of steps) {
    const next = step.to;
    rows.push({
      ...step,
      from: current,
      to: next,
      stepPct: relativeChangePct(current, next),
      totalPct: relativeChangePct(startRatio, next),
    });
    current = next;
  }
  return rows;
}

/**
 * Show why additive and percent steps diverge once the base is no longer 1.0.
 * Returns the result of the same nominal step (e.g. "5") under both readings.
 */
export function compareInterpretations(oldRatio, percent) {
  const additive = applyModifier(oldRatio, percent / 100, 'additive');
  const relative = applyModifier(oldRatio, percent, 'percent');
  return { additive, relative, difference: round(additive - relative, 6) };
}

export const PLAUSIBLE = { min: 0.8, max: 1.15, bigStepPct: 8 };

/** Human-facing warnings, returned as keys so the UI can translate them. */
export function warnings(oldRatio, newRatio) {
  const out = [];
  if (!Number.isFinite(newRatio)) return ['invalid'];
  if (newRatio < PLAUSIBLE.min) out.push('tooLow');
  if (newRatio > PLAUSIBLE.max) out.push('tooHigh');
  if (Math.abs(relativeChangePct(oldRatio, newRatio)) > PLAUSIBLE.bigStepPct) out.push('bigStep');
  return out;
}

/** Suggest a follow-up test if the best block sits at the edge of the range. */
export function edgeHint(method, modifier) {
  const mods = METHODS[method].modifiers;
  if (Math.abs(modifier - mods[0]) < EPS) return 'edgeLow';
  if (Math.abs(modifier - mods[mods.length - 1]) < EPS && method !== 'pass2') return 'edgeHigh';
  return null;
}

// ---------- process profile: flow per area ----------
//
// OrcaSlicer (GCode.cpp, extrude path):
//   effective = filament_flow_ratio × print_flow_ratio × area factor
// Top and bottom surface factors always apply. All other area factors (and the
// first-layer factor on layer 1) only apply when "set_other_flow_ratios" is on.
// The filament value is the 100 %; the area factors are relative to it.
// The flow calibration resets top surface and print_flow_ratio to 1.0 on the
// test blocks, so the calibrated filament value is free of both.

export const AREAS = [
  { id: 'top', key: 'top_solid_infill_flow_ratio', always: true },
  { id: 'bottom', key: 'bottom_solid_infill_flow_ratio', always: true },
  { id: 'firstLayer', key: 'first_layer_flow_ratio', always: false },
  { id: 'outerWall', key: 'outer_wall_flow_ratio', always: false },
  { id: 'innerWall', key: 'inner_wall_flow_ratio', always: false },
  { id: 'overhang', key: 'overhang_flow_ratio', always: false },
  { id: 'sparseInfill', key: 'sparse_infill_flow_ratio', always: false },
  { id: 'internalSolid', key: 'internal_solid_infill_flow_ratio', always: false },
  { id: 'gapFill', key: 'gap_fill_flow_ratio', always: false },
  { id: 'support', key: 'support_flow_ratio', always: false },
  { id: 'supportInterface', key: 'support_interface_flow_ratio', always: false },
];

/** Range OrcaSlicer accepts for every area factor. */
export const FACTOR_LIMITS = { min: 0, max: 2 };

/** Flow that actually reaches the nozzle for one area. */
export function effectiveFlow(filament, print, factor) {
  assertRatio(filament);
  assertRatio(print);
  if (!Number.isFinite(factor) || factor < 0) throw new RangeError('area factor must be >= 0');
  return round(filament * print * factor, 6);
}

/**
 * Area factor that keeps the effective flow unchanged when the filament
 * value moves from oldFilament to newFilament.
 */
export function keepEffectiveFactor(factor, oldFilament, newFilament) {
  assertRatio(oldFilament);
  assertRatio(newFilament);
  return round((factor * oldFilament) / newFilament, 6);
}

/**
 * Single-wall cube alternative: correct only the outer wall factor and leave
 * the filament value alone. The cube wall is an outer wall, so its flow is
 * filament × print × outer wall factor.
 */
export function outerWallFactorFromWall(factor, nominalWidth, measuredWidth) {
  if (!(nominalWidth > 0) || !(measuredWidth > 0)) throw new RangeError('widths must be > 0');
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('area factor must be > 0');
  return round((factor * nominalWidth) / measuredWidth, 6);
}

/**
 * One row per area: is the factor active, what flows now, what flows after
 * the new filament value, and which factor to enter in OrcaSlicer.
 * mode 'factor':    leave the factors alone, effective flow follows the filament.
 * mode 'effective': keep today's effective flow for tuned areas (factor != 1),
 *                   their factors are rescaled. Areas at 1.0 follow the filament,
 *                   otherwise the calibration would be undone for them.
 */
export function areaTable({ oldFilament, newFilament, print = 1, other = false, factors = {}, mode = 'factor' }) {
  assertRatio(oldFilament);
  const next = Number.isFinite(newFilament) ? newFilament : oldFilament;
  assertRatio(next);
  return AREAS.map((area) => {
    const active = area.always || other;
    const factor = Number.isFinite(factors[area.id]) ? factors[area.id] : 1;
    const applied = active ? factor : 1;
    const effOld = effectiveFlow(oldFilament, print, applied);
    const keep = mode === 'effective' && active && Math.abs(factor - 1) > EPS;
    const setFactor = keep ? keepEffectiveFactor(factor, oldFilament, next) : factor;
    const effNew = effectiveFlow(next, print, active ? setFactor : 1);
    return {
      ...area,
      active,
      factor,
      effOld,
      effNew,
      setFactor,
      changed: Math.abs(setFactor - factor) > EPS,
      outOfRange: setFactor < FACTOR_LIMITS.min || setFactor > FACTOR_LIMITS.max,
    };
  });
}

function assertRatio(r) {
  if (!Number.isFinite(r) || r <= 0) throw new RangeError('flow ratio must be a positive number');
}

/** Serialize a history as CSV (semicolon, works with German Excel). */
export function historyToCsv(filament, rows) {
  const head = ['date', 'filament', 'method', 'modifier', 'from', 'to', 'step_pct', 'total_pct', 'note'];
  const esc = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(';')];
  for (const r of rows) {
    lines.push(
      [r.date, filament, r.method, r.modifier ?? '', r.from, r.to, round(r.stepPct, 3), round(r.totalPct, 3), r.note ?? '']
        .map(esc)
        .join(';'),
    );
  }
  return lines.join('\n') + '\n';
}
