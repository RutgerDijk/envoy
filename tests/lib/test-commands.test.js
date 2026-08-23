#!/usr/bin/env node
/**
 * test-commands — Test Suite
 *
 * Run: node tests/lib/test-commands.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    resolveTestCommands,
    buildFilteredCommand,
    extractTestCommandSection,
    parseTestCommandSection,
    PLACEHOLDER,
} = require('../../lib/test-commands.js');

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
    return fs.mkdtempSync(path.join(os.tmpdir(), 'test-commands-test-'));
}

function mkStacksDir(files) {
    const dir = mkTmp();
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, `${name}.md`), content, 'utf8');
    }
    return dir;
}

const DOTNET_PROFILE = `# Testing (.NET)

## Best Practices

Some practices.

## Test Command

filtered: dotnet test --filter "FullyQualifiedName~${PLACEHOLDER}"
full: dotnet test

## Common Mistakes

Some mistakes.
`;

const PLAYWRIGHT_PROFILE = `# Testing (Playwright)

## Test Command

filtered: npx playwright test -g "${PLACEHOLDER}"
full: npx playwright test
`;

const NO_SECTION_PROFILE = `# Some Stack

## Best Practices

Nothing about tests here.
`;

section('resolveTestCommands: CLAUDE.md override');

test('CLAUDE.md declared command wins over stack profile', () => {
    const project = mkTmp();
    const stacksDir = mkStacksDir({ 'testing-dotnet': DOTNET_PROFILE });
    fs.writeFileSync(
        path.join(project, 'CLAUDE.md'),
        `# Project\n\n## Test Command\n\nfiltered: dotnet test --filter "Name~${PLACEHOLDER}" --no-build\nfull: dotnet test --no-build\n`,
        'utf8'
    );
    fs.writeFileSync(path.join(project, 'App.csproj'), '<Project></Project>', 'utf8');

    const resolved = resolveTestCommands(project, { stacksDir });

    assert.strictEqual(resolved.source, 'claude.md');
    assert.strictEqual(resolved.full, 'dotnet test --no-build');
    assert.ok(resolved.filtered.includes('--no-build'));
    assert.strictEqual(resolved.commands.length, 1);
    assert.strictEqual(resolved.commands[0].source, 'claude.md');

    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(stacksDir, { recursive: true, force: true });
});

section('resolveTestCommands: stack-profile fallback');

test('no CLAUDE.md declaration falls back to stack profile Test Command section', () => {
    const project = mkTmp();
    const stacksDir = mkStacksDir({ 'testing-dotnet': DOTNET_PROFILE });
    fs.writeFileSync(path.join(project, 'App.csproj'), '<Project><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>', 'utf8');

    const resolved = resolveTestCommands(project, { stacksDir });

    assert.strictEqual(resolved.source, 'stack-profile');
    assert.strictEqual(resolved.full, 'dotnet test');
    assert.ok(resolved.filtered.includes('FullyQualifiedName~'));

    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(stacksDir, { recursive: true, force: true });
});

test('multiple detected stacks produce multiple commands, not a single guess', () => {
    const project = mkTmp();
    const stacksDir = mkStacksDir({
        'testing-dotnet': DOTNET_PROFILE,
        'testing-playwright': PLAYWRIGHT_PROFILE,
    });
    fs.writeFileSync(path.join(project, 'App.csproj'), '<Project><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>', 'utf8');
    fs.writeFileSync(
        path.join(project, 'package.json'),
        JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
        'utf8'
    );

    const resolved = resolveTestCommands(project, { stacksDir });

    assert.strictEqual(resolved.source, 'stack-profile');
    assert.strictEqual(resolved.commands.length, 2);
    const names = resolved.commands.map((c) => c.stack).sort();
    assert.deepStrictEqual(names, ['testing-dotnet', 'testing-playwright']);

    const dotnetCmd = resolved.commands.find((c) => c.stack === 'testing-dotnet');
    const pwCmd = resolved.commands.find((c) => c.stack === 'testing-playwright');
    assert.strictEqual(dotnetCmd.full, 'dotnet test');
    assert.strictEqual(pwCmd.full, 'npx playwright test');

    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(stacksDir, { recursive: true, force: true });
});

test('detected stack whose profile has no Test Command section is skipped, not guessed', () => {
    const project = mkTmp();
    const stacksDir = mkStacksDir({ dotnet: NO_SECTION_PROFILE });
    fs.writeFileSync(path.join(project, 'App.csproj'), '<Project></Project>', 'utf8');

    const resolved = resolveTestCommands(project, { stacksDir });

    assert.strictEqual(resolved.source, 'none');
    assert.strictEqual(resolved.filtered, null);
    assert.strictEqual(resolved.full, null);
    assert.deepStrictEqual(resolved.commands, []);

    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(stacksDir, { recursive: true, force: true });
});

section('resolveTestCommands: no-source degradation');

test('neither CLAUDE.md nor any detected stack profile yields a command: returns nulls, does not throw', () => {
    const project = mkTmp();
    const stacksDir = mkStacksDir({});

    let resolved;
    assert.doesNotThrow(() => {
        resolved = resolveTestCommands(project, { stacksDir });
    });

    assert.deepStrictEqual(resolved, { filtered: null, full: null, source: 'none', commands: [] });

    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(stacksDir, { recursive: true, force: true });
});

test('malformed CLAUDE.md Test Command section degrades instead of throwing', () => {
    const project = mkTmp();
    const stacksDir = mkStacksDir({});
    fs.writeFileSync(
        path.join(project, 'CLAUDE.md'),
        `# Project\n\n## Test Command\n\nthis section has no filtered/full lines at all\n`,
        'utf8'
    );

    let resolved;
    assert.doesNotThrow(() => {
        resolved = resolveTestCommands(project, { stacksDir });
    });
    assert.strictEqual(resolved.source, 'none');
    assert.strictEqual(resolved.filtered, null);

    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(stacksDir, { recursive: true, force: true });
});

test('nonexistent projectDir does not throw', () => {
    const stacksDir = mkStacksDir({ 'testing-dotnet': DOTNET_PROFILE });
    let resolved;
    assert.doesNotThrow(() => {
        resolved = resolveTestCommands('/nonexistent/path/xyz', { stacksDir });
    });
    assert.strictEqual(resolved.source, 'none');
    fs.rmSync(stacksDir, { recursive: true, force: true });
});

section('buildFilteredCommand: placeholder substitution');

test('substitutes the test name into the stack filter placeholder', () => {
    const filtered = `dotnet test --filter "FullyQualifiedName~${PLACEHOLDER}"`;
    const built = buildFilteredCommand(filtered, 'MyTests.ShouldDoThing');
    assert.strictEqual(built, 'dotnet test --filter "FullyQualifiedName~MyTests.ShouldDoThing"');
});

test('resolved commands expose a buildFilteredCommand(testName) helper', () => {
    const project = mkTmp();
    const stacksDir = mkStacksDir({ 'testing-dotnet': DOTNET_PROFILE });
    fs.writeFileSync(path.join(project, 'App.csproj'), '<Project><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>', 'utf8');

    const resolved = resolveTestCommands(project, { stacksDir });
    const built = resolved.commands[0].buildFilteredCommand('MyTests.ShouldDoThing');
    assert.ok(built.includes('MyTests.ShouldDoThing'));
    assert.ok(!built.includes(PLACEHOLDER));

    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(stacksDir, { recursive: true, force: true });
});

test('returns filtered command unchanged (no placeholder found) rather than throwing', () => {
    const built = buildFilteredCommand('dotnet test', 'MyTests.ShouldDoThing');
    assert.strictEqual(built, 'dotnet test');
});

test('warns (not throws) when the placeholder is missing, so a malformed profile is not silently ignored', () => {
    const originalWarn = console.warn;
    let warned = null;
    console.warn = (msg) => { warned = msg; };
    try {
        const built = buildFilteredCommand('dotnet test', 'MyTests.ShouldDoThing');
        assert.strictEqual(built, 'dotnet test');
        assert.ok(warned, 'expected a console.warn call');
        assert.ok(warned.includes(PLACEHOLDER), 'warning should mention the missing placeholder');
    } finally {
        console.warn = originalWarn;
    }
});

test('null filtered command returns null, not a throw', () => {
    assert.strictEqual(buildFilteredCommand(null, 'MyTests.ShouldDoThing'), null);
});

section('resolveTestCommands: real stack profiles (stacks/testing-dotnet.md, stacks/testing-playwright.md)');

test('real testing-dotnet.md profile contributes a resolvable Test Command section', () => {
    const realStacksDir = path.join(__dirname, '..', '..', 'stacks');
    const content = fs.readFileSync(path.join(realStacksDir, 'testing-dotnet.md'), 'utf8');
    const section = extractTestCommandSection(content);
    const parsed = parseTestCommandSection(section);

    assert.ok(parsed.filtered, 'expected a filtered command in stacks/testing-dotnet.md');
    assert.ok(parsed.full, 'expected a full command in stacks/testing-dotnet.md');
    assert.ok(parsed.filtered.includes(PLACEHOLDER));
    assert.strictEqual(parsed.full, 'dotnet test');

    const built = buildFilteredCommand(parsed.filtered, 'MyTests.ShouldDoThing');
    assert.ok(built.includes('MyTests.ShouldDoThing'));
});

test('real testing-playwright.md profile contributes a resolvable Test Command section', () => {
    const realStacksDir = path.join(__dirname, '..', '..', 'stacks');
    const content = fs.readFileSync(path.join(realStacksDir, 'testing-playwright.md'), 'utf8');
    const section = extractTestCommandSection(content);
    const parsed = parseTestCommandSection(section);

    assert.ok(parsed.filtered, 'expected a filtered command in stacks/testing-playwright.md');
    assert.ok(parsed.full, 'expected a full command in stacks/testing-playwright.md');
    assert.ok(parsed.filtered.includes(PLACEHOLDER));
    assert.strictEqual(parsed.full, 'npx playwright test');

    const built = buildFilteredCommand(parsed.filtered, 'login test');
    assert.ok(built.includes('login test'));
});

test('resolveTestCommands resolves both real profiles end-to-end via detectStacks fixture', () => {
    const project = mkTmp();
    fs.writeFileSync(path.join(project, 'App.csproj'), '<Project><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>', 'utf8');
    fs.writeFileSync(
        path.join(project, 'package.json'),
        JSON.stringify({ devDependencies: { '@playwright/test': '1.0.0' } }),
        'utf8'
    );

    const realStacksDir = path.join(__dirname, '..', '..', 'stacks');
    const resolved = resolveTestCommands(project, { stacksDir: realStacksDir });

    assert.strictEqual(resolved.source, 'stack-profile');
    const dotnetCmd = resolved.commands.find((c) => c.stack === 'testing-dotnet');
    const pwCmd = resolved.commands.find((c) => c.stack === 'testing-playwright');
    assert.ok(dotnetCmd, 'expected testing-dotnet to contribute a resolved command');
    assert.ok(pwCmd, 'expected testing-playwright to contribute a resolved command');
    assert.strictEqual(dotnetCmd.full, 'dotnet test');
    assert.strictEqual(pwCmd.full, 'npx playwright test');

    fs.rmSync(project, { recursive: true, force: true });
});

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
