import { commands, type ExtensionContext, TextEditorRevealType, window, workspace } from "vscode";
import { searchCache } from "./cache";
import search from "./search";

const INPUT_PLACEHOLDER = "Please input your search pattern.";
const COMMANDS = {
  FIND: "go-to-fuzzy.find",
};

export function applySelectionFromItem(item: any): boolean {
  if (!item?.line?.matching?.selection) {
    return false;
  }

  if (!window.activeTextEditor) {
    return false;
  }

  const selection = item.line.matching.selection;

  window.activeTextEditor.selections = [selection];
  window.activeTextEditor.revealRange(selection, TextEditorRevealType.InCenter);

  return true;
}

export function activate(context: ExtensionContext): void {
  // Invalidate TypeScript cache when document is modified
  const docChangeDisposable = workspace.onDidChangeTextDocument((event) => {
    const filePath = event.document.uri.fsPath;
    searchCache.invalidateFile(filePath);
  });

  context.subscriptions.push(docChangeDisposable);

  const disposable = commands.registerCommand(COMMANDS.FIND, () => {
    // Save the current cursor position before opening the quick pick
    const editor = window.activeTextEditor;
    const originalSelection = editor?.selection;
    let itemAccepted = false; // Track if user accepted an item

    const quickPick = window.createQuickPick();

    quickPick.placeholder = INPUT_PLACEHOLDER;
    quickPick.items = [];
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;
    quickPick.canSelectMany = false;

    // CRITICAL: Disable s built-in filtering completely
    // We handle all fuzzy matching in Rust and want to show ALL our results
    (quickPick as any).sortByLabel = false;
    (quickPick as any).filterProvider = () => null;

    // when the user type into the search input
    // -> launch a new search each time
    quickPick.onDidChangeValue((newPattern) => {
      if (newPattern.length === 0) {
        quickPick.items = [];
        return;
      }

      const newItems = search(newPattern);

      // Items now have alwaysShow to bypass filtering
      quickPick.items = newItems;

      // IMPORTANT: Set activeItems AFTER items, using reference from items array
      // This triggers onDidChangeActive which handles the selection
      if (newItems.length > 0) {
        quickPick.activeItems = [quickPick.items[0]];

        // Manually apply selection since setting activeItems doesn't always trigger onDidChangeActive
        const firstItem = quickPick.items[0] as any;

        if (firstItem.line?.matching?.selection) {
          applySelectionFromItem(firstItem);
        }
      }
    });

    // when we cycle between the search results,
    // go to the targeted line and select the matching pattern
    quickPick.onDidChangeActive(([item]) => {
      if (!item) {
        return;
      }

      applySelectionFromItem(item);
    });

    // when pressing enter, just close the QuickPick
    // (selection already done in onDidChangeActive)
    quickPick.onDidAccept(() => {
      itemAccepted = true; // Mark that user accepted (pressed Enter)
      quickPick.hide();
    });

    // when pressing escape, restore the original cursor position
    quickPick.onDidHide(() => {
      // Only restore if user cancelled (ESC), not if they accepted an item (Enter)
      if (!itemAccepted && originalSelection && editor) {
        editor.selection = originalSelection;
        editor.revealRange(originalSelection, TextEditorRevealType.InCenter);
      }
    });

    quickPick.show();
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // do nothing as we have no cleanup to do
}
