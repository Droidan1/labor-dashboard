// The Categories tab's y-axis labels.
//
// 🛑 THE BUG. ctNiceTicks steps by 1, 1.5, 2, 2.5, 3, 4, 5, 7.5 or 10 × a power of ten, so a
// tick is often NOT a whole thousand — and ctAxis rounded every label to one. A chart running
// to $2.3k drew gridlines at 0, 500, 1000, 1500, 2000, 2500 and labelled them
// $0, $500, $1k, $2k, $2k, $3k: two lines both called $2k, and $1.5k and $2.5k mislabelled.
// Units had the same fault below 1,000 (ticks of 0.75 printed as "1").
//
// A label is a claim about where its gridline sits. So this sweeps the axis across every
// magnitude the panel can reach, in both measures and at both tick counts the charts ask
// for (Vs 5, Trend 4), and asserts every label reads back as EXACTLY its tick, which also
// makes two labels on one axis impossible to share.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const slice = (from, to) => {
  const i = html.indexOf(from), j = html.indexOf(to, i + 1);
  ok(i > 0 && j > i, `found ${from.trim()} in index.html`);
  return html.slice(i, j);
};

console.log('\n── Categories · y-axis labels ──');

// The real source of both functions, run against a stand-in ctState.
const src = slice('  function ctAxis(', '  function ctPct(') + slice('  function ctNiceTicks(', '  function ctChartSVG(');
const ctState = { measure: 'net' };
const { ctAxis, ctNiceTicks } = new Function('ctState', src + '\nreturn { ctAxis, ctNiceTicks };')(ctState);

// "$1.5k" → 1500, "750" → 750. Anything else is a label this test cannot read, and fails.
const read = (s, net) => {
  const m = String(s).match(net ? /^\$(\d+(?:\.\d+)?)(k?)$/ : /^(\d+(?:\.\d+)?)(k?)$/);
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : NaN;
};

// The case on screen: a chart running to ~$2.3k, gridlines every $500.
ctState.measure = 'net';
const seen = ctNiceTicks(2300, 5).map(ctAxis);
ok(JSON.stringify(seen) === JSON.stringify(['$0', '$500', '$1k', '$1.5k', '$2k', '$2.5k']),
  `a $2.3k chart labels its gridlines $0 … $2.5k in $500 steps (got ${JSON.stringify(seen)})`);

let axes = 0, bad = [];
for (const measure of ['net', 'units']) {
  ctState.measure = measure;
  for (const n of [4, 5]) {
    // Both charts floor the max at 1, so the sweep starts there.
    for (let max = 1; max < 5e7; max *= 1.031) {
      const ticks = ctNiceTicks(max, n), labels = ticks.map(ctAxis);
      axes++;
      ticks.forEach((t, i) => {
        const back = read(labels[i], measure === 'net');
        if (!(Math.abs(back - t) <= 1e-9 * Math.max(1, t)) && bad.length < 8)
          bad.push(`${measure} n=${n} max=${max.toFixed(2)}: tick ${t} labelled "${labels[i]}"`);
      });
      if (new Set(labels).size !== labels.length && bad.length < 8)
        bad.push(`${measure} n=${n} max=${max.toFixed(2)}: duplicate labels ${JSON.stringify(labels)}`);
    }
  }
}
ok(bad.length === 0, `every label reads back as exactly its tick, across ${axes} axes:\n    ` + bad.join('\n    '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
