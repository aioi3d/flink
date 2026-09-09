import type { LibraryEntry } from '../../native/contracts';

export type LibrarySortField = 'name' | 'modifiedAt' | 'size';
export type SortDirection = 'asc' | 'desc';

export interface LibrarySortDescriptor {
  field: LibrarySortField;
  direction: SortDirection;
}

export type LibrarySortOrder =
  | 'nameAsc'
  | 'nameDesc'
  | 'modifiedAtAsc'
  | 'modifiedAtDesc'
  | 'sizeAsc'
  | 'sizeDesc';

export interface LibraryQuery {
  searchText: string;
  sort: LibrarySortDescriptor | LibrarySortOrder;
}

export type LibraryEntryPredicate = (entry: LibraryEntry) => boolean;

