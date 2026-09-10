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
  const disabledCredentialPersistence = [
    ...text.matchAll(/persist-credentials:\s*false\b/g),
  ].length;
  if (disabledCredentialPersistence !== checkouts.length) {
    errors.push(
      `${fileName}: every checkout must disable persisted Git credentials.`,
    );
  }
  if (nodeSetups.length === 0) {
    errors.push(`${fileName}: actions/setup-node is required.`);
  }
  for (const version of nodeSetups) {
    if (version !== 'v7.0.0') {
      errors.push(`${fileName}: actions/setup-node must use verified tag v7.0.0.`);
    }
  }
  requirePattern(errors, text, /node-version:\s*24\.18\.0\b/, `${fileName}: Node.js must be pinned to 24.18.0.`);
  requirePattern(errors, text, /npm install --global npm@11\.16\.0/, `${fileName}: npm must be pinned to 11.16.0.`);
  requirePattern(errors, text, /npm --version[\s\S]{0,100}11\.16\.0/, `${fileName}: npm version must be verified.`);
}

function validateForbiddenCapabilities(errors, fileName, text) {
  const forbidden = [
    [/actions\/upload-artifact@/i, 'must not use Actions artifact upload'],
    [/actions\/download-artifact@/i, 'must not use Actions artifact download'],
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

export function validateWorkflowPolicy({
  checksText,
  buildText,
  buildScriptText = '',
  publishScriptText = '',
  signatureScriptText = '',
  inputScriptText = '',
  allWorkflows = [],
}) {
  const errors = [];
  for (const workflow of allWorkflows) {
    validateForbiddenCapabilities(errors, workflow.name, workflow.text);
    validateActionVersions(errors, workflow.name, workflow.text);
  }
  validateForbiddenCapabilities(errors, 'publish-release.mjs', publishScriptText);
  rejectPattern(
    errors,
    buildScriptText,
    /(?:security\s+import|codesign[\s\S]{0,80}\s-s\s|CODE_SIGNING_ALLOWED\s*=\s*YES|-allowProvisioningUpdates)/i,
    'build-ios-release.mjs: must not import or request signing credentials.',
  );

  requirePattern(errors, checksText, /runs-on:\s*ubuntu-24\.04\b/, 'checks.yml: checks must use Ubuntu 24.04.');
  rejectPattern(errors, checksText, /runs-on:\s*macos-/, 'checks.yml: ordinary checks must never start macOS.');
  requirePattern(errors, checksText, /\bpush\s*:/, 'checks.yml: push trigger is missing.');
  requirePattern(errors, checksText, /\bpull_request\s*:/, 'checks.yml: pull_request trigger is missing.');
  rejectPattern(errors, checksText, /contents:\s*write/, 'checks.yml: checks must not have write permission.');
  requirePattern(errors, checksText, /^permissions:\s*\r?\n\s*contents:\s*read\s*$/m, 'checks.yml: default permissions must be contents: read.');

  requirePattern(errors, buildText, /tags:\s*(?:\[\s*['"]v\*['"]\s*\]|\r?\n\s*-\s*['"]v\*['"])/, 'build-ios-ipa.yml: only v* tag pushes may trigger production.');
  rejectPattern(errors, buildText, /tags:\s*(?:\[[^\]]*dev-runtime|\r?\n\s*-\s*['"]dev-runtime)/, 'build-ios-ipa.yml: development tag pushes must not trigger native work.');
  rejectPattern(errors, buildText, /^[ \t]+branches(?:-ignore)?:[ \t]*/m, 'build-ios-ipa.yml: branch pushes must not start native builds.');
  requirePattern(errors, buildText, /workflow_dispatch\s*:/, 'build-ios-ipa.yml: manual dispatch is missing.');
  rejectPattern(errors, buildText, /^\s*pull_request\s*:/m, 'build-ios-ipa.yml: pull requests must not start native builds.');
  requirePattern(errors, buildText, /^permissions:\s*\r?\n\s*contents:\s*read\s*$/m, 'build-ios-ipa.yml: default permissions must be contents: read.');
  if ([...buildText.matchAll(/contents:\s*write\b/g)].length !== 1) {
    errors.push('build-ios-ipa.yml: contents: write must appear exactly once.');
  }
  for (const inputName of ['tag', 'profile', 'reason']) {
    requirePattern(
      errors,
      buildText,
      new RegExp(`\\n {6}${inputName}:\\r?\\n[\\s\\S]{0,240}?required:\\s*true`),
      `build-ios-ipa.yml: required dispatch input ${inputName} is missing.`,
    );
  }
  requirePattern(errors, buildText, /options:\s*\r?\n\s*-\s*development\s*\r?\n\s*-\s*production/, 'build-ios-ipa.yml: profile choices must be development and production.');

  const trustedCheckout = buildText.indexOf('name: Check out workflow source for trusted validation');
  const trustedValidation = buildText.indexOf('validate-build-inputs.mjs --skip-app-version');
  const tagCheckout = buildText.indexOf('name: Check out the requested existing tag');
  const taggedValidation = buildText.indexOf('validate-build-inputs.mjs --github-output');
  if (
    trustedCheckout < 0 ||
    trustedValidation <= trustedCheckout ||
    tagCheckout <= trustedValidation ||
    taggedValidation <= tagCheckout
  ) {
    errors.push('build-ios-ipa.yml: trusted validation, exact tag checkout, and tagged validation are out of order.');
  }
  requirePattern(errors, buildText, /ref:\s*refs\/tags\/\$\{\{\s*env\.FLINK_TAG\s*\}\}/, 'build-ios-ipa.yml: preflight must check out an explicit validated tag ref.');
  requirePattern(errors, buildText, /git show-ref --verify "\$tag_ref"/, 'build-ios-ipa.yml: existing tag verification is missing.');
  requirePattern(errors, buildText, /git rev-parse HEAD/, 'build-ios-ipa.yml: checked-out source SHA recording is missing.');
  rejectPattern(errors, buildText, /run\s*:[^\r\n]*\$\{\{[^\r\n]*inputs\./, 'build-ios-ipa.yml: dispatch inputs must reach shell through environment variables.');

  requirePattern(errors, buildText, /runs-on:\s*macos-26\b/, 'build-ios-ipa.yml: native build must use macos-26.');
  requirePattern(errors, buildText, /timeout-minutes:\s*90\b/, 'build-ios-ipa.yml: native build timeout must be 90 minutes.');
  requirePattern(errors, buildText, /needs:\s*preflight\b/, 'build-ios-ipa.yml: macOS build must require Linux preflight.');
  requirePattern(errors, buildText, /build-and-release:[\s\S]{0,300}?permissions:\s*\r?\n\s*contents:\s*write/, 'build-ios-ipa.yml: Release write permission must be scoped to the native job.');
  requirePattern(errors, buildText, /DEVELOPER_DIR:\s*\/Applications\/Xcode_26\.6\.app\/Contents\/Developer/, 'build-ios-ipa.yml: Xcode 26.6 must be selected exactly.');
  requirePattern(errors, buildText, /ruby --version[\s\S]{0,80}3\\\.4\\\.10/, 'build-ios-ipa.yml: Ruby 3.4.10 verification is missing.');
  requirePattern(errors, buildText, /gem install cocoapods --version 1\.17\.0/, 'build-ios-ipa.yml: CocoaPods 1.17.0 install is missing.');
  requirePattern(errors, buildText, /pod _1\.17\.0_ install --deployment/, 'build-ios-ipa.yml: locked CocoaPods deployment install is missing.');
  requirePattern(errors, buildText, /expo prebuild --platform ios --no-install/, 'build-ios-ipa.yml: CNG iOS generation is missing.');
  rejectPattern(errors, buildText, /expo prebuild[^\r\n]*--clean/, 'build-ios-ipa.yml: prebuild --clean is not allowed in the CNG job.');
  requirePattern(errors, buildText, /resolve-native-signature\.mjs/, 'build-ios-ipa.yml: resolved native signature step is missing.');
  requirePattern(errors, buildText, /build-ios-release\.mjs/, 'build-ios-ipa.yml: verified build/package script is missing.');
  requirePattern(errors, buildText, /publish-release\.mjs/, 'build-ios-ipa.yml: GitHub Release publication script is missing.');
  requirePattern(
    errors,
    buildText,
    /FLINK_BUILD_NUMBER:\s*\$\{\{\s*github\.run_number\s*\}\}/,
    'build-ios-ipa.yml: CFBundleVersion must be derived from the workflow run number.',
  );
  rejectPattern(
    errors,
    buildText,
    /FLINK_BUILD_NUMBER:[^\r\n]*run_attempt/,
    'build-ios-ipa.yml: rerun attempt belongs in metadata, not CFBundleVersion.',
  );
  requirePattern(
    errors,
    buildText,
    /steps\.signature\.outputs\.signature/,
    'build-ios-ipa.yml: native signature step output is not consumed.',
  );
  requirePattern(
    errors,
    signatureScriptText,
    /appendOutput\(\s*['"]signature['"]\s*,\s*result\.signature\s*\)/,
    'resolve-native-signature.mjs: output name must match the workflow consumer.',
  );
  requirePattern(
    errors,
    buildText,
    /native_runtime_version:\s*\$\{\{\s*steps\.inputs\.outputs\.native_runtime_version\s*\}\}/,
    'build-ios-ipa.yml: native runtime version must be transferred from preflight.',
  );
  requirePattern(
    errors,
    buildText,
    /FLINK_NATIVE_RUNTIME_VERSION:\s*\$\{\{\s*needs\.preflight\.outputs\.native_runtime_version\s*\}\}/,
    'build-ios-ipa.yml: resolved native runtime version must reach Expo prebuild.',
  );
  requirePattern(
    errors,
    inputScriptText,
    /native_runtime_version=\$\{nativeRuntime\.nativeRuntimeVersion\}\\n/,
    'validate-build-inputs.mjs: native runtime version output is missing.',
  );

  for (const [pattern, message] of [
    [/xcodebuild/, 'must inspect and build with xcodebuild'],
    [/'iphoneos'/, 'must use the device SDK'],
    [/'generic\/platform=iOS'/, 'must target a generic iOS device'],
    [/'CODE_SIGNING_ALLOWED=NO'/, 'must disable code signing'],
    [/'CODE_SIGNING_REQUIRED=NO'/, 'must disable signing requirements'],
    [/TARGETED_DEVICE_FAMILY/, 'must verify iPhone and iPad families'],
    [/MinimumOSVersion/, 'must verify the built minimum OS'],
    [/FlinkNativeRuntimeSignature/, 'must verify embedded native metadata'],
    [/FlinkNativeModule/, 'must verify local module registration'],
    [/main\.jsbundle/, 'must verify the production JS bundle'],
    [/Assets\.car/, 'must verify compiled native assets'],
    [/CFBundleSupportedPlatforms/, 'must verify the built device platform'],
    [/\.debug\.dylib/, 'must inspect the Xcode Debug implementation dylib'],
    [/appCodePaths/, 'must inspect every app code image'],
    [/devlauncher/i, 'must verify the development launcher'],
    [/Payload[',]/, 'must construct a Payload directory'],
    [/'\/usr\/bin\/ditto'/, 'must package with ditto'],
  ]) {
    requirePattern(errors, buildScriptText, pattern, `build-ios-release.mjs: ${message}.`);
  }

  for (const [pattern, message] of [
    [/'release',\s*'create'/, 'must create a Release'],
    [/'--verify-tag'/, 'must refuse implicit tag creation'],
    [
      /\[\s*'release',\s*'upload',[\s\S]{0,500}?'--clobber'[\s\S]{0,200}?'--repo'/,
      'must upload Release assets with clobber and an explicit repository',
    ],
    [/immutable/, 'must handle immutable Releases'],
    [/native-build-info\.json/, 'must verify prior build provenance'],
    [/sourceCommit/, 'must reject source drift'],
    [/git\/ref\/tags/, 'must revalidate the remote tag target before publication'],
    [/FLINK_NATIVE_RUNTIME_SIGNATURE/, 'must bind publication to the resolved signature'],
    [/releaseAssetNames/, 'must use the remote asset inventory when downloading'],
  ]) {
    requirePattern(errors, publishScriptText, pattern, `publish-release.mjs: ${message}.`);
  }

  if (errors.length > 0) {
    throw new WorkflowPolicyError(errors);
  }
  return {
    testIds: ['TC-D02', 'TC-D05', 'TC-D06', 'TC-D07', 'TC-D08'],
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
  const buildText = allWorkflows.find((workflow) => workflow.name === 'build-ios-ipa.yml')?.text;
  if (!checksText || !buildText) {
    throw new WorkflowPolicyError(['Both checks.yml and build-ios-ipa.yml are required.']);
  }
  const [
    buildScriptText,
    publishScriptText,
    signatureScriptText,
    inputScriptText,
  ] = await Promise.all([
    readFile(path.join(PROJECT_ROOT, 'scripts', 'ci', 'build-ios-release.mjs'), 'utf8'),
    readFile(path.join(PROJECT_ROOT, 'scripts', 'ci', 'publish-release.mjs'), 'utf8'),
    readFile(path.join(PROJECT_ROOT, 'scripts', 'ci', 'resolve-native-signature.mjs'), 'utf8'),
    readFile(path.join(PROJECT_ROOT, 'scripts', 'ci', 'validate-build-inputs.mjs'), 'utf8'),
  ]);
  const result = validateWorkflowPolicy({
    checksText,
    buildText,
    buildScriptText,
    publishScriptText,
    signatureScriptText,
    inputScriptText,
    allWorkflows,
  });
  console.log(`Workflow policy verified (${result.testIds.join(', ')}; ${result.workflowCount} workflows).`);
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
