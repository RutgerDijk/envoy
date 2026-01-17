# GitHub Actions Stack Profile

## Detection

```bash
# Detect GitHub Actions
find .github/workflows -name "*.yml" -o -name "*.yaml" 2>/dev/null | head -1
```

## Best Practices

### Workflow Structure

```
.github/
└── workflows/
    ├── ci.yml              # Continuous integration
    ├── cd-dev.yml          # Deploy to dev
    ├── cd-prod.yml         # Deploy to production
    └── codeql.yml          # Security scanning
```

### CI Workflow

```yaml
# .github/workflows/ci.yml
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
  build-api:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: src/Api

    steps:
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '9.0.x'

      - name: Restore dependencies
        run: dotnet restore

      - name: Build
        run: dotnet build --no-restore

      - name: Test
        run: dotnet test --no-build --verbosity normal --collect:"XPlat Code Coverage"

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}

  build-web:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: src/web

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: src/web/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run typecheck

      - name: Test
        run: npm test -- --coverage

      - name: Build
        run: npm run build

  e2e:
    needs: [build-api, build-web]
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
```

### CD Workflow

```yaml
# .github/workflows/cd-prod.yml
name: Deploy to Production

on:
  push:
    branches: [main]

permissions:
  id-token: write  # For Azure OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production

    steps:
      - uses: actions/checkout@v4

      - name: Azure Login
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Build and push container
        run: |
          az acr login --name ${{ vars.ACR_NAME }}
          docker build -t ${{ vars.ACR_NAME }}.azurecr.io/api:${{ github.sha }} .
          docker push ${{ vars.ACR_NAME }}.azurecr.io/api:${{ github.sha }}

      - name: Deploy infrastructure
        uses: azure/arm-deploy@v2
        with:
          scope: subscription
          region: westeurope
          template: infra/main.bicep
          parameters: infra/parameters/prod.bicepparam imageTag=${{ github.sha }}

      - name: Deploy to Container App
        run: |
          az containerapp update \
            --name ${{ vars.CONTAINER_APP_NAME }} \
            --resource-group ${{ vars.RESOURCE_GROUP }} \
            --image ${{ vars.ACR_NAME }}.azurecr.io/api:${{ github.sha }}
```

### Reusable Workflows

```yaml
# .github/workflows/deploy.yml (reusable)
name: Deploy

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      image-tag:
        required: true
        type: string
    secrets:
      AZURE_CLIENT_ID:
        required: true
      AZURE_TENANT_ID:
        required: true
      AZURE_SUBSCRIPTION_ID:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      # ... deployment steps

# Usage in another workflow
jobs:
  deploy-staging:
    uses: ./.github/workflows/deploy.yml
    with:
      environment: staging
      image-tag: ${{ github.sha }}
    secrets: inherit
```

### Caching

```yaml
# .NET caching
- uses: actions/cache@v4
  with:
    path: ~/.nuget/packages
    key: ${{ runner.os }}-nuget-${{ hashFiles('**/*.csproj') }}
    restore-keys: |
      ${{ runner.os }}-nuget-

# Node caching (automatic with setup-node)
- uses: actions/setup-node@v4
  with:
    cache: 'npm'
    cache-dependency-path: src/web/package-lock.json

# Docker layer caching
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

## Common Mistakes

### Mistake: No Concurrency Control

```yaml
# Bad: Multiple runs for same branch
on:
  push:
    branches: [main]

# Good: Cancel in-progress runs
on:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

### Mistake: Secrets in Logs

```yaml
# Bad: Secrets can appear in logs
- run: echo "Connecting to ${{ secrets.DB_CONNECTION }}"

# Good: Mask secrets
- run: |
    echo "::add-mask::${{ secrets.DB_CONNECTION }}"
    ./deploy.sh
```

### Mistake: No Environment Protection

```yaml
# Bad: No approval required
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy-to-prod.sh

# Good: Environment with protection rules
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment: production  # Requires approval
    steps:
      - run: ./deploy-to-prod.sh
```

### Mistake: Using Deprecated Actions

```yaml
# Bad: Old action versions
- uses: actions/checkout@v2

# Good: Latest major versions
- uses: actions/checkout@v4
```

### Mistake: Long-Running Single Job

```yaml
# Bad: Everything in one job (slow, no parallelism)
jobs:
  build-and-test:
    steps:
      - run: dotnet build
      - run: dotnet test
      - run: npm install
      - run: npm test
      - run: npm run e2e

# Good: Parallel jobs
jobs:
  build-api:
    steps:
      - run: dotnet build && dotnet test

  build-web:
    steps:
      - run: npm ci && npm test

  e2e:
    needs: [build-api, build-web]
    steps:
      - run: npm run e2e
```

### Mistake: No Artifact Upload on Failure

```yaml
# Bad: Can't debug failed tests
- run: npm test

# Good: Upload artifacts for debugging
- run: npm test
  continue-on-error: true

- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: test-results
    path: test-results/
```

## Review Checklist

- [ ] Concurrency control prevents duplicate runs
- [ ] Secrets not exposed in logs
- [ ] Production has environment protection
- [ ] Latest action versions used (@v4)
- [ ] Jobs parallelized where possible
- [ ] Caching configured for dependencies
- [ ] Artifacts uploaded for debugging
- [ ] OIDC used for Azure (not secrets)
- [ ] Reusable workflows for common patterns
- [ ] Path filters to avoid unnecessary runs

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [Security Hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
