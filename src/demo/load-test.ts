const BASE_URL = 'http://localhost:3000';
const RUN = Date.now();
const VALID_CARD = '4111111111111111';

const G = '\x1b[32m';
const R = '\x1b[31m';
const C = '\x1b[36m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const X = '\x1b[0m';

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

function testHeader(title: string): void {
  const bar = '━'.repeat(52);
  console.log(`\n${B}${C}${bar}${X}`);
  console.log(`${B}${C} ${title}${X}`);
  console.log(`${B}${C}${bar}${X}`);
}

function row(label: string, value: string | number): void {
  console.log(`  ${D}${label.padEnd(28)}${X}${value}`);
}

async function runTest(
  label: string,
  count: number,
  buildPayload: (i: number) => PlaceOrderPayload,
  assertFn: (counts: Record<number, number>) => { passed: boolean; message: string },
): Promise<boolean> {
  testHeader(label);
  console.log(`  ${D}Firing ${count} concurrent requests...${X}`);

  const start = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => post(buildPayload(i))),
  );
  const elapsed = Math.round(performance.now() - start);

  const counts: Record<number, number> = {};
  for (const r of results) {
    const code = r.status === 'fulfilled' ? r.value.status : 0;
    counts[code] = (counts[code] ?? 0) + 1;
  }

  const confirmed = counts[201] ?? 0;
  const conflict = counts[409] ?? 0;
  const other = count - confirmed - conflict;

  row('Requests fired', count);
  row('201 Confirmed', `${G}${confirmed}${X}`);
  row('409 Insufficient inventory', conflict > 0 ? `${conflict}` : `${D}0${X}`);
  if (other > 0) row('Other / network errors', `${R}${other}${X}`);
  row('Wall-clock time', `${elapsed}ms`);
  row('Throughput', `${Math.round((count / elapsed) * 1000)} req/s`);

  const { passed, message } = assertFn(counts);
  if (passed) {
    console.log(`\n  ${G}✓${X}  ${message}`);
  } else {
    console.log(`\n  ${R}✗${X}  ${message}`);
  }

  return passed;
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`\n${R}${B}Server not reachable at ${BASE_URL}.${X}\nStart it with: RATE_LIMIT_MAX=1000 npm run dev\n`);
    process.exit(1);
  }
  console.log(`${D}Server OK — running load tests against ${BASE_URL}${X}`);

  // ── TEST A: Throughput ────────────────────────────────────────────────────
  // 100 concurrent orders for Apples (Seattle stock: 200) — all should succeed.
  const testA = await runTest(
    'TEST A — THROUGHPUT  (100 concurrent, ample stock)',
    100,
    (i) => ({
      customerId: 1,
      shippingAddress: '123 Pine St, Seattle WA',
      items: [{ productId: 1, quantity: 1 }],
      cardNumber: VALID_CARD,
      idempotencyKey: `load-throughput-${i}-${RUN}`,
    }),
    (counts) => {
      const confirmed = counts[201] ?? 0;
      return {
        passed: confirmed === 100,
        message: confirmed === 100
          ? `All 100 orders confirmed — service handles concurrent load without errors`
          : `Only ${confirmed}/100 confirmed`,
      };
    },
  );

  // ── TEST B: Oversell prevention ───────────────────────────────────────────
  // 60 concurrent orders for Headphones (Seattle stock: 50) — at most 50 can succeed.
  // Without the per-SKU distributed lock, all 60 would observe "50 available" before
  // any reservation is inserted and all would succeed → oversell.
  const testB = await runTest(
    'TEST B — OVERSELL PREVENTION  (60 concurrent, 50 in stock)',
    60,
    (i) => ({
      customerId: 1,
      shippingAddress: '123 Pine St, Seattle WA',
      items: [{ productId: 2, quantity: 1 }],
      cardNumber: VALID_CARD,
      idempotencyKey: `load-oversell-${i}-${RUN}`,
    }),
    (counts) => {
      const confirmed = counts[201] ?? 0;
      const noOversell = confirmed <= 50;
      return {
        passed: noOversell,
        message: noOversell
          ? `${confirmed}/60 confirmed (≤ 50 stock) — reservation lock prevented oversell`
          : `OVERSELL DETECTED: ${confirmed} orders confirmed against 50 units of stock`,
      };
    },
  );

  // ── FINAL RESULT ──────────────────────────────────────────────────────────
  const allPassed = testA && testB;
  const bar = '━'.repeat(52);
  console.log(`\n${B}${C}${bar}${X}`);
  if (allPassed) {
    console.log(`  ${G}${B}All tests passed${X}`);
  } else {
    console.log(`  ${R}${B}One or more tests failed${X}`);
  }
  console.log(`${B}${C}${bar}${X}\n`);

  if (!allPassed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`${R}Unexpected error:${X}`, err);
  process.exit(1);
});
