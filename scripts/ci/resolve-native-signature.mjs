#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateNativeSignature } from '../lib/native-signature.mjs';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

function appendOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return Promise.resolve();
  }
  return import('node:fs/promises').then(({ appendFile }) =>
    appendFile(outputPath, `${name}=${value}\n`, 'utf8'),
  );
}

try {
  const profile = process.env.FLINK_BUILD_PROFILE;
  if (profile !== 'development' && profile !== 'production') {
    throw new Error('FLINK_BUILD_PROFILE must be development or production.');
  }

  const result = await calculateNativeSignature({
    projectRoot: PROJECT_ROOT,
    buildProfile: profile,
  });
  if (result.unresolvedReasons.length > 0) {
    throw new Error(
      `Native signature inputs remain unresolved:\n- ${result.unresolvedReasons.join('\n- ')}`,
    );
  }

  const outputDirectory = path.join(PROJECT_ROOT, 'build', 'native');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, 'native-signature-manifest.json'),
    `${JSON.stringify(result.manifest, null, 2)}\n`,
    'utf8',
  );
  // Keep this output name in lockstep with
  // steps.signature.outputs.signature in build-ios-ipa.yml.
  await appendOutput('signature', result.signature);
  process.stdout.write(`${result.signature}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
