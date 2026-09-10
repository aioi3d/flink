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
let buildScriptText;
let publishScriptText;
let signatureScriptText;
let inputScriptText;

function validate(overrides = {}) {
  const checks = overrides.checksText ?? checksText;
  const build = overrides.buildText ?? buildText;
  return validateWorkflowPolicy({
    checksText: checks,
    buildText: build,
    buildScriptText: overrides.buildScriptText ?? buildScriptText,
    publishScriptText: overrides.publishScriptText ?? publishScriptText,
    signatureScriptText: overrides.signatureScriptText ?? signatureScriptText,
    inputScriptText: overrides.inputScriptText ?? inputScriptText,
    allWorkflows: [
      { name: 'checks.yml', text: checks },
      { name: 'build-ios-ipa.yml', text: build },
    ],
  });
}

beforeAll(async () => {
  [
    checksText,
    buildText,
    buildScriptText,
    publishScriptText,
    signatureScriptText,
    inputScriptText,
  ] = await Promise.all([
    readFile(path.join(ROOT, '.github', 'workflows', 'checks.yml'), 'utf8'),
    readFile(path.join(ROOT, '.github', 'workflows', 'build-ios-ipa.yml'), 'utf8'),
    readFile(path.join(ROOT, 'scripts', 'ci', 'build-ios-release.mjs'), 'utf8'),
    readFile(path.join(ROOT, 'scripts', 'ci', 'publish-release.mjs'), 'utf8'),
    readFile(path.join(ROOT, 'scripts', 'ci', 'resolve-native-signature.mjs'), 'utf8'),
    readFile(path.join(ROOT, 'scripts', 'ci', 'validate-build-inputs.mjs'), 'utf8'),
  ]);
});

describe('workflow policy (TC-D02 and TC-D05 through TC-D08)', () => {
  it('accepts the checked-in Phase 2 workflows and build scripts', () => {
    expect(validate()).toMatchObject({
      testIds: ['TC-D02', 'TC-D05', 'TC-D06', 'TC-D07', 'TC-D08'],
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

  it('requires the signature producer and workflow consumer to use the same output', () => {
    expect(() =>
      validate({
        signatureScriptText: signatureScriptText.replace(
          "appendOutput('signature', result.signature)",
          "appendOutput('other_name', result.signature)",
        ),
      }),
    ).toThrow(WorkflowPolicyError);
  });

  it('requires the validated runtime version to reach Expo prebuild', () => {
    expect(() =>
      validate({
        inputScriptText: inputScriptText.replace(
          'native_runtime_version=${nativeRuntime.nativeRuntimeVersion}',
          'runtime_version=${nativeRuntime.nativeRuntimeVersion}',
        ),
      }),
    ).toThrow(WorkflowPolicyError);
  });

  it('requires checkout credentials to be discarded', () => {
    expect(() =>
      validate({
        checksText: checksText.replace('persist-credentials: false', 'persist-credentials: true'),
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

  it('requires a device build with signing disabled', () => {
    expect(() =>
      validate({
        buildScriptText: buildScriptText.replace(
          "'CODE_SIGNING_ALLOWED=NO'",
          "'CODE_SIGNING_ALLOWED=YES'",
        ),
      }),
    ).toThrow(WorkflowPolicyError);
  });

  it('requires immutable-release and source-provenance protection', () => {
    expect(() =>
      validate({
        publishScriptText: publishScriptText
          .replaceAll('immutable', 'changeable')
          .replaceAll('sourceCommit', 'sourceRevision'),
      }),
    ).toThrow(WorkflowPolicyError);
  });

  it('requires remote tag revalidation and explicit repository targeting', () => {
    expect(() =>
      validate({
        publishScriptText: publishScriptText
          .replaceAll('git/ref/tags', 'removed/tag/check')
          .replaceAll("'--repo'", "'--target-repository'"),
      }),
    ).toThrow(WorkflowPolicyError);
  });
});
