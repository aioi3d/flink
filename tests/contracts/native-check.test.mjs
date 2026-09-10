import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_ROOT,
  calculateNativeSignature,
} from '../../scripts/lib/native-signature.mjs';

const temporaryDirectories = [];
const scriptPath = path.join(DEFAULT_PROJECT_ROOT, 'scripts', 'native-check.mjs');

function cleanEnvironment(overrides = {}) {
  const environment = { ...process.env };
  delete environment.FLINK_BUILD_PROFILE;
  return { ...environment, ...overrides };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('native runtime compatibility check', () => {
  it('infers the profile from installed metadata when no override is present', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'flink-native-check-'));
    temporaryDirectories.push(directory);
    const installedPath = path.join(directory, 'installed.json');
    const runtime = JSON.parse(
      await readFile(
        path.join(DEFAULT_PROJECT_ROOT, 'config', 'native-runtime.json'),
        'utf8',
      ),
    );
    const calculated = await calculateNativeSignature({ buildProfile: 'development' });
    await writeFile(
      installedPath,
      `${JSON.stringify({
        nativeApiVersion: calculated.manifest.nativeApiVersion,
        nativeRuntimeVersion: runtime.nativeRuntimeVersion,
        nativeRuntimeSignature: calculated.signature,
        buildProfile: 'development',
      })}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--installed', installedPath, '--json'],
      {
        cwd: DEFAULT_PROJECT_ROOT,
        encoding: 'utf8',
        env: cleanEnvironment(),
        windowsHide: true,
      },
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.status).not.toBe('mismatch');
    expect(report.buildProfile).toBe('development');
    expect(report.mismatches).toEqual([]);
  });

  it('keeps explicit CLI and environment profile precedence', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'flink-native-check-'));
    temporaryDirectories.push(directory);
    const installedPath = path.join(directory, 'installed.json');
    const runtime = JSON.parse(
      await readFile(
        path.join(DEFAULT_PROJECT_ROOT, 'config', 'native-runtime.json'),
        'utf8',
      ),
    );
    const development = await calculateNativeSignature({ buildProfile: 'development' });
    await writeFile(
      installedPath,
      `${JSON.stringify({
        nativeApiVersion: development.manifest.nativeApiVersion,
        nativeRuntimeVersion: runtime.nativeRuntimeVersion,
        nativeRuntimeSignature: development.signature,
        buildProfile: 'development',
      })}\n`,
    );

    const environmentOverride = spawnSync(
      process.execPath,
      [scriptPath, '--installed', installedPath, '--json'],
      {
        cwd: DEFAULT_PROJECT_ROOT,
        encoding: 'utf8',
        env: cleanEnvironment({ FLINK_BUILD_PROFILE: 'production' }),
        windowsHide: true,
      },
    );
    expect(environmentOverride.status).toBe(1);
    expect(JSON.parse(environmentOverride.stdout).buildProfile).toBe('production');

    const cliOverride = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--installed',
        installedPath,
        '--profile',
        'development',
        '--json',
      ],
      {
        cwd: DEFAULT_PROJECT_ROOT,
        encoding: 'utf8',
        env: cleanEnvironment({ FLINK_BUILD_PROFILE: 'production' }),
        windowsHide: true,
      },
    );
    expect(cliOverride.status).toBe(0);
    expect(JSON.parse(cliOverride.stdout).buildProfile).toBe('development');
  });

  it.each([
    ['null', null],
    ['array', []],
    ['missing profile', {}],
    ['invalid profile', { buildProfile: 'staging' }],
  ])('rejects invalid installed metadata: %s', async (_label, metadata) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'flink-native-check-'));
    temporaryDirectories.push(directory);
    const installedPath = path.join(directory, 'installed.json');
    await writeFile(installedPath, `${JSON.stringify(metadata)}\n`);

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--installed', installedPath, '--profile', 'development'],
      {
        cwd: DEFAULT_PROJECT_ROOT,
        encoding: 'utf8',
        env: cleanEnvironment(),
        windowsHide: true,
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Installed native build (metadata|profile)/);
  });

  it('rejects an invalid environment profile instead of falling back', async () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: DEFAULT_PROJECT_ROOT,
      encoding: 'utf8',
      env: cleanEnvironment({ FLINK_BUILD_PROFILE: 'staging' }),
      windowsHide: true,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'FLINK_BUILD_PROFILE must be development or production.',
    );
  });

  it('rejects installed runtime-version and build-profile drift', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'flink-native-check-'));
    temporaryDirectories.push(directory);
    const installedPath = path.join(directory, 'installed.json');
    const calculated = await calculateNativeSignature({ buildProfile: 'production' });
    await writeFile(
      installedPath,
      `${JSON.stringify({
        nativeApiVersion: calculated.manifest.nativeApiVersion,
        nativeRuntimeVersion: '0.9.0',
        nativeRuntimeSignature: calculated.signature,
        buildProfile: 'development',
      })}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--installed',
        installedPath,
        '--profile',
        'production',
        '--json',
      ],
      {
        cwd: DEFAULT_PROJECT_ROOT,
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.mismatches).toContain(
      'The installed native runtime version is incompatible.',
    );
    expect(report.mismatches).toContain(
      'The installed native build profile is incompatible.',
    );
  });
});
