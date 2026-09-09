import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..');

const TEXT_FILE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.js',
  '.json',
  '.lock',
  '.m',
  '.mm',
  '.modulemap',
  '.podspec',
  '.rb',
  '.swift',
  '.ts',
  '.tsx',
  '.xcconfig',
  '.xcprivacy',
  '.xml',
  '.yaml',
  '.yml',
]);

const IGNORED_DIRECTORY_NAMES = new Set([
  '.expo',
  '.git',
  '.gradle',
  '.idea',
  '.swiftpm',
  'DerivedData',
  'Pods',
  'build',
  'dist',
  'node_modules',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareOrdinal)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function normalizeText(buffer) {
  return Buffer.from(buffer.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function statOptional(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function toLogicalPath(projectRoot, absolutePath) {
  const relative = path.relative(projectRoot, absolutePath).replaceAll('\\', '/');
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith('../') ||
    path.isAbsolute(relative)
  ) {
    throw new Error('A native signature input resolved outside the project root.');
  }
  return relative;
}

async function makeFileInput(projectRoot, absolutePath, contentOverride) {
  const raw = contentOverride ?? (await readFile(absolutePath));
  const extension = path.extname(absolutePath).toLowerCase();
  const normalized = TEXT_FILE_EXTENSIONS.has(extension) ? normalizeText(raw) : raw;
  return {
    id: toLogicalPath(projectRoot, absolutePath),
    sha256: sha256(normalized),
    bytes: normalized.byteLength,
  };
}

function makeVirtualInput(id, value) {
  const content = Buffer.from(canonicalJson(value), 'utf8');
  return { id, sha256: sha256(content), bytes: content.byteLength };
}

function projectToolchain(toolchain) {
  return {
    schemaVersion: toolchain.schemaVersion,
    expoSdk: toolchain.expoSdk,
    node: toolchain.node,
    packageManager: toolchain.packageManager,
    githubRunner: toolchain.githubRunner,
    xcode: {
      version: toolchain.xcode?.version,
      application: toolchain.xcode?.application,
    },
    ruby: toolchain.ruby,
    cocoaPods: toolchain.cocoaPods,
    ios: toolchain.ios,
    cng: toolchain.cng,
  };
}

function projectRuntime(runtime) {
  return {
    schemaVersion: runtime.schemaVersion,
    nativeApiVersion: runtime.nativeApiVersion,
    nativeRuntimeVersion: runtime.nativeRuntimeVersion,
    signatureAlgorithm: runtime.signature?.algorithm,
    signatureInputVersion: runtime.signature?.inputVersion,
    nativePackageAllowlist: [...(runtime.nativePackageAllowlist ?? [])].sort(compareOrdinal),
    jsOnlyPackageAllowlist: [...(runtime.jsOnlyPackageAllowlist ?? [])].sort(compareOrdinal),
    iosAutolinkSnapshot: [...(runtime.iosAutolinkSnapshot ?? [])].sort(compareOrdinal),
    generatedMetadataBasenames: [
      ...(runtime.generatedMetadataBasenames ?? []),
    ].sort(compareOrdinal),
  };
}

function projectAppConfig(rawConfig, buildProfile) {
  const expo = rawConfig.expo ?? rawConfig;
  const effectiveIosIcon = expo.ios?.icon ?? expo.icon;
  const effectiveIosSplash = expo.ios?.splash ?? expo.splash;
  return {
    buildProfile,
    name: expo.name,
    slug: expo.slug,
    version: expo.version,
    scheme: expo.scheme,
    orientation: expo.orientation,
    userInterfaceStyle: expo.userInterfaceStyle,
    newArchEnabled: expo.newArchEnabled,
    plugins: expo.plugins,
    ios: {
      ...(expo.ios ?? {}),
      icon: effectiveIosIcon,
      splash: effectiveIosSplash,
    },
  };
}

function safeRegistryHost(value) {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return new URL(value).hostname;
  } catch {
    return 'non-url';
  }
}

function lockedPackageOccurrences(packageLock, packageName) {
  const suffix = `/node_modules/${packageName}`;
  return Object.entries(packageLock.packages ?? {})
    .filter(([packagePath]) =>
      packagePath === `node_modules/${packageName}` || packagePath.endsWith(suffix),
    )
    .map(([packagePath, entry]) => ({
      path: packagePath.replaceAll('\\', '/'),
      name: packageName,
      version: entry.version ?? null,
      integrity: entry.integrity ?? null,
      resolvedRegistry: safeRegistryHost(entry.resolved),
    }))
    .sort((left, right) => compareOrdinal(left.path, right.path));
}

async function collectDirectoryFiles({
  projectRoot,
  absoluteDirectory,
  generatedMetadataBasenames,
  unresolvedReasons,
  ignoreBuildDirectories,
}) {
  const files = [];
  const rootStat = await statOptional(absoluteDirectory);
  if (!rootStat) {
    return { files, missing: true };
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    unresolvedReasons.push(
      `Native input directory is not a regular directory: ${toLogicalPath(
        projectRoot,
        absoluteDirectory,
      )}`,
    );
    return { files, missing: false };
  }

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareOrdinal(left.name, right.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const logicalPath = toLogicalPath(projectRoot, entryPath);
      if (entry.isSymbolicLink()) {
        unresolvedReasons.push(`Symlink is not allowed in native signature inputs: ${logicalPath}`);
      } else if (entry.isDirectory()) {
        if (!ignoreBuildDirectories || !IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          await visit(entryPath);
        }
      } else if (
        entry.isFile() &&
        !generatedMetadataBasenames.has(entry.name)
      ) {
        files.push(entryPath);
      }
    }
  }

  await visit(absoluteDirectory);
  return { files, missing: false };
}

function collectNativeAssetReferences(rawConfig) {
  const expo = rawConfig.expo ?? rawConfig;
  const references = new Set();
  const walkKnownAsset = (value) => {
    if (typeof value === 'string') {
      references.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(walkKnownAsset);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walkKnownAsset);
    }
  };
  const walkPluginOptions = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walkPluginOptions);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walkPluginOptions);
    } else {
      if (
        typeof value === 'string' &&
        (value.startsWith('./') || value.startsWith('../') || path.isAbsolute(value))
      ) {
        references.add(value);
      }
    }
  };

  walkKnownAsset(expo.ios?.icon ?? expo.icon);
  walkKnownAsset((expo.ios?.splash ?? expo.splash)?.image);
  for (const plugin of expo.plugins ?? []) {
    if (Array.isArray(plugin) && plugin.length > 1) {
      walkPluginOptions(plugin[1]);
    }
  }
  return [...references].sort(compareOrdinal);
}

