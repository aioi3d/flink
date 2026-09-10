import { describe, expect, it } from 'vitest';

import {
  FlinkNativeError,
  formatNativeErrorForDisplay,
  normalizeNativeError,
} from '../../src/native/errors';

describe('native error normalization', () => {
  it('maps a known native code without copying an arbitrary native message', () => {
    const error = Object.assign(new Error('C:\\private\\secret.pdf'), {
      code: 'E_FILE_CHANGED',
    });

    const normalized = normalizeNativeError(error, 'openDocument');

    expect(normalized).toBeInstanceOf(FlinkNativeError);
    expect(normalized).toMatchObject({
      code: 'E_FILE_CHANGED',
      operation: 'openDocument',
      recoverable: true,
    });
    expect(normalized.message).not.toContain('secret.pdf');
    expect(normalized.detail).toBeUndefined();
  });

  it('fails closed for an unknown bridge failure', () => {
    const normalized = normalizeNativeError(
      Object.assign(new Error('unknown'), { code: 'E_UNRECOGNIZED' }),
      'scanLibrary',
    );

    expect(normalized).toMatchObject({
      code: 'E_UNRECOGNIZED',
      operation: 'scanLibrary',
      recoverable: false,
    });
    expect(normalized.toJSON()).toEqual({
      code: 'E_UNRECOGNIZED',
      operation: 'scanLibrary',
      recoverable: false,
    });
  });

  it('treats the Expo native-view mount race as recoverable without leaking details', () => {
    const normalized = normalizeNativeError(
      Object.assign(new Error('Unable to find view with tag 42'), {
        code: 'ERR_VIEW_NOT_FOUND',
      }),
      'openDocument',
    );

    expect(normalized).toMatchObject({
      code: 'ERR_VIEW_NOT_FOUND',
      operation: 'openDocument',
      recoverable: true,
    });
    expect(normalized.message).toBe(
      'PDFビューを準備できませんでした。ライブラリへ戻って、もう一度開いてください。',
    );
    expect(normalized.message).not.toContain('42');
  });

  it('keeps an allowlisted path diagnostic while discarding the native message', () => {
    const error = Object.assign(
      new Error(
        "FunctionCallException: Calling the 'renameDocument' function has failed (at ExpoModulesCore/ConcurrentFunctionDefinition.swift:88)\n→ Caused by: operation=renameDocument;diagnostic=path.v1.coordinated-parent-identity",
      ),
      { code: 'E_PATH_OUTSIDE_LIBRARY' },
    );

    const normalized = normalizeNativeError(error, 'renameDocument');
    const display = formatNativeErrorForDisplay(normalized);

    expect(normalized).toMatchObject({
      code: 'E_PATH_OUTSIDE_LIBRARY',
      operation: 'renameDocument',
      detail: 'path.v1.coordinated-parent-identity',
    });
    expect(normalized.toJSON()).toMatchObject({
      detail: 'path.v1.coordinated-parent-identity',
    });
    expect(display).toContain('親フォルダが開始時に確認した場所と一致しなくなりました。');
    expect(display).toContain('path.v1.coordinated-parent-identity');
    expect(display).not.toContain('FunctionCallException');
    expect(display).not.toContain('ConcurrentFunctionDefinition.swift');
  });

  it('rejects malformed, mismatched, and path-bearing native diagnostics', () => {
    const rejected = [
      Object.assign(
        new Error(
          'operation=deleteDocument;diagnostic=path.v1.coordinated-parent-identity',
        ),
        { code: 'E_PATH_OUTSIDE_LIBRARY' },
      ),
      Object.assign(
        new Error(
          "FunctionCallException: Calling the 'deleteDocument' function has failed (at ExpoModulesCore/ConcurrentFunctionDefinition.swift:88)\n→ Caused by: operation=renameDocument;diagnostic=path.v1.coordinated-parent-identity",
        ),
        { code: 'E_PATH_OUTSIDE_LIBRARY' },
      ),
      Object.assign(
        new Error(
          'operation=renameDocument;diagnostic=path.v1.coordinated-parent-identity/private/secret.pdf',
        ),
        { code: 'E_PATH_OUTSIDE_LIBRARY' },
      ),
      Object.assign(
        new Error('operation=renameDocument;diagnostic=path.v1.unknown-check'),
        { code: 'E_PATH_OUTSIDE_LIBRARY' },
      ),
      Object.assign(
        new Error(
          'operation=renameDocument;diagnostic=path.v1.coordinated-parent-identity\n/private/secret.pdf',
        ),
        { code: 'E_PATH_OUTSIDE_LIBRARY' },
      ),
      Object.assign(
        new Error(
          'operation=renameDocument;diagnostic=path.v1.coordinated-parent-identity',
        ),
        { code: 'E_FILE_CHANGED' },
      ),
    ];

    for (const error of rejected) {
      const normalized = normalizeNativeError(error, 'renameDocument');
      expect(normalized.detail).toBeUndefined();
      expect(formatNativeErrorForDisplay(normalized)).not.toContain('診断:');
      expect(formatNativeErrorForDisplay(normalized)).not.toContain('secret.pdf');
    }
  });

  it('does not render an unsafe structured detail', () => {
    const normalized = new FlinkNativeError({
      code: 'E_PATH_OUTSIDE_LIBRARY',
      operation: 'renameDocument',
      recoverable: false,
      detail: 'file:///private/secret.pdf',
    });

    const display = formatNativeErrorForDisplay(normalized);
    expect(display).toBe('E_PATH_OUTSIDE_LIBRARY: 対象のファイルは操作できません。');
    expect(display).not.toContain('secret.pdf');
  });
});
