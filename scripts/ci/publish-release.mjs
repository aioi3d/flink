#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const RELEASE_DIRECTORY = path.join(PROJECT_ROOT, 'build', 'release');

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

function gh(args, { allowFailure = false } = {}) {
  const result = spawnSync('gh', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    fail(`GitHub CLI could not start: ${result.error.message}`);
  }
  if (!allowFailure && result.status !== 0) {
    const action = args[0] === 'api' ? 'API request' : args.slice(0, 2).join(' ');
    const detail = (
      result.stderr ||
      result.stdout ||
      `gh exited with ${result.status}${result.signal ? ` (${result.signal})` : ''}`
    ).trim();
    fail(`GitHub CLI ${action} failed: ${detail}`);
  }
  return result;
}

function parseGhJson(result, description) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(
      `${description} did not return valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

export function releaseAssetNames(release) {
  assert(Array.isArray(release.assets), 'GitHub Release response has no asset inventory.');
  return new Set(
    release.assets.map((asset) => {
      assert(
        typeof asset?.name === 'string' &&
          asset.name.length > 0 &&
          !/[\/\\]/.test(asset.name),
        'GitHub Release response contains an invalid asset name.',
      );
      return asset.name;
    }),
  );
}

export function validateReleaseState(release, tag, profile) {
  assert(release?.tag_name === tag, 'GitHub returned a Release for an unexpected tag.');
  assert(
    typeof release.draft === 'boolean' &&
      typeof release.prerelease === 'boolean' &&
      typeof release.immutable === 'boolean',
    'GitHub Release response is missing lifecycle state.',
  );
  assert(
    release.prerelease === (profile === 'development'),
    'Existing Release prerelease state does not match the requested build profile.',
  );
  releaseAssetNames(release);
  return release;
}

export async function downloadAsset(
  tag,
  name,
  directory,
  repository,
  exists,
  execute = gh,
) {
  if (!exists) {
    return null;
  }
  execute([
    'release',
    'download',
    tag,
    '--pattern',
    name,
    '--dir',
    directory,
    '--clobber',
    '--repo',
    repository,
  ]);
  return path.join(directory, name);
}

export function queryRelease(
  repository,
  tag,
  { allowMissing = false, execute = gh } = {},
) {
  const result = execute(
    [
      'api',
      '--paginate',
      '--slurp',
      `repos/${repository}/releases?per_page=100`,
    ],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    const response = `${result.stderr}\n${result.stdout}`.trim();
    fail(`Unable to list GitHub Releases: ${response}`);
  }

  // The release-by-tag endpoint only returns published Releases. Publication
  // deliberately starts as a Draft, so enumerate the authenticated Release
  // inventory instead; users with push access receive Drafts in this listing.
  const pages = parseGhJson(result, 'GitHub Release inventory query');
  assert(
    Array.isArray(pages) && pages.every((page) => Array.isArray(page)),
    'GitHub Release inventory has an invalid paginated response.',
  );
  const matches = pages
    .flat()
    .filter((release) => release?.tag_name === tag);
  assert(matches.length <= 1, 'GitHub returned duplicate Releases for the requested tag.');
  if (matches.length === 0 && allowMissing) {
    return null;
  }
  assert(matches.length === 1, `GitHub Release ${tag} was not found.`);
  return matches[0];
}

export async function waitForRelease(
  repository,
  tag,
  {
    attempts = 10,
    intervalMs = 1_000,
    query = queryRelease,
    sleep = (milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
  } = {},
) {
  assert(Number.isInteger(attempts) && attempts > 0, 'Release wait attempts are invalid.');
  assert(
    Number.isInteger(intervalMs) && intervalMs >= 0,
    'Release wait interval is invalid.',
  );
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const release = query(repository, tag, { allowMissing: true });
    if (release) {
      return release;
    }
    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }
  fail(`Draft GitHub Release ${tag} did not appear in the authenticated inventory.`);
}

export function resolveRemoteTagCommit(repository, tag, execute = gh) {
  const reference = parseGhJson(
    execute(['api', `repos/${repository}/git/ref/tags/${tag}`]),
    'Remote tag reference query',
  );
  let object = reference?.object;
  for (let depth = 0; depth < 8; depth += 1) {
    assert(
      object &&
        (object.type === 'commit' || object.type === 'tag') &&
        typeof object.sha === 'string' &&
        /^[a-f0-9]{40}$/.test(object.sha),
      'Remote tag reference has an invalid target.',
    );
    if (object.type === 'commit') {
      return object.sha;
    }
    const annotatedTag = parseGhJson(
      execute(['api', `repos/${repository}/git/tags/${object.sha}`]),
      'Annotated tag query',
    );
    object = annotatedTag?.object;
  }
  fail('Remote tag annotation nesting is too deep.');
}

function assertRemoteTagCommit(repository, tag, sourceCommit) {
  if (resolveRemoteTagCommit(repository, tag) !== sourceCommit) {
    fail('The remote tag no longer points to the source commit built by this run.');
  }
}

export async function verifyChecksumManifest(
  expectedNames,
  localDigests,
  releaseDirectory = RELEASE_DIRECTORY,
) {
  const checksumPath = path.join(releaseDirectory, 'SHA256SUMS.txt');
  const lines = (await readFile(checksumPath, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean);
  const checksums = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    assert(match, 'SHA256SUMS.txt contains an invalid line.');
    assert(!checksums.has(match[2]), 'SHA256SUMS.txt contains a duplicate asset.');
    checksums.set(match[2], match[1]);
  }
  const checksummedNames = expectedNames.filter((name) => name !== 'SHA256SUMS.txt');
  assert(
    checksums.size === checksummedNames.length,
    'SHA256SUMS.txt does not contain the exact expected asset set.',
  );
  for (const name of checksummedNames) {
    assert(
      checksums.get(name) === localDigests.get(name),
      `SHA256SUMS.txt has the wrong digest for ${name}.`,
    );
  }
}

async function performPublication(setTemporaryDirectory) {
  const profile = requiredEnvironment('FLINK_BUILD_PROFILE', /^(development|production)$/);
  const tag = requiredEnvironment(
    'FLINK_TAG',
    profile === 'development'
      ? /^dev-runtime-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/
      : /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/,
  );
  const sourceCommit = requiredEnvironment('FLINK_SOURCE_COMMIT', /^[a-f0-9]{40}$/);
  const repository = requiredEnvironment(
    'GITHUB_REPOSITORY',
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
  );
  const signature = requiredEnvironment(
    'FLINK_NATIVE_RUNTIME_SIGNATURE',
    /^[a-f0-9]{64}$/,
  );
  requiredEnvironment('GH_TOKEN', /^.+$/s);

  const metadataPath = path.join(RELEASE_DIRECTORY, 'native-build-info.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const version = tag.replace(
    profile === 'development' ? /^dev-runtime-v/ : /^v/,
    '',
  );
  const expectedIpaName =
    profile === 'development'
      ? `Flink-dev-runtime-${version}-unsigned.ipa`
      : `Flink-${version}-unsigned.ipa`;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.tag !== tag ||
    metadata.sourceCommit !== sourceCommit ||
    metadata.buildProfile !== profile ||
    metadata.nativeRuntimeSignature !== signature ||
    metadata.assets?.ipa?.name !== expectedIpaName ||
    (profile === 'development'
      ? metadata.nativeRuntimeVersion !== version
      : metadata.appVersion !== version)
  ) {
    fail(
      'Local release metadata does not match the validated tag, source, profile, and signature.',
    );
  }

  const expectedNames = [
    // Upload provenance first so a partial draft can be retried safely.
    'native-build-info.json',
    metadata.assets?.ipa?.name,
    'SHA256SUMS.txt',
    'Podfile.lock',
  ];
  if (
    expectedNames.some(
      (name) =>
        typeof name !== 'string' ||
        name.length === 0 ||
        /[\/\\]/.test(name),
    )
  ) {
    fail('Release metadata contains an invalid asset name.');
  }
  if (new Set(expectedNames).size !== expectedNames.length) {
    fail('Release metadata contains duplicate asset names.');
  }
  const assetPaths = expectedNames.map((name) => path.join(RELEASE_DIRECTORY, name));
  const localDigests = new Map(
    await Promise.all(
      assetPaths.map(async (filePath) => [path.basename(filePath), await sha256(filePath)]),
    ),
  );

  if (
    metadata.assets?.ipa?.sha256 !== localDigests.get(metadata.assets.ipa.name) ||
    metadata.assets?.podfileLock?.name !== 'Podfile.lock' ||
    metadata.assets?.podfileLock?.sha256 !== localDigests.get('Podfile.lock')
  ) {
    fail('Local release metadata checksums do not match the files being published.');
  }
  await verifyChecksumManifest(expectedNames, localDigests);

  // A tag can be force-moved while a long native build is running. Re-resolve
  // both lightweight and annotated tags through the remote API before writing.
  assertRemoteTagCommit(repository, tag, sourceCommit);

  let release = queryRelease(repository, tag, { allowMissing: true });
  let created = false;
  if (!release) {
    const title =
      profile === 'development'
        ? `Flink development runtime ${metadata.nativeRuntimeVersion}`
        : `Flink ${metadata.appVersion}`;
    const notes =
      profile === 'development'
        ? 'Unsigned development IPA for explicit SideStore re-signing and native smoke tests.'
        : 'Unsigned production IPA for explicit SideStore re-signing.';
    const createArguments = [
      'release',
      'create',
      tag,
      '--verify-tag',
      '--draft',
      '--title',
      title,
      '--notes',
      notes,
    ];
    if (profile === 'development') {
      createArguments.push('--prerelease', '--latest=false');
    }
    createArguments.push('--repo', repository);
    gh(createArguments);
    created = true;
    release = await waitForRelease(repository, tag);
  }

  validateReleaseState(release, tag, profile);

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'flink-release-'));
  setTemporaryDirectory(temporaryDirectory);
  let remoteAssetNames = releaseAssetNames(release);
  const existingMetadata = await downloadAsset(
    tag,
    'native-build-info.json',
    temporaryDirectory,
    repository,
    remoteAssetNames.has('native-build-info.json'),
  );
  if (existingMetadata) {
    const previous = JSON.parse(await readFile(existingMetadata, 'utf8'));
    if (
      previous.tag !== tag ||
      previous.sourceCommit !== sourceCommit ||
      previous.buildProfile !== profile ||
      previous.nativeRuntimeSignature !== metadata.nativeRuntimeSignature
    ) {
      fail('Existing Release metadata belongs to a different source or native runtime. Use a new tag.');
    }
  } else if (!created) {
    if (release.immutable === true) {
      fail('Immutable Release has no provenance metadata and cannot be repaired in place. Use a new tag.');
    }
    if (!release.draft) {
      fail('Published Release has no provenance metadata and will not be overwritten. Use a new tag.');
    }
  }

  if (release.immutable === true) {
    const comparisonDirectory = path.join(temporaryDirectory, 'immutable');
    await mkdir(comparisonDirectory, { recursive: true });
    for (const name of expectedNames) {
      const downloaded = await downloadAsset(
        tag,
        name,
        comparisonDirectory,
        repository,
        remoteAssetNames.has(name),
      );
      if (!downloaded) {
        fail(`Immutable Release is missing ${name}; use a new tag.`);
      }
      if ((await sha256(downloaded)) !== localDigests.get(name)) {
        fail(`Immutable Release asset ${name} differs; use a new tag.`);
      }
    }
    assertRemoteTagCommit(repository, tag, sourceCommit);
    console.log('Immutable Release already contains byte-identical assets; publication is a no-op.');
  } else {
    assertRemoteTagCommit(repository, tag, sourceCommit);
    gh([
      'release',
      'upload',
      tag,
      ...assetPaths,
      '--clobber',
      '--repo',
      repository,
    ]);

    const verificationDirectory = path.join(temporaryDirectory, 'verify');
    await mkdir(verificationDirectory, { recursive: true });
    release = queryRelease(repository, tag);
    validateReleaseState(release, tag, profile);
    remoteAssetNames = releaseAssetNames(release);
    for (const name of expectedNames) {
      const downloaded = await downloadAsset(
        tag,
        name,
        verificationDirectory,
        repository,
        remoteAssetNames.has(name),
      );
      if (!downloaded || (await sha256(downloaded)) !== localDigests.get(name)) {
        fail(`Uploaded Release asset ${name} failed checksum verification.`);
      }
    }
    assertRemoteTagCommit(repository, tag, sourceCommit);
    if (release.draft) {
      gh(['release', 'edit', tag, '--draft=false', '--repo', repository]);
      release = queryRelease(repository, tag);
      validateReleaseState(release, tag, profile);
      assert(!release.draft, 'GitHub Release remained a draft after publication.');
    }
    console.log(`Published ${expectedNames.length} verified assets to ${tag}.`);
  }

  const finalAssetNames = (await readdir(RELEASE_DIRECTORY)).sort();
  console.log(`Local release inputs: ${finalAssetNames.join(', ')}`);
}

export async function publishRelease() {
  let temporaryDirectory;
  try {
    await performPublication((directory) => {
      temporaryDirectory = directory;
    });
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await publishRelease();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
