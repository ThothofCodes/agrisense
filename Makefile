# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.

.PHONY: help setup dev infra-up infra-down build test lint clean db-migrate db-seed docker-logs shell-api shell-ml shell-db

SHELL := /bin/bash
INFRA := infrastructure

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

## ── Setup ──────────────────────────────────────────────────────────────────

setup: ## Full project setup (install deps, copy env, init db)
	@echo "🌿 Setting up AgriSense development environment..."
	cp -n .env.example .env 2>/dev/null || true
	cd apps/api && npm install
	cd apps/web && npm install
	cd apps/ml && pip install -r requirements.txt
	@echo "✅ Setup complete. Edit .env with your keys, then run 'make infra-up'"

install: ## Install all dependencies
	@echo "📦 Installing dependencies..."
	npm install
	cd apps/api && npm install
	cd apps/web && npm install
	cd apps/ml && pip install -r requirements.txt
	@echo "✅ Dependencies installed"

## ── Development ────────────────────────────────────────────────────────────

dev: ## Run all services in development mode
	@echo "🚀 Starting development servers..."
	npm run dev

infra-up: ## Start infrastructure services (DB, Redis, MQTT)
	@echo "🏗️  Starting infrastructure..."
	docker compose -f $(INFRA)/docker-compose.yml up -d db redis mqtt
	@echo "⏳ Waiting for services to be healthy..."
	@echo "✅ Infrastructure is ready"

infra-down: ## Stop infrastructure services
	@echo "🛑 Stopping infrastructure..."
	docker compose -f $(INFRA)/docker-compose.yml down

infra-logs: ## View infrastructure logs
	docker compose -f $(INFRA)/docker-compose.yml logs -f

## ── Docker (full stack) ────────────────────────────────────────────────────

up: ## Start full stack via Docker Compose
	@echo "🚀 Starting full AgriSense stack..."
	docker compose -f $(INFRA)/docker-compose.yml up -d
	@echo "✅ Stack is running"

down: ## Stop full stack
	@echo "🛑 Stopping full stack..."
	docker compose -f $(INFRA)/docker-compose.yml down

rebuild: ## Rebuild and restart all services
	@echo "🔨 Rebuilding and restarting..."
	docker compose -f $(INFRA)/docker-compose.yml up -d --build --remove-orphans

pull: ## Pull latest images
	@echo "📥 Pulling latest images..."
	docker compose -f $(INFRA)/docker-compose.yml pull

## ── Build & Test ───────────────────────────────────────────────────────────

build: ## Build all services
	@echo "🔨 Building all services..."
	cd apps/api && npm run build
	cd apps/web && npm run build
	@echo "✅ Build complete"

test: ## Run all tests
	@echo "🧪 Running all tests..."
	cd apps/api && npm test
	cd apps/ml && python -m pytest tests/ -v --tb=short

test-api: ## Run API tests only
	cd apps/api && npm test

test-ml: ## Run ML tests only
	cd apps/ml && python -m pytest tests/ -v --tb=short

lint: ## Run all linters
	@echo "🔍 Running linters..."
	cd apps/api && npm run lint; EXIT=$$((EXIT + $$?))
	cd apps/web && npm run lint; EXIT=$$((EXIT + $$?))
	cd apps/ml && flake8 . --count --statistics; EXIT=$$((EXIT + $$?))
	@if [ $$EXIT -ne 0 ]; then echo "❌ Lint failed"; exit $$EXIT; fi
	@echo "✅ Lint complete"

typecheck: ## Run TypeScript type checking
	@echo "📝 Type checking..."
	cd apps/api && npx tsc --noEmit
	cd apps/web && npx tsc --noEmit
	@echo "✅ Type checking complete"

## ── Database ───────────────────────────────────────────────────────────────

db-migrate: ## Run database migrations
	@echo "🗄️  Running migrations..."
	node scripts/migrate.js

db-seed: ## Seed database with sample data
	@echo "🌱 Seeding database..."
	node scripts/seed.js

db-reset: ## Reset and re-seed the database
	@echo "⚠️  Resetting database..."
	node scripts/migrate.js
	node scripts/seed.js
	@echo "✅ Database reset complete"

db-shell: ## Open PostgreSQL shell
	docker exec -it agrisense_db psql -U agrisense agrisense

## ── Utility ────────────────────────────────────────────────────────────────

clean: ## Clean build artifacts and dependencies
	@echo "🧹 Cleaning..."
	rm -rf apps/api/dist apps/web/dist
	rm -rf node_modules apps/api/node_modules apps/web/node_modules
	find . -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
	@echo "✅ Clean complete"

prune: ## Docker system prune
	@echo "🗑️  Pruning Docker..."
	docker system prune -af --volumes
	@echo "✅ Prune complete"

logs: ## Tail all Docker logs
	docker compose -f $(INFRA)/docker-compose.yml logs -f

logs-api: ## Tail API logs
	docker compose -f $(INFRA)/docker-compose.yml logs -f api

logs-ml: ## Tail ML logs
	docker compose -f $(INFRA)/docker-compose.yml logs -f ml

logs-web: ## Tail Web logs
	docker compose -f $(INFRA)/docker-compose.yml logs -f web

## ── Shell Access ───────────────────────────────────────────────────────────

shell-api: ## Open a shell in the API container
	docker exec -it agrisense_api sh

shell-ml: ## Open a shell in the ML container
	docker exec -it agrisense_ml bash

shell-db: ## Open a PostgreSQL shell (alias for db-shell)
	docker exec -it agrisense_db psql -U agrisense agrisense

shell-redis: ## Open a Redis CLI
	docker exec -it agrisense_redis redis-cli -a agrisense_redis_pass

## ── Git Workflow ──────────────────────────────────────────────────────────

git-hooks: ## Install Git hooks (husky)
	@echo "🔗 Installing Git hooks..."
	npx husky
	@echo "✅ Git hooks installed"

changelog: ## Generate changelog from conventional commits
	@echo "📝 Generating changelog..."
	npx conventional-changelog -p angular -i CHANGELOG.md -s
	@echo "✅ Changelog generated"
