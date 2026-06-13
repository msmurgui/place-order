#!/usr/bin/env bash
#
# Manual smoke test for POST /orders against the originally-seeded data.
#
# Prerequisites:
#   1. Postgres up, migrations run, and seeded:
#        npm run migration:run && npm run seed
#   2. Redis running.
#   3. Server running. NOTE: the rate limiter allows only 5 requests / 60s per IP, and
#      every curl below comes from the same IP — so run the server with a relaxed limit
#      for these functional scenarios:
#        RATE_LIMIT_MAX=1000 npm run dev
#      (The rate-limit demo at the bottom is separate — see its note.)
#
# Seeded data this script relies on:
#   customer 1 = Alice
#   product  1 = Organic Apples      ($5.00,  GROCERY 0%)
#   product  2 = Wireless Headphones ($80.00, ELECTRONICS 21%)
#   product  3 = USB Keyboard        ($45.00, STANDARD 10%)
#   Seattle warehouse: 200 apples, 50 headphones, 0 keyboards
#   LA warehouse:      100 apples, 30 headphones, 60 keyboards

set -u

BASE_URL="${BASE_URL:-http://localhost:3000}"
GOOD_CARD="4111111111111111"
DECLINED_CARD="4000000000000002"
RUN="$(date +%s)" # namespaces idempotency keys so the script is re-runnable

post() {
  local label="$1" body="$2"
  printf '\n=== %s ===\n' "$label"
  curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE_URL/orders" \
    -H 'Content-Type: application/json' \
    -d "$body"
}

# make_body <items-json> <card> <idempotency-key> [shipping-address]
make_body() {
  local addr="${4:-123 Pike St, Seattle WA}"
  printf '{"orderToPlace":{"customerId":1,"shippingAddress":"%s","items":%s,"cardNumber":"%s","idempotencyKey":"%s"}}' \
    "$addr" "$1" "$2" "$3"
}

# 1. Happy path — apples x2 + headphones x1 to a Seattle address.
#    Both warehouses stock these; Seattle is closest. Expect 201,
#    subtotal 90.00, tax 16.80 (21% on headphones only), total 106.80.
post "Happy path → Seattle warehouse" \
  "$(make_body '[{"productId":1,"quantity":2},{"productId":2,"quantity":1}]' "$GOOD_CARD" "$RUN-happy")"

# 2. Keyboards are only stocked in LA, so selection must pick LA even from a
#    Seattle address. Expect 201, subtotal 45.00, tax 4.50, total 49.50.
post "Routes to LA (only warehouse with keyboards)" \
  "$(make_body '[{"productId":3,"quantity":1}]' "$GOOD_CARD" "$RUN-keyboard")"

# 3. No single warehouse can fulfill 100000 apples → 409.
post "No warehouse can fulfill (insufficient stock)" \
  "$(make_body '[{"productId":1,"quantity":100000}]' "$GOOD_CARD" "$RUN-toomany")"

# 4. Idempotency — same key twice. Second call returns the cached response
#    with no second charge (identical body, HTTP 201 both times).
IDEM_BODY="$(make_body '[{"productId":1,"quantity":1}]' "$GOOD_CARD" "$RUN-idem")"
post "Idempotency (1st submission)" "$IDEM_BODY"
post "Idempotency (duplicate — cached, no re-charge)" "$IDEM_BODY"

# 5. Declined card → 402, reservations released, order FAILED.
post "Payment declined" \
  "$(make_body '[{"productId":2,"quantity":1}]' "$DECLINED_CARD" "$RUN-declined")"

# 6. Validation error — empty items array violates the schema → 400.
post "Validation error (empty items)" \
  "$(make_body '[]' "$GOOD_CARD" "$RUN-invalid")"

# ---------------------------------------------------------------------------
# Rate-limit demo (run separately, against a server started WITHOUT the relaxed
# limit, i.e. default RATE_LIMIT_MAX=5). Fires 7 rapid requests from one IP;
# expect the first 5 to pass and the rest to return HTTP 429.
#
# Uncomment to run:
#
# echo; echo "=== Rate limit (expect 429 after 5) ==="
# for i in $(seq 1 7); do
#   code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/orders" \
#     -H 'Content-Type: application/json' \
#     -d "$(make_body '[{"productId":1,"quantity":1}]' "$GOOD_CARD" "$RUN-rl-$i")")
#   echo "request $i → HTTP $code"
# done
