# Plan: POST /orders — Production-Ready Order Endpoint

## Context

Standalone endpoint for warehouse-based order fulfillment. A customer submits an order (shipping address + items + credit card); the server selects the closest warehouse that can fulfill all items, reserves inventory atomically via an **append-only reservation table**, charges the card inline, and returns the confirmed order.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node 24 + TypeScript | Strict types; modern async |
| Framework | Express 5 | Minimal, well-understood |
| Database | PostgreSQL 16 | ACID transactions |
| ORM / Migrations | TypeORM | Entities, relations, query builder, and migrations in one package |
| Cache / locks | Redis (ioredis) | Atomic SET NX for distributed lock; geocode cache; idempotency store |
| Background jobs | BullMQ | Reservation expiry + order reconciliation workers — built on Redis (no extra infra) |
| Validation | Zod | Runtime schema + inferred types |
| Testing | Vitest + Supertest | Fast, ESM-native; integration tests via Supertest |

---

## Architecture — Four Layers

The application is divided into four strict layers. Each layer may only call the layer directly below it. No layer may skip layers.

```
┌─────────────────────────────────────────┐
│           Route Layer                   │  Rate limiting, schema validation,
│       src/routes/                       │  idempotency check, calls controller
├─────────────────────────────────────────┤
│         Controller Layer                │  Thin HTTP adapter — orchestrates
│       src/controllers/                  │  one service call, maps result to
│                                         │  HTTP response. No DB access.
├─────────────────────────────────────────┤
│          Service Layer                  │  All business logic. Facade pattern:
│        src/services/                    │  OrderService is the single entry
│                                         │  point; internally coordinates
│                                         │  sub-services. No DB access.
├─────────────────────────────────────────┤
│          Data Layer                     │  Repositories only. All TypeORM
│       src/repositories/                 │  queries live here. No business
│                                         │  logic.
└─────────────────────────────────────────┘
```

### Why a single service entry point (Facade)

The controller calls `OrderService.createOrder()` only — it does not coordinate individual services like `WarehouseSelectionService` or `ReservationService` directly. This means:

- The controller is a dumb HTTP adapter. Adding a fraud check, loyalty points, or a notification step requires zero controller changes.
- `OrderService.createOrder()` is fully testable without HTTP context.
- When sub-services are eventually extracted into microservices, only `OrderService` changes — the controller and route are untouched.

---

## Project Structure

```
src/
├── config/
│   └── env.ts                              ← typed env vars (DB_URL, REDIS_URL, etc.)
│
├── db/
│   ├── dataSource.ts                       ← TypeORM DataSource singleton
│   ├── migrations/                         ← hand-written, versioned, one per table
│   │   ├── 001_create_customers.ts
│   │   ├── 002_create_products.ts
│   │   ├── 003_create_warehouses.ts
│   │   ├── 004_create_inventories.ts
│   │   ├── 005_create_orders.ts
│   │   ├── 006_create_order_items.ts
│   │   └── 007_create_inventory_reservations.ts
│   └── seeds/                              ← test fixture data
│
├── entities/                               ← TypeORM entities (schema source of truth)
│   ├── Customer.ts
│   ├── Product.ts
│   ├── Warehouse.ts
│   ├── Inventory.ts
│   ├── InventoryReservation.ts
│   ├── Order.ts
│   └── OrderItem.ts
│
├── repositories/                           ← DATA LAYER: all DB + Redis queries
│   ├── OrderRepository.ts
│   ├── OrderItemRepository.ts
│   ├── ProductRepository.ts
│   ├── WarehouseRepository.ts
│   ├── InventoryRepository.ts
│   ├── ReservationRepository.ts
│   └── IdempotencyRepository.ts            ← Redis-backed
│
├── services/                               ← SERVICE LAYER: all business logic
│   ├── OrderService.ts                     ← Facade entry point
│   ├── WarehouseSelectionService.ts
│   ├── ReservationService.ts               ← create / confirm / release reservations
│   ├── GeocodeService.ts                   ← Redis cache wrapper around GeocodingGateway
│   └── DistributedLockService.ts
│
├── controllers/                            ← CONTROLLER LAYER: thin HTTP adapter
│   └── orderController.ts
│
├── routes/                                 ← ROUTE LAYER: middleware pipeline
│   └── orders.ts
│
├── middleware/
│   ├── rateLimiter.ts                      ← per-customer sliding window, Redis-backed
│   └── circuitBreaker.ts                   ← Redis-backed boolean flags per gateway
│
├── gateways/
│   ├── GeocodingGateway.ts                 ← mock: address → { lat, lng }
│   ├── PaymentGateway.ts                   ← mock: charge card → { reference }
│   └── TaxGateway.ts                       ← mock: calculate tax per line item → { totalTaxAmount, breakdown }
│
├── jobs/
│   ├── expireReservations.ts               ← BullMQ worker: release stale reservations
│   └── reconcileOrders.ts                  ← BullMQ worker: resolve PENDING_PAYMENT orders
│
├── util/
│   ├── haversine.ts
│   ├── retry.ts
│   └── logger.ts                           ← structured JSON logging (pino)
│
└── app.ts                                  ← Express app + route registration
```

