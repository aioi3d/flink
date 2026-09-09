import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_ROOT,
  calculateNativeSignature,
} from '../../scripts/lib/native-signature.mjs';

const temporaryDirectories = [];
const scriptPath = path.join(DEFAULT_PROJECT_ROOT, 'scripts', 'native-check.mjs');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('native runtime compatibility check', () => {
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
