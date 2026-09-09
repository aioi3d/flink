#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export class WorkflowPolicyError extends Error {
  constructor(messages) {
    super(messages.join('\n'));
    this.name = 'WorkflowPolicyError';
    this.messages = messages;
  }
}

function requirePattern(errors, text, pattern, message) {
  if (!pattern.test(text)) {
    errors.push(message);
  }
}

function rejectPattern(errors, text, pattern, message) {
  if (pattern.test(text)) {
    errors.push(message);
  }
}

function validateActionVersions(errors, fileName, text) {
  const checkouts = [...text.matchAll(/uses:\s*actions\/checkout@([^\s#]+)/g)].map(
    (match) => match[1],
  );
  const nodeSetups = [...text.matchAll(/uses:\s*actions\/setup-node@([^\s#]+)/g)].map(
    (match) => match[1],
  );

  if (checkouts.length === 0) {
    errors.push(`${fileName}: actions/checkout is required.`);
  }
  for (const version of checkouts) {
    if (version !== 'v6.0.3' && version !== 'v6.0.2') {
      errors.push(`${fileName}: actions/checkout must use verified tag v6.0.3 or v6.0.2.`);
    }
  }
  if (nodeSetups.length === 0) {
    errors.push(`${fileName}: actions/setup-node is required.`);
  }
  for (const version of nodeSetups) {
    if (version !== 'v7.0.0') {
      errors.push(`${fileName}: actions/setup-node must use verified tag v7.0.0.`);
    }
  }
  requirePattern(
    errors,
    text,
    /node-version:\s*24\.18\.0\b/,
    `${fileName}: Node.js must be pinned to 24.18.0.`,
  );
  requirePattern(
    errors,
    text,
    /npm install --global npm@11\.16\.0/,
    `${fileName}: the exact npm version must be installed.`,
  );
  requirePattern(
    errors,
    text,
    /npm --version[\s\S]{0,80}11\.16\.0/,
    `${fileName}: the installed npm version must be verified.`,
  );
}

function validateForbiddenCapabilities(errors, fileName, text) {
  const forbidden = [
    [/actions\/upload-artifact@/i, 'must not use Actions artifact upload'],
    [/\beas\s+(?:build|submit|update)\b/i, 'must not invoke EAS build, submit, or update'],
    [/secrets\.(?:APPLE|ASC|APP_STORE|MATCH|FASTLANE|P12|PROVISION)/i, 'must not request Apple signing secrets'],
    [/\.(?:p12|mobileprovision)\b/i, 'must not handle signing certificate/profile files'],
    [/CODE_SIGNING_ALLOWED\s*=\s*YES/i, 'must not enable code signing'],
    [/-allowProvisioningUpdates\b/i, 'must not allow provisioning updates'],
  ];
  for (const [pattern, message] of forbidden) {
    rejectPattern(errors, text, pattern, `${fileName}: ${message}.`);
  }
}

export function validateWorkflowPolicy({ checksText, buildText, allWorkflows = [] }) {
  const errors = [];
  for (const workflow of allWorkflows) {
    validateForbiddenCapabilities(errors, workflow.name, workflow.text);
    validateActionVersions(errors, workflow.name, workflow.text);
  }

  requirePattern(
    errors,
    checksText,
    /runs-on:\s*ubuntu-24\.04\b/,
    'checks.yml: checks must use the pinned Linux runner.',
  );
  rejectPattern(
    errors,
    checksText,
    /runs-on:\s*macos-/,
    'checks.yml: ordinary checks must never start a macOS runner.',
  );
  requirePattern(errors, checksText, /\bpush\s*:/, 'checks.yml: push trigger is missing.');
  requirePattern(
    errors,
    checksText,
    /\bpull_request\s*:/,
    'checks.yml: pull_request trigger is missing.',
  );
  rejectPattern(
    errors,
    checksText,
    /contents:\s*write/,
    'checks.yml: checks must not have write permission.',
  );

  requirePattern(
    errors,
    buildText,
    /tags:\s*(?:\[\s*['"]v\*['"]\s*\]|\r?\n\s*-\s*['"]v\*['"])/,
    'build-ios-ipa.yml: only v* tag pushes may trigger the production preflight.',
  );
  rejectPattern(
    errors,
    buildText,
    /tags:\s*(?:\[[^\]]*dev-runtime|\r?\n\s*-\s*['"]dev-runtime)/,
    'build-ios-ipa.yml: development tag pushes must not trigger native work.',
  );
  requirePattern(
    errors,
    buildText,
    /workflow_dispatch\s*:/,
    'build-ios-ipa.yml: manual dispatch is missing.',
  );
  for (const inputName of ['tag', 'profile', 'reason']) {
    requirePattern(
      errors,
      buildText,
      new RegExp(`\\n {6}${inputName}:\\r?\\n[\\s\\S]{0,240}?required:\\s*true`),
      `build-ios-ipa.yml: required dispatch input ${inputName} is missing.`,
    );
  }
  requirePattern(
    errors,
    buildText,
    /options:\s*\r?\n\s*-\s*development\s*\r?\n\s*-\s*production/,
    'build-ios-ipa.yml: profile choices must be development and production.',
  );
  requirePattern(
    errors,
    buildText,
    /ref:\s*refs\/tags\/\$\{\{\s*env\.FLINK_TAG\s*\}\}/,
    'build-ios-ipa.yml: the requested tag must be checked out through an explicit tag ref.',
  );
  requirePattern(
    errors,
    buildText,
    /validate-build-inputs\.mjs/,
    'build-ios-ipa.yml: build-input validation is missing.',
  );
  const workflowSourceCheckout = buildText.indexOf(
    'name: Check out workflow source for trusted validation',
  );
  const trustedInputValidation = buildText.indexOf(
    'node scripts/ci/validate-build-inputs.mjs --skip-app-version',
  );
  const requestedTagCheckout = buildText.indexOf(
    'name: Check out the requested existing tag',
  );
  const taggedInputValidation = buildText.lastIndexOf(
    'node scripts/ci/validate-build-inputs.mjs',
  );
  if (
    workflowSourceCheckout < 0 ||
    trustedInputValidation <= workflowSourceCheckout ||
    requestedTagCheckout <= trustedInputValidation ||
    taggedInputValidation <= requestedTagCheckout ||
    taggedInputValidation === trustedInputValidation
  ) {
    errors.push(
      'build-ios-ipa.yml: inputs must be validated from workflow source before tag checkout and revalidated from tagged source.',
    );
  }
  requirePattern(
    errors,
    buildText,
    /git show-ref --verify "\$tag_ref"/,
    'build-ios-ipa.yml: existing tag verification is missing.',
  );
  requirePattern(
    errors,
    buildText,
    /git rev-parse HEAD/,
    'build-ios-ipa.yml: checked-out source SHA recording is missing.',
  );
  rejectPattern(
    errors,
    buildText,
    /run\s*:[^\r\n]*\$\{\{[^\r\n]*inputs\./,
    'build-ios-ipa.yml: dispatch inputs must enter shell only through environment variables.',
  );
  rejectPattern(
    errors,
    buildText,
    /runs-on:\s*macos-|\bxcodebuild\b|\bgh\s+release\b/,
    'build-ios-ipa.yml: Phase 1 draft must not build or publish native output.',
  );
  requirePattern(
    errors,
    buildText,
    /FLINK_PHASE_1_NATIVE_BUILD_UNAVAILABLE/,
    'build-ios-ipa.yml: explicit Phase 1 native-build gate is missing.',
  );
  requirePattern(
    errors,
    buildText,
    /exit\s+1/,
    'build-ios-ipa.yml: the Phase 1 draft must fail rather than report a false build success.',
  );
  rejectPattern(
    errors,
    buildText,
    /contents:\s*write/,
    'build-ios-ipa.yml: Phase 1 preflight must not have release write permission.',
  );

  if (errors.length > 0) {
    throw new WorkflowPolicyError(errors);
  }
  return {
    testIds: ['TC-D05', 'TC-D06', 'TC-D07'],
    workflowCount: allWorkflows.length,
  };
}

async function run() {
  const workflowDirectory = path.join(PROJECT_ROOT, '.github', 'workflows');
  const workflowNames = (await readdir(workflowDirectory))
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();
  const allWorkflows = await Promise.all(
    workflowNames.map(async (name) => ({
      name,
      text: await readFile(path.join(workflowDirectory, name), 'utf8'),
    })),
  );
  const checksText = allWorkflows.find((workflow) => workflow.name === 'checks.yml')?.text;
  const buildText = allWorkflows.find(
    (workflow) => workflow.name === 'build-ios-ipa.yml',
  )?.text;
  if (!checksText || !buildText) {
    throw new WorkflowPolicyError([
      'Both .github/workflows/checks.yml and build-ios-ipa.yml are required.',
    ]);
  }

  const result = validateWorkflowPolicy({ checksText, buildText, allWorkflows });
  console.log(
    `Workflow policy verified (${result.testIds.join(', ')}; ${result.workflowCount} workflows).`,
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await run();
  } catch (error) {
    if (error instanceof WorkflowPolicyError) {
      for (const message of error.messages) {
        console.error(message);
      }
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
