// Fast drop-in for makefun-diff 1.0.0: run(input) returns exactly makefun-diff's
// patch of { old, new }, as one JSON string, but computed with a typed-array
// Myers search instead of jsdiff's object-per-path walk.
//
// The rule, from makefun-diff's own header (vendor/makefun-diff/index.js in the
// kit): lines are cut after every "\n" (a "\r" is part of its line; a last line
// with no "\n" is a line too); the common prefix is kept, then the common suffix
// of what is left; between them Myers's greedy search, which on each diagonal
// keeps the path reaching furthest into the old text and, when a deletion and an
// insertion reach the same point, takes the deletion's; it never moves past
// either text's end, prunes no edge diagonal, and follows every run of equal
// lines as far as it goes; the first path to reach both ends is the script.
//
// Speed comes from three changes, none of which changes the script:
//  1. Lines are interned to integer ids once per case, so every comparison in
//     the search is an integer compare, never a string compare.
//  2. The search keeps, per depth d, one Int32Array V of the furthest old-line
//     count reached on each diagonal (stored plus one, so 0 means "no path of
//     d edits reaches this diagonal", which also covers out-of-range reads),
//     instead of one linked-list path object per (d, k). The script is
//     recovered afterwards by walking the snapshots back down with the same
//     tie-break the forward search used, so the recovered path is the same
//     path.
//  3. No slicing copies: prefix/suffix trimming is index arithmetic on the id
//     arrays, and the patch is assembled from the same line strings.

const KEEP = '=';
const DELETE = '-';
const INSERT = '+';
const CONTEXT = 3;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const lines = [];
  let start = 0;
  for (;;) {
    const idx = text.indexOf('\n', start);
    if (idx === -1) break;
    lines.push(text.slice(start, idx + 1));
    start = idx + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/**
 * The runs of the edit script of the middle slices A[0..n) into B[0..m):
 * [{ kind, count }] in order, kinds KEEP/DELETE/INSERT, exactly the runs
 * makefun-diff's editRuns returns for the same slices.
 *
 * Forward pass: Vs[d] is one Int32Array of length 2d+1, index k + d, holding
 * the number of old lines consumed by the furthest path of d edits on
 * diagonal k (k = consumedOld - consumedNew), plus one: 0 means no path of d
 * edits reaches k. After the forward pass, walk the snapshots back down from
 * (n, m) to recover the path's components. The stored value is cx + 1 so a
 * zero read (including an out-of-range index, which reads undefined, and
 * undefined | 0 is 0) always means "no path here".
 */
function editRuns(A, n, B, m) {
  const Vs = [];
  const endK = n - m;

  // Depth 0: the snake from (0, 0).
  let V = new Int32Array(1);
  let cx = 0;
  let cy = 0;
  while (cx < n && cy < m && A[cx] === B[cy]) { cx++; cy++; }
  V[0] = cx + 1;
  Vs.push(V);
  if (cx >= n && cy >= m) return cx > 0 ? [{ kind: KEEP, count: cx }] : [];

  const maxD = n + m;
  let D = -1;
  for (let d = 1; d <= maxD; d++) {
    const Vp = Vs[d - 1];
    V = new Int32Array(2 * d + 1);
    let done = false;
    // k runs -d..d step 2; idx = k + d is the store index, delIdx = idx - 2
    // and insIdx = idx are the parent indices into Vp (out-of-range reads
    // give undefined, which | 0 turns into 0, i.e. "no path").
    for (let k = -d, idx = 0; k <= d; k += 2, idx += 2) {
      const pvDel = Vp[idx - 2] | 0;
      const pvIns = Vp[idx] | 0;
      let canDel = false;
      let canIns = false;
      let byDel = -2;
      let byIns = -2;
      if (pvDel !== 0) {
        const pcx = pvDel - 1;
        if (pcx < n) { canDel = true; byDel = pcx; }
      }
      if (pvIns !== 0) {
        const pcx = pvIns - 1;
        // Insertion parent's new lines consumed: pcx - k - 1; the inserted
        // line exists when that count is still below m, i.e. pcx - k <= m.
        if (pcx - k <= m) { canIns = true; byIns = pcx - 1; }
      }
      if (!canDel && !canIns) continue;
      let x;
      if (canDel && (!canIns || byDel >= byIns)) x = pvDel;
      else x = pvIns - 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      V[idx] = x + 1;
      // Only diagonal endK can reach both ends: x >= n then forces y >= m.
      if (k === endK && x >= n) { D = d; done = true; break; }
    }
    Vs.push(V);
    if (done) break;
  }
  if (D === -1) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack from (n, m) on diagonal endK, collecting components in reverse.
  const rev = [];
  let k = endK;
  cx = n;
  cy = m;
  for (let d = D; d >= 1; d--) {
    const Vp = Vs[d - 1];
    const idx = k + d;
    const pvDel = Vp[idx - 2] | 0;
    const pvIns = Vp[idx] | 0;
    let canDel = false;
    let canIns = false;
    let byDel = -2;
    let byIns = -2;
    if (pvDel !== 0) {
      const pcx = pvDel - 1;
      if (pcx < n) { canDel = true; byDel = pcx; }
    }
    if (pvIns !== 0) {
      const pcx = pvIns - 1;
      if (pcx - k <= m) { canIns = true; byIns = pcx - 1; }
    }
    let kind;
    let pcx;
    let pcy;
    if (canDel && (!canIns || byDel >= byIns)) {
      kind = DELETE;
      pcx = pvDel - 1;
      pcy = pcx - (k - 1);
      // The edit deleted old line pcx; the snake after it ran to (cx, cy).
      const kept = cx - (pcx + 1);
      if (kept > 0) rev.push({ kind: KEEP, count: kept });
      k = k - 1;
    } else {
      kind = INSERT;
      pcx = pvIns - 1;
      pcy = pcx - (k + 1);
      // The edit inserted new line pcy; the snake after it ran to (cx, cy).
      const kept = cx - pcx;
      if (kept > 0) rev.push({ kind: KEEP, count: kept });
      k = k + 1;
    }
    // Merge with the run pushed just before this one when it is the same
    // kind (consecutive edits with no kept line between them form one run).
    const last = rev[rev.length - 1];
    if (last !== undefined && last.kind === kind) last.count++;
    else rev.push({ kind, count: 1 });
    cx = pcx;
    cy = pcy;
  }
  // The opening snake, from (0, 0) to where depth 0 ended.
  if (cx > 0) rev.push({ kind: KEEP, count: cx });
  rev.reverse();
  return rev;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const aLines = tokenize(input.old);
  const bLines = tokenize(input.new);
  const n = aLines.length;
  const m = bLines.length;

  // Intern every distinct line to an integer id, shared by both texts.
  const ids = new Map();
  const aIds = new Int32Array(n);
  const bIds = new Int32Array(m);
  let nextId = 0;
  for (let i = 0; i < n; i++) {
    const s = aLines[i];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    aIds[i] = id;
  }
  for (let i = 0; i < m; i++) {
    const s = bLines[i];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    bIds[i] = id;
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) suffix++;
  const midA = aIds.subarray(prefix, n - suffix);
  const midB = bIds.subarray(prefix, m - suffix);
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(midA, midA.length, midB, midB.length));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes.at(-1);
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.at(-1);
    const prev = h?.at(-1);
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h.at(-1);
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, aLines[at]));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, aLines[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, bLines[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, aLines[at]));
  }
  return out.join('');
}
