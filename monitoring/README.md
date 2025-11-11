# Portfolio Investments Monitoring

This directory contains the monitoring infrastructure for the Portfolio Investments platform using Prometheus and Grafana.

## Services

### Prometheus
- **Port**: 9090
- **Access**: http://localhost:9090
- Scrapes metrics from all services every 15 seconds
- Stores metrics for 7 days

### Grafana
- **Port**: 3000
- **Access**: http://localhost:3000
- **Default Credentials**:
  - Username: `admin`
  - Password: `admin` (or check `GRAFANA_ADMIN_PASSWORD` in `.env`)

## Dashboards

### 1. Portfolio Investments - Comprehensive Monitoring
**UID**: `portfolio-comprehensive`

This is the main dashboard providing complete visibility into all system components.

#### Key Sections:
- **Service Health Status**: Real-time health for all services
- **Backend Metrics**: API request rate and response times (p50/p95/p99)
- **Database Metrics**: PostgreSQL connections and cache hit ratio
- **Redis Metrics**: Connections, keys, commands/s, and RQ queue depth
- **Container Metrics**: CPU, memory, and network usage
- **System Resources**: Host CPU, memory, and disk usage

### 2. Portfolio Investments Overview (Legacy)
**UID**: `portfolio-overview`

Simpler dashboard with basic metrics.

## Accessing Dashboards

**Direct Links**:
- Comprehensive: http://localhost:3000/d/portfolio-comprehensive
- Overview: http://localhost:3000/d/portfolio-overview

## Monitored Components

- Backend (FastAPI)
- PostgreSQL + postgres-exporter
- Redis + redis-exporter
- Frontend (nginx) - via cAdvisor
- Ollama (LLM) - via cAdvisor
- Workers (expense, price, statement, plaid) - via cAdvisor
- Host system - via node-exporter
