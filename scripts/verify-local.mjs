#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const scripts = [
  'typecheck',
  'lint',
  'test:unit',
  'verify:config',
  'native:check',
  'verify:ci',
];

for (const script of scripts) {
  console.log(`\n[verify:local] npm run ${script}`);
  const args = npmExecPath ? [npmExecPath, 'run', script] : ['run', script];
  const result = spawnSync(npmCommand, args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    console.error(
      `[verify:local] could not start npm for ${script}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    if (result.signal) {
      console.error(`[verify:local] ${script} ended from signal ${result.signal}.`);
    }
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) {
  console.log('\nLocal Phase 2 source verification completed successfully.');
}
