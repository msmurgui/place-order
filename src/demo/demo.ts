import { redisClient } from '../redis';

const BASE_URL = 'http://localhost:3000';
const RUN = Date.now();
const VALID_CARD = '4111111111111111';
const DECLINED_CARD = '4000000000000002';

const G = '\x1b[32m'; // green
const R = '\x1b[31m'; // red
const C = '\x1b[36m'; // cyan
const B = '\x1b[1m';  // bold
const D = '\x1b[2m';  // dim
const X = '\x1b[0m';  // reset

interface OrderResponse {
  orderId: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  warehouseId: number;
  status: string;
}

interface PlaceOrderPayload {
  customerId: number;
  shippingAddress: string;
  items: { productId: number; quantity: number }[];
  cardNumber: string;
  idempotencyKey: string;
}

async function post(payload: PlaceOrderPayload): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderToPlace: payload }),
  });
  return { status: res.status, body: await res.json() };
}

function ikey(tag: string): string {
  return `demo-${tag}-${RUN}`;
}

const results: { name: string; passed: boolean }[] = [];

function sectionHeader(n: number, title: string): void {
  const bar = '═'.repeat(48);
  console.log(`\n${B}${C}${bar}${X}`);
  console.log(`${B}${C} SCENARIO ${n} — ${title}${X}`);
  console.log(`${B}${C}${bar}${X}`);
}

function ok(msg: string): boolean {
  console.log(`  ${G}✓${X}  ${msg}`);
  return true;
}

function ko(msg: string): boolean {
  console.log(`  ${R}✗${X}  ${msg}`);
  return false;
}

