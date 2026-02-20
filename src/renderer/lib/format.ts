export function formatCurrency(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDateOnly(value: string): Date | null {
  const match = dateOnlyPattern.exec(value);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const parsed = new Date(year, month - 1, day);

  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }

  return parsed;
}

export function toLocalIsoDate(reference = new Date()) {
  const year = reference.getFullYear();
  const month = String(reference.getMonth() + 1).padStart(2, '0');
  const day = String(reference.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(date: string) {
  const parsed = parseLocalDateOnly(date) ?? new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function toCents(amountText: string) {
  const parsed = Number.parseFloat(amountText.replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.round(parsed * 100);
}

export function fromCents(cents: number) {
  return (cents / 100).toFixed(2);
}

export function monthBounds(reference = new Date()) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
  return {
    fromDate: toLocalIsoDate(start),
    toDate: toLocalIsoDate(end),
  };
}

export function yearBounds(reference = new Date()) {
  return {
    fromDate: `${reference.getFullYear()}-01-01`,
    toDate: `${reference.getFullYear()}-12-31`,
  };
}
