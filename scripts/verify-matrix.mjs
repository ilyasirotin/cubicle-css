// Cubicle verification matrix. Development tool only; not part of the shipped kit.
//
// Setup:          as scripts/verify-browser.mjs.
// Run:            node scripts/verify-matrix.mjs [--pages index,example] [--browsers chromium,firefox,webkit]
//                                                [--min] [--jobs 3] [--only forms,keyboard] [--shots none]
//                 Runs scripts/verify-browser.mjs for every page and browser, up to --jobs at a time.
//                 --pages takes page names in docs/ or paths (both pages by default).
//                 --browsers takes engines (all three by default).
//                 --min builds dist/*.min.* first (scripts/build-min.sh) and checks the minified files
//                 as well as the source.
//                 --only and --shots none are passed to every run (see verify-browser.mjs).
// Output:         one line per run as it ends, then every FAIL line. Each run writes its report to
//                 tmp/verify/<run>.txt and its screenshots to tmp/shots/<run>/, where <run> is
//                 <page>-<browser>[-min], e.g. index-webkit.
// Exit code:      0 when every run passes, 1 otherwise, 2 on bad arguments.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] ?? '' : fallback;
};
const flag = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };

const pages = option('--pages', 'index,example').split(',').filter(Boolean)
  .map((p) => (p.includes('/') || p.endsWith('.html') ? p : `docs/${p}.html`));
const browsers = option('--browsers', 'chromium,firefox,webkit').split(',').filter(Boolean);
const jobs = Number(option('--jobs', '3'));
const only = option('--only', null);
const shots = option('--shots', null);
const min = flag('--min');
const bad = browsers.filter((b) => !['chromium', 'firefox', 'webkit'].includes(b));
if (args.length || bad.length || !pages.length || !(jobs >= 1) || (shots !== null && shots !== 'none')) {
  console.error(`unexpected ${[...args, ...bad].join(' ') || 'value'}; see the header of scripts/verify-matrix.mjs`);
  process.exit(2);
}

if (min) {
  const built = spawnSync('bash', ['scripts/build-min.sh'], { cwd: root, encoding: 'utf8' });
  if (built.status !== 0) { console.error(`build-min.sh failed\n${built.stdout}${built.stderr}`); process.exit(1); }
}

const runs = [];
for (const page of pages) {
  for (const browser of browsers) {
    for (const minified of min ? [false, true] : [false]) {
      const name = `${basename(page, extname(page))}-${browser}${minified ? '-min' : ''}`;
      runs.push({ name, args: [page, '--browser', browser, '--shots', shots ?? `tmp/shots/${name}`,
        ...(minified ? ['--css', 'dist/cubicle.min.css', '--js', 'dist/cubicle.min.js'] : []),
        ...(only ? ['--only', only] : [])] });
    }
  }
}

mkdirSync(resolve(root, 'tmp/verify'), { recursive: true });
const started = Date.now();
const failures = [];
let failed = 0;

const run = ({ name, args: runArgs }) => new Promise((done) => {
  const t0 = Date.now();
  const child = spawn(process.execPath, ['scripts/verify-browser.mjs', ...runArgs], { cwd: root });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => {
    writeFileSync(resolve(root, `tmp/verify/${name}.txt`), out);
    const summary = out.trim().split('\n').at(-1) ?? '';
    const counts = summary.match(/\d+\/\d+ checks passed(?: \(\d+ skipped as engine limits\))?/)?.[0] ?? 'crashed';
    const seconds = Math.round((Date.now() - t0) / 1000);
    console.log(`${code === 0 ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${counts}  ${seconds}s`);
    if (code !== 0) {
      failed++;
      failures.push(...out.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => `${name}: ${l}`));
      if (!out.includes('checks passed')) failures.push(`${name}: ${out.split('\n').find((l) => /^\w[\w.]*: |Error:/.test(l))?.trim() ?? summary}`);
    }
    done();
  });
});

// A small pool: each browser slows when several run at once, so --jobs stays near the engine count.
const queue = [...runs];
await Promise.all(Array.from({ length: Math.min(jobs, runs.length) }, async () => {
  while (queue.length) await run(queue.shift());
}));

for (const f of failures) console.log(f);
console.log(`\n${runs.length - failed}/${runs.length} runs passed in ${Math.round((Date.now() - started) / 1000)}s. Reports: tmp/verify/, screenshots: ${shots === 'none' ? 'none' : 'tmp/shots/<run>/'}`);
process.exit(failed ? 1 : 0);
