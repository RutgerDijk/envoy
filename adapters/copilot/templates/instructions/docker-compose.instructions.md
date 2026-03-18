---
applyTo: '**/{docker-compose*.yml,compose*.yml,Dockerfile}'
---

# Docker Compose Best Practices

## File Structure

```
├── docker-compose.yml              # Base services (production-like)
├── docker-compose.override.yml     # Dev overrides (auto-loaded locally)
├── docker-compose.test.yml         # Test environment
├── .env.example                    # Template (commit this)
├── .env                            # Actual values (gitignore this)
```

## Service Definition

```yaml
# docker-compose.yml
services:
  api:
    build:
      context: .
      dockerfile: docker/api/Dockerfile
    environment:
      - ASPNETCORE_ENVIRONMENT=Production
      - ConnectionStrings__DefaultConnection=${DB_CONNECTION}
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - backend

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - backend

volumes:
  postgres_data:

networks:
  backend:
    driver: bridge
```

## Dev Overrides

```yaml
# docker-compose.override.yml
services:
  api:
    build:
      target: development        # Build only dev stage
    volumes:
      - ./src:/app/src            # Hot reload
    ports:
      - "5000:8080"              # Expose for local access
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
```

## .env.example Template

```
DB_NAME=myapp
DB_USER=postgres
DB_PASSWORD=changeme
DB_CONNECTION=Host=db;Database=myapp;Username=postgres;Password=changeme
```

## Common Mistakes to Avoid

- ❌ Secrets in `docker-compose.yml` → always use `.env` and reference via `${VAR}`
- ❌ No health checks → `depends_on` without `condition: service_healthy` is unreliable
- ❌ Committing `.env` → add it to `.gitignore`, commit `.env.example` instead
- ❌ No named volumes → data is lost on `docker-compose down`
- ❌ `network_mode: host` in production → use named networks instead
