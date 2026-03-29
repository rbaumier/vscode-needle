export interface SearchMatch {
  lineIndex: number;
  lineContent: string;
  score: number;
  matchStart: number;
  matchEnd: number;
  matchIndices: number[];
  selectionStart: number;
  selectionEnd: number;
  highlights: number[][];
}

export interface DocumentSource {
  text?: string;
  path?: string;
}

export declare function searchDocument(source: DocumentSource, pattern: string, limit?: number): SearchMatch[];
export declare function search(lines: string[], pattern: string, limit?: number): SearchMatch[];
