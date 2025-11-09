# Portfolio Investments Monitoring

This directory contains the monitoring stack configuration for the Portfolio Investments application using Prometheus and Grafana.

## Overview

The monitoring solution provides comprehensive observability for all components:

- **Backend API** (FastAPI metrics)
- **PostgreSQL Database** (database performance metrics)
- **Redis Cache** (cache metrics)
- **Worker Processes** (queue and task metrics)
- **System Resources** (CPU, memory, disk, network)
- **Container Metrics** (Docker container statistics)

## Components

### Prometheus
- **URL**: http://localhost:9090
- **Purpose**: Metrics collection and storage
- **Retention**: 7 days of historical data
- **Scrape Interval**: 15 seconds

### Grafana
- **URL**: http://localhost:3000
- **Default Credentials**: admin/admin (configurable via environment variables)
- **Purpose**: Metrics visualization and dashboarding

### Exporters
- **PostgreSQL Exporter** (port 9187): Database metrics
- **Redis Exporter** (port 9121): Cache metrics
- **Node Exporter** (port 9100): Host system metrics
- **cAdvisor** (port 8080): Container metrics

## Getting Started

### 1. Start the Monitoring Stack

```bash
docker-compose up -d prometheus grafana postgres-exporter redis-exporter node-exporter cadvisor
```

### 2. Access Grafana

1. Open http://localhost:3000
2. Login with credentials (default: admin/admin)
3. Navigate to "Dashboards"
4. Open "Portfolio Investments Overview"

### 3. Configure Grafana Admin Credentials

Set the following environment variables in your `.env` file:

```bash
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=your_secure_password
```

## Dashboard Panels

The main dashboard includes:

### Service Health
- Real-time status of all services (Backend, PostgreSQL, Redis, Workers)
- Green gauge indicates healthy service
- Red gauge indicates service down

### Backend API Metrics
- **Request Rate**: Requests per second by endpoint
- **Response Time**: p95 and p99 latency percentiles
- **Error Rate**: HTTP error responses

### Database Metrics
- **Connection Pool**: Active vs max connections
- **Cache Hit Ratio**: PostgreSQL buffer cache efficiency
- **Query Performance**: Slow queries and locks

### Redis Metrics
- **Connected Clients**: Active Redis connections
- **Key Count**: Number of keys in each database
- **Memory Usage**: Redis memory consumption

### Container Metrics
- **CPU Usage**: Per-container CPU utilization
- **Memory Usage**: Per-container memory consumption
- **Network I/O**: Container network traffic

### Worker Metrics
- **Queue Lengths**: Tasks waiting in each queue
- **Processing Rate**: Tasks processed per second
- **Worker Health**: Worker process status

## Data Retention

- **Prometheus**: 7 days (configurable in prometheus.yml)
- **Grafana**: Indefinite (dashboard configurations and annotations)

To change retention period, edit `monitoring/prometheus/prometheus.yml`:

```yaml
storage:
  tsdb:
    retention.time: 7d  # Change to desired retention (e.g., 14d, 30d)
```

## Custom Metrics

### Adding Custom Metrics to Backend

The backend uses `prometheus-fastapi-instrumentator` which automatically exposes:
- Request count by method, endpoint, and status code
- Request duration histograms
- Request size and response size

To add custom metrics, use the `prometheus_client` library:

```python
from prometheus_client import Counter, Histogram

# Define custom metric
custom_counter = Counter('custom_operations_total', 'Total custom operations')

# Increment in your code
custom_counter.inc()
```

### Available Metrics Endpoints

- Backend: http://localhost:8000/metrics
- PostgreSQL: http://localhost:9187/metrics
- Redis: http://localhost:9121/metrics
- Node: http://localhost:9100/metrics
- Containers: http://localhost:8080/metrics

## Alerting (Optional)

To set up alerts:

1. Create alert rules in `monitoring/prometheus/alerts/`
2. Configure Alertmanager in docker-compose.yml
3. Add notification channels in Grafana

Example alert rule:

```yaml
groups:
  - name: backend_alerts
    interval: 30s
    rules:
      - alert: HighErrorRate
        expr: rate(fastapi_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        annotations:
          summary: "High error rate detected"
```

## Troubleshooting

### Prometheus not scraping targets

Check target status at http://localhost:9090/targets

Common issues:
- Service not exposing metrics endpoint
- Network connectivity between containers
- Incorrect target configuration in prometheus.yml

### Grafana shows "No Data"

1. Verify Prometheus datasource is configured (should be automatic)
2. Check Prometheus has data: http://localhost:9090/graph
3. Verify time range in dashboard

### High Memory Usage

If Prometheus consumes too much memory:
- Reduce retention period
- Reduce scrape frequency
- Reduce number of time series

## Performance Tuning

### Prometheus Storage

Default configuration stores metrics in Docker volume `prometheus_data`. For production:

1. Use dedicated disk/volume
2. Monitor disk usage
3. Set up retention policies

### Grafana Performance

For large datasets:
- Use appropriate time ranges
- Enable query result caching
- Use recording rules in Prometheus for complex queries

## Backup and Restore

### Backup Grafana Dashboards

Dashboards are provisioned from files in `monitoring/grafana/dashboards/` and automatically backed up with your code repository.

### Backup Prometheus Data

```bash
# Stop Prometheus
docker-compose stop prometheus

# Backup data volume
docker run --rm -v portfolio_prometheus_data:/data -v $(pwd)/backup:/backup alpine tar czf /backup/prometheus-backup.tar.gz -C /data .

# Start Prometheus
docker-compose start prometheus
```

## Security Considerations

1. **Change Default Credentials**: Update Grafana admin password
2. **Network Security**: Restrict access to monitoring ports in production
3. **Data Privacy**: Metrics may contain sensitive information
4. **HTTPS**: Use reverse proxy with SSL for production deployments

## Additional Resources

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [FastAPI Instrumentator](https://github.com/trallnag/prometheus-fastapi-instrumentator)
- [PostgreSQL Exporter](https://github.com/prometheus-community/postgres_exporter)
- [Redis Exporter](https://github.com/oliver006/redis_exporter)
