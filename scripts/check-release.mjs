// Cubicle release gate. Development tool only; not part of the shipped kit.
//
// Setup:          none (Node built-ins only). The minified files come from bash scripts/build-min.sh.
// Run:            node scripts/check-release.mjs <tag> [--root <directory>] [--notes <file>]
//                 <tag>      vX.Y.Z or vX.Y.Z-rc.N, the git tag a release is built from
//                 --root     the tree to check (default: this repository); lets a test point at a
//                            scratch copy
//                 --notes    where to write the release notes (default: tmp/release-notes.md, outside
//                            tmp/release/, which package-release.mjs empties)
// Checks:         1. the tag has the form vX.Y.Z or vX.Y.Z-rc.N;
//                 2. the "Cubicle vX.Y.Z" banner of dist/cubicle.css, dist/cubicle.js and both
//                    minified files carries exactly the tag's version;
//                 3. CHANGELOG.md has a "## [X.Y.Z] - YYYY-MM-DD" section with a real date and
//                    a body.
// Output:         the body of that CHANGELOG section, written to the notes file, but only
//                 when every check passes.
// Exit code:      0 when every check passes, 1 otherwise.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { REPOSITORY_ROOT, DIST_FILE_NAMES } from './release-files.mjs';

// --- Configuration -----------------------------------------------------------------

const USAGE = 'Usage: node scripts/check-release.mjs <tag> [--root <directory>] [--notes <file>]';
const DEFAULT_NOTES_FILE = resolve(REPOSITORY_ROOT, 'tmp', 'release-notes.md');
const CHANGELOG_FILE_NAME = 'CHANGELOG.md';

// vX.Y.Z or vX.Y.Z-rc.N, without leading zeros. The capture group is the version.
const TAG_PATTERN = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-rc\.[1-9]\d*)?)$/;
// The first comment of a distributed file names the kit and its version.
const BANNER_COMMENT_PATTERN = /^\/\*![\s\S]*?\*\//;
const BANNER_VERSION_PATTERN = /Cubicle v(\S+)/;
const CHANGELOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CHANGELOG_SECTION_START_PATTERN = /^## /;
// A Keep a Changelog link reference such as "[1.0.0]: https://...", which closes the file.
const LINK_REFERENCE_PATTERN = /^\[[^\]]+\]:\s+\S+\s*$/;

// --- Helpers -----------------------------------------------------------------------

// Reads the command line: one tag, then optional --root and --notes values.
function parseArguments(argv) {
  const remaining = argv.slice(2);
  const options = {
    tag: '',
    rootDirectory: REPOSITORY_ROOT,
    notesFile: DEFAULT_NOTES_FILE,
  };
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i] === '--root') {
      options.rootDirectory = resolve(remaining[i + 1] ?? '');
      i += 1;
    } else if (remaining[i] === '--notes') {
      options.notesFile = resolve(remaining[i + 1] ?? '');
      i += 1;
    } else if (options.tag === '') {
      options.tag = remaining[i];
    } else {
      throw new Error(`Unexpected argument "${remaining[i]}". ${USAGE}`);
    }
  }
  if (options.tag === '') {
    throw new Error(USAGE);
  }
  return options;
}

function escapeForRegularExpression(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A date written as YYYY-MM-DD that exists on the calendar (2026-02-30 does not).
function isCalendarDate(text) {
  if (!CHANGELOG_DATE_PATTERN.test(text)) {
    return false;
  }
  const parsedDate = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    return false;
  }
  return parsedDate.toISOString().slice(0, 10) === text;
}

function passed(description) {
  return { description, problem: null };
}

function failed(description, problem) {
  return { description, problem };
}

// The version in a file's banner comment, or null when there is no banner or no version.
function readBannerVersion(fileText) {
  const banner = fileText.match(BANNER_COMMENT_PATTERN);
  if (banner === null) {
    return null;
  }
  const versionMatch = banner[0].match(BANNER_VERSION_PATTERN);
  if (versionMatch === null) {
    return null;
  }
  return versionMatch[1];
}

