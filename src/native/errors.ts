import type { FlinkError } from './contracts';

const NATIVE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  E_NATIVE_RUNTIME_MISMATCH:
    'インストール済みの開発ランタイムを更新してください。',
  NOT_IMPLEMENTED: 'このネイティブ機能は Phase 2 で実装されます。',
};

export class FlinkNativeError extends Error implements FlinkError {
  readonly code: string;
  readonly operation: string;
  readonly recoverable: boolean;
  readonly detail?: string;

  constructor(error: FlinkError, message?: string) {
    super(message ?? NATIVE_ERROR_MESSAGES[error.code] ?? 'ネイティブ処理に失敗しました。');
    this.name = 'FlinkNativeError';
    this.code = error.code;
    this.operation = error.operation;
    this.recoverable = error.recoverable;
    this.detail = error.detail;
  }

  toJSON(): FlinkError {
    return {
      code: this.code,
      operation: this.operation,
      recoverable: this.recoverable,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

function isContractError(error: unknown): error is FlinkError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as Partial<FlinkError>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.operation === 'string' &&
    typeof candidate.recoverable === 'boolean' &&
    (candidate.detail === undefined || typeof candidate.detail === 'string')
  );
}

function readNativeCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * Normalizes bridge failures without copying arbitrary native messages. Those
 * messages may contain an absolute sandbox path or document metadata.
 */
export function normalizeNativeError(
  error: unknown,
  operation: string,
): FlinkNativeError {
  if (error instanceof FlinkNativeError) {
    return error;
  }

  if (isContractError(error)) {
    return new FlinkNativeError(error);
  }

  return new FlinkNativeError({
    code: readNativeCode(error) ?? 'E_NATIVE_UNKNOWN',
    operation,
    recoverable: false,
  });
}
