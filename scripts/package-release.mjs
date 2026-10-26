// Cubicle release packager. Development tool only; not part of the shipped kit.
//
// Setup:          none (Node built-ins and the system zip). The minified files come from
//                 bash scripts/build-min.sh.
// Run:            node scripts/package-release.mjs <version>
//                 <version>  without the leading v, for example 1.0.0-rc.1
// Output:         tmp/release/, the files a GitHub Release carries:
//                   cubicle.css, cubicle.js, cubicle.min.css, cubicle.min.js
//                   cubicle-<version>.zip      cubicle-<version>/ holding dist/ (the four files),
//                                              LICENSE, README.md and CHANGELOG.md
//                   checksums.txt              a SHA-256 line per asset (checked with
//                                              shasum -a 256 -c checksums.txt), then each SRI
//                                              value as a # comment, which shasum and sha256sum skip
// Exit code:      0 when the release files are written, 1 otherwise.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  REPOSITORY_ROOT,
  DIST_FILE_NAMES,
  RELEASE_DIRECTORY,
  findMissingFiles,
  recreateDirectory,
} from './release-files.mjs';

// --- Configuration -----------------------------------------------------------------

const USAGE = 'Usage: node scripts/package-release.mjs <version>   (for example 1.0.0-rc.1, no leading v)';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const ZIP_DOCUMENT_NAMES = ['LICENSE', 'README.md', 'CHANGELOG.md'];
const CHECKSUMS_FILE_NAME = 'checksums.txt';
// Lines that start with # are comments to shasum and sha256sum, so the file still checks cleanly.
const CHECKSUMS_HEADER = [
  '# SHA-256. Check the downloaded assets with: shasum -a 256 -c checksums.txt',
];
const SRI_HEADER = [
  '#',
  '# Subresource Integrity (sha384), for the integrity attribute of a link or script tag:',
];

// --- Helpers -----------------------------------------------------------------------

// The files this script reads, relative to the repository root.
function listSourceFiles() {
  const sourceFiles = [];
  for (const distFileName of DIST_FILE_NAMES) {
    sourceFiles.push(`dist/${distFileName}`);
  }
  sourceFiles.push(...ZIP_DOCUMENT_NAMES);
  return sourceFiles;
}

function copyDistFiles(destinationDirectory) {
  mkdirSync(destinationDirectory, { recursive: true });
  for (const distFileName of DIST_FILE_NAMES) {
    copyFileSync(
      resolve(REPOSITORY_ROOT, 'dist', distFileName),
      resolve(destinationDirectory, distFileName),
    );
  }
}

// Builds cubicle-<version>.zip from a staging folder that is removed afterwards. The folder
// name is the archive's single top-level entry, so unzipping never spills into the current directory.
function createZip(version) {
  const folderName = `cubicle-${version}`;
  const stagingDirectory = resolve(RELEASE_DIRECTORY, folderName);
  copyDistFiles(resolve(stagingDirectory, 'dist'));
  for (const documentName of ZIP_DOCUMENT_NAMES) {
    copyFileSync(resolve(REPOSITORY_ROOT, documentName), resolve(stagingDirectory, documentName));
  }

  const zipFileName = `${folderName}.zip`;
  // -X leaves out extra file attributes (owner, timestamps in extra fields); -q keeps the log short.
  execFileSync('zip', ['-X', '-q', '-r', zipFileName, folderName], { cwd: RELEASE_DIRECTORY });
  rmSync(stagingDirectory, { recursive: true, force: true });
  return zipFileName;
}

function hashFile(fileName) {
  const fileBytes = readFileSync(resolve(RELEASE_DIRECTORY, fileName));
  return {
    fileName,
    sha256Hex: createHash('sha256').update(fileBytes).digest('hex'),
    sriValue: `sha384-${createHash('sha384').update(fileBytes).digest('base64')}`,
  };
}

// Two spaces between hash and name is the format shasum and sha256sum read back.
function formatChecksums(hashes) {
  const lines = [...CHECKSUMS_HEADER];
  for (const hash of hashes) {
    lines.push(`${hash.sha256Hex}  ${hash.fileName}`);
  }
  lines.push(...SRI_HEADER);
  for (const hash of hashes) {
    lines.push(`# ${hash.fileName}  ${hash.sriValue}`);
  }
  return `${lines.join('\n')}\n`;
}

// --- Entry point -------------------------------------------------------------------

function packageRelease() {
  const version = process.argv[2] ?? '';
  if (!VERSION_PATTERN.test(version)) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const missingFiles = findMissingFiles(REPOSITORY_ROOT, listSourceFiles());
  if (missingFiles.length > 0) {
    console.error(`package-release: missing ${missingFiles.join(', ')}`);
    console.error('The minified files come from: bash scripts/build-min.sh');
    process.exitCode = 1;
    return;
  }

  recreateDirectory(RELEASE_DIRECTORY);
  copyDistFiles(RELEASE_DIRECTORY);
  const zipFileName = createZip(version);

  const assetNames = [...DIST_FILE_NAMES, zipFileName];
  const hashes = [];
  for (const assetName of assetNames) {
    hashes.push(hashFile(assetName));
  }
  writeFileSync(resolve(RELEASE_DIRECTORY, CHECKSUMS_FILE_NAME), formatChecksums(hashes));

  console.log(`Release files for ${version} written to ${RELEASE_DIRECTORY}:`);
  for (const assetName of [...assetNames, CHECKSUMS_FILE_NAME]) {
    console.log(`  ${assetName}`);
  }
}

packageRelease();