---

## Database Schema

Eight tables. Migrations run in dependency order via `typeorm migration:run`. Migrations are written by hand — not generated — to ensure the schema is fully understood and intentional.

### Core tables

| Table | Key columns |
|---|---|
| `customers` | `id serial PK`, `name text`, `email text unique` |
| `products` | `id serial PK`, `name text`, `sku text unique`, `price numeric(10,2)`, `description text`, `tax_code text` |
| `warehouses` | `id serial PK`, `name text`, `address text`, `latitude double precision`, `longitude double precision` |
| `inventories` | `warehouse_id FK`, `product_id FK`, `quantity int ≥ 0` — unique on `(warehouse_id, product_id)` — **physical stock only, never written on the order path** |

### Order tables

| Table | Key columns |
|---|---|
| `orders` | `id serial PK`, `customer_id FK`, `warehouse_id FK`, `warehouse_name text`, `warehouse_address text`, `shipping_address jsonb`, `subtotal numeric(10,2)`, `tax_amount numeric(10,2)`, `total numeric(10,2)`, `status text CHECK('PENDING_PAYMENT','CONFIRMED','FAILED')`, `payment_reference text`, `idempotency_key text unique`, `receipt_snapshot jsonb`, `created_at timestamptz` |
| `order_items` | `id serial PK`, `order_id FK`, `product_id FK`, `quantity int`, `unit_price numeric(10,2)`, `product_name text`, `product_sku text`, `product_description text`, `tax_code text`, `tax_rate numeric(5,4)`, `tax_amount numeric(10,2)` |

### Reservation table

| Table | Key columns |
|---|---|
| `inventory_reservations` | `id serial PK`, `warehouse_id FK`, `product_id FK`, `order_id FK`, `quantity int`, `status text CHECK('active','confirmed','released')`, `expires_at timestamptz`, `created_at timestamptz` |

**Critical index on `inventory_reservations`:**

```sql
CREATE INDEX idx_inventory_reservations_availability
ON inventory_reservations (warehouse_id, product_id, status, expires_at)
WHERE status = 'active';
```

This index is load-bearing. The availability query runs on every warehouse selection check and aggregates across all active reservations per product. Without it, the query degrades linearly as the table grows. The partial `WHERE status = 'active'` clause keeps the index small — confirmed and released rows are excluded automatically.

Seeds provide 1 customer, 3 products with different tax codes, 2 warehouses with varying inventory for test coverage.

---

## Temporal Data Integrity — Order Snapshots

An order is a **point-in-time contract** with the customer. Product prices, names, tax codes, and warehouse details can change at any time; the order must always reflect what the customer actually saw and paid.

### Two-layer snapshot strategy

**Layer 1 — `order_items` denormalized (queryable)**

Every `order_item` stores a snapshot of the product fields at the moment of purchase. The `product_id` FK is kept for analytics and traceability only — never used to reconstruct what the customer bought.

