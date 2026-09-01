export function assertNever(value: never): never {
  throw new Error(`Unhandled Lena state: ${String(value)}`);
}

export function unreachable(message: string): never {
  throw new Error(message);
}
