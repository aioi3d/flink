import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { calculateNativeSignature } from '../../scripts/lib/native-signature.mjs';

const roots = [];
const json = (file, value) => writeFile(file, `${JSON.stringify(value)}\n`);

async function readJson(root, file) {
  return JSON.parse(await readFile(path.join(root, file), 'utf8'));
}

async function makeProject() {
  const root = await mkdtemp(path.join(tmpdir(), 'flink-signature-'));
  roots.push(root);
  const directories = [
    'config',
    'plugins',
    'modules/fixture',
    'modules/flink-native/ios/Shared',
    'native-locks/ios',
    'src/native',
    'assets/images',
    'assets/expo.icon/Assets',
  ];
  await Promise.all(
    directories.map((directory) => mkdir(path.join(root, directory), { recursive: true })),
  );
  await Promise.all([
    json(path.join(root, 'config/native-toolchain.json'), {
      schemaVersion: 1,
      expoSdk: '57.0.0',
      node: { version: '24.18.0' },
      packageManager: { name: 'npm', version: '11.16.0' },
      xcode: { version: '26.6', developerDirectory: '/machine/path' },
      ios: { deploymentTarget: '18.0' },
    }),
    json(path.join(root, 'config/native-runtime.json'), {
      schemaVersion: 1,
      nativeApiVersion: 1,
      nativeRuntimeVersion: '1.0.0',
      signature: { algorithm: 'sha256', inputVersion: 1, recordedSignature: 'ignored' },
      nativePackageAllowlist: [],
      jsOnlyPackageAllowlist: [],
      iosAutolinkSnapshot: [],
      generatedMetadataBasenames: ['native-build-info.json'],
    }),
    json(path.join(root, 'app.json'), {
      expo: {
        name: 'Flink',
        icon: './assets/images/icon.png',
        ios: { icon: './assets/expo.icon', deploymentTarget: '18.0' },
        plugins: [
          ['expo-splash-screen', { image: './assets/images/splash-icon.png' }],
        ],
      },
    }),
    json(path.join(root, 'package.json'), {
      name: 'fixture',
      version: '1.0.0',
      dependencies: {},
    }),
    json(path.join(root, 'package-lock.json'), {
      lockfileVersion: 3,
      packages: { '': { name: 'fixture', version: '1.0.0' } },
    }),
    writeFile(path.join(root, 'plugins/fixture.js'), 'module.exports = {}\n'),
    writeFile(path.join(root, 'modules/fixture/source.swift'), 'struct Fixture {}\n'),
    writeFile(path.join(root, 'modules/fixture/native-build-info.json'), '{"build":1}\n'),
    writeFile(
      path.join(root, 'src/native/contracts.ts'),
      'export const NATIVE_API_VERSION = 1 as const;\ninterface Contract {}\n',
    ),
    writeFile(
      path.join(root, 'modules/flink-native/ios/Shared/FlinkNativeBuildInfo.swift'),
      'enum BuildInfo { static let nativeApiVersion = 1 }\n',
    ),
    writeFile(path.join(root, 'native-locks/ios/Podfile.lock'), 'PODS:\n'),
    writeFile(path.join(root, 'assets/images/icon.png'), Buffer.from([0, 1, 2])),
    writeFile(path.join(root, 'assets/images/splash-icon.png'), Buffer.from([3, 4, 5])),
    writeFile(path.join(root, 'assets/expo.icon/icon.json'), '{"icon":1}\n'),
    writeFile(path.join(root, 'assets/expo.icon/Assets/grid.png'), Buffer.from([6, 7, 8])),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('native runtime signature', () => {
  it('is deterministic, relative, and excludes generated metadata', async () => {
    const root = await makeProject();
    const first = await calculateNativeSignature({ projectRoot: root });
    expect((await calculateNativeSignature({ projectRoot: root })).signature).toBe(
      first.signature,
    );
    expect(JSON.stringify(first.manifest)).not.toContain(root);
    expect(first.manifest.inputs.every(({ id }) => !path.isAbsolute(id) && !id.includes('\\'))).toBe(true);
    expect(first.manifest.inputs.map(({ id }) => id)).not.toContain(
      'modules/fixture/native-build-info.json',
    );
    await writeFile(path.join(root, 'modules/fixture/native-build-info.json'), '{"build":2}\n');
    expect((await calculateNativeSignature({ projectRoot: root })).signature).toBe(
      first.signature,
    );
  });

  it('changes for plugin, Swift, and TypeScript contract changes', async () => {
    const root = await makeProject();
    let prior = (await calculateNativeSignature({ projectRoot: root })).signature;
    for (const [file, contents] of [
      ['plugins/fixture.js', 'module.exports = { v: 2 }\n'],
      ['modules/fixture/source.swift', 'struct Changed {}\n'],
      ['src/native/contracts.ts', 'export const NATIVE_API_VERSION = 1 as const;\ninterface Changed {}\n'],
    ]) {
      await writeFile(path.join(root, file), contents);
      const current = (await calculateNativeSignature({ projectRoot: root })).signature;
      expect(current).not.toBe(prior);
      prior = current;
    }
  });

  it('hashes the effective iOS icon directory and splash by content', async () => {
    const root = await makeProject();
    let prior = (await calculateNativeSignature({ projectRoot: root })).signature;
    for (const file of [
      'assets/expo.icon/Assets/grid.png',
      'assets/images/splash-icon.png',
    ]) {
      await writeFile(path.join(root, file), Buffer.from([9, 9, 9]));
      const current = (await calculateNativeSignature({ projectRoot: root })).signature;
      expect(current).not.toBe(prior);
      prior = current;
    }
  });

  it('ignores an overridden top-level icon but hashes it as the iOS fallback', async () => {
    const root = await makeProject();
    const overridden = await calculateNativeSignature({ projectRoot: root });
    await writeFile(path.join(root, 'assets/images/icon.png'), Buffer.from([9, 9, 9]));
    expect((await calculateNativeSignature({ projectRoot: root })).signature).toBe(
      overridden.signature,
    );

    const appConfig = await readJson(root, 'app.json');
    delete appConfig.expo.ios.icon;
    await json(path.join(root, 'app.json'), appConfig);
    const fallback = await calculateNativeSignature({ projectRoot: root });
    await writeFile(path.join(root, 'assets/images/icon.png'), Buffer.from([8, 8, 8]));
    expect((await calculateNativeSignature({ projectRoot: root })).signature).not.toBe(
      fallback.signature,
    );
  });

  it('collects SDK 57 object-form iOS icon variants', async () => {
    const root = await makeProject();
    const appConfig = await readJson(root, 'app.json');
    appConfig.expo.ios.icon = { light: './assets/images/icon.png' };
    await json(path.join(root, 'app.json'), appConfig);
    const first = await calculateNativeSignature({ projectRoot: root });
    await writeFile(path.join(root, 'assets/images/icon.png'), Buffer.from([7, 7, 7]));
    expect((await calculateNativeSignature({ projectRoot: root })).signature).not.toBe(
      first.signature,
    );
  });

  it('normalizes Podfile.lock line endings and separates build profiles', async () => {
    const root = await makeProject();
    await writeFile(path.join(root, 'native-locks/ios/Podfile.lock'), 'PODS:\n  - Expo\n');
    const lf = await calculateNativeSignature({ projectRoot: root });
    await writeFile(path.join(root, 'native-locks/ios/Podfile.lock'), 'PODS:\r\n  - Expo\r\n');
    expect((await calculateNativeSignature({ projectRoot: root })).signature).toBe(lf.signature);
    expect(
      (await calculateNativeSignature({ projectRoot: root, buildProfile: 'development' }))
        .signature,
    ).not.toBe(lf.signature);
  });

  it.each([
    ['src/native/contracts.ts', 'export const NATIVE_API_VERSION = 2 as const;\n'],
    [
      'modules/flink-native/ios/Shared/FlinkNativeBuildInfo.swift',
      'enum BuildInfo { static let nativeApiVersion = 2 }\n',
    ],
  ])('rejects API version drift in %s', async (file, contents) => {
    const root = await makeProject();
    await writeFile(path.join(root, file), contents);
    await expect(calculateNativeSignature({ projectRoot: root })).rejects.toThrow(
      /nativeApiVersion mismatch/,
    );
  });

  it('fails closed for an unclassified direct dependency', async () => {
    const root = await makeProject();
    const packageJson = await readJson(root, 'package.json');
    packageJson.dependencies.unknown = '1.0.0';
    await json(path.join(root, 'package.json'), packageJson);
    expect((await calculateNativeSignature({ projectRoot: root })).unresolvedReasons).toContain(
      'Direct runtime dependency is unclassified: unknown',
    );
  });

  it('does not change for a classified JS-only package version', async () => {
    const root = await makeProject();
    const runtime = await readJson(root, 'config/native-runtime.json');
    const packageJson = await readJson(root, 'package.json');
    const packageLock = await readJson(root, 'package-lock.json');
    runtime.jsOnlyPackageAllowlist = ['js-only'];
    packageJson.dependencies['js-only'] = '1.0.0';
    packageLock.packages['node_modules/js-only'] = { version: '1.0.0' };
    await Promise.all([
      json(path.join(root, 'config/native-runtime.json'), runtime),
      json(path.join(root, 'package.json'), packageJson),
      json(path.join(root, 'package-lock.json'), packageLock),
    ]);
    const first = await calculateNativeSignature({ projectRoot: root });
    packageJson.dependencies['js-only'] = '2.0.0';
    packageLock.packages['node_modules/js-only'] = { version: '2.0.0' };
    await Promise.all([
      json(path.join(root, 'package.json'), packageJson),
      json(path.join(root, 'package-lock.json'), packageLock),
    ]);
    expect((await calculateNativeSignature({ projectRoot: root })).signature).toBe(
      first.signature,
    );
  });

  it('changes for a native generation tool version', async () => {
    const root = await makeProject();
    const runtime = await readJson(root, 'config/native-runtime.json');
    const lock = await readJson(root, 'package-lock.json');
    runtime.nativePackageAllowlist = ['native-tool'];
    lock.packages['node_modules/native-tool'] = { version: '1.0.0' };
    await Promise.all([
      json(path.join(root, 'config/native-runtime.json'), runtime),
      json(path.join(root, 'package-lock.json'), lock),
    ]);
    const first = await calculateNativeSignature({ projectRoot: root });
    lock.packages['node_modules/native-tool'] = { version: '1.0.1' };
    await json(path.join(root, 'package-lock.json'), lock);
    expect((await calculateNativeSignature({ projectRoot: root })).signature).not.toBe(
      first.signature,
    );
  });

  it('fails closed for a new iOS pod outside the snapshot and allowlist', async () => {
    const root = await makeProject();
    const directory = path.join(root, 'node_modules/new-native');
    await mkdir(directory, { recursive: true });
    await json(path.join(directory, 'package.json'), { name: 'new-native', version: '1.0.0' });
    await writeFile(path.join(directory, 'NewNative.podspec'), 'Pod::Spec.new {}\n');
    const lock = await readJson(root, 'package-lock.json');
    lock.packages['node_modules/new-native'] = { version: '1.0.0' };
    await json(path.join(root, 'package-lock.json'), lock);
    const result = await calculateNativeSignature({ projectRoot: root });
    expect(result.installedIosNativePackages).toContain('new-native');
    expect(result.unresolvedReasons).toContain(
      'Detected iOS native package is not allowlisted: new-native',
    );
    expect(result.unresolvedReasons).toContain(
      'iOS autolink snapshot has an unexpected package: new-native',
    );
  });

  it('ignores an explicitly Android-only Expo module for Apple autolinking', async () => {
    const root = await makeProject();
    const directory = path.join(root, 'node_modules/android-only');
    await mkdir(directory, { recursive: true });
    await json(path.join(directory, 'package.json'), { name: 'android-only' });
    await json(path.join(directory, 'expo-module.config.json'), { platforms: ['android'] });
    const lock = await readJson(root, 'package-lock.json');
    lock.packages['node_modules/android-only'] = { version: '1.0.0' };
    await json(path.join(root, 'package-lock.json'), lock);
    const result = await calculateNativeSignature({ projectRoot: root });
    expect(result.installedIosNativePackages).not.toContain('android-only');
    expect(result.unresolvedReasons.join('\n')).not.toContain('android-only');
  });
});
