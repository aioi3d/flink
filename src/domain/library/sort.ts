import type { LibraryEntry } from '../../native/contracts';
import type {
  LibrarySortDescriptor,
  LibrarySortOrder,
  SortDirection,
} from './types';

export const librarySortOptions: readonly LibrarySortOrder[] = Object.freeze([
  'nameAsc',
  'nameDesc',
  'modifiedAtAsc',
  'modifiedAtDesc',
  'sizeAsc',
  'sizeDesc',
]);

const japaneseNaturalCollator = new Intl.Collator('ja', {
  numeric: true,
  sensitivity: 'base',
});

function compareText(left: string, right: string): number {
  return japaneseNaturalCollator.compare(left.normalize('NFKC'), right.normalize('NFKC'));
}

function directionMultiplier(direction: SortDirection): 1 | -1 {
  return direction === 'asc' ? 1 : -1;
}

export function resolveLibrarySortDescriptor(
  sort: LibrarySortDescriptor | LibrarySortOrder,
): LibrarySortDescriptor {
  if (typeof sort !== 'string') {
    return sort;
  }

  switch (sort) {
    case 'nameAsc':
      return { field: 'name', direction: 'asc' };
    case 'nameDesc':
      return { field: 'name', direction: 'desc' };
    case 'modifiedAtAsc':
      return { field: 'modifiedAt', direction: 'asc' };
    case 'modifiedAtDesc':
      return { field: 'modifiedAt', direction: 'desc' };
    case 'sizeAsc':
      return { field: 'size', direction: 'asc' };
    case 'sizeDesc':
      return { field: 'size', direction: 'desc' };
  }
}

function compareKnownNumbers(
  left: number | null,
  right: number | null,
  direction: SortDirection,
): number {
  const leftKnown = left !== null && Number.isFinite(left);
  const rightKnown = right !== null && Number.isFinite(right);

  // Unknown metadata remains after known metadata in both directions.
  if (leftKnown !== rightKnown) {
    return leftKnown ? -1 : 1;
  }

  if (!leftKnown || !rightKnown || left === right) {
    return 0;
  }

  return (left < right ? -1 : 1) * directionMultiplier(direction);
}

function compareTieBreakers(left: LibraryEntry, right: LibraryEntry): number {
  const byName = compareText(left.name, right.name);
  if (byName !== 0) {
    return byName;
  }

  return compareText(left.relativePath, right.relativePath);
}

function compareEntries(
  left: LibraryEntry,
  right: LibraryEntry,
  sort: LibrarySortDescriptor,
): number {
  let primary = 0;

  switch (sort.field) {
    case 'name':
      primary = compareText(left.name, right.name) * directionMultiplier(sort.direction);
      break;
    case 'modifiedAt':
      primary = compareKnownNumbers(
        left.modifiedAtUnixMs,
        right.modifiedAtUnixMs,
        sort.direction,
      );
      break;
    case 'size':
      primary = compareKnownNumbers(left.sizeBytes, right.sizeBytes, sort.direction);
      break;
  }

  return primary !== 0 ? primary : compareTieBreakers(left, right);
}

/**
 * Returns a new array. The source is never mutated, and the original position
 * is the final tie breaker so fully-equal metadata remains stable.
 */
export function sortLibraryEntries(
  entries: readonly LibraryEntry[],
  requestedSort: LibrarySortDescriptor | LibrarySortOrder,
): LibraryEntry[] {
  const sort = resolveLibrarySortDescriptor(requestedSort);

  return entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort((left, right) => {
      const comparison = compareEntries(left.entry, right.entry, sort);
      return comparison !== 0 ? comparison : left.originalIndex - right.originalIndex;
    })
    .map(({ entry }) => entry);
}

