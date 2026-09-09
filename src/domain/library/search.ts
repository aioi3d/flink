import type { LibraryEntry } from '../../native/contracts';

/**
 * Search uses a compatibility-normalized, case-insensitive key while the
 * original display name remains untouched.
 */
export function normalizeLibrarySearchKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP');
}

export function libraryEntryMatchesSearch(entry: LibraryEntry, query: string): boolean {
  const searchKey = normalizeLibrarySearchKey(query.trim());
  if (searchKey.length === 0) {
    return true;
  }

  return normalizeLibrarySearchKey(entry.name).includes(searchKey);
}

export function searchLibraryEntries(
  entries: readonly LibraryEntry[],
  query: string,
): LibraryEntry[] {
  return entries.filter((entry) => libraryEntryMatchesSearch(entry, query));
}

