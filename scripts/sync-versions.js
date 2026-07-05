#!/usr/bin/env node
'use strict';

/**
 * Version lockstep across every manifest that carries the plugin version.
 *
 * Manifest list lives in .version-bump.json at the repo root:
 *   { "manifests": [ { "path": "<file>", "fields": ["metadata.version", "plugins[*].version"] } ] }
 *
 * Usage:
 *   node scripts/sync-versions.js --check            # exit 0 if all agree, 1 with a mismatch report
 *   node scripts/sync-versions.js --apply <version>  # rewrite every field to <version>
 */

const fs = require('fs');
const path = require('path');

const SEMVER = /^\d+\.\d+\.\d+$/;
const CONFIG_FILE = '.version-bump.json';

function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(`config not found: ${CONFIG_FILE} (${file})`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readManifest(root, relPath) {
  const file = path.join(root, relPath);
  if (!fs.existsSync(file)) {
    throw new Error(`manifest not found: ${relPath} (${file})`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Expands one field spec ("metadata.version", "plugins[*].version") against a
// parsed manifest into concrete { fieldPath, segments } entries.
function expandField(doc, field) {
  const segments = field.split('.').flatMap(part => {
    const wildcard = part.match(/^(.+)\[\*\]$/);
    if (wildcard) return [wildcard[1], '*'];
    return [part];
  });

  let expanded = [{ pathParts: [], node: doc }];
  for (const seg of segments) {
    const next = [];
    for (const entry of expanded) {
      if (seg === '*') {
        if (!Array.isArray(entry.node)) continue;
        entry.node.forEach((item, i) => {
          next.push({ pathParts: entry.pathParts.concat(`[${i}]`), node: item });
        });
      } else {
        if (entry.node == null || typeof entry.node !== 'object') continue;
        next.push({ pathParts: entry.pathParts.concat(seg), node: entry.node[seg] });
      }
    }
    expanded = next;
  }

  return expanded.map(entry => ({
    fieldPath: entry.pathParts.reduce((acc, p) => (p.startsWith('[') ? acc + p : acc ? `${acc}.${p}` : p), ''),
    segments: entry.pathParts
  }));
}

function getAtPath(doc, segments) {
  let node = doc;
  for (const seg of segments) {
    const idx = seg.match(/^\[(\d+)\]$/);
    node = idx ? node[Number(idx[1])] : node[seg];
  }
  return node;
}

function setAtPath(doc, segments, value) {
  let node = doc;
  for (const seg of segments.slice(0, -1)) {
    const idx = seg.match(/^\[(\d+)\]$/);
    node = idx ? node[Number(idx[1])] : node[seg];
  }
  const last = segments[segments.length - 1];
  const idx = last.match(/^\[(\d+)\]$/);
  if (idx) node[Number(idx[1])] = value;
  else node[last] = value;
}

function resolveTargets(root) {
  const config = loadConfig(root);
  const targets = [];
  for (const manifest of config.manifests || []) {
    const doc = readManifest(root, manifest.path);
    for (const field of manifest.fields || []) {
      for (const { fieldPath, segments } of expandField(doc, field)) {
        targets.push({
          file: manifest.path,
          fieldPath,
          segments,
          value: getAtPath(doc, segments)
        });
      }
    }
  }
  return targets;
}

function check(root) {
  const targets = resolveTargets(root);
  const versions = [...new Set(targets.map(t => t.value))];
  if (versions.length === 1) {
    return { ok: true, version: versions[0], mismatches: [] };
  }
  // Report every target so the drift is fully visible, whichever value is "right".
  return {
    ok: false,
    version: null,
    mismatches: targets.map(t => ({ file: t.file, fieldPath: t.fieldPath, value: t.value }))
  };
}

function apply(root, version) {
  if (!SEMVER.test(String(version))) {
    throw new Error(`not a plain semver version: ${version} (expected MAJOR.MINOR.PATCH)`);
  }
  const config = loadConfig(root);
  for (const manifest of config.manifests || []) {
    const doc = readManifest(root, manifest.path);
    for (const field of manifest.fields || []) {
      for (const { segments } of expandField(doc, field)) {
        setAtPath(doc, segments, version);
      }
    }
    fs.writeFileSync(path.join(root, manifest.path), JSON.stringify(doc, null, 2) + '\n');
  }
}

function main() {
  const [, , mode, versionArg] = process.argv;
  const root = process.cwd();

  if (mode === '--check') {
    const result = check(root);
    if (result.ok) {
      process.stdout.write(`sync-versions: all manifests at ${result.version}\n`);
      process.exit(0);
    }
    process.stderr.write('sync-versions: version drift detected:\n');
    for (const m of result.mismatches) {
      process.stderr.write(`  - ${m.file}#${m.fieldPath} = ${m.value}\n`);
    }
    process.exit(1);
  }

  if (mode === '--apply') {
    apply(root, versionArg);
    const result = check(root);
    process.stdout.write(`sync-versions: applied ${versionArg} (${result.ok ? 'in lockstep' : 'STILL DRIFTED'})\n`);
    process.exit(result.ok ? 0 : 1);
  }

  process.stderr.write('Usage: sync-versions.js --check | --apply <version>\n');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { resolveTargets, check, apply };
