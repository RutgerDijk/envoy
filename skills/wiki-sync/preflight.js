#!/usr/bin/env node
'use strict';

/**
 * Wiki-sync preflight.
 *
 * Requires docs/wiki/ to exist with at least one .md file. If present
 * but missing Home.md, emits degraded.
 */

const fs = require('fs');
const path = require('path');

const CWD = process.cwd();

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

function writeJson(rel, data) {
  const full = path.join(CWD, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

function nowIso() { return new Date().toISOString(); }

function strictPromote(tier) {
  if (tier === 'degraded' && process.env.ENVOY_HOOK_PROFILE === 'strict') return 'fatal';
  return tier;
}

function listWikiMarkdown(wikiDir) {
  if (!fs.existsSync(wikiDir)) return null;
  return fs.readdirSync(wikiDir).filter(f => f.endsWith('.md'));
}

function main() {
  const wikiDir = path.join(CWD, 'docs', 'wiki');
  const files = listWikiMarkdown(wikiDir);

  if (files === null) {
    banner('fatal');
    say('docs/wiki directory not found.');
    say('');
    say('Remediation: create docs/wiki/ with at least a Home.md file before invoking wiki-sync.');
    return;
  }

  if (files.length === 0) {
    banner('fatal');
    say('docs/wiki exists but contains no .md files.');
    return;
  }

  writeJson('.envoy/active-skill.json', {
    $schemaVersion: '1',
    skill: 'wiki-sync',
    startedAt: nowIso(),
    pid: process.pid,
  });

  const hasHome = files.includes('Home.md');
  if (!hasHome) {
    const tier = strictPromote('degraded');
    banner(tier);
    say('');
    say('## DEGRADED:');
    say('  - Home.md not present in docs/wiki/ — GitHub wiki requires Home.md as the landing page.');
    say('');
    say(`${files.length} wiki page${files.length === 1 ? '' : 's'} detected: ${files.join(', ')}`);
    return;
  }

  banner('ok');
  say('');
  say(`${files.length} wiki page${files.length === 1 ? '' : 's'} ready to sync: ${files.join(', ')}`);
  say('');
  say('Next: read skills/wiki-sync/SKILL.md for the GitHub wiki push flow.');
}

main();
