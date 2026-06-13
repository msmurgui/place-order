# High-Traffic Assessment — Inventory Reservation Path

## Summary

This document records an analysis of the inventory reservation path under high traffic and the
decisions taken as a result. The reserve-early plus group-id model is sound — it fails fast, leaves
no orphan orders, and locks inventory as early as possible — and the surrounding architecture
(reservation table, snapshots, circuit breakers, compensation) holds up. The limiting factor was the
**Redis distributed lock around the database check-and-insert**: it capped throughput on hot SKUs and,
more importantly, was a correctness hazard. Replacing it was prioritised over every other change.

## Analysis: the Redis lock around a DB check-and-insert

For a hot SKU, every order serialized on `inv-lock:wh:prod`, and that lock was held across *a DB
query, a DB insert, and two Redis round trips*. Two problems emerged at scale:

1. **Throughput.** The hot-SKU rate was capped at `1 / lock_hold_time`. With Redis hops plus a DB
   query and insert inside the window, that ceiling was lower than it needed to be.
2. **Correctness.** The lock carried a 5-second TTL. Under load (a GC pause, a slow query, a
   connection-pool wait), the operation could exceed the TTL, the lock would **auto-expire
   mid-flight**, a second worker would proceed, and the system would **oversell**. The token-based
   release protected the *release*, not the *hold*. Inventory correctness was therefore hostage to
   "the DB operation always finishes within 5 seconds under peak load" — precisely the condition that
   fails when it matters most.

The lock also coupled inventory correctness to Redis liveness, on the same Redis instance already
serving idempotency, rate limiting, circuit breakers, the geocode cache, and BullMQ.

## Decision: serialize in Postgres with an advisory transaction lock

The chosen replacement is a PostgreSQL advisory transaction lock keyed on the `(warehouseId,
productId)` pair, taken as the first statement inside the reservation transaction:

```sql
BEGIN;
SELECT pg_advisory_xact_lock(:warehouseId, :productId);
-- availability check (active + confirmed reservations)
-- INSERT reservation if sufficient
COMMIT;
```

This is faster (no Redis round trips), correct (no TTL — the lock auto-releases *at commit*, never
mid-operation), and decouples inventory from Redis entirely. The two-integer form maps the
`(warehouseId, productId)` natural key directly, with no hashing. A fuller treatment of the mechanism
and the rationale is in [`advisory-locks.md`](advisory-locks.md).

The change also resolves the earlier "reservations must not be wrapped in a transaction" constraint,
and it is worth recording why. That rule existed *only because* the Redis lock released independently
of the DB commit: wrapping the insert in a transaction would release the lock before committing, so
the next worker could read stale availability and oversell. With an *in-database* advisory lock,
**lock-release and commit are the same event** — the next waiter cannot run its check until this
transaction commits, by which point the row is already visible. The insert living in a transaction
becomes not merely safe but *correct*, and the reasoning gets simpler rather than harder. The
per-SKU serialization granularity is unchanged; it is simply cheaper and free of the footgun.

## The trade-off

Advisory locks serialize same-SKU requests: for one hot SKU, orders are processed one at a time. This
is acceptable because the lock window is small — one indexed read, one insert, and a commit, in the
single-digit-millisecond range. Even a viral SKU handling hundreds of concurrent orders drains in
well under a second, which the load test confirms. This is the *same* serialization the Redis lock
was always intended to provide; the change does not introduce a new bottleneck, it makes the existing
one correct and non-failing.

The design deliberately avoids `SELECT FOR UPDATE` on the inventory row, which would hold a lock
across the *entire* order transaction — including the tax-gateway and payment calls, hundreds of
milliseconds each. The advisory lock wraps only the check and insert; the slow external calls run
*outside* it, preserving the short critical section the reservation-table design depends on.

The net effect, measured against the load test: hot-SKU confirmations went from 1 of 100 to 100 of
100, while the oversell guarantee held exactly (50 of 60 confirmed against 50 units of stock, the
remaining 10 cleanly rejected).

## Additional findings addressed alongside the lock change

Three further issues degrade under high traffic. They are independent of the reserve-early refactor
and were addressed as part of the same effort.

1. **Availability query growth from accumulated `confirmed` rows.** Confirmed reservations count
   against availability until physical shipment, so a popular SKU would accumulate a large set of
   `confirmed` rows that every availability check must sum, degrading the hot path over time. The
   decision was to add a scheduled reaper that rolls confirmed reservations into a physical
   `inventories.quantity` decrement and marks those rows released, keeping the summed set bounded.

2. **Per-row expiry job.** A "for each expired reservation, release it" loop becomes thousands of
   `UPDATE`s per minute under a spike of expirations. The expiry job was made set-based — a single
   `UPDATE … WHERE status = 'active' AND expires_at < NOW()` (batched), not a loop.

3. **Check-then-set idempotency race.** Two concurrent requests with the same key could both miss the
   Redis check before either stored a value, then both reserve inventory and potentially both charge.
   The database unique constraint catches the duplicate *order* row, but only after one request has
   already reserved and charged. The fix was an atomic `SET NX` claim at the start of the request
   rather than a get-then-set.

## Sequencing

The Redis lock was replaced with the advisory lock in the same pass as the reserve-early plus
group-id change, since both touch the same code path. The reaper, set-based expiry, and atomic
idempotency claim were handled as separate, independent changes.