```
order_items:
  product_id          ← FK for analytics / traceability only
  unit_price          ← snapshot: price at time of purchase
  product_name        ← snapshot: name at time of purchase
  product_sku         ← snapshot: SKU at time of purchase
  product_description ← snapshot: description at time of purchase
  tax_code            ← snapshot: tax code at time of purchase
  tax_rate            ← snapshot: rate applied at time of purchase
  tax_amount          ← tax applied to this line item
```

This layer is SQL-queryable with standard indexed queries: revenue reports, SKU-level sales breakdowns, tax reporting, dispute resolution.

**Layer 2 — `receipt_snapshot jsonb` on `orders` (immutable display)**

A serialized, self-contained representation of the full order at creation time, used exclusively to render receipts to the customer without joins:

```json
{
  "items": [
    {
      "product_id": 1,
      "product_name": "Organic Apples",
      "sku": "APPL-ORG-1KG",
      "quantity": 2,
      "unit_price": 5.00,
      "subtotal": 10.00,
      "tax_code": "GROCERY",
      "tax_rate": 0.00,
      "tax_amount": 0.00
    },
    {
      "product_id": 2,
      "product_name": "Wireless Headphones",
      "sku": "ELEC-WH-001",
      "quantity": 1,
      "unit_price": 80.00,
      "subtotal": 80.00,
      "tax_code": "ELECTRONICS",
      "tax_rate": 0.21,
      "tax_amount": 16.80
    }
  ],
  "warehouse": {
    "id": 3,
    "name": "North Warehouse",
    "address": "742 Evergreen Terrace, Springfield"
  },
  "subtotal": 90.00,
  "tax_amount": 16.80,
  "total": 106.80,
  "pricing_at": "2026-06-09T14:30:00Z"
}
```

This blob is written once and never updated. It is the source of truth for customer-facing receipts, PDF generation, and payment dispute evidence.

`warehouse_name` and `warehouse_address` are also snapshotted as flat columns on `orders` for the same reason.

### Stored vs virtual fields for order totals

`subtotal`, `tax_amount`, and `total` on `orders` are stored columns, not virtual computed fields, for two reasons:

- **Performance.** A virtual field recomputes on every read via a JOIN + SUM across `order_items`. For an order history page showing 50 orders, that is 50 aggregations on every load.
- **Audit immutability.** The stored `total` is the legal record of what the customer was charged. Even if a bug or migration ever touched `order_items`, the charged amount remains correct and auditable.

A DB-level consistency constraint asserts `total = subtotal + tax_amount` at write time, catching any discrepancy at the source.

---

## Inventory Management System

### Why not `SELECT FOR UPDATE`

`SELECT FOR UPDATE` holds a write lock on the inventory row for the entire transaction duration. Under high concurrency on the same product, all competing transactions queue on that single lock. With 100 simultaneous orders for the same SKU and ~300ms per transaction, throughput collapses to ~3 orders/second and P99 latency reaches 30 seconds.

### Reservation table approach

Inventory reservation is append-only. Instead of updating a hot row, the system inserts a new `inventory_reservations` row per item. No row-level write contention; the DB processes parallel inserts independently.

**Available inventory** is a derived read-only value computed in `InventoryRepository`:

```sql
SELECT
  i.quantity - COALESCE(SUM(r.quantity), 0) AS available
FROM inventories i
LEFT JOIN inventory_reservations r
  ON  r.warehouse_id = i.warehouse_id
  AND r.product_id   = i.product_id
  AND r.status       = 'active'
  AND r.expires_at   > NOW()
WHERE i.warehouse_id = :warehouseId
  AND i.product_id   = :productId
GROUP BY i.quantity
```

`inventories.quantity` represents **physical stock** and is only written during receiving/restocking operations — never on the order path.

### Reservation lifecycle

```
INSERT reservation (status='active', expires_at=NOW()+10min)
       ↓
 Payment attempted
       ↓
  ┌────┴────┐
success   failure
  ↓           ↓
status=    status=
confirmed  released
```

Reservations that reach `expires_at` while still `active` are released by the `expireReservations` background job.

### Lock scope and timing

