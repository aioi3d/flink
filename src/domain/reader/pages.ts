import type { ValidationResult } from '../validation';

export type PageInputError = 'empty' | 'not-integer' | 'unsafe-integer' | 'out-of-range';

function isValidPageCount(pageCount: number): boolean {
  return Number.isSafeInteger(pageCount) && pageCount > 0;
}

export function pageIndexToDisplayNumber(pageIndex: number, pageCount: number): number {
  if (!isValidPageCount(pageCount)) {
    throw new RangeError('pageCount must be a positive safe integer.');
  }

  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new RangeError('pageIndex must be a zero-based index within pageCount.');
  }

  return pageIndex + 1;
}

export function displayPageNumberToIndex(
  displayPageNumber: number,
  pageCount: number,
): number {
  if (!isValidPageCount(pageCount)) {
    throw new RangeError('pageCount must be a positive safe integer.');
  }

  if (
    !Number.isSafeInteger(displayPageNumber) ||
    displayPageNumber < 1 ||
    displayPageNumber > pageCount
  ) {
    throw new RangeError('displayPageNumber must be one-based and within pageCount.');
  }

  return displayPageNumber - 1;
}

/**
 * Parses a page-number text field. NFKC permits full-width digits while still
 * rejecting signs, decimals, exponents and partial numeric strings.
 */
export function parseDisplayPageInput(
  input: string,
  pageCount: number,
): ValidationResult<number, PageInputError> {
  if (!isValidPageCount(pageCount)) {
    return { ok: false, code: 'out-of-range' };
  }

  const normalized = input.normalize('NFKC').trim();
  if (normalized.length === 0) {
    return { ok: false, code: 'empty' };
  }

  if (!/^\d+$/u.test(normalized)) {
    return { ok: false, code: 'not-integer' };
  }

  const displayPageNumber = Number(normalized);
  if (!Number.isSafeInteger(displayPageNumber)) {
    return { ok: false, code: 'unsafe-integer' };
  }

  if (displayPageNumber < 1 || displayPageNumber > pageCount) {
    return { ok: false, code: 'out-of-range' };
  }

  return {
    ok: true,
    value: displayPageNumberToIndex(displayPageNumber, pageCount),
  };
}

