#!/bin/bash

# Portfolio Investments Monitoring Stack Startup Script

set -e

echo "========================================="
echo "Portfolio Investments Monitoring Setup"
echo "========================================="
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Warning: .env file not found. Creating from .env.example..."
    if [ -f backend/.env.example ]; then
        cp backend/.env.example .env
        echo "Please edit .env file and set GRAFANA_ADMIN_PASSWORD before continuing."
        echo "Run this script again after updating .env"
        exit 1
    else
        echo "Error: backend/.env.example not found"
        exit 1
    fi
fi

echo "Step 1: Checking monitoring configuration..."
if [ ! -f monitoring/prometheus/prometheus.yml ]; then
    echo "Error: Prometheus configuration not found at monitoring/prometheus/prometheus.yml"
    exit 1
fi
echo "✓ Monitoring configuration found"
echo ""

echo "Step 2: Building application images..."
docker-compose build backend
echo "✓ Application images built"
echo ""

echo "Step 3: Starting core services..."
docker-compose up -d postgres redis
echo "Waiting for PostgreSQL to be ready..."
sleep 10
echo "✓ Core services started"
echo ""

echo "Step 4: Starting application services..."
docker-compose up -d backend expense-worker statement-worker plaid-worker
echo "✓ Application services started"
echo ""

echo "Step 5: Starting monitoring stack..."
docker-compose up -d prometheus grafana postgres-exporter redis-exporter node-exporter cadvisor
echo "✓ Monitoring stack started"
echo ""

echo "Step 6: Waiting for services to be ready..."
sleep 15
echo ""

echo "========================================="
echo "Monitoring Stack Started Successfully!"
echo "========================================="
echo ""
echo "Access your monitoring tools:"
echo ""
echo "  Grafana Dashboard:  http://localhost:3000"
echo "    Username: admin"
echo "    Password: (check GRAFANA_ADMIN_PASSWORD in .env)"
echo ""
echo "  Prometheus:         http://localhost:9090"
echo "  Backend API:        http://localhost:8000"
echo "  Backend Metrics:    http://localhost:8000/metrics"
echo ""
echo "Additional monitoring endpoints:"
echo "  PostgreSQL Exporter: http://localhost:9187/metrics"
echo "  Redis Exporter:      http://localhost:9121/metrics"
echo "  Node Exporter:       http://localhost:9100/metrics"
echo "  cAdvisor:            http://localhost:8080"
echo ""
echo "To view logs:"
echo "  docker-compose logs -f [service-name]"
echo ""
echo "To stop all services:"
echo "  docker-compose down"
echo ""
echo "For detailed documentation, see:"
echo "  monitoring/README.md"
echo ""