async function collectAssetInputs(
  projectRoot,
  appConfig,
  generatedMetadataBasenames,
  unresolvedReasons,
) {
  const inputs = [];
  for (const reference of collectNativeAssetReferences(appConfig)) {
    const absolutePath = path.resolve(projectRoot, reference);
    let logicalPath;
    try {
      logicalPath = toLogicalPath(projectRoot, absolutePath);
    } catch {
      unresolvedReasons.push(`Native asset resolves outside the project: ${reference}`);
      continue;
    }
    const stat = await statOptional(absolutePath);
    if (!stat) {
      unresolvedReasons.push(`Native asset is missing: ${logicalPath}`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      unresolvedReasons.push(`Native asset may not be a symlink: ${logicalPath}`);
      continue;
    }
    if (stat.isFile()) {
      inputs.push(await makeFileInput(projectRoot, absolutePath));
      continue;
    }
    if (!stat.isDirectory()) {
      unresolvedReasons.push(`Native asset is not a regular file or directory: ${logicalPath}`);
      continue;
    }
    const collected = await collectDirectoryFiles({
      projectRoot,
      absoluteDirectory: absolutePath,
      generatedMetadataBasenames,
      unresolvedReasons,
      ignoreBuildDirectories: false,
    });
    for (const filePath of collected.files) {
      inputs.push(await makeFileInput(projectRoot, filePath));
    }
  }
  return inputs;
}

async function directoryHasPodspec(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.some(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.podspec'),
    );
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function detectAppleNativePackage(packageDirectory, unresolvedReasons, logicalPath) {
  const expoConfigPath = path.join(packageDirectory, 'expo-module.config.json');
  const expoConfigStat = await statOptional(expoConfigPath);
  if (expoConfigStat) {
    if (!expoConfigStat.isFile() || expoConfigStat.isSymbolicLink()) {
      unresolvedReasons.push(`Invalid Expo module config: ${logicalPath}/expo-module.config.json`);
      return false;
    }
    try {
      const expoConfig = await readJson(expoConfigPath);
      const platforms = Array.isArray(expoConfig.platforms) ? expoConfig.platforms : [];
      return platforms.includes('apple') || platforms.includes('ios');
    } catch {
      unresolvedReasons.push(`Unreadable Expo module config: ${logicalPath}/expo-module.config.json`);
      return false;
    }
  }

  return (
    (await directoryHasPodspec(packageDirectory)) ||
    (await directoryHasPodspec(path.join(packageDirectory, 'ios'))) ||
    (await directoryHasPodspec(path.join(packageDirectory, 'apple')))
  );
}

async function discoverInstalledIosNativePackages(projectRoot, packageLock, unresolvedReasons) {
  const discovered = new Set();
  const packagePaths = Object.keys(packageLock.packages ?? {})
    .filter((packagePath) => packagePath.includes('node_modules/'))
    .sort(compareOrdinal);

  for (const packagePath of packagePaths) {
    const normalizedPath = packagePath.replaceAll('\\', '/');
    if (
      normalizedPath.startsWith('../') ||
      path.isAbsolute(normalizedPath) ||
      normalizedPath.includes('/../')
    ) {
      unresolvedReasons.push(`Unsafe package-lock path: ${normalizedPath}`);
      continue;
    }
    const packageDirectory = path.join(projectRoot, ...normalizedPath.split('/'));
    const packageStat = await statOptional(packageDirectory);
    if (!packageStat || !packageStat.isDirectory() || packageStat.isSymbolicLink()) {
      continue;
    }
    let packageJson;
    try {
      packageJson = await readJson(path.join(packageDirectory, 'package.json'));
    } catch {
      unresolvedReasons.push(`Installed package metadata is unreadable: ${normalizedPath}`);
      continue;
    }
    if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
      unresolvedReasons.push(`Installed package has no name: ${normalizedPath}`);
      continue;
    }
    if (
      await detectAppleNativePackage(packageDirectory, unresolvedReasons, normalizedPath)
    ) {
      discovered.add(packageJson.name);
    }
  }
  return [...discovered].sort(compareOrdinal);
}

function validateDirectDependencyClassification(
  packageJson,
  nativeAllowlist,
  jsOnlyAllowlist,
  unresolvedReasons,
) {
  const native = new Set(nativeAllowlist);
  const jsOnly = new Set(jsOnlyAllowlist);
  for (const packageName of Object.keys(packageJson.dependencies ?? {}).sort(compareOrdinal)) {
    const classificationCount = Number(native.has(packageName)) + Number(jsOnly.has(packageName));
    if (classificationCount === 0) {
      unresolvedReasons.push(`Direct runtime dependency is unclassified: ${packageName}`);
    } else if (classificationCount > 1) {
      unresolvedReasons.push(`Direct runtime dependency has conflicting classifications: ${packageName}`);
    }
  }
}

function validateAutolinkSnapshot(discovered, runtime, unresolvedReasons) {
  const nativeAllowlist = new Set(runtime.nativePackageAllowlist ?? []);
  const expected = new Set(runtime.iosAutolinkSnapshot ?? []);
  for (const packageName of discovered) {
    if (!nativeAllowlist.has(packageName)) {
      unresolvedReasons.push(`Detected iOS native package is not allowlisted: ${packageName}`);
    }
    if (!expected.has(packageName)) {
      unresolvedReasons.push(`iOS autolink snapshot has an unexpected package: ${packageName}`);
    }
  }
  for (const packageName of expected) {
    if (!discovered.includes(packageName)) {
      unresolvedReasons.push(`iOS autolink snapshot package was not detected: ${packageName}`);
    }
  }
}

function extractSingleInteger(source, pattern, description) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${description} must contain exactly one native API version literal.`);
  }
  const value = Number(matches[0][1]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${description} contains an invalid native API version.`);
  }
  return value;
}

