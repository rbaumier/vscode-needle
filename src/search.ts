import { Position, type QuickPickItem, Selection, window } from "vscode";
import { type DocumentSource, type SearchMatch, searchDocument } from "../rust-needle";
import { searchCache } from "./cache";

export type QuickPickLineItem = QuickPickItem & {
  selection: Selection;
  isMore?: boolean;
};

const DEFAULT_LIMIT = 10_000;
const ELLIPSIS = "... ";
const MAX_VISIBLE_BEFORE_MATCH = 60;
const CONTEXT_BEFORE_MATCH = 20;

function matchesToQuickPickItems(matches: SearchMatch[]): QuickPickLineItem[] {
  return matches.map((match, i) => {
    const lineNumber = match.lineIndex;
    const lineNumberStr = String(lineNumber + 1);
    const originalContent = match.lineContent;

    const trimmedContent = originalContent.trimStart();
    const indentStripped = originalContent.length - trimmedContent.length;

    const matchStartInTrimmed = (match.highlights.at(0)?.at(0) ?? 0) - indentStripped;

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

    const highlights: [number, number][] = match.highlights.map((h) => [
      totalPrefixLength + h[0] - contentOffset,
      totalPrefixLength + h[1] - contentOffset,
    ]);

    return {
      label: `${lineNumberStr}: ${ellipsisPrefix}${displayContent}`,
      description: "",
      picked: i === 0,
      alwaysShow: true,
      highlights,
      selection: new Selection(
        new Position(lineNumber, match.selectionStart),
        new Position(lineNumber, match.selectionEnd)
      ),
    };
  });
}

function findInDocument(pattern: string, limit: number): SearchMatch[] | null {
  if (pattern.length === 0) {
    return [];
  }

  const activeDocument = window.activeTextEditor?.document;
  if (!activeDocument) {
    return null;
  }

  const filePath = activeDocument.uri.fsPath;
  const fileVersion = activeDocument.version;

  const cached = searchCache.get(filePath, pattern, fileVersion);
  if (cached && cached.length >= limit + 1) {
    return cached;
  }

  const documentSource: DocumentSource =
    activeDocument.isDirty || activeDocument.isUntitled
      ? { text: activeDocument.getText() }
      : { path: activeDocument.uri.fsPath };

  const matches = searchDocument(documentSource, pattern, limit + 1);

  searchCache.set(filePath, pattern, fileVersion, matches);

  return matches;
}

export function search(pattern: string, limit = DEFAULT_LIMIT): QuickPickLineItem[] {
  const matches = findInDocument(pattern, limit);
  if (!matches) {
    return [];
  }

  const hasMore = matches.length > limit;
  const displayMatches = hasMore ? matches.slice(0, limit) : matches;
  const items = matchesToQuickPickItems(displayMatches);

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
