# `POST /orders` — warehouse-based order fulfillment endpoint.

## Overview

This service exposes a single `POST /orders` endpoint for an e-commerce platform. It accepts a customer's order (shipping address, items, and payment details), selects the optimal warehouse to fulfil the order, reserves the required inventory atomically, applies jurisdiction-based tax, processes payment, and returns a confirmed order with a full receipt snapshot.

Key guarantees:

- **Inventory safety** — append-only reservation table with per-SKU PostgreSQL advisory locks prevents overselling under concurrent load.
- **Idempotency** — duplicate submissions (retries, double-clicks, network timeouts) return the original response without re-charging.
- **Financial consistency** — payment charges that cannot be immediately confirmed land in a `PENDING_PAYMENT` state and are reconciled by a background job rather than being incorrectly failed.
- **Resilience** — circuit breakers on all external gateways, retry logic for transient failures, and a dead-letter queue for unresolvable compensation failures.

The full design for this solution can be found in `docs/design_doc.md`.

## Prerequisites

- Node.js 20+
- PostgreSQL 16
- Redis

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the database

```bash
createdb orders_dev
createdb orders_test   # for integration tests
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in the values for your local environment:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=orders_dev
DB_USER=<your database username>
DB_PASSWORD=<your database password>
REDIS_URL=redis://localhost:6379
```

> `REDIS_URL` must be set even when only running migrations — the app validates all env vars at startup. Redis does not need to be running for migrations to work, only for the server.

### 4. Run migrations

```bash
npm run migration:run
```

To roll back the last migration:

```bash
npm run migration:revert
```

### 5. Seed the database

```bash
npm run seed
```

### 6. Start the development server

```bash
# Make sure Redis is running first
redis-server --daemonize yes

npm run dev
```

## Other commands

```bash
npm run typecheck   # TypeScript type-check (no emit)
npm test            # Run tests (Vitest)
npm run lint        # ESLint
npm run format      # Prettier
```
