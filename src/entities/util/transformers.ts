export const numericTransformer = {
  to: (value: number): number => value,
  from: (value: string | number): number =>
    typeof value === 'string' ? parseFloat(value) : value,
};
