# 🚀 AgriSense Deployment Guide

This document covers setting up and managing deployments for the AgriSense Smart Farming System.

## Required GitHub Secrets

The CI/CD pipeline (`.github/workflows/ci.yml`) uses the following GitHub Actions secrets. Configure them in your repository under **Settings → Secrets and variables → Actions**.

### Docker Registry

| Secret | Description |
|--------|-------------|
| `GITHUB_TOKEN` | Automatically available — used to push to `ghcr.io` |

### Staging Deployment

| Secret | Description |
|--------|-------------|
| `STAGING_HOST` | Staging server hostname or IP |
| `STAGING_USER` | SSH username for staging |
| `STAGING_SSH_KEY` | SSH private key (never the passphrase-protected key) |

### Production Deployment

| Secret | Description |
|--------|-------------|
| `PROD_HOST` | Production server hostname or IP |
| `PROD_USER` | SSH username for production |
| `PROD_SSH_KEY` | SSH private key for production |

### Notifications

| Secret | Description |
|--------|-------------|
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL for deployment notifications |

### Test Environment (optional overrides)

| Secret | Description |
|--------|-------------|
| `JWT_ACCESS_SECRET` | Override the test JWT access secret |
| `JWT_REFRESH_SECRET` | Override the test JWT refresh secret |

## Setting Up a Deployment Server

### Prerequisites

- Docker Engine 24+ and Docker Compose v2
- Git
- `~/.docker/config.json` configured to authenticate with `ghcr.io`

### Initial Setup

```bash
# 1. Create the app directory
sudo mkdir -p /opt/agrisense
sudo chown -R $USER:$USER /opt/agrisense
cd /opt/agrisense

# 2. Clone the repository
git clone https://github.com/thoth-codes/agrisense.git .

# 3. Configure environment
cp .env.example .env
# Edit .env with production values (DB passwords, API keys, etc.)

# 4. Authenticate with GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u $USER --password-stdin

# 5. Pull and start services
docker compose -f infrastructure/docker-compose.yml pull
docker compose -f infrastructure/docker-compose.yml up -d
```

### Automatic Deployments

Once the server is set up and SSH keys are configured as GitHub secrets, pushes to `main` will automatically:

1. Build and push Docker images to GHCR
2. Scan images for vulnerabilities
3. SSH into the production server
4. Pull new images and restart services

### Manual Rollback

```bash
cd /opt/agrisense

# Roll back to a specific image tag
docker compose -f infrastructure/docker-compose.yml down
docker compose -f infrastructure/docker-compose.yml up -d

# Or pull a specific version
docker pull ghcr.io/agrisense/agrisense-api:v1.2.3
docker compose -f infrastructure/docker-compose.yml up -d
```

## Environment Overview

| Environment | Branch | Auto-deploy | URL |
|-------------|--------|-------------|-----|
| Development | Local `develop` | No | `http://localhost:5173` |
| Staging | `develop` | Yes | Staging server |
| Production | `main` / `v*` tags | Yes | Production server |

## Monitoring

### Health Checks

Each service has a Docker health check configured in `docker-compose.yml` and `Dockerfile`.

### Logs

```bash
# View all logs
docker compose -f infrastructure/docker-compose.yml logs -f

# View specific service logs
docker compose -f infrastructure/docker-compose.yml logs -f api
docker compose -f infrastructure/docker-compose.yml logs -f ml
```

### Backup

Database backups should be configured separately:

```bash
# Manual PostgreSQL backup
docker exec agrisense_db pg_dump -U agrisense agrisense > backup_$(date +%Y%m%d).sql
```

## Security Considerations

1. **SSH keys** used in CI/CD should be deploy keys with the minimum necessary permissions
2. **`.env` files** are never committed — manage them via secrets or a secure vault
3. **SSL/TLS** certificates should be managed via certbot or a reverse proxy like Caddy or Traefik
4. **Database passwords** should be rotated regularly
5. **Docker images** are scanned for vulnerabilities by Trivy on every `main` build

---

*AgriSense Smart Farming System — Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.*
