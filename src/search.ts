import { fuzzySearch } from "../rust-fuzzy";
import * as vscode from "vscode";

type MatchingInfo = {
  start: number;
  end: number;
  selection: vscode.Selection;
};

type ParsedLine = {
  number: string;
  content: string;
  matching: MatchingInfo;
};

interface QuickPickLineItem extends vscode.QuickPickItem {
  line: ParsedLine;
}

/**
 * Get the active (focused) vscode document,
 * pattern search it using Rust fuzzy matching
 */
async function findInDocument(pattern: string): Promise<ParsedLine[] | null> {
  if (pattern.length === 0) {
    return [];
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (!activeDocument) {
    return null;
  }

  // Split document into lines
  const lines = activeDocument.getText().split("\n");

  // Call Rust fuzzy search
  const matches = fuzzySearch(lines, pattern, 100);

  // Convert Rust results to ParsedLine format
  return matches.map((match) => {
    const lineNumber = match.lineIndex;
    return {
      number: String(lineNumber + 1),
      content: match.lineContent,
      matching: {
        start: match.matchStart,
        end: match.matchEnd,
        selection: new vscode.Selection(
          new vscode.Position(lineNumber, match.matchStart),
          new vscode.Position(lineNumber, match.matchEnd)
        ),
      },
    };
  });
}

/**
 * Perform a search against a document
 * and return the matching lines as vscode quickPick items
 */
export default async function search(pattern: string): Promise<QuickPickLineItem[]> {
  const matchingLines = await findInDocument(pattern);
  if (!matchingLines) {
    return [];
  }
  return matchingLines.map((line, i) => {
    const { number, content } = line;

    return {
      // use line number and content as label
      label: `${number}: ${content}`,
      description: "",
      picked: i === 0,
      line,
    };
  });
}
