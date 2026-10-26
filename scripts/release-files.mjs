// Shared by check-release.mjs, build-site.mjs and package-release.mjs: where the repository
// is, which files make a release, and where the generated output goes.
// Development tool only; not part of the shipped kit.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Constants ---------------------------------------------------------------------

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Source files first, then the minified files that bash scripts/build-min.sh writes.
export const DIST_FILE_NAMES = ['cubicle.css', 'cubicle.js', 'cubicle.min.css', 'cubicle.min.js'];

// Generated output lives here, which .gitignore already excludes.
const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'tmp');
export const SITE_DIRECTORY = resolve(OUTPUT_ROOT, 'site');
export const RELEASE_DIRECTORY = resolve(OUTPUT_ROOT, 'release');

// --- Helpers -----------------------------------------------------------------------

// The paths (relative to `rootDirectory`) that do not exist.
export function findMissingFiles(rootDirectory, relativePaths) {
  const missingPaths = [];
  for (const relativePath of relativePaths) {
    if (!existsSync(resolve(rootDirectory, relativePath))) {
      missingPaths.push(relativePath);
    }
  }
  return missingPaths;
}

// Empties and recreates a generated directory. Refuses anything outside tmp/, so a wrong
// constant can never delete source files.
export function recreateDirectory(directory) {
  if (!directory.startsWith(OUTPUT_ROOT + sep)) {
    throw new Error(`Refusing to recreate ${directory}: it is not inside ${OUTPUT_ROOT}`);
  }
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}
