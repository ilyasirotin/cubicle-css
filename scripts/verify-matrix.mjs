// Cubicle verification matrix. Development tool only; not part of the shipped kit.
//
// Setup:          as scripts/verify-browser.mjs.
// Run:            node scripts/verify-matrix.mjs [--pages index,example] [--browsers chromium,firefox,webkit]
//                                                [--min] [--themes] [--jobs 3] [--only forms,keyboard]
//                                                [--shots none]
//                 Runs scripts/verify-browser.mjs for every page and browser, up to --jobs at a time.
//                 --pages takes page names in docs/ or paths (both pages by default).
//                 --browsers takes engines (all three by default).
//                 --min builds dist/*.min.* first (scripts/build-min.sh) and checks the minified files
//                 as well as the source.
//                 --themes adds a Chromium run per page for every theme but the default, with
//                 --theme <name> and the palette-sensitive groups (THEME_GROUPS); the themes are
//                 the [data-cb-theme] blocks of dist/cubicle.css, the default the one equal to :root.
//                 With --min those runs check the minified files.
//                 --only and --shots none are passed to every run (see verify-browser.mjs).
// Output:         one line per run as it ends, then every FAIL line. Each run writes its report to
//                 tmp/verify/<run>.txt and its screenshots to tmp/shots/<run>/, where <run> is
//                 <page>-<browser>[-min] or <page>-chromium-<theme>[-min], e.g. index-webkit.
// Exit code:      0 when every run passes, 1 otherwise, 2 on bad arguments.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Configuration -----------------------------------------------------------------

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KNOWN_ENGINES = ['chromium', 'firefox', 'webkit'];
const DEFAULT_PAGES = 'index,example';
const DEFAULT_BROWSERS = KNOWN_ENGINES.join(',');
const DEFAULT_JOBS = '3';
const REPORTS_DIRECTORY = 'tmp/verify';
const MINIFIED_ARGUMENTS = ['--css', 'dist/cubicle.min.css', '--js', 'dist/cubicle.min.js'];
// --themes: where the theme blocks are, the engine of the theme runs, and the check groups that
// depend on the palette.
const STYLESHEET = 'dist/cubicle.css';
const THEME_ENGINE = 'chromium';
const THEME_GROUPS = 'contrast,states,badges,alerts,meters,tables,forced,themes';
const ROOT_BLOCK_PATTERN = /:root\s*\{([^{}]*)\}/;
const THEME_BLOCK_PATTERN = /\[data-cb-theme="([a-z-]+)"\]\s*\{([^{}]*)\}/g;
const TOKEN_DECLARATION_PATTERN = /(--cb-[a-z0-9-]+)\s*:\s*([^;]+);/g;
const RUN_NAME_WIDTH = 32;
// The run's own summary line, e.g. "268/269 checks passed (1 skipped as engine limits)".
const SUMMARY_COUNTS_PATTERN = /\d+\/\d+ checks passed(?: \(\d+ skipped as engine limits\))?/;
// The first line of an uncaught error, for a run that crashed before its summary.
const ERROR_LINE_PATTERN = /^\w[\w.]*: |Error:/;

// --- Helpers -----------------------------------------------------------------------

// Reads the command line. Every recognised option is removed from `remaining`, so whatever is
// left over is an unexpected argument.
function parseArguments(argv) {
  const remaining = argv.slice(2);
  const takeOption = (name, fallback) => {
    const index = remaining.indexOf(name);
    if (index < 0) {
      return fallback;
    }
    const [, value] = remaining.splice(index, 2);
    return value ?? '';
  };
  const takeFlag = (name) => {
    const index = remaining.indexOf(name);
    if (index < 0) {
      return false;
    }
    remaining.splice(index, 1);
    return true;
  };

  // Option order matters only for malformed input (an option missing its value takes the next
  // word); it is kept as it always was.
  const pageNames = takeOption('--pages', DEFAULT_PAGES).split(',').filter(Boolean);
  const browsers = takeOption('--browsers', DEFAULT_BROWSERS).split(',').filter(Boolean);
  const jobs = Number(takeOption('--jobs', DEFAULT_JOBS));
  const only = takeOption('--only', null);
  const shots = takeOption('--shots', null);
  const minified = takeFlag('--min');
  const themes = takeFlag('--themes');

  const pages = pageNames.map(toPagePath);
  return { pages, browsers, jobs, only, shots, minified, themes, unexpected: remaining };
}

// A bare page name means docs/<name>.html; anything with a slash or an .html suffix is a path.
function toPagePath(pageName) {
  if (pageName.includes('/') || pageName.endsWith('.html')) {
    return pageName;
  }
  return `docs/${pageName}.html`;
}

// The declarations of a CSS block body as a map of token name to value.
function readTokens(blockBody) {
  const tokens = new Map();
  for (const [, name, value] of blockBody.matchAll(TOKEN_DECLARATION_PATTERN)) {
    tokens.set(name, value.trim());
  }
  return tokens;
}

