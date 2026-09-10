import { describe, expect, it } from 'vitest';

import { FlinkNativeError, normalizeNativeError } from '../../src/native/errors';

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
});
