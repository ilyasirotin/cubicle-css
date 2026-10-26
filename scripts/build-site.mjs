// Cubicle documentation site assembler. Development tool only; not part of the shipped kit.
//
// Setup:          none (Node built-ins only). The minified files come from bash scripts/build-min.sh.
// Run:            node scripts/build-site.mjs
// Output:         tmp/site/, the tree GitHub Pages serves:
//                   /index.html, /example.html, /docs.css, /img/   from docs/
//                   /dist/cubicle.css, .js and their .min files    from dist/
//                 In the two HTML copies, "../dist/" becomes "dist/", because the site has
//                 no docs/ folder. The sources in docs/ are not touched.
// Checks:         each page still names dist/cubicle.css and dist/cubicle.js after the
//                 rewrite, and no "../dist/" remains anywhere in the copied pages or docs.css.
// Exit code:      0 when the site is assembled and clean, 1 otherwise.

import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  REPOSITORY_ROOT,
  DIST_FILE_NAMES,
  SITE_DIRECTORY,
  findMissingFiles,
  recreateDirectory,
} from './release-files.mjs';

// --- Configuration -----------------------------------------------------------------

const DOCS_DIRECTORY = resolve(REPOSITORY_ROOT, 'docs');
const DIST_DIRECTORY = resolve(REPOSITORY_ROOT, 'dist');
const PAGE_FILE_NAMES = ['index.html', 'example.html'];
const STYLESHEET_FILE_NAME = 'docs.css';
const IMAGE_DIRECTORY_NAME = 'img';

const SOURCE_DIST_REFERENCE = '../dist/';
const SITE_DIST_REFERENCE = 'dist/';
// What every page must still load once the reference is rewritten.
const REQUIRED_PAGE_REFERENCES = ['href="dist/cubicle.css"', 'src="dist/cubicle.js"'];

// --- Helpers -----------------------------------------------------------------------

// The files this script reads, relative to the repository root.
function listSourceFiles() {
  const sourceFiles = [];
  for (const pageFileName of PAGE_FILE_NAMES) {
    sourceFiles.push(`docs/${pageFileName}`);
  }
  sourceFiles.push(`docs/${STYLESHEET_FILE_NAME}`);
  sourceFiles.push(`docs/${IMAGE_DIRECTORY_NAME}`);
  for (const distFileName of DIST_FILE_NAMES) {
    sourceFiles.push(`dist/${distFileName}`);
  }
  return sourceFiles;
}

// Copies a page with its dist references rewritten, and returns the problems it finds.
function copyPage(pageFileName) {
  const pageText = readFileSync(resolve(DOCS_DIRECTORY, pageFileName), 'utf8');
  const rewrittenText = pageText.replaceAll(SOURCE_DIST_REFERENCE, SITE_DIST_REFERENCE);
  writeFileSync(resolve(SITE_DIRECTORY, pageFileName), rewrittenText);

  const problems = [];
  for (const requiredReference of REQUIRED_PAGE_REFERENCES) {
    if (!rewrittenText.includes(requiredReference)) {
      problems.push(`${pageFileName} does not contain ${requiredReference}`);
    }
  }
  if (rewrittenText.includes(SOURCE_DIST_REFERENCE)) {
    problems.push(`${pageFileName} still contains ${SOURCE_DIST_REFERENCE}`);
  }
  return problems;
}

function copyStaticFiles() {
  copyFileSync(
    resolve(DOCS_DIRECTORY, STYLESHEET_FILE_NAME),
    resolve(SITE_DIRECTORY, STYLESHEET_FILE_NAME),
  );
  cpSync(
    resolve(DOCS_DIRECTORY, IMAGE_DIRECTORY_NAME),
    resolve(SITE_DIRECTORY, IMAGE_DIRECTORY_NAME),
    { recursive: true },
  );
  mkdirSync(resolve(SITE_DIRECTORY, 'dist'));
  for (const distFileName of DIST_FILE_NAMES) {
    copyFileSync(
      resolve(DIST_DIRECTORY, distFileName),
      resolve(SITE_DIRECTORY, 'dist', distFileName),
    );
  }
}

// The documentation stylesheet is copied as it is, so it must not point at ../dist/ either.
function findStylesheetProblems() {
  const stylesheetText = readFileSync(resolve(SITE_DIRECTORY, STYLESHEET_FILE_NAME), 'utf8');
  if (stylesheetText.includes(SOURCE_DIST_REFERENCE)) {
    return [`${STYLESHEET_FILE_NAME} contains ${SOURCE_DIST_REFERENCE}`];
  }
  return [];
}

// --- Entry point -------------------------------------------------------------------

function buildSite() {
  const missingFiles = findMissingFiles(REPOSITORY_ROOT, listSourceFiles());
  if (missingFiles.length > 0) {
    console.error(`build-site: missing ${missingFiles.join(', ')}`);
    console.error('The minified files come from: bash scripts/build-min.sh');
    process.exitCode = 1;
    return;
  }

  recreateDirectory(SITE_DIRECTORY);
  const problems = [];
  for (const pageFileName of PAGE_FILE_NAMES) {
    problems.push(...copyPage(pageFileName));
  }
  copyStaticFiles();
  problems.push(...findStylesheetProblems());

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`build-site: ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Site assembled in ${SITE_DIRECTORY}`);
}

buildSite();
