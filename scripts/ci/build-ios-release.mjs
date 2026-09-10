#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const MAX_BUFFER = 64 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function requiredEnvironment(name, pattern) {
  // Call sites pass fixed, allow-listed CI variable names only.
  // eslint-disable-next-line expo/no-dynamic-env-var
  const value = process.env[name];
  if (!value || !pattern.test(value)) {
    fail(`${name} is missing or invalid.`);
  }
  return value;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    encoding: options.encoding ?? 'utf8',
    env: process.env,
    maxBuffer: MAX_BUFFER,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function inspectDeviceMachO(filePath, description) {
  const architectures = run('/usr/bin/lipo', ['-archs', filePath])
    .trim()
    .split(/\s+/);
  assert(
    architectures.includes('arm64'),
    `${description} does not contain arm64.`,
  );
  const buildVersion = run('xcrun', ['vtool', '-show-build', filePath]);
  assert(
    /platform\s+IOS\b/i.test(buildVersion) && !/SIMULATOR/i.test(buildVersion),
    `${description} is not built for iOS devices.`,
  );
  return architectures;
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function parseJsonOutput(command, args, description) {
  try {
    return JSON.parse(run(command, args));
  } catch (error) {
    fail(`${description} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function discoverWorkspace(iosDirectory) {
  const workspaces = (await readdir(iosDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.xcworkspace'))
    .map((entry) => path.join(iosDirectory, entry.name));
  assert(workspaces.length === 1, `Expected exactly one generated app workspace; found ${workspaces.length}.`);
  return workspaces[0];
}

function showBuildSettings({ workspace, scheme, configuration, derivedData }) {
  const payload = parseJsonOutput(
    'xcodebuild',
    [
      '-workspace',
      workspace,
      '-scheme',
      scheme,
      '-configuration',
      configuration,
      '-sdk',
      'iphoneos',
      '-destination',
      'generic/platform=iOS',
      '-derivedDataPath',
      derivedData,
      '-showBuildSettings',
      '-json',
      'CODE_SIGNING_ALLOWED=NO',
      'CODE_SIGNING_REQUIRED=NO',
      'CODE_SIGN_IDENTITY=',
    ],
    `Build settings for ${scheme}`,
  );
  return Array.isArray(payload) ? payload : [];
}

function selectApplicationTarget(settings, bundleIdentifier) {
  const candidates = settings.filter((entry) => {
    const values = entry?.buildSettings;
    return (
      values?.WRAPPER_EXTENSION === 'app' &&
      values?.PRODUCT_BUNDLE_IDENTIFIER === bundleIdentifier
    );
  });
  assert(candidates.length === 1, `Expected one application target for ${bundleIdentifier}; found ${candidates.length}.`);
  return candidates[0];
}

async function findExpoModulesProvider(iosDirectory) {
  const candidates = (await listFiles(iosDirectory)).filter(
    (filePath) => path.basename(filePath) === 'ExpoModulesProvider.swift',
  );
  for (const candidate of candidates) {
    if ((await readFile(candidate, 'utf8')).includes('FlinkNativeModule')) {
      return path.relative(iosDirectory, candidate).split(path.sep).join('/');
    }
  }
  fail('Generated ExpoModulesProvider.swift does not register FlinkNativeModule.');
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function appendGithubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }
  const lines = Object.entries(values)
    .map(([name, value]) => `${name}=${value}\n`)
    .join('');
  await appendFile(process.env.GITHUB_OUTPUT, lines, 'utf8');
}

try {
  const profile = requiredEnvironment('FLINK_BUILD_PROFILE', /^(development|production)$/);
  const tag = requiredEnvironment(
    'FLINK_TAG',
    profile === 'development'
      ? /^dev-runtime-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/
      : /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/,
  );
  const version = requiredEnvironment('FLINK_VERSION', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/);
  const sourceCommit = requiredEnvironment('FLINK_SOURCE_COMMIT', /^[a-f0-9]{40}$/);
  const signature = requiredEnvironment('FLINK_NATIVE_RUNTIME_SIGNATURE', /^[a-f0-9]{64}$/);
  const configuredRuntimeVersion = requiredEnvironment(
    'FLINK_NATIVE_RUNTIME_VERSION',
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/,
  );
  const buildNumber = requiredEnvironment('FLINK_BUILD_NUMBER', /^\d+(?:\.\d+){0,2}$/);
  const runNumber = requiredEnvironment('FLINK_RUN_NUMBER', /^\d+$/);
  const runAttempt = requiredEnvironment('FLINK_RUN_ATTEMPT', /^\d+$/);
  const configuration = profile === 'development' ? 'Debug' : 'Release';

  const [appJson, runtime, toolchain] = await Promise.all([
    readFile(path.join(PROJECT_ROOT, 'app.json'), 'utf8').then(JSON.parse),
    readFile(path.join(PROJECT_ROOT, 'config', 'native-runtime.json'), 'utf8').then(JSON.parse),
    readFile(path.join(PROJECT_ROOT, 'config', 'native-toolchain.json'), 'utf8').then(JSON.parse),
  ]);
  const bundleIdentifier = appJson.expo?.ios?.bundleIdentifier;
  assert(bundleIdentifier === 'com.aioi.flink', 'Unexpected iOS bundle identifier.');
  assert(
    configuredRuntimeVersion === runtime.nativeRuntimeVersion,
    'Native runtime version output does not match config/native-runtime.json.',
  );
  assert(
    version ===
      (profile === 'development'
        ? runtime.nativeRuntimeVersion
        : appJson.expo.version),
    'Tag version does not match the requested app or native runtime version.',
  );
  assert(process.env.RUNNER_OS === 'macOS', 'The native package script must run on a macOS runner.');
  assert(process.env.RUNNER_ARCH === 'ARM64', 'The native package script must run on an arm64 runner.');
  assert(
    process.env.DEVELOPER_DIR === toolchain.xcode.developerDirectory,
    'DEVELOPER_DIR does not match the pinned native toolchain.',
  );
  assert(
    process.version === `v${toolchain.node.version}`,
    'Node.js does not match the pinned native toolchain.',
  );
  const xcodeVersion = run('xcodebuild', ['-version']).trim().split(/\r?\n/);
  const npmVersion = run('npm', ['--version']).trim();
  const rubyVersion = run('ruby', ['--version']).trim();
  const cocoaPodsVersion = run('pod', [
    `_${toolchain.cocoaPods.version}_`,
    '--version',
  ]).trim();
  assert(xcodeVersion[0] === `Xcode ${toolchain.xcode.version}`, 'Xcode does not match the pinned native toolchain.');
  assert(npmVersion === toolchain.packageManager.version, 'npm does not match the pinned native toolchain.');
  assert(rubyVersion.startsWith(`ruby ${toolchain.ruby.version} `), 'Ruby does not match the pinned native toolchain.');
  assert(cocoaPodsVersion === toolchain.cocoaPods.version, 'CocoaPods does not match the pinned native toolchain.');

  const iosDirectory = path.join(PROJECT_ROOT, 'ios');
  const workspace = await discoverWorkspace(iosDirectory);
  const workspaceInfo = parseJsonOutput(
    'xcodebuild',
    ['-workspace', workspace, '-list', '-json'],
    'Generated workspace inventory',
  );
  const schemes = workspaceInfo?.workspace?.schemes;
  assert(Array.isArray(schemes) && schemes.length > 0, 'Generated workspace has no shared schemes.');
  const derivedData = path.join(PROJECT_ROOT, 'build', 'DerivedData');
  await rm(derivedData, { recursive: true, force: true });
  await mkdir(derivedData, { recursive: true });

  const configuredScheme = appJson.expo?.name;
  let selected = null;
  if (typeof configuredScheme === 'string' && schemes.includes(configuredScheme)) {
    const settings = showBuildSettings({
      workspace,
      scheme: configuredScheme,
      configuration,
      derivedData,
    });
    const matches = settings.filter(
      (entry) =>
        entry?.buildSettings?.WRAPPER_EXTENSION === 'app' &&
        entry?.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER === bundleIdentifier,
    );
    assert(
      matches.length === 1,
      `Configured scheme ${configuredScheme} must build exactly one ${bundleIdentifier} app target.`,
    );
    selected = { scheme: configuredScheme, settings, application: matches[0] };
  } else {
    const candidates = [];
    for (const scheme of schemes) {
      let settings;
      try {
        settings = showBuildSettings({ workspace, scheme, configuration, derivedData });
      } catch (error) {
        console.warn(
          `Skipping scheme ${scheme}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      const matches = settings.filter(
        (entry) =>
          entry?.buildSettings?.WRAPPER_EXTENSION === 'app' &&
          entry?.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER === bundleIdentifier,
      );
      assert(
        matches.length <= 1,
        `Scheme ${scheme} resolves more than one ${bundleIdentifier} app target.`,
      );
      if (matches.length === 1) {
        candidates.push({ scheme, settings, application: matches[0] });
      }
    }
    assert(
      candidates.length === 1,
      `Expected exactly one generated scheme for ${bundleIdentifier}; found ${candidates.length}.`,
    );
    selected = candidates[0];
  }
  selectApplicationTarget(selected.settings, bundleIdentifier);
  const buildSettings = selected.application.buildSettings;

  assert(buildSettings.SDK_NAME?.startsWith('iphoneos'), 'The application target is not using the iPhoneOS device SDK.');
  assert(String(buildSettings.SUPPORTED_PLATFORMS).split(/\s+/).includes('iphoneos'), 'The application target does not support iphoneos.');
  assert(String(buildSettings.TARGETED_DEVICE_FAMILY).replaceAll(' ', '') === '1,2', 'TARGETED_DEVICE_FAMILY must contain iPhone and iPad.');
  assert(buildSettings.IPHONEOS_DEPLOYMENT_TARGET === '18.0', 'The application target must use iOS 18.0.');
  assert(buildSettings.FULL_PRODUCT_NAME === 'Flink.app', 'The generated application product must be Flink.app.');
  assert(buildSettings.CONFIGURATION === configuration, 'The generated configuration does not match the requested profile.');

  const buildArguments = [
    '-workspace',
    workspace,
    '-scheme',
    selected.scheme,
    '-configuration',
    configuration,
    '-sdk',
    'iphoneos',
    '-destination',
    'generic/platform=iOS',
    '-derivedDataPath',
    derivedData,
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
    'build',
  ];
  run('xcodebuild', buildArguments, { inherit: true });

  const refreshedSettings = showBuildSettings({
    workspace,
    scheme: selected.scheme,
    configuration,
    derivedData,
  });
  const application = selectApplicationTarget(refreshedSettings, bundleIdentifier);
  const values = application.buildSettings;
  const appPath = path.resolve(values.TARGET_BUILD_DIR, values.FULL_PRODUCT_NAME);
  const realDerivedData = await realpath(derivedData);
  const realAppPath = await realpath(appPath);
  assert(realAppPath.startsWith(`${realDerivedData}${path.sep}`), 'Built app escaped the dedicated DerivedData directory.');
  assert(path.basename(realAppPath) === 'Flink.app', 'Resolved build product is not Flink.app.');

  const plistPath = path.join(realAppPath, 'Info.plist');
  const plist = parseJsonOutput(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', plistPath],
    'Built Info.plist',
  );
  assert(plist.CFBundleIdentifier === bundleIdentifier, 'Built bundle identifier does not match app.json.');
  assert(plist.CFBundleShortVersionString === appJson.expo.version, 'Built app version does not match app.json.');
  assert(plist.CFBundleVersion === buildNumber, 'Built CFBundleVersion does not match the CI build number.');
  assert(plist.CFBundlePackageType === 'APPL', 'Built product is not an application bundle.');
  assert(plist.LSRequiresIPhoneOS === true, 'Built product is not marked as an iPhoneOS application.');
  assert(
    Array.isArray(plist.CFBundleSupportedPlatforms) &&
      plist.CFBundleSupportedPlatforms.includes('iPhoneOS'),
    'Built product does not declare the iPhoneOS device platform.',
  );
  assert(plist.MinimumOSVersion === '18.0', 'Built MinimumOSVersion must be 18.0.');
  assert(
    Array.isArray(plist.UIDeviceFamily) &&
      plist.UIDeviceFamily.includes(1) &&
      plist.UIDeviceFamily.includes(2),
    'Built UIDeviceFamily must include iPhone and iPad.',
  );
  assert(plist.UIFileSharingEnabled === true, 'Built app does not enable iTunes/Files sharing.');
  assert(plist.LSSupportsOpeningDocumentsInPlace === true, 'Built app does not enable opening documents in place.');
  assert(plist.UIRequiresFullScreen === false, 'Built iPad app must permit adaptive multitasking layouts.');
  const phoneOrientations = new Set(plist.UISupportedInterfaceOrientations ?? []);
  const tabletOrientations = new Set(
    plist['UISupportedInterfaceOrientations~ipad'] ?? [],
  );
  for (const orientation of [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ]) {
    assert(phoneOrientations.has(orientation), `Built iPhone orientations omit ${orientation}.`);
    assert(tabletOrientations.has(orientation), `Built iPad orientations omit ${orientation}.`);
  }
  assert(
    tabletOrientations.has('UIInterfaceOrientationPortraitUpsideDown'),
    'Built iPad orientations omit portrait upside-down.',
  );
  assert(typeof plist.NSCameraUsageDescription === 'string' && plist.NSCameraUsageDescription.length > 0, 'Built app has no camera privacy description.');
  const transportSecurity = plist.NSAppTransportSecurity ?? {};
  for (const key of [
    'NSAllowsArbitraryLoads',
    'NSAllowsArbitraryLoadsForMedia',
    'NSAllowsArbitraryLoadsInWebContent',
  ]) {
    assert(transportSecurity[key] !== true, `Built app must not enable ${key}.`);
  }
  const bonjourServices = Array.isArray(plist.NSBonjourServices)
    ? plist.NSBonjourServices
    : [];
  const hasExpoBonjourService = bonjourServices.some(
    (service) =>
      typeof service === 'string' &&
      service.toLowerCase().replace(/\.$/, '') === '_expo._tcp',
  );
  const exceptionDomains =
    transportSecurity.NSExceptionDomains &&
    typeof transportSecurity.NSExceptionDomains === 'object' &&
    !Array.isArray(transportSecurity.NSExceptionDomains)
      ? Object.keys(transportSecurity.NSExceptionDomains)
      : [];
  const hasLocalhostException = exceptionDomains.some(
    (domain) => domain.toLowerCase().replace(/\.$/, '') === 'localhost',
  );
  if (profile === 'development') {
    assert(
      typeof plist.NSLocalNetworkUsageDescription === 'string' &&
        plist.NSLocalNetworkUsageDescription.length > 0 &&
        hasExpoBonjourService &&
        transportSecurity.NSAllowsLocalNetworking === true,
      'Development app is missing its explicit Expo LAN discovery declarations.',
    );
  } else {
    assert(
      plist.NSLocalNetworkUsageDescription === undefined &&
        !hasExpoBonjourService &&
        !hasLocalhostException &&
        transportSecurity.NSAllowsLocalNetworking !== true,
      'Production app contains development-only LAN declarations.',
    );
  }
  assert(plist.FlinkNativeRuntimeVersion === runtime.nativeRuntimeVersion, 'Built native runtime version metadata is wrong.');
  assert(plist.FlinkNativeRuntimeSignature === signature, 'Built native runtime signature metadata is wrong.');
  assert(plist.FlinkNativeBuildProfile === profile, 'Built native profile metadata is wrong.');
  assert(plist.FlinkNativeSourceCommit === sourceCommit, 'Built source commit metadata is wrong.');

  assert(
    typeof plist.CFBundleExecutable === 'string' &&
      path.basename(plist.CFBundleExecutable) === plist.CFBundleExecutable,
    'Built CFBundleExecutable is invalid.',
  );
  const executablePath = path.join(realAppPath, plist.CFBundleExecutable);
  assert(await isFile(executablePath), 'Built application executable is missing.');
  const debugDylibPath = path.join(
    realAppPath,
    `${plist.CFBundleExecutable}.debug.dylib`,
  );
  const appCodePaths = [executablePath];
  if (await isFile(debugDylibPath)) {
    assert(
      profile === 'development',
      'Production app unexpectedly contains an Xcode Debug implementation dylib.',
    );
    appCodePaths.push(debugDylibPath);
  }
  const appCode = appCodePaths.map((filePath) => {
    const relativePath = path.relative(realAppPath, filePath).split(path.sep).join('/');
    return {
      path: relativePath,
      architectures: inspectDeviceMachO(filePath, `App code ${relativePath}`),
    };
  });
  const appCodeLabels = appCode.map(({ path: relativePath }) => relativePath).join(', ');
  const linkedLibraries = appCodePaths
    .map((filePath) => run('/usr/bin/otool', ['-L', filePath]))
    .join('\n');
  for (const framework of ['ARKit', 'PDFKit', 'SceneKit']) {
    assert(
      linkedLibraries.includes(`/${framework}.framework/`),
      `Built app code (${appCodeLabels}) is not linked to ${framework}.`,
    );
  }

  const appFiles = await listFiles(realAppPath);
  assert(
    await isFile(path.join(realAppPath, 'Assets.car')),
    'Built application is missing its compiled native asset catalog.',
  );
  assert(!appFiles.some((filePath) => filePath.includes(`${path.sep}_CodeSignature${path.sep}`)), 'Unsigned build unexpectedly contains a code-signature directory.');
  assert(!appFiles.some((filePath) => path.basename(filePath) === 'embedded.mobileprovision'), 'Unsigned build unexpectedly contains a provisioning profile.');
  const embeddedCode = [];
  for (const filePath of appFiles) {
    const components = path.relative(realAppPath, filePath).split(path.sep);
    const frameworkDirectory = components.length === 3 ? components[1] : '';
    const isFrameworkExecutable =
      components[0] === 'Frameworks' &&
      frameworkDirectory.endsWith('.framework') &&
      path.basename(frameworkDirectory, '.framework') === components[2];
    const isDynamicLibrary =
      components.length === 2 &&
      components[0] === 'Frameworks' &&
      components[1].endsWith('.dylib');
    if (!isFrameworkExecutable && !isDynamicLibrary) {
      continue;
    }
    const embeddedArchitectures = inspectDeviceMachO(
      filePath,
      `Embedded code ${components.join('/')}`,
    );
    embeddedCode.push({
      path: components.join('/'),
      architectures: embeddedArchitectures,
    });
  }

  const podLockPath = path.join(iosDirectory, 'Podfile.lock');
  const podLock = await readFile(podLockPath, 'utf8');
  assert(/(?:^|\n)\s*- FlinkNative\b/m.test(podLock), 'Podfile.lock does not contain the local FlinkNative pod.');
  const providerPath = await findExpoModulesProvider(iosDirectory);
  const appCodeStrings = appCodePaths
    .map((filePath) => run('/usr/bin/strings', [filePath]))
    .join('\n');
  assert(
    appCodeStrings.includes('FlinkNativeModule'),
    `Built app code (${appCodeLabels}) contains no FlinkNativeModule registration evidence.`,
  );
  if (profile === 'production') {
    const javascriptBundle = path.join(realAppPath, 'main.jsbundle');
    assert(await isFile(javascriptBundle), 'Production app does not contain the bundled JavaScript runtime.');
    assert((await stat(javascriptBundle)).size > 0, 'Production JavaScript bundle is empty.');
  } else {
    const appNames = appFiles.map((filePath) => path.basename(filePath)).join('\n');
    assert(/devlauncher/i.test(`${appNames}\n${appCodeStrings}`), 'Development app contains no Expo Dev Launcher evidence.');
  }

  const releaseDirectory = path.join(PROJECT_ROOT, 'build', 'release');
  const stageDirectory = path.join(releaseDirectory, 'stage');
  await rm(releaseDirectory, { recursive: true, force: true });
  await mkdir(path.join(stageDirectory, 'Payload'), { recursive: true });
  const stagedApp = path.join(stageDirectory, 'Payload', 'Flink.app');
  run('/usr/bin/ditto', [realAppPath, stagedApp]);

  const ipaName =
    profile === 'development'
      ? `Flink-dev-runtime-${version}-unsigned.ipa`
      : `Flink-${version}-unsigned.ipa`;
  const ipaPath = path.join(releaseDirectory, ipaName);
  run('/usr/bin/ditto', [
    '-c',
    '-k',
    '--keepParent',
    path.join(stageDirectory, 'Payload'),
    ipaPath,
  ]);
  const archiveEntries = run('/usr/bin/unzip', ['-Z1', ipaPath])
    .split(/\r?\n/)
    .filter(Boolean);
  assert(archiveEntries.includes('Payload/Flink.app/Info.plist'), 'IPA does not contain Payload/Flink.app/Info.plist.');
  assert(
    archiveEntries.every(
      (entry) =>
        (entry === 'Payload' || entry === 'Payload/' || entry.startsWith('Payload/')) &&
        !entry.split('/').includes('..') &&
        !entry.includes('\\'),
    ),
    'IPA contains an unexpected or unsafe archive path.',
  );
  assert(!archiveEntries.some((entry) => entry.startsWith('Payload/Payload/')), 'IPA contains an invalid Payload/Payload hierarchy.');
  assert(!archiveEntries.some((entry) => entry.includes('/_CodeSignature/')), 'IPA contains an unexpected code signature.');
  assert(!archiveEntries.some((entry) => entry.endsWith('/embedded.mobileprovision')), 'IPA contains an unexpected provisioning profile.');

  const releasePodLockPath = path.join(releaseDirectory, 'Podfile.lock');
  await copyFile(podLockPath, releasePodLockPath);
  const [ipaSha256, podLockSha256] = await Promise.all([
    sha256(ipaPath),
    sha256(releasePodLockPath),
  ]);
  const metadata = {
    schemaVersion: 1,
    tag,
    appVersion: appJson.expo.version,
    nativeApiVersion: runtime.nativeApiVersion,
    nativeRuntimeVersion: runtime.nativeRuntimeVersion,
    nativeRuntimeSignature: signature,
    buildProfile: profile,
    sourceCommit,
    buildNumber,
    workflow: { runNumber: Number(runNumber), runAttempt: Number(runAttempt) },
    toolchain: {
      runner: toolchain.githubRunner.label,
      architecture: toolchain.githubRunner.architecture,
      xcode: xcodeVersion,
      node: process.version.slice(1),
      npm: npmVersion,
      ruby: rubyVersion,
      cocoaPods: cocoaPodsVersion,
    },
    xcodeProduct: {
      workspace: path.basename(workspace),
      scheme: selected.scheme,
      applicationTarget: application.target,
      configuration,
      sdk: values.SDK_NAME,
      destination: 'generic/platform=iOS',
      supportedPlatforms: String(values.SUPPORTED_PLATFORMS).split(/\s+/),
      targetedDeviceFamily: [1, 2],
      minimumOSVersion: plist.MinimumOSVersion,
      bundleIdentifier,
      expoModulesProvider: providerPath,
      appCode,
      embeddedCode,
      codeSigningAllowed: false,
    },
    assets: {
      ipa: { name: ipaName, sha256: ipaSha256 },
      podfileLock: { name: 'Podfile.lock', sha256: podLockSha256 },
    },
  };
  const metadataPath = path.join(releaseDirectory, 'native-build-info.json');
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  const finalMetadataSha256 = await sha256(metadataPath);
  await writeFile(
    path.join(releaseDirectory, 'SHA256SUMS.txt'),
    `${ipaSha256}  ${ipaName}\n${finalMetadataSha256}  native-build-info.json\n${podLockSha256}  Podfile.lock\n`,
    'utf8',
  );
  await rm(stageDirectory, { recursive: true, force: true });
  await appendGithubOutput({
    ipa_name: ipaName,
    ipa_sha256: ipaSha256,
    release_directory: 'build/release',
  });
  console.log(`Verified and packaged ${ipaName} (${ipaSha256}).`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