function check(cond: boolean, passMsg: string, failMsg: string): boolean {
  return cond ? ok(passMsg) : ko(failMsg);
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`\n${R}${B}Server not reachable at ${BASE_URL}.${X}\nStart it with: RATE_LIMIT_MAX=1000 npm run dev\n`);
    process.exit(1);
  }
  console.log(`${D}Server OK — running 8 scenarios against ${BASE_URL}${X}`);

  // ── SCENARIO 1: Happy path ────────────────────────────────────────────────
  {
    sectionHeader(1, 'HAPPY PATH — MIXED TAX CODES');
    const { status, body } = await post({
      customerId: 1,
      shippingAddress: '123 Pine St, Seattle WA',
      items: [
        { productId: 1, quantity: 2 }, // 2 × $5.00 Apples — GROCERY (0% tax)
        { productId: 2, quantity: 1 }, // 1 × $80.00 Headphones — ELECTRONICS (21% tax)
      ],
      cardNumber: VALID_CARD,
      idempotencyKey: ikey('s1'),
    });
    const b = body as OrderResponse;
    const p1 = check(status === 201, `POST /orders → 201 CONFIRMED`, `Expected 201, got ${status}`);
    const p2 = check(b.warehouseId === 1, `Routed to warehouse 1 (Seattle — closest to shipping address)`, `Expected warehouseId 1, got ${b.warehouseId}`);
    const p3 = check(
      Math.abs(b.total - (b.subtotal + b.taxAmount)) < 0.01,
      `total = subtotal + taxAmount  ($${b.subtotal} + $${b.taxAmount} = $${b.total})`,
      `total mismatch: $${b.subtotal} + $${b.taxAmount} ≠ $${b.total}`,
    );
    results.push({ name: 'Happy path', passed: p1 && p2 && p3 });
  }

  // ── SCENARIO 2: Warehouse routing ────────────────────────────────────────
  {
    sectionHeader(2, 'WAREHOUSE ROUTING');
    const { status, body } = await post({
      customerId: 1,
      shippingAddress: '123 Pine St, Seattle WA',
      items: [{ productId: 3, quantity: 1 }], // Keyboard — Seattle has 0 stock
      cardNumber: VALID_CARD,
      idempotencyKey: ikey('s2'),
    });
    const b = body as OrderResponse;
    const p1 = check(status === 201, `POST /orders → 201 CONFIRMED`, `Expected 201, got ${status}`);
    const p2 = check(b.warehouseId === 2, `Routed to warehouse 2 (LA — Seattle has 0 keyboards)`, `Expected warehouseId 2, got ${b.warehouseId}`);
    results.push({ name: 'Warehouse routing', passed: p1 && p2 });
  }

  // ── SCENARIO 3: Idempotency ───────────────────────────────────────────────
  {
    sectionHeader(3, 'IDEMPOTENCY');
    const payload: PlaceOrderPayload = {
      customerId: 1,
      shippingAddress: '123 Pine St, Seattle WA',
      items: [{ productId: 1, quantity: 1 }],
      cardNumber: VALID_CARD,
      idempotencyKey: ikey('s3'),
    };
    const first = await post(payload);
    const second = await post(payload);
    const b1 = first.body as OrderResponse;
    const b2 = second.body as OrderResponse;
    const p1 = check(first.status === 201, `First request → 201`, `Expected 201, got ${first.status}`);
    const p2 = check(second.status === 201, `Duplicate request → 201 (cached — no second charge)`, `Expected 201, got ${second.status}`);
    const p3 = check(b1.orderId === b2.orderId, `Same orderId both times (${b1.orderId}) — request was not re-executed`, `orderId mismatch: ${b1.orderId} vs ${b2.orderId}`);
    results.push({ name: 'Idempotency', passed: p1 && p2 && p3 });
  }

  // ── SCENARIO 4: Payment declined ─────────────────────────────────────────
  {
    sectionHeader(4, 'PAYMENT DECLINED');
    const { status } = await post({
      customerId: 1,
      shippingAddress: '123 Pine St, Seattle WA',
      items: [{ productId: 1, quantity: 1 }],
      cardNumber: DECLINED_CARD,
      idempotencyKey: ikey('s4'),
    });
    const p1 = check(status === 402, `POST /orders → 402 Payment Required`, `Expected 402, got ${status}`);
    results.push({ name: 'Payment declined', passed: p1 });
  }

  // ── SCENARIO 5: Insufficient inventory ───────────────────────────────────
  {
    sectionHeader(5, 'INSUFFICIENT INVENTORY');
    const { status } = await post({
      customerId: 1,
      shippingAddress: '123 Pine St, Seattle WA',
      items: [{ productId: 1, quantity: 10000 }],
      cardNumber: VALID_CARD,
      idempotencyKey: ikey('s5'),
    });
    const p1 = check(status === 409, `POST /orders → 409 Conflict (no warehouse can fulfil 10,000 apples)`, `Expected 409, got ${status}`);
    results.push({ name: 'Insufficient inventory', passed: p1 });
  }

  // ── SCENARIO 6: Circuit breaker — payment ────────────────────────────────
  {
    sectionHeader(6, 'CIRCUIT BREAKER — PAYMENT');
    await redisClient.set('circuit:payment', '1');
    try {
      const { status } = await post({
        customerId: 1,
        shippingAddress: '123 Pine St, Seattle WA',
        items: [{ productId: 1, quantity: 1 }],
        cardNumber: VALID_CARD,
        idempotencyKey: ikey('s6'),
      });
      const p1 = check(status === 503, `POST /orders → 503 Service Unavailable (payment circuit open)`, `Expected 503, got ${status}`);
      results.push({ name: 'Circuit breaker — payment', passed: p1 });
    } finally {
      await redisClient.del('circuit:payment');
    }
  }

  // ── SCENARIO 7: Circuit breaker — tax ────────────────────────────────────
  {
    sectionHeader(7, 'CIRCUIT BREAKER — TAX');
    await redisClient.set('circuit:tax', '1');
    try {
      const { status } = await post({
        customerId: 1,
        shippingAddress: '123 Pine St, Seattle WA',
        items: [{ productId: 1, quantity: 1 }],
        cardNumber: VALID_CARD,
        idempotencyKey: ikey('s7'),
      });
      const p1 = check(status === 503, `POST /orders → 503 Service Unavailable (tax circuit open)`, `Expected 503, got ${status}`);
      results.push({ name: 'Circuit breaker — tax', passed: p1 });
    } finally {
      await redisClient.del('circuit:tax');
    }
  }

  // ── SCENARIO 8: Concurrent mini-burst ────────────────────────────────────
  {
    sectionHeader(8, 'CONCURRENT MINI-BURST');
    const BURST = 10;
    const start = performance.now();
    const responses = await Promise.all(
      Array.from({ length: BURST }, (_, i) =>
        post({
          customerId: 1,
          shippingAddress: '123 Pine St, Seattle WA',
          items: [{ productId: 1, quantity: 1 }],
          cardNumber: VALID_CARD,
          idempotencyKey: ikey(`s8-${i}`),
        }),
      ),
    );
    const elapsed = Math.round(performance.now() - start);
    const confirmed = responses.filter((r) => r.status === 201);
    const orderIds = confirmed.map((r) => (r.body as OrderResponse).orderId);
    const uniqueIds = new Set(orderIds);
    const p1 = check(confirmed.length === BURST, `All ${BURST} concurrent orders → 201 CONFIRMED`, `Only ${confirmed.length}/${BURST} confirmed`);
    const p2 = check(uniqueIds.size === BURST, `All ${BURST} orders have unique orderId (no duplicate processing)`, `Duplicate orderIds detected`);
    console.log(`  ${D}${BURST} requests completed in ${elapsed}ms${X}`);
    results.push({ name: 'Concurrent mini-burst', passed: p1 && p2 });
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  const bar = '═'.repeat(48);
  console.log(`\n${B}${C}${bar}${X}`);
  console.log(`${B}${C} SUMMARY${X}`);
  console.log(`${B}${C}${bar}${X}`);
  for (const [i, r] of results.entries()) {
    const icon = r.passed ? `${G}✓${X}` : `${R}✗${X}`;
    console.log(`  ${icon}  ${i + 1}. ${r.name}`);
  }
  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.length - passCount;
  const colour = failCount === 0 ? G : R;
  console.log(`\n  ${colour}${B}${passCount} passed, ${failCount} failed${X}\n`);

  if (failCount > 0) process.exit(1);
}

main()
  .catch((err: unknown) => {
    console.error(`${R}Unexpected error:${X}`, err);
    process.exit(1);
  })
  .finally(() => {
    void redisClient.quit();
  });
