import { Position, type QuickPickItem, Selection, window } from "vscode";
import { type SearchResults, searchText } from "../rust-needle";
import { searchCache } from "./cache";

export type QuickPickLineItem = QuickPickItem & {
  selection: Selection;
  isMore?: boolean;
};

const DEFAULT_LIMIT = 10_000;
const ELLIPSIS = "... ";
const MAX_VISIBLE_BEFORE_MATCH = 60;
const CONTEXT_BEFORE_MATCH = 20;

function resultsToQuickPickItems(results: SearchResults, text: string): QuickPickLineItem[] {
  const items: QuickPickLineItem[] = [];

  for (let i = 0; i < results.count; i++) {
    const lineNumber = results.lineIndices[i];
    const lineNumberStr = String(lineNumber + 1);

    // Extract line content from text using byte offsets (works for ASCII; for UTF-16 JS strings, byte offset == char index for ASCII)
    const lineContent = text.substring(results.lineByteStarts[i], results.lineByteEnds[i]);
    const matchStart = results.matchStarts[i];
    const matchEnd = results.matchEnds[i];

    const trimmedContent = lineContent.trimStart();
    const indentStripped = lineContent.length - trimmedContent.length;

    const matchStartInTrimmed = matchStart - indentStripped;

    let displayContent = trimmedContent;
    let contentOffset = indentStripped;
    let ellipsisPrefix = "";

    if (matchStartInTrimmed > MAX_VISIBLE_BEFORE_MATCH) {
      const trimStart = matchStartInTrimmed - CONTEXT_BEFORE_MATCH;
      displayContent = trimmedContent.substring(trimStart);
      contentOffset = indentStripped + trimStart;
      ellipsisPrefix = ELLIPSIS;
    }

    const lineNumberPrefix = `${lineNumberStr}: `;
    const totalPrefixLength = lineNumberPrefix.length + ellipsisPrefix.length;

    const highlights: [number, number][] = [
      [totalPrefixLength + matchStart - contentOffset, totalPrefixLength + matchEnd - contentOffset],
    ];

    items.push({
      label: `${lineNumberStr}: ${ellipsisPrefix}${displayContent}`,
      description: "",
      picked: i === 0,
      alwaysShow: true,
      highlights,
      selection: new Selection(
        new Position(lineNumber, results.selectionStarts[i]),
        new Position(lineNumber, results.selectionEnds[i])
      ),
    });
  }

  return items;
}

function findInDocument(pattern: string, limit: number): { results: SearchResults; text: string } | null {
  if (pattern.length === 0) {
    return { results: { count: 0, lineIndices: [], lineByteStarts: [], lineByteEnds: [], matchStarts: [], matchEnds: [], selectionStarts: [], selectionEnds: [] }, text: "" };
  }

  const activeDocument = window.activeTextEditor?.document;
  if (!activeDocument) {
    return null;
  }

  const filePath = activeDocument.uri.fsPath;
  const fileVersion = activeDocument.version;

  const cached = searchCache.get(filePath, pattern, fileVersion);
  if (cached && cached.results.count >= limit + 1) {
    return cached;
  }

  const text = activeDocument.getText();
  const results = searchText(text, pattern, limit + 1);

  const entry = { results, text };
  searchCache.set(filePath, pattern, fileVersion, entry);

  return entry;
}

export function search(pattern: string, limit = DEFAULT_LIMIT): QuickPickLineItem[] {
  const found = findInDocument(pattern, limit);
  if (!found) {
    return [];
  }

  const { results, text } = found;
  const hasMore = results.count > limit;

  // Slice results if we got more than limit
  const displayCount = hasMore ? limit : results.count;
  const displayResults: SearchResults = hasMore
    ? {
        count: displayCount,
        lineIndices: results.lineIndices.slice(0, displayCount),
        lineByteStarts: results.lineByteStarts.slice(0, displayCount),
        lineByteEnds: results.lineByteEnds.slice(0, displayCount),
        matchStarts: results.matchStarts.slice(0, displayCount),
        matchEnds: results.matchEnds.slice(0, displayCount),
        selectionStarts: results.selectionStarts.slice(0, displayCount),
        selectionEnds: results.selectionEnds.slice(0, displayCount),
      }
    : results;

  const items = resultsToQuickPickItems(displayResults, text);

  if (hasMore) {
    items.push({
      label: "$(ellipsis) Load more results...",
      description: "",
      alwaysShow: true,
      isMore: true,
      selection: items[items.length - 1].selection,
    });
  }

  return items;
}