async function verifyNativeApiParity(projectRoot, expectedVersion) {
  const typeScriptPath = path.join(projectRoot, 'src', 'native', 'contracts.ts');
  const swiftPath = path.join(
    projectRoot,
    'modules',
    'flink-native',
    'ios',
    'Shared',
    'FlinkNativeBuildInfo.swift',
  );
  const [typeScriptSource, swiftSource] = await Promise.all([
    readFile(typeScriptPath, 'utf8'),
    readFile(swiftPath, 'utf8'),
  ]);
  const typeScriptVersion = extractSingleInteger(
    typeScriptSource,
    /export\s+const\s+NATIVE_API_VERSION\s*=\s*(\d+)\s+as\s+const\s*;/g,
    'src/native/contracts.ts',
  );
  const swiftVersion = extractSingleInteger(
    swiftSource,
    /static\s+let\s+nativeApiVersion\s*=\s*(\d+)\b/g,
    'FlinkNativeBuildInfo.swift',
  );
  if (typeScriptVersion !== expectedVersion || swiftVersion !== expectedVersion) {
    throw new Error(
      `nativeApiVersion mismatch: config=${expectedVersion}, TypeScript=${typeScriptVersion}, Swift=${swiftVersion}.`,
    );
  }
}

function resolveBuildProfile(value) {
  const profile = value ?? process.env.FLINK_BUILD_PROFILE ?? 'production';
  if (profile !== 'development' && profile !== 'production') {
    throw new Error('Native signature buildProfile must be development or production.');
  }
  return profile;
}