A distributed lock is acquired **per `(warehouseId, productId)` pair** and held from the availability check through the reservation insert — both operations are within the lock window. This is what makes the reservation atomic: without holding the lock during the check, two concurrent requests can both observe sufficient inventory before either inserts, resulting in oversell.

```
acquire lock: inv-lock:${warehouseId}:${productId}
  ↓
  run availability query          ← inside lock
  ↓
  re-verify quantities sufficient ← inside lock
  ↓
  insert reservation row          ← inside lock
  ↓
release lock
```

Locks are acquired in ascending key order across all items in an order to prevent deadlocks when an order touches multiple products. Two orders for different products in the same warehouse never block each other.

### Throughput comparison

| Strategy | Throughput (same SKU) | P99 latency (100 concurrent orders) |
|---|---|---|
| `SELECT FOR UPDATE` | ~3–4 orders/sec | ~25–30 seconds |
| Reservation table | ~100–200 orders/sec | ~200–400ms |

---

## Tax Gateway

Tax is calculated per line item after the subtotal is computed and before the payment gateway is called. The `shippingAddress` determines the jurisdiction; the `tax_code` on each product determines the applicable rate within that jurisdiction. The server derives the jurisdiction from the address — the client never sends it.

**`src/gateways/TaxGateway.ts`**

```ts
TaxGateway.calculate({
  shippingAddress: string
  items: {
    taxCode: string    // e.g. 'GROCERY', 'ELECTRONICS', 'EXEMPT'
    amount:  number    // line item subtotal
  }[]
}): Promise<{
  totalTaxAmount: number
  breakdown: {
    taxCode:   string
    taxRate:   number   // e.g. 0.21
    taxAmount: number
  }[]
}>
```

Mock returns deterministic rates per tax code (e.g. `GROCERY → 0.00`, `ELECTRONICS → 0.21`, `STANDARD → 0.10`). Throws `TaxCalculationError` for unknown tax codes (test hook). Real implementation swaps this for a TaxJar or Avalara call.

Circuit breaker flag `circuit:tax` checked before every call. Maps to `503` if open.

---

## Layer Responsibilities in Detail

### Route Layer — `src/routes/orders.ts`

`POST /orders` middleware pipeline:

```
1. rateLimiter middleware       ← 5 req / 60s sliding window, keyed on customerId
2. Zod schema validation        ← rejects malformed requests before hitting controller
3. orderController.createOrder  ← delegates to controller
```

The route layer is purely infrastructural: rate limiting, validation, delegation. It has no knowledge of business logic or database structure.

### Controller Layer — `src/controllers/orderController.ts`

The controller is the natural home for idempotency — it is the layer that decides whether to invoke business logic at all, it already has the validated DTO (including `idempotencyKey`), and it is where the response is first constructed, making it clean to store immediately after `OrderService` returns.

```
1. Check idempotency key        ← IdempotencyRepository.get(key) → return cached response if found
2. Call OrderService.createOrder(dto)
3. Store idempotency key        ← IdempotencyRepository.set(key, response, 24h)
4. Return 201 { orderId, subtotal, taxAmount, total, warehouseId, status }
```

The controller never calls repositories other than `IdempotencyRepository`. All business logic flows through `OrderService`.

### Service Layer — `src/services/`

`OrderService.ts` is the **Facade** — the single entry point called by the controller:

```
1. Fetch products via ProductRepository; compute subtotal server-side
2. WarehouseSelectionService.findClosest(items, shippingAddress)
3. TaxGateway.calculate(shippingAddress, items with tax codes)
4. Compute total = subtotal + taxAmount
5. ReservationService.createReservations(warehouseId, items, orderId)
6. OrderRepository.insert(order) + OrderItemRepository.insertMany(items) with full snapshots
7. Check payment circuit breaker → throw CircuitOpenError (503) if open
8. withRetry(() => PaymentGateway.charge(total, ...), 2, 500ms)
9. On success: ReservationService.confirmReservations(orderId)
               OrderRepository.updateStatus(orderId, 'CONFIRMED')
10. On failure: ReservationService.releaseReservations(orderId)  ← compensating transaction
                OrderRepository.updateStatus(orderId, 'FAILED')
                if release fails → deadLetterQueue.send(...)
```

