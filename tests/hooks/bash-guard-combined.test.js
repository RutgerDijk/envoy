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
  delete base.CLAUDE_PROJECT_DIR;
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
  // GNU: -i ends the cluster; the rest is the backup suffix, not -e/-f.
  ["sed -ie 's/error/off/' .eslintrc.json", '.eslintrc.json'],
  ["sed -if 's/error/off/' .prettierrc", '.prettierrc'],
  ["sed -Eie 's/error/off/' biome.json", 'biome.json'],
  // -e first: it takes the next arg as the script; -i follows separately.
  ["sed -e 's/a/b/' -i .eslintrc.json", '.eslintrc.json'],
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

section('targets resolve against the payload cwd, project root stays the hook cwd');

test('payload cwd in a subdir: ../.eslintrc.json lands in the project and blocks', () => {
  withTmp((tmp) => {
    fs.mkdirSync(path.join(tmp, 'sub'));
    const event = { ...bashEvent('echo {} > ../.eslintrc.json'), cwd: path.join(tmp, 'sub') };
    const r = runScript(BASH_GUARD_COMBINED, tmp, event);
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  });
});

test('payload cwd outside the project: .eslintrc.json there does not block', () => {
  withTmp((tmp) => {
    const outside = mkTmp();
    try {
      const event = { ...bashEvent('echo {} > .eslintrc.json'), cwd: outside };
      const r = runScript(BASH_GUARD_COMBINED, tmp, event);
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
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

section('PR #98: [[ ]] scope survives &&, ||, ( and )');

for (const cmd of [
  '[[ -n foo && z > .eslintrc.json ]]',
  '[[ -n foo || z > .prettierrc ]] && echo ok',
  '[[ ( -n foo ) && z < biome.json ]]',
  'if [[ -n $a && $a > .eslintrc.json ]]; then echo y; fi',
]) {
  test(`allows compound condition: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    });
  });
}

test('redirect after a closed compound [[ a && b ]] still blocks', () => {
  withTmp((tmp) => {
    const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent('[[ -n a && -n b ]] && echo {} > .eslintrc.json'));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  });
});

section('PR #98: writes inside if/then/else/do bodies are detected');

for (const cmd of [
  "if true; then sed -i 's/error/off/' .eslintrc.json; fi",
  'if true; then tee .prettierrc < /dev/null; fi',
  'if false; then :; else cp x.json biome.json; fi',
  'for f in a; do mv tmp.js eslint.config.js; done',
  'while false; do cp x.json .eslintrc.json; done',
  "if sed -i 's/a/b/' .eslintrc.json; then echo ok; fi",
  '! tee .editorconfig < /dev/null',
  '{ cp x.json .eslintrc.json; }',
]) {
  test(`blocks compound-command body: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    });
  });
}

test('a quoted keyword is not a keyword: "then" tee ... runs the command "then"', () => {
  const { extractWriteTargets } = loadConfigProtection();
  assert.deepStrictEqual(extractWriteTargets("'then' tee .eslintrc.json"), []);
});

section('PR #98: attached sed -e/-f script options');

for (const cmd of [
  "sed -i -e's/error/off/' .eslintrc.json",
  'sed -i -frules.sed .eslintrc.json',
  "sed -e's/a/b/' -i .prettierrc",
  'sed --in-place -finline.sed biome.json',
]) {
  test(`blocks attached script option: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    });
  });
}

section('PR #98: cd / pushd / env -C move the base for relative targets');

for (const cmd of [
  "cd /tmp && echo '{}' > .eslintrc.json",
  'pushd /tmp; echo {} > .prettierrc',
  'env -C /tmp tee .eslintrc.json < /dev/null',
  'env --chdir=/tmp tee .eslintrc.json < /dev/null',
  'cd "$HOME" && echo {} > .eslintrc.json',
  'cd && echo {} > .eslintrc.json',
  'cd - && echo {} > .eslintrc.json',
]) {
  test(`allows write after leaving the project: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    });
  });
}

section('review 2 (#98): popd and cd - return to a known directory');

for (const cmd of [
  'pushd /tmp; popd; echo {} > .eslintrc.json',
  'pushd /tmp && popd && echo {} > .eslintrc.json',
  'pushd /tmp; pushd /var; popd; popd; echo {} > .eslintrc.json',
  'cd /tmp; cd -; echo {} > .eslintrc.json',
  'cd /tmp && cd - && echo {} > .eslintrc.json',
  'cd sub; cd -; echo {} > .eslintrc.json',
]) {
  test(`blocks a write after returning into the project: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, 'sub'));
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    });
  });
}

for (const cmd of [
  'pushd /tmp; pushd /var; popd; echo {} > .eslintrc.json',
  'cd sub; cd /tmp; cd -; cd -; echo {} > .eslintrc.json',
]) {
  test(`allows a write while still outside the project: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, 'sub'));
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    });
  });
}