// The themes of the stylesheet other than the default (the block whose every token equals :root).
function readOtherThemes() {
  const css = readFileSync(resolve(REPOSITORY_ROOT, STYLESHEET), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rootTokens = readTokens(css.match(ROOT_BLOCK_PATTERN)?.[1] ?? '');
  const otherThemes = [];
  for (const [, themeName, blockBody] of css.matchAll(THEME_BLOCK_PATTERN)) {
    const themeTokens = readTokens(blockBody);
    const isDefault = [...themeTokens].every(([name, value]) => rootTokens.get(name)?.toLowerCase() === value.toLowerCase());
    if (!isDefault) {
      otherThemes.push(themeName);
    }
  }
  return otherThemes;
}

// Returns the error message for invalid options, or null when they are valid.
function validateOptions(options) {
  const unknownBrowsers = options.browsers.filter((browser) => !KNOWN_ENGINES.includes(browser));
  const invalid = options.unexpected.length > 0
    || unknownBrowsers.length > 0
    || options.pages.length === 0
    || !(options.jobs >= 1)
    || (options.shots !== null && options.shots !== 'none');
  if (!invalid) {
    return null;
  }
  const offending = [...options.unexpected, ...unknownBrowsers].join(' ') || 'value';
  return `unexpected ${offending}; see the header of scripts/verify-matrix.mjs`;
}

// One run per page, browser and (with --min) source or minified build.
function planRuns(options) {
  const variants = options.minified ? [false, true] : [false];
  const runs = [];
  for (const page of options.pages) {
    for (const browser of options.browsers) {
      for (const isMinified of variants) {
        const pageName = basename(page, extname(page));
        const name = `${pageName}-${browser}${isMinified ? '-min' : ''}`;
        const runArguments = [page, '--browser', browser, '--shots', options.shots ?? `tmp/shots/${name}`];
        if (isMinified) {
          runArguments.push(...MINIFIED_ARGUMENTS);
        }
        if (options.only) {
          runArguments.push('--only', options.only);
        }
        runs.push({ name, args: runArguments });
      }
    }
  }
  if (options.themes) {
    runs.push(...planThemeRuns(options));
  }
  return runs;
}

// With --themes: one run per page and non-default theme, in Chromium, on the palette groups;
// the minified files with --min.
function planThemeRuns(options) {
  const runs = [];
  for (const page of options.pages) {
    for (const themeName of readOtherThemes()) {
      const pageName = basename(page, extname(page));
      const name = `${pageName}-${THEME_ENGINE}-${themeName}${options.minified ? '-min' : ''}`;
      const runArguments = [page, '--browser', THEME_ENGINE, '--theme', themeName, '--only', options.only ?? THEME_GROUPS, '--shots', options.shots ?? `tmp/shots/${name}`];
      if (options.minified) {
        runArguments.push(...MINIFIED_ARGUMENTS);
      }
      runs.push({ name, args: runArguments });
    }
  }
  return runs;
}

function secondsSince(startTime) {
  return Math.round((Date.now() - startTime) / 1000);
}

// Runs verify-browser.mjs once, writes its report, prints one line and, when it failed, adds its
// FAIL lines (or its crash line) to `failures`. Resolves to true when the run passed.
function executeRun(run, failures) {
  return new Promise((done) => {
    const startTime = Date.now();
    const child = spawn(process.execPath, ['scripts/verify-browser.mjs', ...run.args], { cwd: REPOSITORY_ROOT });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    child.on('close', (exitCode, exitSignal) => {
      writeFileSync(resolve(REPOSITORY_ROOT, `${REPORTS_DIRECTORY}/${run.name}.txt`), output);
      const outputLines = output.split('\n');
      const summary = output.trim().split('\n').at(-1) ?? '';
      // A run with no summary line threw, was killed from outside, or lost the end of its output;
      // it never passes, whatever its exit code says.
      let missingSummary = 'crashed';
      if (exitSignal) {
        missingSummary = `killed by ${exitSignal}`;
      } else if (exitCode === 0) {
        missingSummary = 'output cut off';
      }
      const summaryCounts = summary.match(SUMMARY_COUNTS_PATTERN)?.[0];
      const counts = summaryCounts ?? missingSummary;
      const passed = exitCode === 0 && summaryCounts !== undefined;
      console.log(`${passed ? 'ok  ' : 'FAIL'}  ${run.name.padEnd(RUN_NAME_WIDTH)} ${counts}  ${secondsSince(startTime)}s`);

      if (!passed) {
        for (const line of outputLines) {
          if (line.startsWith('FAIL')) {
            failures.push(`${run.name}: ${line}`);
          }
        }
        if (!output.includes('checks passed')) {
          const errorLine = outputLines.find((line) => ERROR_LINE_PATTERN.test(line));
          failures.push(`${run.name}: ${errorLine?.trim() ?? `${missingSummary}; last output: ${summary}`}`);
        }
      }
      done(passed);
    });
  });
}

// --- Main --------------------------------------------------------------------------

async function runMatrix() {
  const options = parseArguments(process.argv);
  const optionError = validateOptions(options);
  if (optionError) {
    console.error(optionError);
    process.exit(2);
  }

  if (options.minified) {
    const build = spawnSync('bash', ['scripts/build-min.sh'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
    if (build.status !== 0) {
      console.error(`build-min.sh failed\n${build.stdout}${build.stderr}`);
      process.exit(1);
    }
  }

  const runs = planRuns(options);
  mkdirSync(resolve(REPOSITORY_ROOT, REPORTS_DIRECTORY), { recursive: true });
  const startTime = Date.now();
  const failures = [];
  let failedCount = 0;

  // A small pool: each browser slows when several run at once, so --jobs stays near the engine count.
  const queue = [...runs];
  const worker = async () => {
    while (queue.length > 0) {
      const passed = await executeRun(queue.shift(), failures);
      if (!passed) {
        failedCount += 1;
      }
    }
  };
  // A fractional --jobs rounds down, as an array length would.
  const workerCount = Math.floor(Math.min(options.jobs, runs.length));
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  for (const failure of failures) {
    console.log(failure);
  }
  const passedCount = runs.length - failedCount;
  const shotsLocation = options.shots === 'none' ? 'none' : 'tmp/shots/<run>/';
  console.log(`\n${passedCount}/${runs.length} runs passed in ${secondsSince(startTime)}s. Reports: tmp/verify/, screenshots: ${shotsLocation}`);
  process.exit(failedCount > 0 ? 1 : 0);
}

await runMatrix();
