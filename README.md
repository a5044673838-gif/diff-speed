# diff-speed

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/a5044673838-gif/diff-speed/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/a5044673838-gif/diff-speed/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A fast drop-in for makefun-diff 1.0.0: `solve.js` returns exactly makefun-diff's
patch of two texts, computed with a typed-array Myers search (integer-interned
lines, one Int32Array of furthest reaches per depth, backtracked with the same
tie-break) instead of one linked-list path object per search step.

## Run it

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

`main.ts` reads every case from `$MAKEFUN_INPUT_DIR/cases.json` and writes
`$MAKEFUN_OUTPUT_DIR/answers.json`. To self-test and benchmark:

```sh
node bench.mjs [cases.json]
```
