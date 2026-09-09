import { describe, expect, it } from 'vitest';

import {
  BuildInputError,
  validateBuildInputs,
} from '../../scripts/ci/validate-build-inputs.mjs';

const production = {
  eventName: 'push',
  tag: 'v1.0.0',
  profile: 'production',
  reason: 'production tag push',
  githubRef: 'refs/tags/v1.0.0',
  appVersion: '1.0.0',
};

describe('build input contract (TC-D07)', () => {
  it('accepts an exact production tag push', () => {
    expect(validateBuildInputs(production)).toEqual({
      eventName: 'push',
      tag: 'v1.0.0',
      tagRef: 'refs/tags/v1.0.0',
      profile: 'production',
      reason: 'production tag push',
      version: '1.0.0',
    });
  });

  it('accepts development only through explicit dispatch', () => {
    expect(
      validateBuildInputs({
        eventName: 'workflow_dispatch',
        tag: 'dev-runtime-v1.2.3',
        profile: 'development',
        reason: 'first native runtime check',
        githubRef: 'refs/heads/main',
        appVersion: '1.0.0',
      }),
    ).toMatchObject({
      tagRef: 'refs/tags/dev-runtime-v1.2.3',
      profile: 'development',
      version: '1.2.3',
    });
  });

  it.each([
    ['v1.0.0;echo unsafe', 'production'],
    ['-v1.0.0', 'production'],
    ['dev-runtime-v1.0.0', 'production'],
    ['v1.0.0', 'development'],
    ['v01.0.0', 'production'],
  ])('rejects invalid tag/profile pair %s / %s', (tag, profile) => {
    expect(() =>
      validateBuildInputs({
        ...production,
        eventName: 'workflow_dispatch',
        githubRef: 'refs/heads/main',
        tag,
        profile,
      }),
    ).toThrow(BuildInputError);
  });

  it('rejects a branch ref masquerading as the pushed tag', () => {
    expect(() =>
      validateBuildInputs({ ...production, githubRef: 'refs/heads/v1.0.0' }),
    ).toThrow(/exactly match/);
  });

  it('rejects production tag and app version drift', () => {
    expect(() =>
      validateBuildInputs({ ...production, tag: 'v1.0.1', githubRef: 'refs/tags/v1.0.1' }),
    ).toThrow(/does not match Expo app version/);
  });

  it('defers app-version comparison during trusted pre-checkout validation', () => {
    expect(
      validateBuildInputs({
        ...production,
        tag: 'v1.0.1',
        githubRef: 'refs/tags/v1.0.1',
        appVersion: null,
      }),
    ).toMatchObject({ version: '1.0.1', profile: 'production' });
  });

  it('rejects multiline reasons before they reach a shell', () => {
    expect(() =>
      validateBuildInputs({ ...production, reason: 'line one\nline two' }),
    ).toThrow(/control characters/);
  });
});
