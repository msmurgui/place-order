# place-order

`POST /orders` — warehouse-based order fulfillment endpoint.

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
