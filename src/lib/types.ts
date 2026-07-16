export type MediaKind = "MOVIE" | "TV";

export interface SearchResult {
  tmdbId: number;
  mediaType: MediaKind;
  title: string;
  year: number | null;
  posterUrl: string | null;
  popularity: number;
  voteCount: number;
}

export interface LibraryMatch {
  id: string;
  status: "WANT" | "WATCHED";
}

export interface SearchResultWithLibrary extends SearchResult {
  library: LibraryMatch | null;
}

export interface CastMember {
  name: string;
  character: string;
  profileUrl: string | null;
}

export interface TmdbDetails {
  tmdbId: number;
  mediaType: MediaKind;
  imdbId: string | null;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
  runtime: number | null;
  genres: string[];
  cast: CastMember[];
  director: string | null;
  tmdbScore: number | null;
}
