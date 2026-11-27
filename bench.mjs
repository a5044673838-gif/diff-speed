// Benchmark + differential test for solve.js against makefun-diff 1.0.0.
// Usage: node bench.mjs [cases.json]
//   - compares my run() with the reference diffPatch on every case
//   - times both (CPU time via process.cpuUsage) over repeated runs
//   - also runs a battery of hand-built edge cases
import { readFileSync } from 'node:fs';
import { run as mine } from './solve.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const KIT = '/home/hatch/workspace/make-fun/kits-batch21/unpack/diff-speed-01-run-20261126-kit';
const { diffPatch } = await import(KIT + '/baselines/makefun-diff/vendor/makefun-diff/index.js');

function cpuMs(fn) {
  const t0 = process.cpuUsage();
  const s0 = process.hrtime.bigint();
  const r = fn();
  const t1 = process.cpuUsage(t0);
  const s1 = process.hrtime.bigint();
  return { cpu: (t1.user + t1.system) / 1000, wall: Number(s1 - s0) / 1e6, r };
}

// --- hand-built edge cases (expected outputs computed by the reference) ---
const edge = [
  { old: '', new: '' },
  { old: '', new: 'a\n' },
  { old: 'a\n', new: '' },
  { old: 'a', new: 'a' },
  { old: 'a', new: 'b' },
  { old: 'a\n', new: 'a' },
  { old: 'a', new: 'a\n' },
  { old: '\n', new: '' },
  { old: '', new: '\n' },
  { old: 'x\ny\nz\n', new: 'x\ny\nz\n' },
  { old: 'x\ny\nz\n', new: 'x\nq\nz\n' },
  { old: 'a\r\nb\r\n', new: 'a\r\nb\n' },
  { old: 'a\r\nb\r\n', new: 'a\nb\r\n' },
  { old: 'same\n'.repeat(50), new: 'same\n'.repeat(50) },
  { old: 'a\nb\nc\nd\ne\nf\ng\n', new: 'a\nX\nc\nd\nY\nf\ng\n' },
  { old: '1\n2\n3\n4\n5\n6\n7\n8\n', new: '8\n7\n6\n5\n4\n3\n2\n1\n' },
  { old: 'a\n'.repeat(100), new: 'b\n'.repeat(100) },
  { old: 'l1\nl2\nl3\n', new: 'l0\nl1\nl2\nl3\nl4\n' },
  { old: 'l0\nl1\nl2\nl3\nl4\n', new: 'l1\nl2\nl3\n' },
  { old: 'a\nb\n', new: 'a\nb\nc\nd\ne\nf\ng\nh\n' },
  { old: 'a\nb\nc\nd\ne\nf\ng\nh\n', new: 'a\nb\n' },
  { old: 'x', new: 'x\ny\nz' },
  { old: 'x\ny\nz', new: 'x' },
];
let edgeFail = 0;
for (const c of edge) {
  const a = mine(c);
  const b = diffPatch(c);
  if (a !== b) { edgeFail++; console.log('EDGE DIFFERS:', JSON.stringify(c).slice(0, 120)); console.log(' mine:', JSON.stringify(a).slice(0, 300)); console.log(' ref :', JSON.stringify(b).slice(0, 300)); }
}
console.log(`edge cases: ${edge.length - edgeFail}/${edge.length} identical`);

// --- random differential test (deterministic PRNG, same style as the generator) ---
function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
const VOCAB = ['ka', 'lo', 'mi', 'ne', 'ru', 'ta', 'shi', 'vo', 'zen', 'pa', 'qui', 'dor', 'el', 'fa', 'gu', 'hy', 'jo', 'ix', 'bra', 'ost', 'um', 'wy', 'cel', 'ser', '}', '{', '', '  ', '    return x;', '  foo();', 'const a = 1;'];
function randLine(r) {
  const n = 1 + Math.floor(r() * 4);
  let w = '';
  for (let i = 0; i < n; i++) w += (i ? ' ' : '') + VOCAB[Math.floor(r() * VOCAB.length)];
  return w;
}
function randCase(r, nLines, nChanges) {
  const old = [];
  for (let i = 0; i < nLines; i++) old.push(randLine(r));
  const nw = old.slice();
  for (let i = 0; i < nChanges; i++) {
    const op = r();
    const at = Math.floor(r() * nw.length);
    if (op < 0.35) nw[at] = randLine(r); // replace
    else if (op < 0.55) nw.splice(at, 1); // delete
    else if (op < 0.75) nw.splice(at, 0, randLine(r)); // insert
    else if (op < 0.9) { const a = Math.floor(r() * nw.length), b = Math.floor(r() * nw.length); const t = nw[a]; nw[a] = nw[b]; nw[b] = t; } // swap
    else nw.splice(at, 0, nw[at]); // double
  }
  const crlf = r() < 0.25;
  const noTrailOld = r() < 0.25;
  const noTrailNew = r() < 0.25;
  const join = (arr, noTrail) => arr.map((l) => l + (crlf ? '\r\n' : '\n')).join('').replace(noTrail && arr.length ? /\r?\n$/ : /$^/, '');
  return { old: join(old, noTrailOld), new: join(nw, noTrailNew) };
}
let randFail = 0;
const R = rng(0x2545f491);
const N_RAND = 300;
for (let i = 0; i < N_RAND; i++) {
  const c = randCase(R, 50 + Math.floor(R() * 200), 5 + Math.floor(R() * 40));
  if (mine(c) !== diffPatch(c)) { randFail++; if (randFail <= 3) console.log('RAND DIFFERS case', i, JSON.stringify(c).slice(0, 200)); }
}
console.log(`random cases: ${N_RAND - randFail}/${N_RAND} identical`);

// --- benchmark on the practice set ---
const casesFile = process.argv[2] ?? KIT + '/practice/input/cases.json';
const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
const inputs = cases.map((c) => c.input);
for (const [name, fn] of [['mine', mine], ['baseline', diffPatch]]) {
  // warm-up
  for (const inp of inputs) fn(inp);
  let cpu = 0, wall = 0;
  const REPS = 5;
  for (let i = 0; i < REPS; i++) {
    const { cpu: c, wall: w } = cpuMs(() => { for (const inp of inputs) fn(inp); });
    cpu += c; wall += w;
  }
  console.log(`${name}: CPU ${(cpu / REPS).toFixed(1)} ms/run, wall ${(wall / REPS).toFixed(1)} ms/run over ${inputs.length} cases`);
}
