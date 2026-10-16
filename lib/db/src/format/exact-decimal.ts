export type ExactDecimal = Readonly<{ coefficient: bigint; scale: number }>;
export type ExactRoundingMode = "half_away_from_zero" | "toward_zero" | "away_from_zero";
export type ExactRounding = { scale: number; rounding: ExactRoundingMode };
const inputPattern = /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,9})?$/;

function power10(scale: number): bigint {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 144) throw new RangeError("Unsupported decimal scale");
  return 10n ** BigInt(scale);
}
function normalize(coefficient: bigint, scale: number): ExactDecimal {
  if (typeof coefficient !== "bigint" || !Number.isSafeInteger(scale) || scale < 0 || scale > 72 || coefficient.toString().length > 257) throw new RangeError("Unsupported decimal magnitude or scale");
  if (coefficient === 0n) return { coefficient: 0n, scale: 0 };
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return { coefficient, scale };
}
function validateRounding(options: ExactRounding) {
  if (!Number.isSafeInteger(options.scale) || options.scale < 0 || options.scale > 36 || !["half_away_from_zero", "toward_zero", "away_from_zero"].includes(options.rounding)) throw new RangeError("Explicit supported scale and rounding are required");
}
function quotient(numerator: bigint, denominator: bigint, rounding: ExactRoundingMode): bigint {
  if (denominator === 0n) throw new RangeError("Cannot divide by zero");
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const result = numerator / denominator, remainder = numerator % denominator;
  if (!remainder || rounding === "toward_zero") return result;
  const magnitude = remainder < 0n ? -remainder : remainder;
  return rounding === "away_from_zero" || magnitude * 2n >= denominator ? result + (numerator < 0n ? -1n : 1n) : result;
}
export function parseExactDecimal(value: string): ExactDecimal {
  if (typeof value !== "string" || !inputPattern.test(value)) throw new RangeError("Decimal must fit numeric(24,9) without truncation");
  const negative = value.startsWith("-"), [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return normalize(BigInt(whole + fraction) * (negative ? -1n : 1n), fraction.length);
}
export function addExact(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  a = normalize(a.coefficient, a.scale); b = normalize(b.coefficient, b.scale);
  const scale = Math.max(a.scale, b.scale);
  return normalize(a.coefficient * power10(scale - a.scale) + b.coefficient * power10(scale - b.scale), scale);
}
export function subtractExact(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  return addExact(a, { coefficient: -b.coefficient, scale: b.scale });
}
export function multiplyExact(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  a = normalize(a.coefficient, a.scale); b = normalize(b.coefficient, b.scale);
  return normalize(a.coefficient * b.coefficient, a.scale + b.scale);
}
export function divideExact(a: ExactDecimal, b: ExactDecimal, options: ExactRounding): ExactDecimal {
  validateRounding(options); a = normalize(a.coefficient, a.scale); b = normalize(b.coefficient, b.scale);
  const shift = b.scale + options.scale - a.scale;
  const numerator = a.coefficient * power10(Math.max(0, shift));
  const denominator = b.coefficient * power10(Math.max(0, -shift));
  return normalize(quotient(numerator, denominator, options.rounding), options.scale);
}
export function roundExact(value: ExactDecimal, options: ExactRounding): ExactDecimal {
  validateRounding(options); value = normalize(value.coefficient, value.scale);
  return value.scale <= options.scale ? value : normalize(quotient(value.coefficient, power10(value.scale - options.scale), options.rounding), options.scale);
}
export function formatExact(value: ExactDecimal): string {
  value = normalize(value.coefficient, value.scale);
  const digits = (value.coefficient < 0n ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, "0");
  const sign = value.coefficient < 0n ? "-" : "";
  return sign + (value.scale ? digits.slice(0, -value.scale) + "." + digits.slice(-value.scale) : digits);
}
