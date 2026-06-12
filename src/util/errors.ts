export class CircuitOpenError extends Error {
  constructor(circuit: string) {
    super(`Circuit open: ${circuit}`);
    this.name = 'CircuitOpenError';
  }
}

export class InsufficientInventoryError extends Error {
  constructor() {
    super('Insufficient inventory');
    this.name = 'InsufficientInventoryError';
  }
}
