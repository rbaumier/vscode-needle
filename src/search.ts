import { Position, type QuickPickItem, Selection, window } from "vscode";
import { type SearchResults, searchText } from "../rust-needle";
import { searchCache } from "./cache";

export type QuickPickLineItem = QuickPickItem & {
  selection: Selection;
  isMore?: boolean;
  highlights?: [number, number][];
};

const DEFAULT_LIMIT = 200;
const ELLIPSIS = "... ";
const MAX_VISIBLE_BEFORE_MATCH = 60;
const CONTEXT_BEFORE_MATCH = 20;

const WORD_RE = /\w/;

/** Expand match to word boundaries in the line content. */
function selectionBounds(lineContent: string, matchStart: number, matchEnd: number): [number, number] {
  let s = matchStart;
  while (s > 0 && WORD_RE.test(lineContent.charAt(s - 1))) s--;
  let e = matchEnd;
  while (e < lineContent.length && WORD_RE.test(lineContent.charAt(e))) e++;
  return [s, e];
}

function resultsToQuickPickItems(results: SearchResults, text: string): QuickPickLineItem[] {
  const items: QuickPickLineItem[] = [];

  for (let i = 0; i < results.count; i++) {
    const lineNumber = results.lineIndices[i] ?? 0;
    const lineNumberStr = String(lineNumber + 1);
    const lineContent = text.substring(results.lineByteStarts[i] ?? 0, results.lineByteEnds[i] ?? 0);
    const matchStart = results.matchStarts[i] ?? 0;
    const matchEnd = results.matchEnds[i] ?? 0;

    const [selStart, selEnd] = selectionBounds(lineContent, matchStart, matchEnd);

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

    items.push({
      label: `${lineNumberStr}: ${ellipsisPrefix}${displayContent}`,
      description: "",
      picked: i === 0,
      alwaysShow: true,
      highlights: [[totalPrefixLength + matchStart - contentOffset, totalPrefixLength + matchEnd - contentOffset]],
      selection: new Selection(
        new Position(lineNumber, selStart),
        new Position(lineNumber, selEnd)
      ),
    });
  }

  return items;
}

function findInDocument(pattern: string, limit: number): { results: SearchResults; text: string } | null {
  if (pattern.length === 0) {
    return { results: { count: 0, lineIndices: [], lineByteStarts: [], lineByteEnds: [], matchStarts: [], matchEnds: [] }, text: "" };
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
  const displayCount = hasMore ? limit : results.count;

  const displayResults: SearchResults = hasMore
    ? {
        count: displayCount,
        lineIndices: results.lineIndices.slice(0, displayCount),
        lineByteStarts: results.lineByteStarts.slice(0, displayCount),
        lineByteEnds: results.lineByteEnds.slice(0, displayCount),
        matchStarts: results.matchStarts.slice(0, displayCount),
        matchEnds: results.matchEnds.slice(0, displayCount),
      }
    : results;

  const items = resultsToQuickPickItems(displayResults, text);

  if (hasMore) {
    items.push({
      label: "$(ellipsis) Load more results...",
      description: "",
      alwaysShow: true,
      isMore: true,
      selection: items.at(-1)?.selection ?? new Selection(new Position(0, 0), new Position(0, 0)),
    });
  }

  return items;
}
