import { describe, expect, it } from 'vitest';

import {
  decidePdfRename,
  parsePdfRenameInput,
  searchLibraryEntries,
  selectLibraryEntries,
  sortLibraryEntries,
  utf8ByteLength,
  validatePdfBaseName,
} from '../../src/domain/library';
import type { LibrarySortOrder } from '../../src/domain/library';
import type { LibraryEntry } from '../../src/native/contracts';

function entry(
  fileId: string,
  name: string,
  relativePath: string,
  modifiedAtUnixMs: number | null,
  sizeBytes: number,
): LibraryEntry {
  return {
    fileId,
    revision: `revision-${fileId}`,
    name,
    relativePath,
    modifiedAtUnixMs,
    sizeBytes,
    status: 'ready',
  };
}

const SORT_ENTRIES = [
  entry('a', '資料10.pdf', 'root/資料10.pdf', 300, 300),
  entry('b', '資料2.pdf', 'root/資料2.pdf', 100, 200),
  entry('c', '資料1.pdf', 'folder-b/資料1.pdf', 200, 100),
  entry('d', '資料1.pdf', 'folder-a/資料1.pdf', 200, 100),
  entry('e', '資料3.pdf', 'root/資料3.pdf', null, 400),
];

describe('library Unicode search', () => {
  it('matches normalized, case-insensitive filename substrings', () => {
    const entries = [
      entry('accent', 'Cafe\u0301.PDF', 'Cafe\u0301.PDF', 1, 1),
      entry('width', 'Ｒｅｐｏｒｔ１２.PDF', 'Ｒｅｐｏｒｔ１２.PDF', 1, 1),
      entry('jp', '日本の絶景 旅の記録.pdf', '日本の絶景 旅の記録.pdf', 1, 1),
    ];

    expect(searchLibraryEntries(entries, 'CAFÉ').map(({ fileId }) => fileId)).toEqual([
      'accent',
    ]);
    expect(searchLibraryEntries(entries, 'report12').map(({ fileId }) => fileId)).toEqual([
      'width',
    ]);
    expect(searchLibraryEntries(entries, '絶景 旅').map(({ fileId }) => fileId)).toEqual([
      'jp',
    ]);
  });

  it('searches only the filename and preserves original entries', () => {
    const item = entry('a', '表紙.pdf', '秘密のfolder/表紙.pdf', 1, 1);
    const source = [item];
    expect(searchLibraryEntries(source, '秘密')).toEqual([]);
    expect(searchLibraryEntries(source, '  ')).toEqual(source);
    expect(source[0].name).toBe('表紙.pdf');
  });
});

describe('library stable six-way sort', () => {
  it.each<[LibrarySortOrder, string[]]>([
    ['nameAsc', ['d', 'c', 'b', 'e', 'a']],
    ['nameDesc', ['a', 'e', 'b', 'd', 'c']],
    ['modifiedAtAsc', ['b', 'd', 'c', 'a', 'e']],
    ['modifiedAtDesc', ['a', 'd', 'c', 'b', 'e']],
    ['sizeAsc', ['d', 'c', 'b', 'a', 'e']],
    ['sizeDesc', ['e', 'a', 'b', 'd', 'c']],
  ])('%s has deterministic primary and tie-break ordering', (sort, expectedIds) => {
    expect(sortLibraryEntries(SORT_ENTRIES, sort).map(({ fileId }) => fileId)).toEqual(
      expectedIds,
    );
  });

  it('keeps unknown modified dates after known dates in both directions', () => {
    for (const sort of ['modifiedAtAsc', 'modifiedAtDesc'] as const) {
      expect(sortLibraryEntries(SORT_ENTRIES, sort).at(-1)?.fileId).toBe('e');
    }
  });

  it('does not mutate the source and preserves input order after complete ties', () => {
    const first = entry('first', '同じ.pdf', 'same/同じ.pdf', 100, 100);
    const second = { ...first, fileId: 'second' };
    const source = [second, first];
    const before = [...source];

    expect(sortLibraryEntries(source, 'sizeAsc').map(({ fileId }) => fileId)).toEqual([
      'second',
      'first',
    ]);
    expect(source).toEqual(before);
  });

  it('composes search and sorting without opening or changing metadata', () => {
    const selected = selectLibraryEntries(SORT_ENTRIES, {
      searchText: '資料1',
      sort: { field: 'modifiedAt', direction: 'desc' },
    });
    expect(selected.map(({ fileId }) => fileId)).toEqual(['a', 'd', 'c']);
  });
});

describe('PDF rename input validation', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['.', 'dot-segment'],
    ['..', 'dot-segment'],
    ['folder/name', 'path-separator'],
    ['folder\\name', 'path-separator'],
    ['bad\0name', 'control-character'],
    ['line\nbreak', 'control-character'],
  ] as const)('rejects %j as %s', (name, code) => {
    expect(validatePdfBaseName(name)).toEqual({ ok: false, code });
  });

  it('rejects unpaired surrogate input', () => {
    expect(validatePdfBaseName('\ud800')).toEqual({
      ok: false,
      code: 'unpaired-surrogate',
    });
  });

  it('measures the complete PDF filename in UTF-8 bytes', () => {
    const atLimit = 'a'.repeat(251); // 251 + four bytes for .pdf
    expect(utf8ByteLength(`${atLimit}.pdf`)).toBe(255);
    expect(validatePdfBaseName(atLimit)).toEqual({ ok: true, value: atLimit });
    expect(validatePdfBaseName('a'.repeat(252))).toEqual({
      ok: false,
      code: 'too-long',
    });
  });

  it('preserves valid whitespace and emoji while maintaining one PDF extension', () => {
    expect(parsePdfRenameInput('季節 を味わう 🍝.PDF')).toEqual({
      ok: true,
      value: {
        baseName: '季節 を味わう 🍝',
        fileName: '季節 を味わう 🍝.pdf',
      },
    });
    expect(parsePdfRenameInput('.pdf')).toEqual({ ok: false, code: 'empty' });
  });

  it('detects conflicts canonically without blocking case-only rename of the current file', () => {
    expect(decidePdfRename('CAFE\u0301', 'old.pdf', ['café.pdf'])).toEqual({
      ok: false,
      code: 'name-conflict',
    });

    expect(decidePdfRename('REPORT', 'Report.pdf', [])).toEqual({
      ok: true,
      value: {
        baseName: 'REPORT',
        fileName: 'REPORT.pdf',
        noOp: false,
      },
    });
    expect(decidePdfRename('Report', 'Report.pdf', [])).toMatchObject({
      ok: true,
      value: { noOp: true },
    });
  });
});
