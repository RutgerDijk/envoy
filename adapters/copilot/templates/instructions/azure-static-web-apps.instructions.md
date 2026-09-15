---
applyTo: '**/{staticwebapp.config.json,*.bicep}'
---

# Azure Static Web Apps Best Practices

## staticwebapp.config.json

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "/api/*"]
  },
  "routes": [
    { "route": "/api/*", "allowedRoles": ["authenticated"] },
    { "route": "/admin/*", "allowedRoles": ["admin"] }
  ],
  "responseOverrides": {
    "401": { "redirect": "/login", "statusCode": 302 },
    "404": { "rewrite": "/404.html" }
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'"
  }
}
```

## Authentication

Configure only the identity providers you use, and disable the rest with 404 routes:

```json
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
    { "route": "/.auth/login/github", "statusCode": 404 }
  ]
}
```

## Bicep Deployment

```bicep
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: appName
  location: location
  sku: { name: environment == 'prod' ? 'Standard' : 'Free' }
  properties: {
    buildProperties: {
      appLocation: 'src/web'
      outputLocation: 'dist'  // must match the build tool's output
    }
  }
}
```

Link an API backend with a `Microsoft.Web/staticSites/linkedBackends` child
resource so `/api/*` requests are proxied to it. Read frontend configuration from
the environment at build time (`import.meta.env.VITE_API_URL`); never hardcode
API URLs or keys in source.

## Common Mistakes to Avoid

- ❌ Missing `navigationFallback` → SPA client-side routes return 404 on refresh
- ❌ No security headers → set `globalHeaders` (CSP, X-Frame-Options, nosniff, Referrer-Policy)
- ❌ Leaving all auth providers enabled → block unused `/.auth/login/*` routes with 404s
- ❌ Wrong `outputLocation` (e.g. `build` when Vite outputs `dist`) → deploy publishes nothing
- ❌ Hardcoded API URLs and keys → use environment variables injected at build/deploy
- ❌ Free tier in production → no SLA, private endpoints, BYO backends, or password protection without the Standard SKU
- ❌ Unprotected routes → use `allowedRoles` plus 401/404 `responseOverrides`
