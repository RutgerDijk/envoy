---
applyTo: '**/.github/workflows/*.{yml,yaml}'
---

# GitHub Actions Best Practices

## Workflow Structure

```
.github/workflows/
├── ci.yml        # Build + test on every push and PR
├── cd-dev.yml    # Deploy to dev on merge to develop
└── cd-prod.yml   # Deploy to production on merge to main
```

## CI Workflow

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '10.x'

      - name: Restore
        run: dotnet restore

      - name: Build
        run: dotnet build --no-restore --configuration Release

      - name: Test
        run: dotnet test --no-build --configuration Release --logger trx --collect:"XPlat Code Coverage"

      - name: Upload coverage
        uses: codecov/codecov-action@v4

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --coverage
      - run: npm run build
```

## Secrets Management

```yaml
# Reference secrets — never hardcode values
env:
  AZURE_CREDENTIALS: ${{ secrets.AZURE_CREDENTIALS }}
  DB_CONNECTION: ${{ secrets.DB_CONNECTION }}
```

## Reusable Workflows

```yaml
# .github/workflows/deploy.yml (reusable)
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string

jobs:
  deploy:
    environment: ${{ inputs.environment }}
    ...
```

## Common Mistakes to Avoid

- ❌ No `concurrency` group → multiple workflows run simultaneously for the same branch
- ❌ Secrets in workflow files → use GitHub repository/environment secrets
- ❌ `actions/checkout@v2` → use latest (`@v4`) for security patches
- ❌ No caching → `actions/setup-node` with `cache: 'npm'` or `actions/cache`
- ❌ `continue-on-error: true` in CI → errors should fail the build
- ❌ Scripts inline in YAML → extract to shell scripts for testability
