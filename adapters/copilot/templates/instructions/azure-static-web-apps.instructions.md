---
applyTo: '**/{staticwebapp.config.json,*.bicep}'
---

# Azure Static Web Apps Best Practices

## Configuration (staticwebapp.config.json)

```json
{
  "routes": [
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    },
    {
      "route": "/*",
      "serve": "/index.html",
      "statusCode": 200
    }
  ],
  "responseOverrides": {
    "401": { "redirect": "/login", "statusCode": 302 },
    "404": { "rewrite": "/index.html" }
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'nonce-{nonce}'"
  },
  "mimeTypes": {
    ".json": "text/json"
  }
}
```

## Bicep Module

```bicep
resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: appName
  location: location
  sku: { name: (environment == 'prod') ? 'Standard' : 'Free', tier: (environment == 'prod') ? 'Standard' : 'Free' }
  properties: {
    repositoryUrl: repositoryUrl
    branch: (environment == 'prod') ? 'main' : 'develop'
    buildProperties: {
      appLocation: 'src'
      outputLocation: 'dist'
      apiLocation: 'api'
    }
  }
}
```

## Environment Variables

Set app settings (not secrets — use Key Vault references for secrets):

```bash
az staticwebapp appsettings set \
  --name myapp-web \
  --setting-names "VITE_API_URL=https://api.myapp.com" \
                  "VITE_AUTH_CLIENT_ID=<client-id>"
```

## Common Mistakes to Avoid

- ❌ No `/*` catch-all route → SPA routing breaks on direct URL navigation
- ❌ Missing security headers → configure `globalHeaders` for CSP, X-Frame-Options
- ❌ Secrets in `staticwebapp.config.json` → config is public; use Key Vault references
- ❌ Free tier for production → Free tier has no SLA or custom auth
- ❌ No `401` override → unauthenticated users see a raw JSON error
