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
  waitForRelease,
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

  it('finds Draft Releases through the paginated Release inventory', () => {
    const draft = {
      tag_name: 'v1.0.0',
      draft: true,
      prerelease: false,
      immutable: false,
      assets: [],
    };
    const calls = [];
    const execute = (args, options) => {
      calls.push({ args, options });
      return ghJson([
        [{ tag_name: 'v0.9.0', draft: false }],
        [draft],
      ]);
    };

    expect(queryRelease('owner/repository', 'v1.0.0', { execute })).toStrictEqual(draft);
    expect(calls).toEqual([
      {
        args: [
          'api',
          '--paginate',
          '--slurp',
          'repos/owner/repository/releases?per_page=100',
        ],
        options: { allowFailure: true },
      },
    ]);
  });

  it('treats only a successful inventory miss as a missing Release', () => {
    expect(
      queryRelease('owner/repository', 'v1.0.0', {
        allowMissing: true,
        execute: () => ghJson([[]]),
      }),
    ).toBeNull();
    expect(() =>
      queryRelease('owner/repository', 'v1.0.0', {
        execute: () => ghJson([[]]),
      }),
    ).toThrow(/was not found/);
    expect(() =>
      queryRelease('owner/repository', 'v1.0.0', {
        allowMissing: true,
        execute: () => ({ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }),
      }),
    ).toThrow(/Unable to list GitHub Releases/);
  });

  it('rejects malformed or duplicate Release inventories', () => {
    expect(() =>
      queryRelease('owner/repository', 'v1.0.0', {
        execute: () => ghJson([{ tag_name: 'v1.0.0' }]),
      }),
    ).toThrow(/invalid paginated response/);
    expect(() =>
      queryRelease('owner/repository', 'v1.0.0', {
        execute: () => ghJson([
          [{ tag_name: 'v1.0.0' }],
          [{ tag_name: 'v1.0.0' }],
        ]),
      }),
    ).toThrow(/duplicate Releases/);
  });

  it('waits for a newly-created Draft to appear without creating it again', async () => {
    const draft = { tag_name: 'v1.0.0', draft: true };
    const responses = [null, null, draft];
    const sleeps = [];
    const query = (_repository, _tag, options) => {
      expect(options).toEqual({ allowMissing: true });
      return responses.shift();
    };

    await expect(
      waitForRelease('owner/repository', 'v1.0.0', {
        attempts: 3,
        intervalMs: 25,
        query,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).resolves.toBe(draft);
    expect(sleeps).toEqual([25, 25]);
    expect(responses).toHaveLength(0);

    await expect(
      waitForRelease('owner/repository', 'v1.0.0', {
        attempts: 2,
        intervalMs: 0,
        query: () => null,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/did not appear/);
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
