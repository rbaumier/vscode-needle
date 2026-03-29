import { Position, type QuickPickItem, Selection, window } from "vscode";
import { type DocumentSource, type SearchMatch, searchDocument } from "../rust-needle";
import { searchCache } from "./cache";

type QuickPickLineItem = QuickPickItem & {
  selection: Selection;
};

const LIMIT_MATCHES = 100;
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

/**
 * Searches the active document using Rust-powered substring matching.
 * Uses in-memory cache and hybrid file/text source for optimal performance.
 */
function findInDocument(pattern: string): SearchMatch[] | null {
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
  if (cached) {
    return cached;
  }

  const documentSource: DocumentSource = (() => {
    if (activeDocument.isDirty || activeDocument.isUntitled) {
      return {
        text: activeDocument.getText(),
        path: undefined,
      };
    }
    const fsPath = activeDocument.uri.fsPath;
    return {
      text: undefined,
      path: fsPath,
    };
  })();

  const matches = searchDocument(documentSource, pattern, LIMIT_MATCHES);

  searchCache.set(filePath, pattern, fileVersion, matches);

  return matches;
}

/**
 * Main search entry point. Finds matches in the active document
 * and converts them to QuickPick items with highlighting.
 */
export default function search(pattern: string): QuickPickLineItem[] {
  const matches = findInDocument(pattern);
  if (!matches) {
    return [];
  }

  return matchesToQuickPickItems(matches);
}
