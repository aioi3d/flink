#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

const PRODUCTION_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/;
const DEVELOPMENT_TAG =
  /^dev-runtime-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/;

export class BuildInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildInputError';
  }
}

function requireText(value, name, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BuildInputError(`${name} is required.`);
  }
  if (value !== value.trim()) {
    throw new BuildInputError(`${name} must not have leading or trailing whitespace.`);
  }
  if (value.length > maximumLength) {
    throw new BuildInputError(`${name} is too long.`);
  }
  if (/\p{Cc}/u.test(value)) {
    throw new BuildInputError(`${name} must not contain control characters.`);
  }
  return value;
}

export function validateBuildInputs(input) {
  const eventName = requireText(input.eventName, 'eventName', 32);
  const tag = requireText(input.tag, 'tag', 80);
  const profile = requireText(input.profile, 'profile', 32);
  const reason = requireText(input.reason, 'reason', 200);
  const githubRef = input.githubRef || '';
  const appVersion = input.appVersion || null;
  const nativeRuntimeVersion = input.nativeRuntimeVersion || null;

  if (
    nativeRuntimeVersion &&
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(
      nativeRuntimeVersion,
    )
  ) {
    throw new BuildInputError('nativeRuntimeVersion must be a semantic version.');
  }

  if (eventName !== 'push' && eventName !== 'workflow_dispatch') {
    throw new BuildInputError(`Unsupported workflow event: ${eventName}`);
  }
  if (profile !== 'development' && profile !== 'production') {
    throw new BuildInputError(`Unsupported build profile: ${profile}`);
  }

  const tagPattern = profile === 'production' ? PRODUCTION_TAG : DEVELOPMENT_TAG;
  if (!tagPattern.test(tag)) {
    throw new BuildInputError(
      profile === 'production'
        ? 'Production requires a vMAJOR.MINOR.PATCH tag.'
        : 'Development requires a dev-runtime-vMAJOR.MINOR.PATCH tag.',
    );
  }

  if (eventName === 'push') {
    if (profile !== 'production') {
      throw new BuildInputError('A tag push can only request the production profile.');
    }
    if (githubRef !== `refs/tags/${tag}`) {
      throw new BuildInputError('The push ref does not exactly match the requested tag ref.');
    }
  }

  const version = tag.replace(
    profile === 'production' ? /^v/ : /^dev-runtime-v/,
    '',
  );
  if (profile === 'production' && appVersion && version !== appVersion) {
    throw new BuildInputError(
      `Production tag version ${version} does not match Expo app version ${appVersion}.`,
    );
  }
  if (
    profile === 'development' &&
    nativeRuntimeVersion &&
    version !== nativeRuntimeVersion
  ) {
    throw new BuildInputError(
      `Development tag version ${version} does not match native runtime version ${nativeRuntimeVersion}.`,
    );
  }

  return {
    eventName,
    tag,
    tagRef: `refs/tags/${tag}`,
    profile,
    reason,
    version,
  };
}

async function run() {
  const argumentsProvided = process.argv.slice(2);
  const unknownArgument = argumentsProvided.find(
    (value) => value !== '--skip-app-version' && value !== '--github-output',
  );
  if (unknownArgument) {
    throw new BuildInputError(`Unknown option: ${unknownArgument}`);
  }
  const skipAppVersion = argumentsProvided.includes('--skip-app-version');
  const writeGithubOutput = argumentsProvided.includes('--github-output');
  const [appJson, nativeRuntime] = await Promise.all([
    readFile(path.join(PROJECT_ROOT, 'app.json'), 'utf8').then(JSON.parse),
    readFile(path.join(PROJECT_ROOT, 'config', 'native-runtime.json'), 'utf8').then(
      JSON.parse,
    ),
  ]);
  const result = validateBuildInputs({
    eventName: process.env.FLINK_EVENT_NAME,
    tag: process.env.FLINK_TAG,
    profile: process.env.FLINK_PROFILE,
    reason: process.env.FLINK_REASON,
    githubRef: process.env.FLINK_GITHUB_REF,
    appVersion: skipAppVersion ? null : appJson.expo?.version,
    nativeRuntimeVersion: skipAppVersion
      ? null
      : nativeRuntime.nativeRuntimeVersion,
  });

  if (writeGithubOutput) {
    if (!process.env.GITHUB_OUTPUT) {
      throw new BuildInputError('GITHUB_OUTPUT is required with --github-output.');
    }
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `tag=${result.tag}\nprofile=${result.profile}\nversion=${result.version}\nnative_runtime_version=${nativeRuntime.nativeRuntimeVersion}\n`,
      'utf8',
    );
  }

  // This output intentionally contains only validated, non-secret values.
  console.log(JSON.stringify(result, null, 2));
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
