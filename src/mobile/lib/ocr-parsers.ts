import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

const moneyRegexes = [
  /(?:total|amount|balance|grand total)[^\d]*(\d+[\.,]\d{2})/gi,
  /(\d+[\.,]\d{2})/g,
];

const dateFormats = ['MM/DD/YYYY', 'M/D/YYYY', 'YYYY-MM-DD', 'MMM D YYYY', 'MMMM D YYYY', 'DD/MM/YYYY'];

export type OCRConfidence = {
  amount: number;
  date: number;
  vendor: number;
  overall: number;
};

export type ParsedReceipt = {
  amountCandidateCents: number | null;
  dateCandidate: string | null;
  vendorCandidate: string | null;
  confidence: OCRConfidence;
};

function normalizeAmount(value: string): number | null {
  const cleaned = value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.round(parsed * 100);
}

export function extractAmount(text: string): { value: number | null; confidence: number } {
  for (const regex of moneyRegexes) {
    const matches = Array.from(text.matchAll(regex));
    if (matches.length === 0) {
      continue;
    }
    const candidate = matches[matches.length - 1]?.[1] ?? matches[matches.length - 1]?.[0] ?? '';
    const cents = normalizeAmount(candidate);
    if (cents !== null) {
      return { value: cents, confidence: regex === moneyRegexes[0] ? 0.9 : 0.65 };
    }
  }
  return { value: null, confidence: 0 };
}

export function extractDate(text: string): { value: string | null; confidence: number } {
  const datePatterns = [
    /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g,
    /\b\d{4}[\-]\d{1,2}[\-]\d{1,2}\b/g,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
  ];

  for (const pattern of datePatterns) {
    const found = text.match(pattern);
    if (!found || found.length === 0) {
      continue;
    }
    for (const raw of found) {
      const sanitized = raw.replace(/,/g, '').trim();
      const parsed = dayjs(sanitized, dateFormats, true);
      if (parsed.isValid()) {
        return {
          value: parsed.format('YYYY-MM-DD'),
          confidence: 0.82,
        };
      }
    }
  }

  return { value: null, confidence: 0 };
}

export function extractVendor(text: string): { value: string | null; confidence: number } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { value: null, confidence: 0 };
  }

  const ignored = /^(receipt|invoice|thank you|subtotal|total|cash|visa|mastercard|change|tax)/i;
  const candidate = lines.find((line) => line.length > 2 && line.length < 60 && !ignored.test(line));
  if (!candidate) {
    return { value: null, confidence: 0 };
  }

  const confidence = /^[A-Z0-9\s\-&'.]+$/.test(candidate) ? 0.78 : 0.62;
  return { value: candidate, confidence };
}

export function parseReceiptText(text: string): ParsedReceipt {
  const amount = extractAmount(text);
  const date = extractDate(text);
  const vendor = extractVendor(text);

  const overall = (amount.confidence + date.confidence + vendor.confidence) / 3;

  return {
    amountCandidateCents: amount.value,
    dateCandidate: date.value,
    vendorCandidate: vendor.value,
    confidence: {
      amount: amount.confidence,
      date: date.confidence,
      vendor: vendor.confidence,
      overall,
    },
  };
}
