import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  downloadAsset,
  queryRelease,
  releaseAssetNames,
  resolveRemoteTagCommit,
  validateReleaseState,
  verifyChecksumManifest,
} from '../../scripts/ci/publish-release.mjs';

function ghJson(value) {
  return { status: 0, stdout: JSON.stringify(value), stderr: '' };
}

describe('GitHub Release publication policy (TC-D07 and TC-D08)', () => {
  it('validates Release identity, lifecycle state, profile, and asset inventory', () => {
    const release = {
      tag_name: 'dev-runtime-v1.0.0',
      draft: true,
      prerelease: true,
      immutable: false,
      assets: [{ name: 'native-build-info.json' }],
    };

    expect(
      validateReleaseState(release, 'dev-runtime-v1.0.0', 'development'),
    ).toBe(release);
    expect([...releaseAssetNames(release)]).toEqual(['native-build-info.json']);
    expect(() =>
      validateReleaseState({ ...release, immutable: undefined }, release.tag_name, 'development'),
    ).toThrow(/lifecycle state/);
    expect(() =>
      validateReleaseState({ ...release, prerelease: false }, release.tag_name, 'development'),
    ).toThrow(/build profile/);
  });

  it('resolves both lightweight and annotated tags to their commit', () => {
    const commit = 'a'.repeat(40);
    const annotation = 'b'.repeat(40);
    const calls = [];
    const execute = (args) => {
      calls.push(args);
      if (args[1].endsWith('/git/ref/tags/v1.0.0')) {
        return ghJson({ object: { type: 'tag', sha: annotation } });
      }
      if (args[1].endsWith(`/git/tags/${annotation}`)) {
        return ghJson({ object: { type: 'commit', sha: commit } });
      }
      throw new Error(`Unexpected fake gh request: ${args.join(' ')}`);
    };

    expect(resolveRemoteTagCommit('owner/repository', 'v1.0.0', execute)).toBe(commit);
    expect(calls).toHaveLength(2);
    expect(
      resolveRemoteTagCommit('owner/repository', 'v1.0.0', () =>
        ghJson({ object: { type: 'commit', sha: commit } }),
      ),
    ).toBe(commit);
  });

  it('does not hide a download failure for an asset known to exist', async () => {
    let calls = 0;
    const missing = await downloadAsset(
      'v1.0.0',
      'native-build-info.json',
      tmpdir(),
      'owner/repository',
      false,
      () => {
        calls += 1;
      },
    );
    expect(missing).toBeNull();
    expect(calls).toBe(0);

    const execute = (args) => {
      calls += 1;
      expect(args).toContain('--repo');
      expect(args).toContain('owner/repository');
      return { status: 0, stdout: '', stderr: '' };
    };
    await expect(
      downloadAsset(
        'v1.0.0',
        'native-build-info.json',
        tmpdir(),
        'owner/repository',
        true,
        execute,
      ),
    ).resolves.toBe(path.join(tmpdir(), 'native-build-info.json'));
    expect(calls).toBe(1);

    await expect(
      downloadAsset(
        'v1.0.0',
        'native-build-info.json',
        tmpdir(),
        'owner/repository',
        true,
        () => {
          throw new Error('network failure');
        },
      ),
    ).rejects.toThrow('network failure');
  });

  it('treats only an explicit 404 as a missing Release', () => {
    expect(
      queryRelease('owner/repository', 'v1.0.0', {
        allowMissing: true,
        execute: () => ({ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }),
      }),
    ).toBeNull();
    expect(() =>
      queryRelease('owner/repository', 'v1.0.0', {
        allowMissing: true,
        execute: () => ({ status: 1, stdout: '', stderr: 'Not Found' }),
      }),
    ).toThrow(/Unable to query/);
    expect(() =>
      queryRelease('owner/repository', 'v1.0.0', {
        allowMissing: true,
        execute: () => ({ status: 1, stdout: '', stderr: 'network unavailable' }),
      }),
    ).toThrow(/Unable to query/);
  });

  it('requires SHA256SUMS.txt to describe the exact release payload', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'flink-release-policy-'));
    const ipaDigest = 'a'.repeat(64);
    const metadataDigest = 'b'.repeat(64);
    const podDigest = 'c'.repeat(64);
    const expectedNames = [
      'Flink-1.0.0-unsigned.ipa',
      'native-build-info.json',
      'SHA256SUMS.txt',
      'Podfile.lock',
    ];
    const localDigests = new Map([
      ['Flink-1.0.0-unsigned.ipa', ipaDigest],
      ['native-build-info.json', metadataDigest],
      ['SHA256SUMS.txt', 'd'.repeat(64)],
      ['Podfile.lock', podDigest],
    ]);

    try {
      await writeFile(
        path.join(directory, 'SHA256SUMS.txt'),
        `${ipaDigest}  Flink-1.0.0-unsigned.ipa\n${metadataDigest}  native-build-info.json\n${podDigest}  Podfile.lock\n`,
        'utf8',
      );
      await expect(
        verifyChecksumManifest(expectedNames, localDigests, directory),
      ).resolves.toBeUndefined();

      await writeFile(
        path.join(directory, 'SHA256SUMS.txt'),
        `${'f'.repeat(64)}  Flink-1.0.0-unsigned.ipa\n${metadataDigest}  native-build-info.json\n${podDigest}  Podfile.lock\n`,
        'utf8',
      );
      await expect(
        verifyChecksumManifest(expectedNames, localDigests, directory),
      ).rejects.toThrow(/wrong digest/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
