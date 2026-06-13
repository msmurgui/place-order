# Demo Scripts

Two scripts for exploring and stress-testing the `POST /orders` service. Both run against a live server over HTTP — no test doubles, no mocking.

## Prerequisites

```bash
# 1. Migrate and seed the database (one-time)
npm run migration:run
npm run seed

# 2. Start the server with the rate limit relaxed (terminal 1)
RATE_LIMIT_MAX=1000 npm run dev
```

> **Re-seeding**: each demo run consumes real inventory. Run `npm run seed` again before re-running if stock runs low (the seed is idempotent for warehouses and products, but will add a new customer row on each run — safe to ignore).

---

## `demo.ts` — Scenario walkthrough

Walks through 8 scenarios sequentially, printing colour-coded pass/fail output for each assertion. Exits non-zero if any scenario fails.

```bash
npm run demo
```

| # | Scenario | What it proves |
|---|---|---|
| 1 | Happy path — mixed tax codes | Order confirmed, correct warehouse selected, `total = subtotal + taxAmount` |
| 2 | Warehouse routing | Order for a product with zero Seattle stock routes to LA |
| 3 | Idempotency | Sending the same request twice returns the same `orderId` without re-charging |
| 4 | Payment declined | Declined card returns 402; reservations are released |
| 5 | Insufficient inventory | Quantity exceeding all warehouse stock returns 409 |
| 6 | Circuit breaker — payment | Open payment circuit returns 503; circuit is auto-restored after the scenario |
| 7 | Circuit breaker — tax | Open tax circuit returns 503; circuit is auto-restored after the scenario |
| 8 | Concurrent mini-burst | 10 simultaneous orders all confirm with unique order IDs |

Circuit breakers (scenarios 6–7) are opened and closed programmatically via Redis — no manual steps needed.

---

## `load-test.ts` — Concurrent load

Runs two back-to-back load tests and prints throughput metrics. Exits non-zero if the oversell assertion fails.

```bash
npm run load-test
```

### Test A — Throughput

Fires **100 concurrent orders** for Apples (Seattle stock: 200). All 200 requests are inflight simultaneously. Asserts all 100 confirm without errors, and reports wall-clock time and requests/second.

### Test B — Oversell prevention

Fires **60 concurrent orders** for Headphones (Seattle stock: 50). All 60 requests are inflight simultaneously. Without the per-SKU distributed lock, each request would observe "50 available" before any reservation is written and all 60 would succeed — overselling by 10 units. The test asserts `confirmed ≤ 50`.
