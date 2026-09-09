#!/usr/bin/env node

import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

function parseArguments(values) {
  let output = path.join(PROJECT_ROOT, 'tests', 'fixtures', '.generated');
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== '--output' || !values[index + 1]) {
      throw new Error('Usage: node scripts/fixtures/generate-pdf-fixtures.mjs [--output DIRECTORY]');
    }
    output = path.resolve(values[index + 1]);
    index += 1;
  }
  return { output };
}

function escapePdfText(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function createPdf(pages) {
  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageObjectNumbers = [];
  pages.forEach((page, index) => {
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    pageObjectNumbers.push(pageObject);
    const rotate = page.rotate ? ` /Rotate ${page.rotate}` : '';
    objects.set(
      pageObject,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}]${rotate} /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
    );
    const content = `BT /F1 72 Tf 72 ${Math.max(100, page.height - 120)} Td (${escapePdfText(page.label)}) Tj ET\n`;
    objects.set(
      contentObject,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    );
  });
  objects.set(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers
      .map((number) => `${number} 0 R`)
      .join(' ')}] >>`,
  );

  const maximumObject = Math.max(...objects.keys());
  const chunks = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'binary')];
  const offsets = new Array(maximumObject + 1).fill(0);
  let byteOffset = chunks[0].byteLength;
  for (let number = 1; number <= maximumObject; number += 1) {
    const body = Buffer.from(`${number} 0 obj\n${objects.get(number)}\nendobj\n`, 'utf8');
    offsets[number] = byteOffset;
    chunks.push(body);
    byteOffset += body.byteLength;
  }

  const xrefOffset = byteOffset;
  const xref = [
    `xref\n0 ${maximumObject + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${maximumObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join('');
  chunks.push(Buffer.from(xref, 'utf8'));
  return Buffer.concat(chunks);
}

async function writeNew(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, { flag: 'wx' });
}

async function run() {
  const { output } = parseArguments(process.argv.slice(2));
  await mkdir(output, { recursive: true });

  const normalPath = path.join(output, 'normal-3-pages.pdf');
  await writeNew(
    normalPath,
    createPdf([
      { width: 595, height: 842, label: '1' },
      { width: 595, height: 842, label: '2' },
      { width: 595, height: 842, label: '3' },
    ]),
  );
  await writeNew(
    path.join(output, 'one-page.pdf'),
    createPdf([{ width: 595, height: 842, label: '1' }]),
  );
  await writeNew(
    path.join(output, 'mixed-page-sizes.pdf'),
    createPdf([
      { width: 595, height: 842, label: 'portrait' },
      { width: 842, height: 595, label: 'landscape' },
      { width: 595, height: 842, rotate: 90, label: 'rotated' },
    ]),
  );

  for (const relativeName of [
    '日本語 書籍 2.pdf',
    '日本語 書籍 10.pdf',
    '絵文字-📘.pdf',
    '大文字.PDF',
    '同名.pdf',
    path.join('サブフォルダ', '同名.pdf'),
  ]) {
    const destination = path.join(output, relativeName);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(normalPath, destination, 1);
  }

  await writeNew(path.join(output, 'not-a-pdf.txt'), 'This is intentionally not a PDF.\n');
  await writeNew(path.join(output, 'fake-header.pdf'), '%PDF-1.7\nintentionally corrupt\n');
  await writeNew(path.join(output, 'zero-byte.pdf'), Buffer.alloc(0));
  await writeNew(
    path.join(output, 'generated-fixtures.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generator: 'scripts/fixtures/generate-pdf-fixtures.mjs',
        containsLargeFiles: false,
        containsPersonalData: false,
        notes: [
          'Files are synthetic and intended only for Phase 1 through Phase 4 functional checks.',
          'Password-protected, 10,000-page, 3 GB, and image-heavy fixtures require the separate preparation documented in tests/fixtures/README.md.',
        ],
      },
      null,
      2,
    )}\n`,
  );

  console.log('Generated small synthetic PDF fixtures.');
  console.log(`Files written: ${output === path.join(PROJECT_ROOT, 'tests', 'fixtures', '.generated') ? 'tests/fixtures/.generated' : 'custom output directory'}`);
}

try {
  await run();
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'EEXIST') {
    console.error('A fixture already exists. Choose a new empty output directory; files are never overwritten.');
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
