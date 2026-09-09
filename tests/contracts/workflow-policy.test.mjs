import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  WorkflowPolicyError,
  validateWorkflowPolicy,
} from '../../scripts/ci/validate-workflows.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let checksText;
let buildText;

function validate(overrides = {}) {
  const checks = overrides.checksText ?? checksText;
  const build = overrides.buildText ?? buildText;
  return validateWorkflowPolicy({
    checksText: checks,
    buildText: build,
    allWorkflows: [
      { name: 'checks.yml', text: checks },
      { name: 'build-ios-ipa.yml', text: build },
    ],
  });
}

beforeAll(async () => {
  [checksText, buildText] = await Promise.all([
    readFile(path.join(ROOT, '.github', 'workflows', 'checks.yml'), 'utf8'),
    readFile(path.join(ROOT, '.github', 'workflows', 'build-ios-ipa.yml'), 'utf8'),
  ]);
});

describe('workflow policy (TC-D05 through TC-D07)', () => {
  it('accepts the checked-in Phase 1 workflows', () => {
    expect(validate()).toMatchObject({
      testIds: ['TC-D05', 'TC-D06', 'TC-D07'],
      workflowCount: 2,
    });
  });

  it('rejects an unverified official action tag', () => {
    expect(() =>
      validate({ checksText: checksText.replace('checkout@v6.0.3', 'checkout@v99') }),
    ).toThrow(WorkflowPolicyError);
  });

  it('rejects an unpinned npm toolchain', () => {
    expect(() =>
      validate({
        checksText: checksText.replace(
          'npm install --global npm@11.16.0',
          'npm install --global npm@latest',
        ),
      }),
    ).toThrow(WorkflowPolicyError);
  });

  it('requires trusted input validation before requested tag checkout', () => {
    expect(() =>
      validate({
        buildText: buildText.replace(
          'node scripts/ci/validate-build-inputs.mjs --skip-app-version',
          'node scripts/ci/validate-build-inputs.mjs',
        ),
      }),
    ).toThrow(WorkflowPolicyError);
  });

  it('rejects development tag push triggers and branch-like checkout', () => {
    const unsafe = buildText
      .replace("- 'v*'", "- 'dev-runtime-v*'")
      .replace('ref: refs/tags/${{ env.FLINK_TAG }}', 'ref: ${{ env.FLINK_TAG }}');
    expect(() => validate({ buildText: unsafe })).toThrow(WorkflowPolicyError);
  });

  it('rejects forbidden artifact and signing paths', () => {
    const unsafe = `${buildText}\n# uses: actions/upload-artifact@v4\n# secrets.APPLE_CERT\n`;
    expect(() => validate({ buildText: unsafe })).toThrow(WorkflowPolicyError);
  });

  it('requires the Phase 1 draft to fail explicitly before native work', () => {
    const unsafe = buildText
      .replace('FLINK_PHASE_1_NATIVE_BUILD_UNAVAILABLE', 'native phase ready')
      .replace('exit 1', 'exit 0');
    expect(() => validate({ buildText: unsafe })).toThrow(WorkflowPolicyError);
  });
});
