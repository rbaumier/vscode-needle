export interface SearchResults {
  count: number;
  lineIndices: number[];
  lineByteStarts: number[];
  lineByteEnds: number[];
  matchStarts: number[];
  matchEnds: number[];
}

export interface SearchMatch {
  lineIndex: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
  matchIndices: number[];
  selectionStart: number;
  selectionEnd: number;
  highlights: [number, number][];
}

export declare function searchText(text: string, pattern: string, limit?: number): SearchResults;
export declare function searchFile(path: string, pattern: string, limit?: number): SearchResults;
export declare function search(lines: string[], pattern: string, limit?: number): SearchMatch[];