test('popd without a pushd in the command leaves the directory unknown (relative target not judged)', () => {
  const cp = loadConfigProtection();
  assert.deepStrictEqual(cp.extractWriteTargetsWithDirs('popd; echo {} > .eslintrc.json'), [{ target: '.eslintrc.json', dirs: null }]);
});

for (const cmd of [
  'cd sub && echo {} > .eslintrc.json',
  'cd sub && echo {} > ../.prettierrc',
  '(cd /tmp && echo x > a.txt); echo {} > .eslintrc.json',
  'echo {} > .eslintrc.json; cd /tmp',
  'env -C sub tee .eslintrc.json < /dev/null',
]) {
  test(`blocks write that stays inside the project: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, 'sub'));
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    });
  });
}

section('PR #98 cycle 2: env only counts in the wrapper prefix; sibling subshells; redirects ignore env -C');

for (const cmd of [
  'tee -- .eslintrc.json env -C /tmp/out.log < /dev/null',
  'tee .prettierrc env --chdir=/tmp < /dev/null',
  '(cd /tmp); (printf x > .eslintrc.json)',
  '(cd /tmp) ; (cp x.json biome.json)',
  '((cd /tmp); echo {} > .eslintrc.json)',
  'env -C /tmp cat /dev/null > .eslintrc.json',
  'env --chdir /tmp echo {} >> .prettierrc',
]) {
  test(`blocks: ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    });
  });
}

for (const cmd of [
  '(cd /tmp; (echo {} > .eslintrc.json))',
  'env -C /tmp tee .eslintrc.json < /dev/null',
]) {
  test(`allows (nested subshell inherits / env -C operand): ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    });
  });
}

test('unknown cd target still blocks an absolute in-project target', () => {
  withTmp((tmp) => {
    const real = fs.realpathSync(tmp);
    const r = runScript(BASH_GUARD_COMBINED, real, bashEvent(`cd "$X" && echo x > ${real}/.eslintrc.json`));
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  });
});

section('review fixes (#94): conditional cd, case patterns, $VAR roots, CLAUDE_PROJECT_DIR');

// A cd that may not run leaves the original directory as a possibility, so a
// protected write that lands in the project from either directory is blocked.
for (const cmd of [
  'case $x in a) cd /tmp;; esac; echo {} > .eslintrc.json',
  'case $x in (a) cd /tmp;; esac; echo {} > .eslintrc.json',
  'if [ -n "$x" ]; then cd /tmp; fi; echo {} > .eslintrc.json',
  'if [ -n "$x" ]; then cd /tmp; else true; fi\necho {} > .prettierrc',
  'false || cd /tmp; echo {} > .eslintrc.json',
  'test -d /tmp && cd /tmp; echo {} > .eslintrc.json',
  'while false; do cd /tmp; done; echo {} > .eslintrc.json',
  'for d in /tmp; do cd "$d"; done; echo {} > .eslintrc.json',
  'cd /tmp | cat; echo {} > .eslintrc.json',
  '(case $x in a) echo hi;; esac; cd /tmp); echo {} > .eslintrc.json',
]) {
  test(`blocks (cd may not have run): ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
    });
  });
}

for (const cmd of [
  'cd /tmp; echo {} > .eslintrc.json',
  'if true; then cd /tmp && echo {} > .eslintrc.json; fi',
  'case $x in a) cd /tmp && echo {} > .eslintrc.json;; esac',
  'test -d /tmp && cd /tmp && echo {} > .eslintrc.json',
  'echo {} > "$HOME/.prettierrc"',
  'cp x.json "${HOME}/.eslintrc.json"',
  'tee $XDG_CONFIG_HOME/.prettierrc < /dev/null',
]) {
  test(`allows (write lands outside the project): ${JSON.stringify(cmd)}`, () => {
    withTmp((tmp) => {
      const r = runScript(BASH_GUARD_COMBINED, tmp, bashEvent(cmd));
      assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
    });
  });
}

test('CLAUDE_PROJECT_DIR is the project root: a write from a subdir to the root config is blocked', () => {
  withTmp((tmp) => {
    const real = fs.realpathSync(tmp);
    const sub = path.join(real, 'sub');
    fs.mkdirSync(sub);
    const r = runScript(BASH_GUARD_COMBINED, sub, { ...bashEvent('echo {} > ../.eslintrc.json'), cwd: sub }, { CLAUDE_PROJECT_DIR: real });
    assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stderr}`);
  });
});

test('ENVOY_DISABLED_HOOKS=config-protection also turns off the Edit/Write check', () => {
  withTmp((tmp) => {
    const r = runScript(EDIT_GUARD_COMBINED, tmp, { tool_name: 'Edit', tool_input: { file_path: '/repo/.eslintrc.json' } }, { ENVOY_DISABLED_HOOKS: 'config-protection' });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
  });
});

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
