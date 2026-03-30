import {
  type Disposable,
  commands,
  type ExtensionContext,
  TextEditorRevealType,
  window,
  workspace,
} from "vscode";
import { searchCache } from "./cache";
import { type QuickPickLineItem, search } from "./search";

const INPUT_PLACEHOLDER = "Please input your search pattern.";
const LIMIT_STEP = 200;

const COMMANDS = {
  FIND: "needle.find",
} as const;

/**
 * Applies the text selection from a QuickPick item to the active editor.
 * Navigates the cursor to the matched line and selects the matched text.
 */
export function applySelectionFromItem(item: QuickPickLineItem): boolean {
  if (!item?.selection) {
    return false;
  }

  const editor = window.activeTextEditor;
  if (!editor) {
    return false;
  }

  editor.selections = [item.selection];
  editor.revealRange(item.selection, TextEditorRevealType.InCenter);

  return true;
}

/**
 * VSCode extension activation entry point.
 * Sets up document change listeners for cache invalidation and the search command.
 */
export function activate(context: ExtensionContext): void {
  const docChangeDisposable = workspace.onDidChangeTextDocument((event) => {
    const filePath = event.document.uri.fsPath;
    searchCache.invalidateFile(filePath);
  });

  context.subscriptions.push(docChangeDisposable);

  const disposable = commands.registerCommand(COMMANDS.FIND, () => {
    const editor = window.activeTextEditor;
    const originalSelection = editor?.selection;

    let itemAccepted = false;
    let currentLimit = LIMIT_STEP;

    const quickPick = window.createQuickPick<QuickPickLineItem>();

    quickPick.placeholder = INPUT_PLACEHOLDER;
    quickPick.items = [];
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;
    quickPick.canSelectMany = false;

    // Disable VSCode's built-in filtering — the Rust search engine handles all matching
    type QuickPickInternal = typeof quickPick & {
      sortByLabel?: boolean;
      filterProvider?: (() => null) | null;
    };
    (quickPick as QuickPickInternal).sortByLabel = false;
    (quickPick as QuickPickInternal).filterProvider = () => null;

    function updateResults(pattern: string, focusIndex = 0) {
      if (pattern.length === 0) {
        quickPick.items = [];
        return;
      }

      const newItems = search(pattern, currentLimit);
      quickPick.items = newItems;

      if (newItems.length > 0) {
        const targetIndex = Math.min(focusIndex, newItems.length - 1);
        const targetItem = quickPick.items[targetIndex];
        if (targetItem) {
          quickPick.activeItems = [targetItem];
          applySelectionFromItem(targetItem);
        }
      }
    }

    const disposables: Disposable[] = [];

    disposables.push(
      quickPick.onDidChangeValue((newPattern) => {
        currentLimit = LIMIT_STEP;
        updateResults(newPattern);
      })
    );

    disposables.push(
      quickPick.onDidChangeActive(([item]) => {
        if (!item) {
          return;
        }
        applySelectionFromItem(item);
      })
    );

    disposables.push(
      quickPick.onDidAccept(() => {
        const activeItem = quickPick.activeItems[0];

        if (activeItem?.isMore) {
          const previousCount = currentLimit;
          currentLimit += LIMIT_STEP;
          updateResults(quickPick.value, previousCount);
          return;
        }

        itemAccepted = true;
        quickPick.hide();
      })
    );

    disposables.push(
      quickPick.onDidHide(() => {
        if (!itemAccepted && originalSelection && editor) {
          editor.selection = originalSelection;
          editor.revealRange(originalSelection, TextEditorRevealType.InCenter);
        }
        for (const d of disposables) d.dispose();
        quickPick.dispose();
      })
    );

    quickPick.show();
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // No cleanup required
}
