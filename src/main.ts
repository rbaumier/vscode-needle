import * as vscode from "vscode";
import search from "./search";
import { log, getLogPath, clearLog } from "./logger";

const INPUT_PLACEHOLDER = "Please input your search pattern.";
const EMPTY_PATTERN = "";
const COMMANDS = {
  FIND: "go-to-fuzzy.find",
};

// Exported for testing
export function applySelectionFromItem(item: any): boolean {
  log("applySelectionFromItem called");

  if (!item || !item.line || !item.line.matching || !item.line.matching.selection) {
    log("  Invalid item structure");
    return false;
  }

  if (!vscode.window.activeTextEditor) {
    log("  No active text editor");
    return false;
  }

  const selection = item.line.matching.selection;
  log("  Applying selection:", {
    start: { line: selection.start.line, character: selection.start.character },
    end: { line: selection.end.line, character: selection.end.character }
  });

  vscode.window.activeTextEditor.selections = [selection];
  vscode.window.activeTextEditor.revealRange(selection, vscode.TextEditorRevealType.InCenter);

  log("  Selection applied successfully");
  return true;
}

export function activate(context: vscode.ExtensionContext): void {
  clearLog();
  log("=== Extension activated ===");
  log(`Log file: ${getLogPath()}`);

  vscode.window.showInformationMessage(`go-to-fuzzy log: ${getLogPath()}`);

  const disposable = vscode.commands.registerCommand(COMMANDS.FIND, async () => {
    log("Command 'find' triggered");

    // Save the current cursor position before opening the quick pick
    const editor = vscode.window.activeTextEditor;
    const originalSelection = editor?.selection;
    let itemAccepted = false; // Track if user accepted an item

    log("Initial search with empty pattern");
    const items = await search(EMPTY_PATTERN);
    log(`Initial search returned ${items.length} items`);

    const quickPick = vscode.window.createQuickPick();

    quickPick.placeholder = INPUT_PLACEHOLDER;
    quickPick.items = [];
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;
    quickPick.canSelectMany = false;

    // CRITICAL: Disable VSCode's built-in filtering completely
    // We handle all fuzzy matching in Rust and want VSCode to show ALL our results
    (quickPick as any).sortByLabel = false;
    (quickPick as any).filterProvider = () => null;

    // when the user type into the search input
    // -> launch a new search each time
    quickPick.onDidChangeValue(async (newPattern) => {
      log(`User typed: "${newPattern}"`);

      if (newPattern.length === 0) {
        log("Empty pattern, clearing items");
        quickPick.items = [];
        return;
      }

      log(`Searching for pattern: "${newPattern}"`);
      const newItems = await search(newPattern);
      log(`Search returned ${newItems.length} items`);
      log(`About to set quickPick.items to ${newItems.length} items`);

      // Items now have alwaysShow to bypass VSCode filtering
      quickPick.items = newItems;

      // IMPORTANT: Set activeItems AFTER items, using reference from items array
      // This triggers onDidChangeActive which handles the selection
      if (newItems.length > 0) {
        log("About to set active items and apply selection");
        log("  newItems.length:", newItems.length);

        quickPick.activeItems = [quickPick.items[0]];
        log("  Set first item as active");

        // Manually apply selection since setting activeItems doesn't always trigger onDidChangeActive
        const firstItem = quickPick.items[0] as any;
        log("  firstItem exists:", !!firstItem);
        log("  firstItem.line exists:", !!firstItem?.line);
        log("  vscode.window.activeTextEditor exists:", !!vscode.window.activeTextEditor);

        if (firstItem.line) {
          log("  firstItem.line.matching exists:", !!firstItem.line.matching);
          log("  firstItem.line.matching.selection exists:", !!firstItem.line.matching?.selection);

          if (firstItem.line.matching?.selection) {
            const selection = firstItem.line.matching.selection;
            log("  Selection object:", {
              start: { line: selection.start.line, character: selection.start.character },
              end: { line: selection.end.line, character: selection.end.character }
            });

            applySelectionFromItem(firstItem);
          } else {
            log("  ERROR: No selection in firstItem.line.matching!");
          }
        } else {
          log("  ERROR: No line data in first item!");
        }
      }

      log(`quickPick.items now has ${quickPick.items.length} items`);
    });

    // when we cycle between the search results,
    // go to the targeted line and select the matching pattern
    quickPick.onDidChangeActive(([item]) => {
      log("onDidChangeActive triggered");

      if (!item) {
        log("No item in onDidChangeActive");
        return;
      }

      applySelectionFromItem(item);
    });

    // when pressing enter, just close the QuickPick
    // (selection already done in onDidChangeActive)
    quickPick.onDidAccept(() => {
      log("onDidAccept triggered - closing QuickPick");
      itemAccepted = true;  // Mark that user accepted (pressed Enter)
      quickPick.hide();
    });

    // when pressing escape, restore the original cursor position
    quickPick.onDidHide(() => {
      log(`onDidHide triggered, itemAccepted=${itemAccepted}`);

      // Only restore if user cancelled (ESC), not if they accepted an item (Enter)
      if (!itemAccepted && originalSelection && editor) {
        log("Restoring original selection (user pressed ESC)");
        editor.selection = originalSelection;
        editor.revealRange(originalSelection, vscode.TextEditorRevealType.InCenter);
      } else if (itemAccepted) {
        log("Keeping current selection (user pressed Enter)");
      }
    });

    quickPick.show();
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // do nothing as we have no cleanup to do
}
