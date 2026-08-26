export function greeting(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) throw new Error("name is required");
  return `Hello, ${normalized}!`;
}
