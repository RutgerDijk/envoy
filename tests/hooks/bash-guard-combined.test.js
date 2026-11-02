#!/usr/bin/env node
/**
 * bash-guard-combined — PreToolUse[Bash] hook that runs, in ONE spawn:
 *  - issue-create-guard (hooks/observe-gate.js guardIssueCreate), unchanged
 *  - config-protection's Bash path (configProtection.runBash): blocks
 *    commands that WRITE a protected linter/formatter config basename via
 *    `>`/`>>`/`&>`, `tee`, `sed -i`, `cp`/`mv`/`install` targets, or a
 *    heredoc redirect — closing the gap where Edit/Write was guarded but
 *    Bash was not.
 *
 * Each sub-guard honours ENVOY_DISABLED_HOOKS by its own name
 * (config-protection / issue-create-guard) independently.
 * ENVOY_OVERRIDE (non-empty, not 0/false) lets a protected write through on
 * both the Bash and the Edit/Write path.
 *
 * Run: node tests/hooks/bash-guard-combined.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS_JSON = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const BASH_GUARD_COMBINED = path.join(REPO_ROOT, 'hooks', 'bash-guard-combined.js');
const EDIT_GUARD_COMBINED = path.join(REPO_ROOT, 'hooks', 'edit-guard-combined.js');
const HOOK_RUNNER = path.join(REPO_ROOT, 'hooks', 'hook-runner.js');
const CONFIG_PROTECTION = path.join(REPO_ROOT, 'hooks', 'config-protection.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}\n`);
  }
}

function section(name) {
  process.stdout.write(`\n\x1b[1m${name}\x1b[0m\n`);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bash-guard-combined-'));
}

function bashEvent(command) {
  return { tool_name: 'Bash', tool_input: { command } };
}

// Strip env vars that would change behavior under the live session.
function cleanEnv(env) {
  const base = { ...process.env };
  delete base.ENVOY_OVERRIDE;
  delete base.ENVOY_DISABLED_HOOKS;
  delete base.ENVOY_HOOK_PROFILE;
  return { ...base, ...env };
}

function runScript(script, cwd, input, env = {}, args = []) {
  return spawnSync('node', [script, ...args], {
    cwd,
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input || {}),
    env: cleanEnv(env),
  });
}

function withTmp(fn) {
  const tmp = mkTmp();
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function writeSession(cwd, issueNumber) {
  const dir = path.join(cwd, '.envoy', 'brainstorm');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'session.json'),
    JSON.stringify({ $schemaVersion: '1', issueNumber, createdAt: new Date().toISOString() })
  );
}

const EDIT_BLOCK_REASON = 'BLOCKED: Cannot modify .eslintrc.json. Fix source code instead of weakening linter/formatter config.';

function loadConfigProtection() {
  delete require.cache[require.resolve(CONFIG_PROTECTION)];
  return require(CONFIG_PROTECTION);
}

section('registration: PreToolUse[Bash] -> bash-guard-combined via hook-runner, all profiles');

test('hooks.json has exactly one PreToolUse "Bash" entry, wired to bash-guard-combined, all profiles', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  const entries = (hooksConfig.hooks.PreToolUse || []).filter((e) => e.matcher === 'Bash');
  assert.strictEqual(entries.length, 1, `expected exactly one PreToolUse[Bash] entry, found ${entries.length}`);
  const hookDef = entries[0].hooks.find((h) => /bash-guard-combined/.test(h.command));
  assert.ok(hookDef, 'PreToolUse[Bash] is not wired to bash-guard-combined');
  assert.ok(/hook-runner\.js" bash-guard-combined/.test(hookDef.command), `not wired via hook-runner: ${hookDef.command}`);
  assert.ok(!entries[0].hooks.some((h) => /hook-runner\.js" issue-create-guard/.test(h.command)),
    'issue-create-guard must no longer be a separate spawn on PreToolUse[Bash]');
  assert.deepStrictEqual([...hookDef._profiles].sort(), ['minimal', 'standard', 'strict']);
});

test('PostToolUse[Bash] -> post-pr-poll entry is untouched', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  const post = (hooksConfig.hooks.PostToolUse || []).filter((e) => e.matcher === 'Bash');
  assert.strictEqual(post.length, 1);
  assert.ok(post[0].hooks.some((h) => /post-pr-poll/.test(h.command)));
});

test('HOOK_PROFILES lists bash-guard-combined in minimal, standard and strict', () => {
  delete require.cache[require.resolve(HOOK_RUNNER)];
  const { HOOK_PROFILES } = require(HOOK_RUNNER);
  assert.deepStrictEqual([...(HOOK_PROFILES['bash-guard-combined'] || [])].sort(), ['minimal', 'standard', 'strict']);
});

section('parser: extractWriteTargets finds write targets (pure, never executes)');

const WRITE_CASES = [
  ['echo {} > .eslintrc.json', '.eslintrc.json'],
  ['echo {} >> .prettierrc', '.prettierrc'],
  ['echo {} >.eslintrc.json', '.eslintrc.json'],
  ['echo {} 1> biome.json', 'biome.json'],
  ['echo x &> .editorconfig', '.editorconfig'],
  ['echo x >| .prettierrc', '.prettierrc'],
  ['echo x > "my dir/.eslintrc.js"', 'my dir/.eslintrc.js'],
  ["echo x > './.prettierrc.yml'", './.prettierrc.yml'],
  ['echo {} | tee .eslintrc.json', '.eslintrc.json'],
  ['echo {} | tee -a out.log eslint.config.js', 'eslint.config.js'],
  ["sed -i 's/error/off/' .eslintrc.json", '.eslintrc.json'],
  ["sed -i.bak 's/error/off/' .eslintrc.json", '.eslintrc.json'],
  ["sed -i '' 's/error/off/' .eslintrc.json", '.eslintrc.json'],
  ["sed --in-place -e 's/a/b/' prettier.config.js", 'prettier.config.js'],
  ['cp /tmp/x.json .eslintrc.json', '.eslintrc.json'],
  ['mv tmp.js eslint.config.js', 'eslint.config.js'],
  ['install -m 644 src.json biome.json', 'biome.json'],
  ['cp -t config/ .eslintrc.json', 'config/.eslintrc.json'],
  ['cat > .eslintrc.json <<EOF\n{}\nEOF', '.eslintrc.json'],
  ['npm test && echo {} > .eslintrc.json', '.eslintrc.json'],
  ['false || echo {} > .eslintrc.json', '.eslintrc.json'],
  ['ls; echo {} > .eslintrc.json', '.eslintrc.json'],
  ['FOO=1 sed -i s/a/b/ .eslintrc.json', '.eslintrc.json'],
  ['sudo tee .editorconfig < /dev/null', '.editorconfig'],
];

for (const [cmd, expected] of WRITE_CASES) {
  test(`write target found: ${JSON.stringify(cmd)} -> ${expected}`, () => {
    const { extractWriteTargets } = loadConfigProtection();
    const targets = extractWriteTargets(cmd);
    assert.ok(targets.includes(expected), `expected ${expected} in ${JSON.stringify(targets)}`);
  });
}

section('runBash: protected writes exit 2 with the same reason as Edit/Write');

const BLOCK_COMMANDS = WRITE_CASES
  .map(([cmd]) => cmd)
  .filter((cmd) => !/cp -t config\//.test(cmd)); // covered separately below

for (const cmd of BLOCK_COMMANDS) {
  test(`blocks: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
      assert.ok(/BLOCKED: Cannot modify /.test(r.stderr), `stderr should carry BLOCKED reason: ${r.stderr}`);
    });
  });
}

test('cp -t <dir> with a protected source basename blocks', () => {
  withTmp((tmp) => {
    const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('cp -t config/ .eslintrc.json'));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  });
});

test('Bash block reason is byte-identical to the Edit/Write block reason', () => {
  withTmp((tmp) => {
    const bash = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('echo {} > .eslintrc.json'));
    const edit = runScript(EDIT_GUARD_COMBINED, tmp, { tool_name: 'Edit', tool_input: { file_path: '/repo/.eslintrc.json' } });
    assert.strictEqual(edit.status, 2);
    assert.strictEqual(bash.status, 2);
    const bashReason = JSON.parse(bash.stderr.trim().split('\n').pop()).reason;
    const editReason = JSON.parse(edit.stderr.trim().split('\n').pop()).reason;
    assert.strictEqual(bashReason, editReason);
    assert.strictEqual(bashReason, EDIT_BLOCK_REASON);
  });
});

test('runBash returns 2 (does not process.exit) so the combined hook can run both guards', () => {
  const cp = loadConfigProtection();
  const origWrite = process.stderr.write;
  process.stderr.write = () => true;
  let code;
  try {
    code = cp.runBash(JSON.stringify(bashEvent('echo {} > .eslintrc.json')));
  } finally {
    process.stderr.write = origWrite;
  }
  assert.strictEqual(code, 2);
});

test('WARN pattern (tsconfig.json) via Bash warns but does not block', () => {
  withTmp((tmp) => {
    const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('echo {} > tsconfig.json'));
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    assert.ok(/WARNING/.test(r.stderr), `stderr should carry WARNING: ${r.stderr}`);
  });
});

section('runBash: reads and look-alikes are allowed (prefer false negatives)');

const ALLOW_COMMANDS = [
  'cat .eslintrc.json',
  'grep -n rules .eslintrc.json',
  'head -20 .prettierrc',
  'node script.js < .eslintrc.json',
  "grep '>' .eslintrc.json",
  'echo "a > .eslintrc.json"',
  'git commit -m "tweak .eslintrc > x"',
  'echo hi # > .eslintrc.json',
  'npm run lint 2>&1 | tee lint.log',
  'npm test > /dev/null 2>&1',
  'echo x >&2',
  'cp .eslintrc.json backup.json',
  'jq . .eslintrc.json > /tmp/out.json',
  "sed 's/a/b/' .eslintrc.json",
  "sed -i 's/x/.eslintrc/' src/app.js",
  'cat > notes.md <<EOF\necho {} > .eslintrc.json\nEOF',
  "cat > notes.md <<'EOF'\n> .prettierrc\nEOF",
  'cat > notes.md <<-EOF\n\techo > biome.json\n\tEOF',
  'ls -la',
  '',
  // Commit / PR-body idiom: heredoc inside "$(...)" whose body mentions a write.
  'git commit -m "$(cat <<\'EOF\'\nfix: block "echo {} > .eslintrc.json" writes\nEOF\n)"',
  'gh pr create --title t --body "$(cat <<\'EOF\'\nfix: a) b > .prettierrc\nEOF\n)"',
  'git commit -m "$(cat <<EOF\nnote: tee .editorconfig\nEOF\n)" && git log -1',
  // Plain-directory backup target is not treated as a write of the source basename.
  'cp .prettierrc /tmp/backup/',
];

for (const cmd of ALLOW_COMMANDS) {
  test(`allows: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
      assert.ok(!/BLOCKED/.test(r.stderr), `unexpected block: ${r.stderr}`);
    });
  });
}

test('parser never executes the command (command substitution is inert)', () => {
  withTmp((tmp) => {
    const marker = path.join(tmp, 'pwned');
    const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(`echo $(touch ${marker}) \`touch ${marker}\``));
    assert.strictEqual(r.status, 0);
    assert.ok(!fs.existsSync(marker), 'parser must not execute anything');
  });
});

section('I1: Bash path matches only real config names (anchored), not prefixes');

const PREFIX_LOOKALIKES = [
  'cp .eslintrc.json .eslintrc.json.bak',
  'mv .eslintrc.json .eslintrc.json.old',
  'git diff > .eslintrc.patch',
  'npm test > .prettierrc.log',
  'echo x > .eslintrc.bak',
  'echo x > eslint.config.js.bak',
  'echo x > prettier.config.notes',
  'echo x > biome.json.orig',
  'echo x > .editorconfig.bak',
];
for (const cmd of PREFIX_LOOKALIKES) {
  test(`allows look-alike: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    });
  });
}

const REAL_CONFIG_NAMES = [
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml',
  'eslint.config.js', 'eslint.config.cjs', 'eslint.config.mjs', 'eslint.config.ts', 'eslint.config.cts', 'eslint.config.mts',
  '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.yaml',
  '.prettierrc.yml', '.prettierrc.toml', '.prettierrc.json5',
  'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts',
  'biome.json', 'biome.jsonc', '.editorconfig',
];
for (const name of REAL_CONFIG_NAMES) {
  test(`still blocks real config name via Bash: ${name}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(`echo x > ${name}`));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
      const reason = JSON.parse(r.stderr.trim().split('\n').pop()).reason;
      assert.strictEqual(reason, `BLOCKED: Cannot modify ${name}. Fix source code instead of weakening linter/formatter config.`);
    });
  });
}

test('tsconfig.build.json via Bash still warns; tsconfig.json.bak does not', () => {
  withTmp((tmp) => {
    const w = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('echo {} > tsconfig.build.json'));
    assert.strictEqual(w.status, 0);
    assert.ok(/WARNING/.test(w.stderr), w.stderr);
    const n = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('echo {} > tsconfig.json.bak'));
    assert.strictEqual(n.status, 0);
    assert.ok(!/WARNING/.test(n.stderr), n.stderr);
  });
});

test('Edit/Write path matching is unchanged (prefix .eslintrc.bak still blocked there)', () => {
  withTmp((tmp) => {
    const r = runScript(EDIT_GUARD_COMBINED, tmp, { tool_name: 'Edit', tool_input: { file_path: '/repo/.eslintrc.bak' } });
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  });
});

section('M1: targets outside the project do not block');

for (const cmd of [
  'cp .eslintrc.json /tmp/.eslintrc.json',
  'git show HEAD:.eslintrc.json > /tmp/.eslintrc.json',
  'echo x > ../other/.eslintrc',
  'echo x > ~/.editorconfig',
]) {
  test(`allows outside-project target: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    });
  });
}

for (const cmd of ['echo x > ./.eslintrc.json', 'echo x > sub/.eslintrc.json', 'echo x > sub/../.prettierrc']) {
  test(`blocks inside-project target: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    });
  });
}

test('absolute path that resolves INSIDE the project still blocks', () => {
  withTmp((tmp) => {
    const real = fs.realpathSync(tmp);
    const r = runScript(BASH_GUARD_COMBINED, real, bashEvent(`echo x > ${real}/.eslintrc.json`));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  });
});

section('M2: > inside [[ ... ]] is a comparison, not a redirect');

for (const cmd of [
  '[[ "$a" > .eslintrc.json ]] && echo yes',
  'if [[ $x > .prettierrc ]]; then echo y; fi',
]) {
  test(`allows: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    });
  });
}

test('redirect after a closed [[ ]] still blocks', () => {
  withTmp((tmp) => {
    const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('[[ -f x ]] && echo {} > .eslintrc.json'));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  });
});

section('M4: wrapper options are skipped to find the real command');

for (const cmd of [
  'sudo -u root tee .eslintrc.json',
  'sudo -E -g staff tee .eslintrc.json',
  'env -i FOO=1 tee .eslintrc.json',
  'env -u HOME tee .prettierrc',
  'time -p sed -i s/a/b/ .eslintrc.json',
  'nohup cp x.json biome.json',
  'command -p tee .editorconfig',
]) {
  test(`blocks through wrapper options: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    });
  });
}

section('M5: ENVOY_OVERRIDE inside the command text is NOT an override');

for (const cmd of [
  'ENVOY_OVERRIDE=1 echo x > .eslintrc.json',
  'export ENVOY_OVERRIDE=1; echo x > .eslintrc.json',
]) {
  test(`still blocked: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    });
  });
}

section('ENVOY_OVERRIDE: lets a protected write through on both paths');

test('Bash: ENVOY_OVERRIDE=1 allows a protected write', () => {
  withTmp((tmp) => {
    const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('echo {} > .eslintrc.json'), { ENVOY_OVERRIDE: '1' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  });
});

test('Edit/Write: ENVOY_OVERRIDE=1 allows a protected edit', () => {
  withTmp((tmp) => {
    const r = runScript(EDIT_GUARD_COMBINED, tmp, { tool_name: 'Edit', tool_input: { file_path: '/repo/.eslintrc.json' } }, { ENVOY_OVERRIDE: '1' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  });
});

for (const ov of ['0', 'false', '']) {
  test(`ENVOY_OVERRIDE=${JSON.stringify(ov)} does NOT override (Bash and Edit)`, () => {
    withTmp((tmp) => {
      const b = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('echo {} > .eslintrc.json'), { ENVOY_OVERRIDE: ov });
      const e = runScript(EDIT_GUARD_COMBINED, tmp, { tool_name: 'Edit', tool_input: { file_path: '/repo/.eslintrc.json' } }, { ENVOY_OVERRIDE: ov });
      assert.strictEqual(b.status, 2, `Bash: expected 2, got ${b.status}`);
      assert.strictEqual(e.status, 2, `Edit: expected 2, got ${e.status}`);
    });
  });
}

section('combined: issue-create-guard still runs, each sub-guard disables independently');

test('duplicate gh issue create still blocked through bash-guard-combined (issue-create-guard runs)', () => {
  withTmp((tmp) => {
    writeSession(tmp, 42);
    const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('gh issue create --title x'));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    assert.ok(/issue-create-guard/.test(r.stderr), r.stderr);
  });
});

test('ENVOY_DISABLED_HOOKS=config-protection: protected write allowed, issue-create-guard still blocks', () => {
  withTmp((tmp) => {
    const env = { ENVOY_DISABLED_HOOKS: 'config-protection' };
    const w = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('echo {} > .eslintrc.json'), env);
    assert.strictEqual(w.status, 0, `config-protection should be skipped: ${w.status}\n${w.stderr}`);
    writeSession(tmp, 42);
    const i = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('gh issue create --title x'), env);
    assert.strictEqual(i.status, 2, `issue-create-guard should still run: ${i.status}\n${i.stderr}`);
  });
});

test('ENVOY_DISABLED_HOOKS=issue-create-guard: duplicate issue allowed, config-protection still blocks', () => {
  withTmp((tmp) => {
    const env = { ENVOY_DISABLED_HOOKS: 'issue-create-guard' };
    writeSession(tmp, 42);
    const i = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('gh issue create --title x'), env);
    assert.strictEqual(i.status, 0, `issue-create-guard should be skipped: ${i.status}\n${i.stderr}`);
    const w = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('echo {} > .eslintrc.json'), env);
    assert.strictEqual(w.status, 2, `config-protection should still run: ${w.status}\n${w.stderr}`);
  });
});

test('via hook-runner: bash-guard-combined blocks a protected write (exit 2)', () => {
  withTmp((tmp) => {
    const r = runScript(HOOK_RUNNER, tmp, bashEvent('echo {} > .eslintrc.json'), {}, ['bash-guard-combined']);
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  });
});

test('non-Bash tool_name -> exit 0', () => {
  withTmp((tmp) => {
    const r = runScript(BASH_GUARD_COMBINED, tmp, { tool_name: 'Read', tool_input: { file_path: '.eslintrc.json' } });
    assert.strictEqual(r.status, 0);
  });
});

test('malformed stdin -> exit 0, no crash', () => {
  withTmp((tmp) => {
    const r = runScript(BASH_GUARD_COMBINED, tmp, 'not json {{{');
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  });
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
