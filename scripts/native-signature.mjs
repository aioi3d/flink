#!/usr/bin/env node

import { calculateNativeSignature } from './lib/native-signature.mjs';

const values = process.argv.slice(2);
const flags = new Set();
let buildProfile;
for (let index = 0; index < values.length; index += 1) {
  const value = values[index];
  if (value === '--profile') {
    index += 1;
    if (values[index] !== 'development' && values[index] !== 'production') {
      console.error('--profile requires development or production.');
      process.exitCode = 2;
      break;
    }
    buildProfile = values[index];
  } else {
    flags.add(value);
  }
}
const unknownFlags = [...flags].filter(
  (flag) => flag !== '--json' && flag !== '--manifest',
);
if (process.exitCode) {
  // The invalid profile diagnostic was already printed while parsing.
} else if (unknownFlags.length > 0) {
  console.error(`Unknown option: ${unknownFlags[0]}`);
  process.exitCode = 2;
} else {
  try {
    const result = await calculateNativeSignature({ buildProfile });
    if (flags.has('--json')) {
      console.log(
        JSON.stringify(
          flags.has('--manifest')
            ? result
            : {
                signature: result.signature,
                unresolvedReasons: result.unresolvedReasons,
                inputCount: result.manifest.inputs.length,
              },
          null,
          2,
        ),
      );
    } else {
      console.log(`nativeRuntimeSignature: ${result.signature}`);
      console.log(`signatureInputs: ${result.manifest.inputs.length}`);
      if (result.unresolvedReasons.length > 0) {
        console.log('resolutionStatus: unresolved');
        for (const reason of result.unresolvedReasons) {
          console.log(`- ${reason}`);
        }
      } else {
        console.log('resolutionStatus: resolved');
      }
      if (flags.has('--manifest')) {
        console.log(JSON.stringify(result.manifest, null, 2));
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
