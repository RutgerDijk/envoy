# Docker Compose Stack Profile

## Detection

```bash
# Detect Docker Compose
find . -name "docker-compose*.yml" -o -name "compose*.yml" | head -1
```

## Best Practices

### Project Structure

```
├── docker-compose.yml          # Production-like compose
├── docker-compose.override.yml # Development overrides (auto-loaded)
├── docker-compose.test.yml     # Test environment
├── .env                        # Environment variables
├── .env.example                # Template for .env
└── docker/
    ├── api/
    │   └── Dockerfile
    ├── web/
    │   └── Dockerfile
    └── nginx/
        └── nginx.conf
```

### Compose File Structure

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
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - backend

  web:
    build:
      context: .
      dockerfile: docker/web/Dockerfile
    depends_on:
      - api
    networks:
      - frontend
      - backend

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
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
  frontend:
  backend:
```

### Development Overrides

```yaml
# docker-compose.override.yml (auto-loaded in development)
services:
  api:
    build:
      target: development
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
    volumes:
      - ./src/Api:/app/src  # Hot reload
    ports:
      - "5000:8080"

  web:
    build:
      target: development
    volumes:
      - ./src/web:/app
      - /app/node_modules  # Exclude node_modules
    ports:
      - "3000:3000"
    environment:
      - VITE_API_URL=http://localhost:5000

  db:
    ports:
      - "5432:5432"  # Expose for local tools
```

### Multi-Stage Dockerfile

```dockerfile
# docker/api/Dockerfile
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy csproj and restore (cached layer)
COPY *.csproj .
RUN dotnet restore

# Copy source and build
COPY . .
RUN dotnet publish -c Release -o /app/publish

# Development target
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS development
WORKDIR /app
EXPOSE 8080
ENTRYPOINT ["dotnet", "watch", "run"]

# Production target
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS production
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "Api.dll"]
```

### Health Checks

```yaml
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  db:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
```

### Environment Variables

```bash
# .env.example
# Database
DB_USER=appuser
DB_PASSWORD=changeme
DB_NAME=myapp
DB_CONNECTION=Host=db;Database=${DB_NAME};Username=${DB_USER};Password=${DB_PASSWORD}

# API
API_PORT=5000
ASPNETCORE_ENVIRONMENT=Development

# Web
WEB_PORT=3000
VITE_API_URL=http://localhost:${API_PORT}
```

## Common Mistakes

### Mistake: Not Using depends_on with Condition

```yaml
# Bad: Only waits for container start, not readiness
services:
  api:
    depends_on:
      - db

# Good: Wait for healthy status
services:
  api:
    depends_on:
      db:
        condition: service_healthy
```

### Mistake: Hardcoded Credentials

```yaml
# Bad: Secrets in compose file
services:
  db:
    environment:
      POSTGRES_PASSWORD: mysecretpassword

# Good: Use environment variables
services:
  db:
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
```

### Mistake: Missing Volume for Data Persistence

```yaml
# Bad: Data lost on container restart
services:
  db:
    image: postgres:16

# Good: Named volume for persistence
services:
  db:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Mistake: Not Separating Networks

```yaml
# Bad: All services on default network
services:
  web:
  api:
  db:

# Good: Isolated networks
services:
  web:
    networks:
      - frontend
  api:
    networks:
      - frontend
      - backend
  db:
    networks:
      - backend

networks:
  frontend:
  backend:
```

### Mistake: Exposing Ports in Production

```yaml
# Bad: Database port exposed
services:
  db:
    ports:
      - "5432:5432"  # Security risk!

# Good: Only expose in development override
# docker-compose.yml (no ports)
services:
  db:
    image: postgres:16

# docker-compose.override.yml (dev only)
services:
  db:
    ports:
      - "5432:5432"
```

### Mistake: Not Using Build Cache

```dockerfile
# Bad: Reinstalls dependencies every build
COPY . .
RUN npm install

# Good: Cache dependency layer
COPY package*.json ./
RUN npm ci
COPY . .
```

## Review Checklist

- [ ] Health checks defined for all services
- [ ] depends_on uses `condition: service_healthy`
- [ ] Secrets stored in .env (not committed)
- [ ] .env.example provided as template
- [ ] Named volumes for persistent data
- [ ] Networks isolate frontend/backend
- [ ] Production ports not exposed unnecessarily
- [ ] Multi-stage Dockerfiles for smaller images
- [ ] Dependency layers cached in Dockerfile
- [ ] Override file for development specifics

## Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Dockerfile Best Practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Compose Specification](https://compose-spec.io/)
