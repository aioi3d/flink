import type { LibraryEntry } from '../../native/contracts';
import { searchLibraryEntries } from './search';
import { sortLibraryEntries } from './sort';
import type { LibraryQuery } from './types';

export function selectLibraryEntries(
  entries: readonly LibraryEntry[],
  query: LibraryQuery,
): LibraryEntry[] {
  return sortLibraryEntries(searchLibraryEntries(entries, query.searchText), query.sort);
}