**`ReservationService.createReservations`** — for each `(warehouseId, productId)` pair, in ascending key order:

```
1. Acquire distributed lock: inv-lock:${warehouseId}:${productId}
2. Query available inventory             ← inside lock
3. Throw InsufficientInventoryError if quantity < requested  ← inside lock
4. Insert reservation row (status='active', expires_at=NOW()+10min)  ← inside lock
5. Release lock
```

The lock is held across steps 2–4. This is what prevents two concurrent requests from both observing sufficient inventory before either inserts.

**`GeocodeService`** — cache wrapper with circuit breaker scoped to the gateway call:

```
1. Check Redis cache (key: geocode:<sha256(address)>)
2. If cache hit → return immediately (circuit breaker irrelevant)
3. If cache miss:
   a. Check circuit:geocoding flag → throw CircuitOpenError (503) if open
   b. Call GeocodingGateway.geocode(address)
   c. Write result to cache (TTL 30 days)
   d. Return coordinates
```

The circuit breaker is checked only on a cache miss, immediately before the gateway call. A cache hit bypasses it entirely — no external call is made, so there is nothing to protect against.

Sub-services called internally by `OrderService`:

- `WarehouseSelectionService` — queries available inventory from `InventoryRepository`, geocodes address via `GeocodeService`, scores by haversine distance
- `ReservationService` — acquires per-product locks (check + insert within lock window), inserts reservations
- `GeocodeService` — Redis cache wrapper around `GeocodingGateway`, circuit breaker on cache miss only
- `DistributedLockService` — Redis SET NX wrapper

### Data Layer — `src/repositories/`

All TypeORM queries are isolated here. Services call repositories; repositories never call services.

| Repository | Responsibilities |
|---|---|
| `OrderRepository` | insert order, updateStatus, findByIdempotencyKey, findStalePending |
| `OrderItemRepository` | insertMany with full snapshots |
| `ProductRepository` | findByIds (price, name, sku, tax_code lookup at order time) |
| `WarehouseRepository` | findAll with coordinates |
| `InventoryRepository` | available inventory query (physical − active reservations) |
| `ReservationRepository` | insert, confirmByOrderId, releaseByOrderId, findExpired |
| `IdempotencyRepository` | Redis GET / SET EX (no TypeORM — Redis-backed) |

---

## Compensating Transactions + Dead Letter Queue

Payment and reservation confirmation are separate operations. If payment succeeds but `confirmReservations` fails, the system must not leave reservations permanently `active` consuming stock for an order that will never be fulfilled.

```
PaymentGateway.charge()
  ↓ success
confirmReservations()
  ↓ failure
releaseReservations()          ← compensating transaction
  ↓ failure
deadLetterQueue.send({         ← triggers alert, manual investigation
  order_id,
  failure_stage: 'post_payment_release',
  payment_reference
})
```

The dead-letter queue is a BullMQ queue with no automatic retry. An alert fires on any enqueue. This ensures no order is silently lost in a partially-failed state.

---

## Idempotency

The `idempotency_key` column on `orders` has a `UNIQUE` constraint as a DB-level safety net. The primary idempotency check happens in the route layer via Redis (TTL 24h) — it short-circuits before the controller is invoked, returning the original response without re-executing any business logic.

Any duplicate submission due to client retry, network timeout, or double-click is handled transparently.

---

## Circuit Breakers

Redis-backed boolean flags, one per external dependency. Checked in the service layer immediately before each gateway call.

| Flag | Where checked | Behaviour on cache hit |
|---|---|---|
| `circuit:geocoding` | `GeocodeService` — after cache miss, before gateway call | Bypassed — no external call made |
| `circuit:payment` | `OrderService` — before `PaymentGateway.charge` | N/A |
| `circuit:tax` | `OrderService` — before `TaxGateway.calculate` | N/A |

When a flag is `true` (circuit open), a `CircuitOpenError` is thrown, mapping to `503 Service Unavailable`. Flags are toggled manually via ops tooling or automatically after a configurable error threshold.

---

