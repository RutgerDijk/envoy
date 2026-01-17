# Azure Static Web Apps Stack Profile

## Detection

```bash
# Detect Static Web Apps
find . -name "staticwebapp.config.json" 2>/dev/null | head -1
```

## Best Practices

### Project Structure

```
├── src/
│   └── web/                    # React/Vite app
├── staticwebapp.config.json    # SWA configuration
└── infra/
    └── static-web-app.bicep    # Infrastructure
```

### Configuration File

```json
// staticwebapp.config.json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "/api/*"]
  },
  "routes": [
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    },
    {
      "route": "/admin/*",
      "allowedRoles": ["admin"]
    },
    {
      "route": "/login",
      "rewrite": "/.auth/login/aad"
    },
    {
      "route": "/logout",
      "redirect": "/.auth/logout"
    }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/login",
      "statusCode": 302
    },
    "404": {
      "rewrite": "/404.html"
    }
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  },
  "mimeTypes": {
    ".json": "application/json",
    ".wasm": "application/wasm"
  }
}
```

### Bicep Deployment

```bicep
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: appName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    repositoryUrl: repositoryUrl
    branch: branch
    buildProperties: {
      appLocation: 'src/web'
      outputLocation: 'dist'
      apiLocation: ''  // No API folder - using separate backend
    }
  }
}

// Link to API backend
resource backendLink 'Microsoft.Web/staticSites/linkedBackends@2023-01-01' = {
  parent: staticWebApp
  name: 'api-backend'
  properties: {
    backendResourceId: containerApp.id
    region: location
  }
}

// Custom domain
resource customDomain 'Microsoft.Web/staticSites/customDomains@2023-01-01' = if (!empty(customDomainName)) {
  parent: staticWebApp
  name: customDomainName
  properties: {}
}

// App settings
resource appSettings 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    VITE_API_URL: apiUrl
    VITE_APP_INSIGHTS_KEY: appInsights.properties.InstrumentationKey
  }
}
```

### Authentication Configuration

```json
// staticwebapp.config.json - AAD authentication
{
  "auth": {
    "identityProviders": {
      "azureActiveDirectory": {
        "registration": {
          "openIdIssuer": "https://login.microsoftonline.com/<tenant-id>/v2.0",
          "clientIdSettingName": "AAD_CLIENT_ID",
          "clientSecretSettingName": "AAD_CLIENT_SECRET"
        }
      }
    }
  },
  "routes": [
    {
      "route": "/login",
      "rewrite": "/.auth/login/aad"
    },
    {
      "route": "/.auth/login/github",
      "statusCode": 404
    },
    {
      "route": "/.auth/login/twitter",
      "statusCode": 404
    }
  ]
}
```

### Environment-Specific Builds

```yaml
# .github/workflows/azure-static-web-apps.yml
jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build
        env:
          VITE_API_URL: ${{ secrets.API_URL }}
          VITE_ENVIRONMENT: ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
        run: |
          cd src/web
          npm ci
          npm run build

      - name: Deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "src/web"
          output_location: "dist"
```

## Common Mistakes

### Mistake: Missing Navigation Fallback

```json
// Bad: SPA routes return 404
{
  "routes": []
}

// Good: Fallback for client-side routing
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "/api/*"]
  }
}
```

### Mistake: No Security Headers

```json
// Bad: Missing security headers
{
  "routes": [...]
}

// Good: Security headers configured
{
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'"
  }
}
```

### Mistake: Exposing All Auth Providers

```json
// Bad: All providers enabled by default
{
  "auth": {}
}

// Good: Only allow specific providers
{
  "routes": [
    { "route": "/.auth/login/github", "statusCode": 404 },
    { "route": "/.auth/login/twitter", "statusCode": 404 }
  ]
}
```

### Mistake: Wrong Output Location

```bicep
// Bad: Vite outputs to 'dist', not 'build'
buildProperties: {
  appLocation: 'src/web'
  outputLocation: 'build'  // Wrong!
}

// Good: Match your build tool's output
buildProperties: {
  appLocation: 'src/web'
  outputLocation: 'dist'  // Vite default
}
```

### Mistake: Hardcoded Environment Variables

```typescript
// Bad: Hardcoded values
const API_URL = "https://api.myapp.com";

// Good: Environment variables
const API_URL = import.meta.env.VITE_API_URL;
```

### Mistake: Free Tier Without Custom Domain Plan

```bicep
// Bad: Free tier can't use custom domains with SSL
sku: {
  name: 'Free'
}

// Good: Standard tier for production features
sku: {
  name: environment == 'prod' ? 'Standard' : 'Free'
}
```

## Review Checklist

- [ ] Navigation fallback configured for SPA
- [ ] Security headers set (CSP, X-Frame-Options, etc.)
- [ ] Only required auth providers enabled
- [ ] Output location matches build tool
- [ ] Environment variables used (not hardcoded)
- [ ] Custom domain configured for production
- [ ] Linked backend for API proxying
- [ ] Route-based authorization configured
- [ ] 404 and 401 response overrides set
- [ ] Standard SKU for production (custom domains)

## Resources

- [Azure Static Web Apps Documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/)
- [Configuration Reference](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration)
- [Authentication](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization)
