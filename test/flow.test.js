import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  range, METHODS, applyModifier, singleWall, chain, compareInterpretations,
  warnings, edgeHint, historyToCsv, stdev, round,
  AREAS, effectiveFlow, keepEffectiveFactor, outerWallFactorFromWall, areaTable,
} from '../src/flow.js';

test('range has no floating point drift', () => {
  assert.deepEqual(range(-0.05, 0.05, 0.01), [-0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.05]);
});

test('block sets match the OrcaSlicer wiki', () => {
  assert.equal(METHODS.yolo.modifiers.length, 11);
  assert.equal(METHODS.perfectionist.modifiers.length, 16);
  assert.equal(METHODS.perfectionist.modifiers[0], -0.04);
  assert.equal(METHODS.perfectionist.modifiers.at(-1), 0.035);
  assert.deepEqual(METHODS.pass1.modifiers, [-20, -15, -10, -5, 0, 5, 10, 15, 20]);
  assert.deepEqual(METHODS.pass2.modifiers, [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0]);
});

test('YOLO is additive (wiki example 0.98 + 0.01 = 0.99)', () => {
  assert.equal(applyModifier(0.98, 0.01, 'additive'), 0.99);
  assert.equal(applyModifier(1, -0.05, 'additive'), 0.95);
});

test('2-pass is relative to the current value', () => {
  assert.equal(applyModifier(1, -5, 'percent'), 0.95);
  assert.equal(applyModifier(0.95, -5, 'percent'), 0.9025);
});

test('the new value becomes the new 100 %', () => {
  const rows = chain(1, [{ to: 0.95 }, { to: 0.9025 }]);
  assert.equal(round(rows[1].stepPct, 6), -5);
  assert.equal(round(rows[1].totalPct, 4), -9.75);
});

test('additive and percent diverge away from 1.0', () => {
  const c = compareInterpretations(0.9, 5);
  assert.equal(c.additive, 0.95);
  assert.equal(c.relative, 0.945);
  assert.equal(c.difference, 0.005);
  assert.equal(compareInterpretations(1, 5).difference, 0);
});

test('single wall: thicker wall lowers the ratio', () => {
  const r = singleWall(1, 0.45, [0.47, 0.48, 0.46, 0.47]);
  assert.equal(r.count, 4);
  assert.ok(Math.abs(r.mean - 0.47) < 1e-12);
  assert.equal(round(r.newRatio, 4), 0.9574);
  assert.ok(r.deviationPct > 4 && r.deviationPct < 4.5);
});

test('single wall ignores empty and invalid readings', () => {
  const r = singleWall(0.98, 0.42, [0.42, NaN, 0, -1]);
  assert.equal(r.count, 1);
  assert.equal(r.newRatio, 0.98);
  assert.equal(r.stdev, 0);
});

test('invalid input throws instead of returning garbage', () => {
  assert.throws(() => applyModifier(0, 0.01, 'additive'), RangeError);
  assert.throws(() => applyModifier(1, 0.01, 'bogus'), TypeError);
  assert.throws(() => singleWall(1, 0.45, []), RangeError);
  assert.throws(() => singleWall(1, 0, [0.4]), RangeError);
});

test('warnings flag implausible values and big jumps', () => {
  assert.deepEqual(warnings(1, 0.97), []);
  assert.ok(warnings(1, 0.7).includes('tooLow'));
  assert.ok(warnings(1, 1.2).includes('tooHigh'));
  assert.ok(warnings(1, 0.9).includes('bigStep'));
});

test('edge hints suggest a follow-up print', () => {
  assert.equal(edgeHint('yolo', -0.05), 'edgeLow');
  assert.equal(edgeHint('yolo', 0.05), 'edgeHigh');
  assert.equal(edgeHint('yolo', 0), null);
  assert.equal(edgeHint('pass2', 0), null);
});