## Type Safety

TypeScript strict mode throughout. No `any`. All external inputs validated with Zod at the route layer and narrowed to inferred types before reaching the controller.

Order status uses a discriminated union — invalid states are unrepresentable at compile time:

```ts
type Order =
  | { status: 'PENDING_PAYMENT'; reservations: Reservation[] }
  | { status: 'CONFIRMED';       confirmedAt: Date; paymentReference: string }
  | { status: 'FAILED';          reason: string }
```

Accessing `.paymentReference` on a `PENDING_PAYMENT` order is a compile-time error.

---

## Observability

**Structured logging** via pino. Every significant event emits a JSON log line with business context. No `console.log` anywhere in the codebase.

```json
{
  "timestamp": "2026-06-09T14:30:00Z",
  "level": "info",
  "event": "order_confirmed",
  "customer_id": 123,
  "order_id": "ord-456",
  "warehouse_id": 3,
  "subtotal": 90.00,
  "tax_amount": 16.80,
  "total": 106.80,
  "fulfillment_latency_ms": 284
}
```

**Metrics** (exported to Prometheus / StatsD):

| Metric | Type | Description |
|---|---|---|
| `orders_created_total` | Counter | Total confirmed orders |
| `orders_failed_total` | Counter | Total failed orders, labeled by `reason` |
| `order_fulfillment_latency_ms` | Histogram | End-to-end order creation latency |
| `warehouse_reservation_conflicts_total` | Counter | Re-verify failures under lock |
| `payment_gateway_error_rate` | Gauge | Rolling error % on payment calls |
| `tax_gateway_error_rate` | Gauge | Rolling error % on tax calls |
| `inventory_reservations_expired_total` | Counter | Reservations released by expiry job |
| `dead_letter_queue_depth` | Gauge | Unresolved compensating transaction failures |

---

## Background Jobs

**`src/jobs/expireReservations.ts`** — BullMQ repeatable, every 1 minute.

```
1. ReservationRepository.findExpired()
   → SELECT WHERE status='active' AND expires_at < NOW()
2. For each: ReservationRepository.releaseByOrderId(orderId)
3. If associated order is still PENDING_PAYMENT:
   OrderRepository.updateStatus(orderId, 'FAILED')
4. Emit metric: inventory_reservations_expired_total++
```

**`src/jobs/reconcileOrders.ts`** — BullMQ repeatable, every 5 minutes.

```
1. OrderRepository.findStalePending()
   → SELECT WHERE status='PENDING_PAYMENT' AND created_at < NOW() - INTERVAL '5 minutes'
2. For each: PaymentGateway.getStatus(payment_reference)
   - 'succeeded' → ReservationService.confirmReservations + updateStatus('CONFIRMED')
   - 'failed'    → ReservationService.releaseReservations + updateStatus('FAILED')
   - 'unknown'   → log warn, skip (retried next run)
```

---

## Tests

**Integration** (`src/routes/orders.test.ts`) — Supertest against a real test DB (`orders_test`, seeded before each suite). Gateways stubbed with Vitest `vi.spyOn`.

| Case | Expected |
|---|---|
| Happy path (mixed tax codes) | 201, correct subtotal + tax + total, snapshot written |
| No warehouse can fulfill | 409 |
| Available inventory changes between selection and reservation insert | 409 from re-verify under lock |
| Duplicate idempotency key | 201 cached response, no second charge |
| Payment declined | 402, reservations released, status FAILED |
| Payment circuit breaker open | 503 |
| Geocoding circuit breaker open (cache miss) | 503 |
| Geocoding circuit breaker open (cache hit) | 200 — circuit bypassed |
| Tax circuit breaker open | 503 |
| Unknown tax code on product | 422 |
| Rate limit exceeded | 429 |
| Reservation expires before payment confirmed | order FAILED by expiry job |
| Compensating transaction fails | event enqueued in dead-letter queue |
| Receipt snapshot immutable after product price update | snapshot shows original price |
| Receipt snapshot immutable after product tax code update | snapshot shows original tax rate |

