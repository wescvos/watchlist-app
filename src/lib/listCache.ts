import type { CardTitle } from "@/components/TitleCard";

export type Status = "WANT" | "WATCHED";

export interface ListState {
  titles: CardTitle[];
  loaded: boolean;
  fetching: boolean;
  error: boolean;
}

export const emptyListState: ListState = { titles: [], loaded: false, fetching: false, error: false };

// Module-level so it survives a Home remount (e.g. Back from a title detail
// page), not just tab switches within one mount — otherwise the return trip
// shows an empty skeleton for a beat, which visually breaks scroll restoration
// even though the browser technically restored the scroll offset underneath.
// Also readable by other pages (e.g. the search page's poster wall) so they
// can reuse data Home has already loaded instead of re-fetching it.
export const listCache: Record<Status, ListState> = { WANT: emptyListState, WATCHED: emptyListState };
