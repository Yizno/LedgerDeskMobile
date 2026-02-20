function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

export function joinPath(...parts: Array<string | null | undefined>): string {
  const filtered = parts
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .map((part) => trimSlashes(part));
  return filtered.join('/');
}

export function dirname(input: string): string {
  const normalized = normalizePath(input);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return '';
  }
  return normalized.slice(0, index);
}

export function normalizePath(input: string): string {
  const absolute = input.startsWith('/');
  const segments = input.split('/').filter((segment) => segment.length > 0);
  const output: string[] = [];

  for (const segment of segments) {
    if (segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (output.length > 0) {
        output.pop();
      }
      continue;
    }
    output.push(segment);
  }

  const built = output.join('/');
  if (absolute) {
    return `/${built}`;
  }
  return built;
}

export function isUnsafeRelativePath(input: string): boolean {
  const normalized = normalizePath(input.replace(/\\/g, '/'));
  return normalized.startsWith('/') || normalized.includes('../') || normalized === '..';
}

export function ensureTrailingSlash(input: string): string {
  if (input.endsWith('/')) {
    return input;
  }
  return `${input}/`;
}
