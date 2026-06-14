// OpenAPI 3.0 spec served by swagger-ui-express at GET /docs. Kept as a TS object (not a YAML
// file) so it compiles into dist/ with the rest of src/ — the tsc build does not copy non-TS
// files. Mirrors the request shape in placeOrderSchema.ts and the responses in
// placeOrderController.ts / the error handler.
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Order Management API',
    version: '1.0.0',
    description:
      'Warehouse-based order fulfillment. `POST /orders` selects the closest warehouse with stock, ' +
      'reserves inventory atomically, applies tax, charges the card, and returns a confirmed order.',
  },
  // Relative server URL so the "Try it out" button targets whatever host serves this page
  // (localhost in dev, the Railway URL in production) without hardcoding either.
  servers: [{ url: '/', description: 'Current host' }],
  paths: {
    '/health': {
      get: {
        summary: 'Liveness check',
        responses: {
          '200': {
            description: 'Service is up',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } },
              },
            },
          },
        },
      },
    },
    '/orders': {
      post: {
        summary: 'Place an order',
        description:
          'Finds a warehouse that can fulfill all items, reserves stock, charges the card, and ' +
          'returns the confirmed order. Idempotent on `idempotencyKey` — replaying the same key ' +
          'returns the original response without re-charging.\n\n' +
          '**Two demo products let you test both inventory outcomes** (pick from the Examples dropdown below):\n' +
          '- **`productId: 5` — Digital Gift Card**: effectively unlimited stock in every warehouse, so the order always succeeds with `201`. Order any quantity.\n' +
          '- **`productId: 4` — Sold-Out Collectible**: zero stock everywhere, so the order always fails with `409` (insufficient inventory).\n\n' +
          '_Tip: give each distinct order a fresh `idempotencyKey` — reusing a key returns the original cached response instead of placing a new order._',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PlaceOrderRequest' },
              examples: {
                standard: {
                  summary: 'Standard order — in-stock products (201)',
                  value: {
                    orderToPlace: {
                      customerId: 1,
                      shippingAddress: '123 Main St, Seattle WA',
                      items: [
                        { productId: 1, quantity: 2 },
                        { productId: 2, quantity: 1 },
                      ],
                      cardNumber: '4111111111111111',
                      idempotencyKey: 'demo-standard-001',
                    },
                  },
                },
                infiniteStock: {
                  summary: 'Always succeeds — Digital Gift Card (productId 5, unlimited stock)',
                  value: {
                    orderToPlace: {
                      customerId: 1,
                      shippingAddress: '123 Main St, Seattle WA',
                      items: [{ productId: 5, quantity: 999 }],
                      cardNumber: '4111111111111111',
                      idempotencyKey: 'demo-infinite-001',
                    },
                  },
                },
                outOfStock: {
                  summary: 'Always 409 — Sold-Out Collectible (productId 4, zero stock)',
                  value: {
                    orderToPlace: {
                      customerId: 1,
                      shippingAddress: '123 Main St, Seattle WA',
                      items: [{ productId: 4, quantity: 1 }],
                      cardNumber: '4111111111111111',
                      idempotencyKey: 'demo-outofstock-001',
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Order placed',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/OrderResponse' } },
            },
          },
          '400': {
            description: 'Invalid request body (failed validation)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
          },
          '402': {
            description: 'Payment declined — reservations are released',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '409': {
            description:
              'Insufficient inventory in any single warehouse, or a request with this idempotency key is already in progress',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '503': {
            description: 'A downstream gateway (payment or tax) circuit is open',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      PlaceOrderRequest: {
        type: 'object',
        required: ['orderToPlace'],
        properties: {
          orderToPlace: {
            type: 'object',
            required: ['customerId', 'shippingAddress', 'items', 'cardNumber', 'idempotencyKey'],
            properties: {
              customerId: { type: 'integer', minimum: 1, example: 1 },
              shippingAddress: { type: 'string', minLength: 1, example: '123 Main St, Seattle WA' },
              items: {
                type: 'array',
                minItems: 1,
                items: { $ref: '#/components/schemas/OrderItem' },
              },
              cardNumber: { type: 'string', minLength: 1, example: '4111111111111111' },
              idempotencyKey: { type: 'string', minLength: 1, example: 'demo-001' },
            },
          },
        },
      },
      OrderItem: {
        type: 'object',
        required: ['productId', 'quantity'],
        properties: {
          productId: { type: 'integer', minimum: 1, example: 1 },
          quantity: { type: 'integer', minimum: 1, example: 2 },
        },
      },
      OrderResponse: {
        type: 'object',
        properties: {
          orderId: { type: 'integer', example: 42 },
          subtotal: { type: 'string', example: '29.98' },
          taxAmount: { type: 'string', example: '2.85' },
          total: { type: 'string', example: '32.83' },
          warehouseId: { type: 'integer', example: 1 },
          status: { type: 'string', example: 'CONFIRMED' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      ValidationError: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Invalid request body' },
          details: { type: 'object' },
        },
      },
    },
  },
} as const;
