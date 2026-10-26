#!/usr/bin/env node
// Prints one hash line per element that matches a selector, taken from a screenshot of that
// element. The computed-style snapshot cannot see engine pseudo-elements (a meter's
// ::-webkit-progress-bar, a range thumb), so a change to a rule that paints one is proven by
// running this probe on the old and the new stylesheet and diffing the two outputs.
//
//   node .claude/skills/cubicle-css-audit/scripts/pixel-probe.mjs --css tmp/css-audit/head.css > tmp/css-audit/pixels-before.txt
//   node .claude/skills/cubicle-css-audit/scripts/pixel-probe.mjs > tmp/css-audit/pixels-after.txt
//   diff tmp/css-audit/pixels-before.txt tmp/css-audit/pixels-after.txt && echo "pixels match"
//
// Options: --browser chromium|firefox|webkit (default chromium), --css <file> to serve that
// file in place of dist/cubicle.css, --selector <css selector list> (default: meters and
// progress bars, ranges, spin and file buttons), --page <path> (default docs/index.html).

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '../../../..');
const DEFAULT_SELECTOR = '.cb-meter, .cb-range, .cb-file, input[type="number"], input[type="search"]';
const DEFAULT_PAGE = 'docs/index.html';
const VIEWPORT = { width: 1360, height: 900 };

function readOptions() {
  const options = {
    browser: 'chromium',
    css: null,
    selector: DEFAULT_SELECTOR,
    page: DEFAULT_PAGE,
  };
  const argumentList = process.argv.slice(2);
  for (let i = 0; i < argumentList.length; i += 2) {
    const name = argumentList[i];
    const value = argumentList[i + 1];
    if (name === '--browser') {
      options.browser = value;
    } else if (name === '--css') {
      options.css = value;
    } else if (name === '--selector') {
      options.selector = value;
    } else if (name === '--page') {
      options.page = value;
    } else {
      console.error(`unknown option ${name}`);
      process.exit(2);
    }
  }
  return options;
}

function loadPlaywright() {
  const requireFromScripts = createRequire(resolve(REPOSITORY_ROOT, 'scripts/package.json'));
  return requireFromScripts('playwright');
}

// Runs inside the page. Stops every animation at its end state, so a spinner or a transition
// cannot make two captures of the same stylesheet differ.
function settleAnimations() {
  for (const animation of document.getAnimations()) {
    if (animation instanceof CSSTransition) {
      animation.finish();
    } else {
      animation.pause();
      animation.currentTime = 0;
    }
  }
}

async function probePixels(options) {
  const playwright = loadPlaywright();
  const browser = await playwright[options.browser].launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  if (options.css) {
    const cssPath = resolve(REPOSITORY_ROOT, options.css);
    await page.route(/\/dist\/cubicle\.css$/, (route) => route.fulfill({ path: cssPath, contentType: 'text/css' }));
  }
  await page.goto(pathToFileURL(resolve(REPOSITORY_ROOT, options.page)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(settleAnimations);

  const elements = await page.locator(options.selector).all();
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const isVisible = await element.isVisible();
    if (!isVisible) {
      continue;
    }
    await element.scrollIntoViewIfNeeded();
    const picture = await element.screenshot({ animations: 'disabled' });
    const hash = createHash('sha256').update(picture).digest('hex').slice(0, 16);
    console.log(`${String(i).padStart(3, '0')} ${hash}`);
  }
  await browser.close();
}

await probePixels(readOptions());
