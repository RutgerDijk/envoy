# Review — Layer 3: Documentation (Medium+ tiers)

Announce: `Running Layer 3: Documentation...`

Invoke `envoy:docstrings` for public API documentation.

Scope: only changed files that have public APIs. Filter to code files:
- C#: `*.cs` (exclude `*.Designer.cs`, `Migrations/`)
- TypeScript: `*.ts`, `*.tsx` (exclude `*.d.ts`, `*.spec.ts`, `*.test.ts`)

Skip if no changed files have public APIs.
