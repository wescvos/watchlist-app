import type { SearchResultWithLibrary } from "@/lib/types";

export interface SearchState {
  q: string;
  results: SearchResultWithLibrary[];
  searched: boolean;
  searchedFor: string;
  searchError: string;
}

// Module-level so it survives a SearchPage remount (e.g. Back from a title):
// the last query + results render on the very first frame instead of blanking
// to the poster wall and re-fetching (the search-flow flash). Directly mirrors
// listCache for the home lists.
export const searchCache: SearchState = {
  q: "",
  results: [],
  searched: false,
  searchedFor: "",
  searchError: "",
};

export function resetSearchCache() {
  searchCache.q = "";
  searchCache.results = [];
  searchCache.searched = false;
  searchCache.searchedFor = "";
  searchCache.searchError = "";
}
