#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const EXPO_CLI = path.join(PROJECT_ROOT, 'node_modules', 'expo', 'bin', 'cli');
const SOURCE_CONFIG = JSON.parse(
  readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8'),
);
const EXPECTED_BUNDLE_IDENTIFIER = SOURCE_CONFIG.expo?.ios?.bundleIdentifier;

const CAMERA_USAGE_DESCRIPTION =
  '両目の瞬きを検出してPDFのページを送るためにカメラを使用します。映像は保存・送信しません。';
const IPHONE_ORIENTATIONS = [
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
  'UIInterfaceOrientationPortrait',
];
const IPAD_ORIENTATIONS = [
  ...IPHONE_ORIENTATIONS,
  'UIInterfaceOrientationPortraitUpsideDown',
].sort();

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runExpoConfig(type, profile) {
  const result = spawnSync(
    process.execPath,
    [EXPO_CLI, 'config', '--type', type, '--json'],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, FLINK_BUILD_PROFILE: profile },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || '').trim();
    fail(`Expo config evaluation failed for ${profile}/${type}: ${diagnostic}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`Expo config returned non-JSON output for ${profile}/${type}.`);
  }
}

function asSortedStrings(value) {
  return Array.isArray(value) ? [...value].sort() : [];
}

function includesScheme(value, expected) {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

function assertNoSensitiveKeys(value, location = 'config') {
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextLocation = `${location}.${key}`;
    if (
      /(?:^|_)(?:password|private[_-]?key|access[_-]?token|api[_-]?secret|client[_-]?secret)$/i.test(
        key,
      )
    ) {
      fail(`Public Expo config contains a sensitive key: ${nextLocation}`);
    }
    assertNoSensitiveKeys(child, nextLocation);
  }
}

function assertBaseConfig(config, profile) {
  assert(config.name === 'Flink', `${profile}: expo.name must be Flink.`);
  assert(config.slug === 'flink', `${profile}: expo.slug must be flink.`);
  assert(includesScheme(config.scheme, 'flink'), `${profile}: flink scheme is missing.`);
  assert(config.orientation === 'default', `${profile}: all supported orientations must be enabled.`);
  assert(
    config.userInterfaceStyle === 'automatic',
    `${profile}: interface style must follow the system.`,
  );
  assert(
    typeof EXPECTED_BUNDLE_IDENTIFIER === 'string' &&
      /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(
        EXPECTED_BUNDLE_IDENTIFIER,
      ),
    'app.json: ios.bundleIdentifier must be a valid reverse-DNS identifier.',
  );
  assert(
    config.ios?.bundleIdentifier === EXPECTED_BUNDLE_IDENTIFIER,
    `${profile}: iOS bundle identifier drifted from app.json.`,
  );
  assert(config.ios?.supportsTablet === true, `${profile}: iPad support must be enabled.`);
  assert(
    config.ios?.deploymentTarget === '18.0',
    `${profile}: iOS deployment target must be 18.0.`,
  );
}

function assertInfoPlist(config, profile) {
  const plist = config.ios?.infoPlist;
  assert(plist && typeof plist === 'object', `${profile}: introspected Info.plist is missing.`);
  assert(plist.UIFileSharingEnabled === true, `${profile}: file sharing is not enabled.`);
  assert(
    plist.LSSupportsOpeningDocumentsInPlace === true,
    `${profile}: opening shared documents in place is not enabled.`,
  );
  assert(
    plist.NSCameraUsageDescription === CAMERA_USAGE_DESCRIPTION,
    `${profile}: camera usage description does not match the Flink privacy contract.`,
  );
  assert(
    JSON.stringify(asSortedStrings(plist.UISupportedInterfaceOrientations)) ===
      JSON.stringify(IPHONE_ORIENTATIONS),
    `${profile}: iPhone orientations do not match the contract.`,
  );
  assert(
    JSON.stringify(asSortedStrings(plist['UISupportedInterfaceOrientations~ipad'])) ===
      JSON.stringify(IPAD_ORIENTATIONS),
    `${profile}: iPad orientations do not match the contract.`,
  );
  assert(plist.UIRequiresFullScreen !== true, `${profile}: iPad full-screen must not be forced.`);
  assert(
    plist.FlinkNativeRuntimeVersion === '1.0.11',
    `${profile}: native runtime version metadata is missing.`,
  );
  assert(
    plist.FlinkNativeRuntimeSignature === 'unresolved',
    `${profile}: unresolved local native signature metadata is missing.`,
  );
  assert(
    plist.FlinkNativeBuildProfile === profile,
    `${profile}: native build profile metadata does not match.`,
  );

  const transport = plist.NSAppTransportSecurity ?? {};
  for (const key of [
    'NSAllowsArbitraryLoads',
    'NSAllowsArbitraryLoadsForMedia',
    'NSAllowsArbitraryLoadsInWebContent',
  ]) {
    assert(transport[key] !== true, `${profile}: ${key} must never be enabled.`);
  }

  const services = Array.isArray(plist.NSBonjourServices)
    ? plist.NSBonjourServices.map((service) =>
        typeof service === 'string'
          ? service.toLowerCase().replace(/\.$/, '')
          : service,
      )
    : [];
  if (profile === 'development') {
    assert(
      typeof plist.NSLocalNetworkUsageDescription === 'string' &&
        plist.NSLocalNetworkUsageDescription.length > 0,
      'development: local-network usage description is missing.',
    );
    assert(services.includes('_expo._tcp'), 'development: Expo Bonjour service is missing.');
    assert(
      transport.NSAllowsLocalNetworking === true,
      'development: local-only transport access is missing.',
    );
  } else {
    assert(
      plist.NSLocalNetworkUsageDescription === undefined,
      'production: development local-network description leaked into Release config.',
    );
    assert(
      !services.includes('_expo._tcp'),
      'production: development Bonjour service leaked into Release config.',
    );
    assert(
      transport.NSAllowsLocalNetworking !== true,
      'production: local transport exception leaked into Release config.',
    );
    const exceptionDomains = transport.NSExceptionDomains ?? {};
    assert(
      !Object.keys(exceptionDomains).some(
        (domain) => domain.toLowerCase().replace(/\.$/, '') === 'localhost',
      ),
      'production: localhost transport exception leaked into Release config.',
    );
  }

  const podfileProperties = config._internal?.modResults?.ios?.podfileProperties;
  assert(
    podfileProperties?.['ios.deploymentTarget'] === '18.0',
    `${profile}: Podfile deployment target must be 18.0.`,
  );
}

try {
  for (const profile of ['production', 'development']) {
    const publicConfig = runExpoConfig('public', profile);
    assertBaseConfig(publicConfig, profile);
    assertNoSensitiveKeys(publicConfig);

    const introspectedConfig = runExpoConfig('introspect', profile);
    assertBaseConfig(introspectedConfig, profile);
    assertInfoPlist(introspectedConfig, profile);
  }
  console.log('Expo configuration verified for production and development profiles.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