**Unit** — `haversine.test.ts`, `WarehouseSelectionService.test.ts`, `DistributedLockService.test.ts`, `ReservationService.test.ts`, `TaxGateway.test.ts`

**Load test** (`src/load-test.ts`) — 100 concurrent orders on the same warehouse/product:

```ts
const orders = Array(100).fill(null).map((_, i) => ({
  customerId: i + 1,
  items: [{ productId: 1, quantity: 1 }],
  shippingAddress: randomAddress(),
  cardNumber: '4111111111111111',
  idempotencyKey: `load-test-${i}`
}))

const start = Date.now()
const results = await Promise.allSettled(orders.map(o => api.post('/orders', o)))
const duration = Date.now() - start

const confirmed = results.filter(r => r.status === 'fulfilled').length
console.log(`${confirmed}/100 confirmed in ${duration}ms`)
```

Expected: all 100 complete in <500ms total. No oversell — confirmed orders must not exceed physical stock.

---

## Verification

```bash
# DB setup
createdb orders_dev
npx typeorm migration:run -d src/db/dataSource.ts
npx ts-node src/db/seeds/run.ts

# Start Redis
redis-server --daemonize yes

# Run server
npm run dev

# Smoke test
curl -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "customerId": 1,
    "shippingAddress": "123 Main St, Seattle WA",
    "items": [
      { "productId": 1, "quantity": 2 },
      { "productId": 2, "quantity": 1 }
    ],
    "cardNumber": "4111111111111111",
    "idempotencyKey": "test-001"
  }'

# Run tests
npm test

# Run load test
npx ts-node src/load-test.ts
```

---

## Implementation

Sequential commits. Each item is roughly one logical unit of work.

- [x] Project scaffold — `package.json`, `tsconfig.json` (strict mode), ESLint, Prettier, Vitest config, `src/config/env.ts`
- [x] TypeORM setup — `src/db/dataSource.ts`, base entity config, migration runner script
- [x] Migration: `customers`, `products`, `warehouses`, `inventories`
- [x] Migration: `orders`, `order_items`
- [x] Migration: `inventory_reservations` with partial index on `(warehouse_id, product_id, status, expires_at)`
- [x] Seed data — 1 customer, 3 products (mixed tax codes), 2 warehouses with inventory
- [x] TypeORM entities — `Customer`, `Product`, `Warehouse`, `Inventory`, `InventoryReservation`, `Order`, `OrderItem`
- [x] Repositories — `OrderRepository`, `OrderItemRepository`, `ProductRepository`, `WarehouseRepository`, `InventoryRepository`, `ReservationRepository`, `IdempotencyRepository`
- [x] Utilities — `haversine.ts`, `retry.ts`, `logger.ts` (pino)
- [x] `DistributedLockService` — Redis `SET NX EX` wrapper with `acquire` / `release`
- [x] Mock gateways — `GeocodingGateway`, `PaymentGateway` (with `PaymentDeclinedError` hook), `TaxGateway` (with `TaxCalculationError` hook)
- [ ] `GeocodeService` — Redis cache wrapper; circuit breaker checked on cache miss only
- [ ] `WarehouseSelectionService` — eligible warehouse query + haversine sort
- [ ] `ReservationService` — per-product lock (check + insert within lock window), confirm, release
- [ ] `OrderService` (Facade) — orchestrates subtotal, warehouse selection, tax, reservation, payment, compensation, dead-letter queue
- [ ] Middleware — `rateLimiter.ts` (per-customer sliding window), `circuitBreaker.ts` (Redis flag reader)
- [ ] Controller — `orderController.ts` with idempotency check + store
- [ ] Route — `POST /orders` pipeline (rate limit → validate → controller)
- [ ] Express app wiring — `app.ts`, `src/index.ts` server entry
- [ ] BullMQ job: `expireReservations` (every 1 min)
- [ ] BullMQ job: `reconcileOrders` (every 5 min)
- [ ] Unit tests — `haversine`, `WarehouseSelectionService`, `DistributedLockService`, `ReservationService`, `TaxGateway`
- [ ] Integration tests — all cases in the Tests section
- [ ] Load test — `src/load-test.ts`