// The lines of the section under "## [version] - date", up to the next "## " heading, without
// the link references that close the file. Null when the section is missing.
function findChangelogSection(changelogText, version) {
  const headingPattern = new RegExp(`^## \\[${escapeForRegularExpression(version)}\\](?: - (\\S+))?\\s*$`);
  const lines = changelogText.split('\n');
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));
  if (headingIndex < 0) {
    return null;
  }
  const date = lines[headingIndex].match(headingPattern)[1] ?? '';

  const bodyLines = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (CHANGELOG_SECTION_START_PATTERN.test(lines[i])) {
      break;
    }
    bodyLines.push(lines[i]);
  }
  while (bodyLines.length > 0) {
    const lastLine = bodyLines[bodyLines.length - 1];
    if (lastLine.trim() === '' || LINK_REFERENCE_PATTERN.test(lastLine)) {
      bodyLines.pop();
    } else {
      break;
    }
  }
  return { date, body: bodyLines.join('\n').trim() };
}

// --- Checks ------------------------------------------------------------------------

function checkTagFormat(tag) {
  const description = `tag ${tag} has the form vX.Y.Z or vX.Y.Z-rc.N`;
  const tagMatch = tag.match(TAG_PATTERN);
  if (tagMatch === null) {
    return { result: failed(description, 'expected for example v1.0.0 or v1.0.0-rc.1'), version: null };
  }
  return { result: passed(description), version: tagMatch[1] };
}

function checkBannerVersions(rootDirectory, version) {
  const results = [];
  for (const fileName of DIST_FILE_NAMES) {
    const relativePath = `dist/${fileName}`;
    const description = `${relativePath} banner says Cubicle v${version}`;
    let fileText;
    try {
      fileText = readFileSync(resolve(rootDirectory, relativePath), 'utf8');
    } catch {
      results.push(failed(description, 'the file is missing (the minified files need bash scripts/build-min.sh)'));
      continue;
    }
    const bannerVersion = readBannerVersion(fileText);
    if (bannerVersion === null) {
      results.push(failed(description, 'the opening /*! comment has no "Cubicle vX.Y.Z" version'));
    } else if (bannerVersion !== version) {
      results.push(failed(description, `the banner says v${bannerVersion}`));
    } else {
      results.push(passed(description));
    }
  }
  return results;
}

// The CHANGELOG checks, and the section body for the notes when it is usable.
function checkChangelog(rootDirectory, version) {
  const sectionDescription = `${CHANGELOG_FILE_NAME} has a section "## [${version}] - YYYY-MM-DD"`;
  let changelogText;
  try {
    changelogText = readFileSync(resolve(rootDirectory, CHANGELOG_FILE_NAME), 'utf8');
  } catch {
    return { results: [failed(sectionDescription, `${CHANGELOG_FILE_NAME} is missing`)], notes: null };
  }

  const section = findChangelogSection(changelogText, version);
  if (section === null) {
    return { results: [failed(sectionDescription, 'no heading for this version')], notes: null };
  }

  const results = [];
  if (isCalendarDate(section.date)) {
    results.push(passed(sectionDescription));
  } else {
    results.push(failed(sectionDescription, `"${section.date}" is not a date written as YYYY-MM-DD`));
  }
  const bodyDescription = `${CHANGELOG_FILE_NAME} section ${version} has release notes`;
  if (section.body === '') {
    results.push(failed(bodyDescription, 'the section is empty'));
  } else {
    results.push(passed(bodyDescription));
  }
  return { results, notes: section.body };
}

// --- Entry point -------------------------------------------------------------------

function runChecks() {
  let options;
  try {
    options = parseArguments(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const tagCheck = checkTagFormat(options.tag);
  const results = [tagCheck.result];
  let notes = null;
  if (tagCheck.version !== null) {
    results.push(...checkBannerVersions(options.rootDirectory, tagCheck.version));
    const changelogCheck = checkChangelog(options.rootDirectory, tagCheck.version);
    results.push(...changelogCheck.results);
    notes = changelogCheck.notes;
  }

  let passedCount = 0;
  for (const result of results) {
    if (result.problem === null) {
      passedCount += 1;
      console.log(`ok    ${result.description}`);
    } else {
      console.log(`FAIL  ${result.description}: ${result.problem}`);
    }
  }
  console.log(`\n${passedCount}/${results.length} checks passed. Tag: ${options.tag}`);
  if (passedCount !== results.length) {
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(options.notesFile), { recursive: true });
  writeFileSync(options.notesFile, `${notes}\n`);
  console.log(`Release notes written to ${options.notesFile}`);
}

runChecks();
