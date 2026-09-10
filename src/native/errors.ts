import type { FlinkError } from './contracts';

const NATIVE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  E_LIBRARY_PATH_BLOCKED:
    'ライブラリフォルダを作成できません。同名のファイルがないか確認してください。',
  E_LIBRARY_UNAVAILABLE:
    'ライブラリを読み取れません。もう一度お試しください。',
  E_IMPORT_PERMISSION: '選択したファイルへアクセスできません。',
  E_PROVIDER_UNAVAILABLE:
    'ファイルを取得できません。接続やダウンロード状態を確認してください。',
  E_NO_SPACE: '空き容量が不足しています。',
  E_NOT_PDF: 'PDFファイルを選択してください。',
  E_PDF_LOCKED: 'パスワード付きPDFは未対応です。',
  E_PDF_INVALID: 'PDFを読み込めません。破損または未対応の形式です。',
  E_PDF_EMPTY: 'ページがないPDFです。',
  E_FILE_MISSING: 'ファイルが削除または移動されました。',
  E_FILE_CHANGED: 'ファイルが変更されました。選び直してください。',
  E_NAME_INVALID: '使用できないファイル名です。',
  E_NAME_CONFLICT: '同じ名前のファイルがあります。',
  E_PATH_OUTSIDE_LIBRARY: '対象のファイルは操作できません。',
  E_IMPORT_BUSY: '別のファイル取り込みが進行中です。',
  E_THUMBNAIL_QUEUE_FULL: 'サムネイルの要求が混み合っています。',
  E_INVALID_ARGUMENT: '操作内容が正しくありません。',
  E_AR_UNSUPPORTED: 'この端末では瞬き操作を利用できません。',
  E_CAMERA_DENIED: 'カメラへのアクセスが許可されていません。',
  E_CAMERA_RESTRICTED: 'カメラの使用が制限されています。',
  E_AR_INTERRUPTED: '瞬き操作が中断されました。',
  E_TRACKING_STOPPED: '顔の追跡が停止しています。',
  E_NATIVE_RUNTIME_MISMATCH:
    'インストール済みの開発ランタイムを更新してください。',
};

const RECOVERABLE_NATIVE_CODES = new Set([
  'E_LIBRARY_PATH_BLOCKED',
  'E_LIBRARY_UNAVAILABLE',
  'E_IMPORT_PERMISSION',
  'E_PROVIDER_UNAVAILABLE',
  'E_NO_SPACE',
  'E_NOT_PDF',
  'E_PDF_LOCKED',
  'E_PDF_INVALID',
  'E_PDF_EMPTY',
  'E_FILE_MISSING',
  'E_FILE_CHANGED',
  'E_NAME_INVALID',
  'E_NAME_CONFLICT',
  'E_IMPORT_BUSY',
  'E_THUMBNAIL_QUEUE_FULL',
  'E_CAMERA_DENIED',
  'E_AR_INTERRUPTED',
  'E_TRACKING_STOPPED',
]);

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

  const code = readNativeCode(error) ?? 'E_NATIVE_UNKNOWN';
  return new FlinkNativeError({
    code,
    operation,
    recoverable: RECOVERABLE_NATIVE_CODES.has(code),
  });
}
