# High-Traffic Assessment — Inventory Reservation Path

Honest verdict: the **reserve-early + group-id change itself is solid** and strictly better than what we have — fail-fast, no orphan orders, inventory locked ASAP. The surrounding architecture (reservation table, snapshots, circuit breakers, compensation) is sound. But if you're asking whether *the whole inventory path* withstands genuinely high traffic, the honest answer is: **the Redis distributed lock is the ceiling, and it's also a correctness hazard.** That's the thing I'd change before anything else.

## The real bottleneck: the Redis lock around a DB check+insert

For a hot SKU, every order serializes on `inv-lock:wh:prod`, and we hold that lock across *a DB query + a DB insert + two Redis round trips*. Two problems at scale:

1. **Throughput** — hot-SKU rate is capped at `1 / lock_hold_time`. With Redis hops + a DB query + insert in the window, that's the ceiling, and it's higher than it needs to be.
2. **Correctness** — the lock has a 5s TTL. Under load (GC pause, slow query, pool wait), the operation can exceed the TTL, the lock **auto-expires mid-flight**, a second thread proceeds, and you **oversell**. The token-based release protects the *release*, not the *hold*. So inventory correctness is hostage to "the DB op always finishes within 5s under peak load" — which is exactly when it won't.

And it couples inventory correctness to Redis liveness, on the same Redis instance that's also doing idempotency, rate limiting, circuit breakers, geocode cache, and BullMQ.

**What I'd do instead: serialize in Postgres with an advisory transaction lock** keyed on `inventory_id` (which *is* the (warehouse, product) pair):

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('inv:' || :inventoryId));
-- availability check (active + confirmed)
-- INSERT reservation if sufficient
COMMIT;
```

This is faster (no Redis round trips), correct (no TTL — the lock auto-releases *at commit*, never mid-operation), and decouples inventory from Redis entirely.

**This also resolves the "reservations must not be in a transaction" constraint** — and it's worth seeing why. That rule only existed *because* the Redis lock releases independently of the DB commit: wrap the insert in a transaction and you'd release the lock before committing, so the next thread reads stale availability → oversell. With an *in-DB* advisory lock, **lock-release and commit are the same event** — the next waiter can't run its check until this transaction commits, at which point the row is already visible. So the insert living in a transaction becomes not just safe but *correct*, and the reasoning gets simpler, not harder. Same per-SKU serialization granularity, just cheaper and without the footgun.

## Three more that bite at high traffic (ranked)

1. **The availability `SUM` grows with accumulated `confirmed` rows.** We made confirmed reservations count until physical shipment. If the out-of-band shipment reaper is slow or absent, a popular SKU accumulates millions of confirmed rows and every availability check sums a growing set. Needs either a reaper that rolls confirmed → physical `quantity` decrement (clearing the rows), or a denormalized `reserved_qty` rollup. Without it, the hot path degrades over time.

2. **The expiry job must be set-based.** The design's "for each expired reservation, release it" is per-row. Under a spike of expirations that's thousands of `UPDATE`s/minute. It has to be a single `UPDATE ... WHERE status='active' AND expires_at < NOW()` (batched/limited), not a loop.

3. **Idempotency is check-then-set, which races.** Two concurrent requests with the same key can both miss the Redis check before either stores, then both reserve and potentially both charge. The DB unique constraint catches the duplicate *order* row, but only after one has already reserved/charged. It should be an atomic `SET NX` claim at the very start of the route, not a get-then-set.

None of these block the reserve-early refactor — they're independent. Suggested sequencing: (1) do the group-id reserve-early change as planned, (2) swap the Redis lock for the advisory lock in the same pass since they touch the same code, then tackle the reaper/expiry/idempotency items separately.