test('stdev is the sample deviation', () => {
  assert.equal(round(stdev([2, 4, 4, 4, 5, 5, 7, 9]), 4), 2.1381);
});

test('CSV is semicolon separated and escapes notes', () => {
  const csv = historyToCsv('PLA; blau', [
    { date: '2026-09-28', method: 'yolo', modifier: -0.02, from: 1, to: 0.98, stepPct: -2, totalPct: -2, note: 'say "hi"' },
  ]);
  const [head, row] = csv.trim().split('\n');
  assert.equal(head.split(';').length, 9);
  assert.ok(row.includes('"PLA; blau"'));
  assert.ok(row.includes('"say ""hi"""'));
});

test('areas match the OrcaSlicer process options', () => {
  assert.equal(AREAS.length, 11);
  assert.deepEqual(AREAS.filter((a) => a.always).map((a) => a.key),
    ['top_solid_infill_flow_ratio', 'bottom_solid_infill_flow_ratio']);
});

test('effective flow multiplies filament, process and area factor', () => {
  assert.equal(effectiveFlow(0.95, 1, 0.97), 0.9215);
  assert.equal(effectiveFlow(0.95, 1.02, 1), 0.969);
  assert.throws(() => effectiveFlow(0.95, 1, -0.1), RangeError);
});

test('keeping the effective flow rescales the factor', () => {
  // 1.00 × 0.97 = 0.97 before; filament now 0.95 → factor 0.97/0.95
  const f = keepEffectiveFactor(0.97, 1, 0.95);
  assert.equal(round(f, 4), 1.0211);
  assert.equal(round(effectiveFlow(0.95, 1, f), 6), 0.97);
});

test('single wall can correct the outer wall factor alone', () => {
  assert.equal(round(outerWallFactorFromWall(1, 0.45, 0.47), 4), 0.9574);
  assert.throws(() => outerWallFactorFromWall(1, 0.45, 0), RangeError);
});

test('area table: factors stay, effective flow follows the filament', () => {
  const rows = areaTable({ oldFilament: 1, newFilament: 0.95, factors: { top: 0.97, outerWall: 0.98 } });
  const top = rows.find((r) => r.id === 'top');
  assert.equal(top.active, true);
  assert.equal(top.setFactor, 0.97);
  assert.equal(top.changed, false);
  assert.equal(top.effOld, 0.97);
  assert.equal(top.effNew, 0.9215);
  // "set other flow ratios" off: the outer wall factor is ignored by Orca.
  const wall = rows.find((r) => r.id === 'outerWall');
  assert.equal(wall.active, false);
  assert.equal(wall.effOld, 1);
  assert.equal(wall.effNew, 0.95);
});

test('area table: keep effective mode rescales only active factors', () => {
  const rows = areaTable({ oldFilament: 1, newFilament: 0.95, other: true, mode: 'effective', factors: { outerWall: 0.98 } });
  const wall = rows.find((r) => r.id === 'outerWall');
  assert.equal(wall.active, true);
  assert.equal(wall.changed, true);
  assert.equal(wall.effNew, wall.effOld);
  // Untuned areas (1.0) follow the filament, or the calibration would be lost.
  const inner = rows.find((r) => r.id === 'innerWall');
  assert.equal(inner.changed, false);
  assert.equal(inner.effNew, 0.95);
  const off = areaTable({ oldFilament: 1, newFilament: 0.95, mode: 'effective', factors: { outerWall: 0.98 } });
  assert.equal(off.find((r) => r.id === 'outerWall').changed, false);
});

test('area table: process flow ratio multiplies every area', () => {
  const rows = areaTable({ oldFilament: 0.95, print: 1.02 });
  assert.ok(rows.every((r) => r.effOld === 0.969));
});

test('area table without a new value keeps everything', () => {
  const rows = areaTable({ oldFilament: 0.95, factors: { top: 0.97 } });
  assert.ok(rows.every((r) => r.effOld === r.effNew && !r.changed));
});
