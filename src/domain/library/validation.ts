import type { ValidationResult } from '../validation';

export const PDF_EXTENSION = '.pdf';
export const DEFAULT_MAX_FILE_NAME_UTF8_BYTES = 255;

export type PdfBaseNameValidationError =
  | 'empty'
  | 'dot-segment'
  | 'path-separator'
  | 'control-character'
  | 'unpaired-surrogate'
  | 'too-long';

export type PdfRenameDecisionError = PdfBaseNameValidationError | 'name-conflict';

export interface PdfRenameValue {
  baseName: string;
  fileName: string;
}

export interface PdfRenameDecision extends PdfRenameValue {
  noOp: boolean;
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function validatePdfBaseName(
  baseName: string,
  maxFileNameUtf8Bytes = DEFAULT_MAX_FILE_NAME_UTF8_BYTES,
): ValidationResult<string, PdfBaseNameValidationError> {
  if (baseName.trim().length === 0) {
    return { ok: false, code: 'empty' };
  }

  if (baseName === '.' || baseName === '..') {
    return { ok: false, code: 'dot-segment' };
  }

  if (baseName.includes('/') || baseName.includes('\\')) {
    return { ok: false, code: 'path-separator' };
  }

  if (/[\u0000-\u001f\u007f-\u009f]/u.test(baseName)) {
    return { ok: false, code: 'control-character' };
  }

  if (containsUnpairedSurrogate(baseName)) {
    return { ok: false, code: 'unpaired-surrogate' };
  }

  if (
    !Number.isSafeInteger(maxFileNameUtf8Bytes) ||
    maxFileNameUtf8Bytes < utf8ByteLength(PDF_EXTENSION) ||
    utf8ByteLength(`${baseName}${PDF_EXTENSION}`) > maxFileNameUtf8Bytes
  ) {
    return { ok: false, code: 'too-long' };
  }

  return { ok: true, value: baseName };
}

/** Accepts either the UI's basename or a pasted name ending in .pdf. */
export function parsePdfRenameInput(
  input: string,
  maxFileNameUtf8Bytes = DEFAULT_MAX_FILE_NAME_UTF8_BYTES,
): ValidationResult<PdfRenameValue, PdfBaseNameValidationError> {
  const baseName = input.toLocaleLowerCase('en-US').endsWith(PDF_EXTENSION)
    ? input.slice(0, -PDF_EXTENSION.length)
    : input;
  const result = validatePdfBaseName(baseName, maxFileNameUtf8Bytes);

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    value: {
      baseName: result.value,
      fileName: `${result.value}${PDF_EXTENSION}`,
    },
  };
}

function fileSystemComparisonKey(fileName: string): string {
  return fileName.normalize('NFD').toLocaleLowerCase('en-US');
}

/**
 * Evaluates rename input without mutating a file. `otherFileNames` must exclude
 * the file currently being renamed, which keeps case-only renames possible.
 */
export function decidePdfRename(
  input: string,
  currentFileName: string,
  otherFileNames: readonly string[],
  maxFileNameUtf8Bytes = DEFAULT_MAX_FILE_NAME_UTF8_BYTES,
): ValidationResult<PdfRenameDecision, PdfRenameDecisionError> {
  const parsed = parsePdfRenameInput(input, maxFileNameUtf8Bytes);
  if (!parsed.ok) {
    return parsed;
  }

  const candidateKey = fileSystemComparisonKey(parsed.value.fileName);
  if (otherFileNames.some((name) => fileSystemComparisonKey(name) === candidateKey)) {
    return { ok: false, code: 'name-conflict' };
  }

  return {
    ok: true,
    value: {
      ...parsed.value,
      noOp: parsed.value.fileName === currentFileName,
    },
  };
}