export async function calculateNativeSignature(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const buildProfile = resolveBuildProfile(options.buildProfile);
  const [toolchain, runtime, appConfig, packageJson, packageLock] = await Promise.all([
    readJson(path.join(projectRoot, 'config', 'native-toolchain.json')),
    readJson(path.join(projectRoot, 'config', 'native-runtime.json')),
    readJson(path.join(projectRoot, 'app.json')),
    readJson(path.join(projectRoot, 'package.json')),
    readJson(path.join(projectRoot, 'package-lock.json')),
  ]);

  if (runtime.signature?.algorithm !== 'sha256') {
    throw new Error('Only sha256 native runtime signatures are supported.');
  }
  await verifyNativeApiParity(projectRoot, runtime.nativeApiVersion);

  const unresolvedReasons = [];
  const generatedMetadataBasenames = new Set(
    runtime.generatedMetadataBasenames ?? [],
  );
  const nativeAllowlist = [...(runtime.nativePackageAllowlist ?? [])].sort(compareOrdinal);
  const jsOnlyAllowlist = [...(runtime.jsOnlyPackageAllowlist ?? [])].sort(compareOrdinal);
  validateDirectDependencyClassification(
    packageJson,
    nativeAllowlist,
    jsOnlyAllowlist,
    unresolvedReasons,
  );

  const installedIosNativePackages = await discoverInstalledIosNativePackages(
    projectRoot,
    packageLock,
    unresolvedReasons,
  );
  validateAutolinkSnapshot(installedIosNativePackages, runtime, unresolvedReasons);

  const nativePackages = [];
  for (const packageName of nativeAllowlist) {
    const occurrences = lockedPackageOccurrences(packageLock, packageName);
    if (occurrences.length === 0) {
      unresolvedReasons.push(`Native package is missing from package-lock.json: ${packageName}`);
    }
    nativePackages.push(...occurrences);
  }

  const inputs = [
    makeVirtualInput('virtual/native-toolchain.json', projectToolchain(toolchain)),
    makeVirtualInput('virtual/native-runtime-contract.json', projectRuntime(runtime)),
    makeVirtualInput(
      'virtual/app-native-config.json',
      projectAppConfig(appConfig, buildProfile),
    ),
    makeVirtualInput('virtual/native-package-lock.json', nativePackages),
    makeVirtualInput('virtual/installed-ios-autolink.json', installedIosNativePackages),
  ];

  for (const relativeDirectory of ['plugins', 'modules']) {
    const absoluteDirectory = path.join(projectRoot, ...relativeDirectory.split('/'));
    const collected = await collectDirectoryFiles({
      projectRoot,
      absoluteDirectory,
      generatedMetadataBasenames,
      unresolvedReasons,
      ignoreBuildDirectories: true,
    });
    if (collected.missing) {
      unresolvedReasons.push(`Native input directory is missing: ${relativeDirectory}`);
    }
    for (const filePath of collected.files) {
      inputs.push(await makeFileInput(projectRoot, filePath));
    }
  }
  inputs.push(
    await makeFileInput(
      projectRoot,
      path.join(projectRoot, 'src', 'native', 'contracts.ts'),
    ),
  );

  inputs.push(
    ...(await collectAssetInputs(
      projectRoot,
      appConfig,
      generatedMetadataBasenames,
      unresolvedReasons,
    )),
  );

  const podLockPath = path.join(projectRoot, 'native-locks', 'ios', 'Podfile.lock');
  const podLockStat = await statOptional(podLockPath);
  if (podLockStat?.isFile() && !podLockStat.isSymbolicLink()) {
    inputs.push(await makeFileInput(projectRoot, podLockPath));
  } else {
    unresolvedReasons.push('native-locks/ios/Podfile.lock is unresolved.');
    inputs.push(
      makeVirtualInput('virtual/native-locks/ios/Podfile.lock', { state: 'unresolved' }),
    );
  }

  const inputsById = new Map();
  for (const input of inputs) {
    if (path.isAbsolute(input.id) || input.id.includes('\\') || input.id.startsWith('../')) {
      throw new Error('Native signature manifests may contain logical relative IDs only.');
    }
    if (generatedMetadataBasenames.has(path.posix.basename(input.id))) {
      throw new Error(`Generated metadata entered the native signature: ${input.id}`);
    }
    inputsById.set(input.id, input);
  }

  const manifest = {
    schemaVersion: 1,
    signatureInputVersion: runtime.signature.inputVersion,
    nativeApiVersion: runtime.nativeApiVersion,
    nativeRuntimeVersion: runtime.nativeRuntimeVersion,
    buildProfile,
    inputs: [...inputsById.values()].sort((left, right) => compareOrdinal(left.id, right.id)),
  };

  return {
    signature: sha256(Buffer.from(canonicalJson(manifest), 'utf8')),
    manifest,
    unresolvedReasons: [...new Set(unresolvedReasons)].sort(compareOrdinal),
    installedIosNativePackages,
  };
}
