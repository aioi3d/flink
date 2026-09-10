#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROJECT_ROOT,
  calculateNativeSignature,
} from './lib/native-signature.mjs';

function parseArguments(values) {
  const options = {
    json: false,
    requireResolved: false,
    installedPath: null,
    buildProfile: null,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--json') {
      options.json = true;
    } else if (value === '--require-resolved') {
      options.requireResolved = true;
    } else if (value === '--installed') {
      index += 1;
      if (!values[index]) {
        throw new Error('--installed requires a file path.');
      }
      options.installedPath = values[index];
    } else if (value === '--profile') {
      index += 1;
      if (values[index] !== 'development' && values[index] !== 'production') {
        throw new Error('--profile requires development or production.');
      }
      options.buildProfile = values[index];
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }
  return options;
}

function isBuildProfile(value) {
  return value === 'development' || value === 'production';
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function validateInstalledMetadata(value) {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Installed native build metadata must be a JSON object.');
  }
  if (!isBuildProfile(value.buildProfile)) {
    throw new Error(
      'Installed native build profile must be development or production.',
    );
  }
  return value;
}

try {
  const options = parseArguments(process.argv.slice(2));
  const runtime = await readJson(
    path.join(DEFAULT_PROJECT_ROOT, 'config', 'native-runtime.json'),
  );
  const installedPath = path.resolve(
    DEFAULT_PROJECT_ROOT,
    options.installedPath ?? runtime.installedBuildInfo?.defaultPath,
  );
  const installed = validateInstalledMetadata(await readOptionalJson(installedPath));
  const environmentProfile = process.env.FLINK_BUILD_PROFILE;
  if (environmentProfile !== undefined && !isBuildProfile(environmentProfile)) {
    throw new Error('FLINK_BUILD_PROFILE must be development or production.');
  }
  const calculated = await calculateNativeSignature({
    buildProfile:
      options.buildProfile ??
      environmentProfile ??
      installed?.buildProfile ??
      'production',
  });
  const buildProfile = calculated.manifest.buildProfile;
  const configuredSignature =
    runtime.signature?.recordedSignatures?.[buildProfile] ??
    runtime.signature?.recordedSignature ??
    null;

  const mismatches = [];
  for (const reason of calculated.unresolvedReasons) {
    if (reason !== 'native-locks/ios/Podfile.lock is unresolved.') {
      mismatches.push(`Native signature input is unresolved: ${reason}`);
    }
  }
  if (configuredSignature && configuredSignature !== calculated.signature) {
    mismatches.push('The recorded native signature does not match current native inputs.');
  }
  if (installed !== undefined) {
    if (installed.nativeApiVersion !== runtime.nativeApiVersion) {
      mismatches.push('The installed runtime native API version is incompatible.');
    }
    if (installed.nativeRuntimeSignature !== calculated.signature) {
      mismatches.push('The installed runtime signature does not match current native inputs.');
    }
    if (installed.nativeRuntimeVersion !== runtime.nativeRuntimeVersion) {
      mismatches.push('The installed native runtime version is incompatible.');
    }
    if (installed.buildProfile !== buildProfile) {
      mismatches.push('The installed native build profile is incompatible.');
    }
  }

  const unresolvedReasons = [
    ...(runtime.signature?.resolutionStatus === 'unresolved'
      ? runtime.signature.unresolvedReasons ?? []
      : []),
    ...calculated.unresolvedReasons,
    ...(installed === undefined
      ? ['Installed native build metadata was not provided.']
      : []),
  ];
  const status =
    mismatches.length > 0
      ? 'mismatch'
      : unresolvedReasons.length > 0
        ? 'unresolved'
        : 'compatible';
  const report = {
    status,
    nativeApiVersion: runtime.nativeApiVersion,
    nativeRuntimeVersion: runtime.nativeRuntimeVersion,
    buildProfile,
    nativeRuntimeSignature: calculated.signature,
    inputCount: calculated.manifest.inputs.length,
    installedMetadataPresent: installed !== undefined,
    unresolvedReasons: [...new Set(unresolvedReasons)].sort(),
    mismatches,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`native check: ${status}`);
    console.log(`native API: ${report.nativeApiVersion}`);
    console.log(`native runtime: ${report.nativeRuntimeVersion}`);
    console.log(`build profile: ${report.buildProfile}`);
    console.log(`signature: ${report.nativeRuntimeSignature}`);
    for (const reason of report.unresolvedReasons) {
      console.log(`unresolved: ${reason}`);
    }
    for (const mismatch of report.mismatches) {
      console.error(`mismatch: ${mismatch}`);
    }
  }

  if (mismatches.length > 0 || (options.requireResolved && status !== 'compatible')) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
