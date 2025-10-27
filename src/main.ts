// Import VSCode API types for extension integration
import {
  commands,
  type ExtensionContext,
  type QuickPickItem,
  type Selection,
  TextEditorRevealType,
  window,
  workspace,
} from "vscode";
// Import cache management for optimized search performance
import { searchCache } from "./cache";
// Import main fuzzy search function
import search from "./search";

// User-facing placeholder text for the search input
const INPUT_PLACEHOLDER = "Please input your search pattern.";

// Extension command identifiers registered with VSCode
const COMMANDS = {
  FIND: "go-to-fuzzy.find",
} as const;

/**
 * Extended QuickPickItem that includes selection information
 * for navigating to the matched line in the editor
 */
interface QuickPickItemWithSelection extends QuickPickItem {
  selection?: Selection;
}

/**
 * Applies the text selection from a QuickPick item to the active editor
 * This navigates the cursor to the matched line and selects the matched text
 *
 * @param item - QuickPick item containing the selection information
 * @returns true if selection was applied successfully, false otherwise
 */
export function applySelectionFromItem(item: QuickPickItemWithSelection): boolean {
  // Validate that the item has selection information
  if (!item?.selection) {
    return false;
  }

  // Ensure there's an active editor to apply the selection to
  const editor = window.activeTextEditor;
  if (!editor) {
    return false;
  }

  // Apply the selection and reveal it in the center of the viewport
  editor.selections = [item.selection];
  editor.revealRange(item.selection, TextEditorRevealType.InCenter);

  return true;
}

/**
 * VSCode extension activation entry point
 * Called when the extension is first activated (lazy loading)
 *
 * Sets up:
 * - Document change listeners for cache invalidation
 * - Command handlers for the fuzzy search feature
 *
 * @param context - Extension context for managing subscriptions and lifecycle
 */
export function activate(context: ExtensionContext): void {
  // Register document change listener to invalidate search cache
  // This ensures search results stay synchronized with file edits
  const docChangeDisposable = workspace.onDidChangeTextDocument((event) => {
    const filePath = event.document.uri.fsPath;
    searchCache.invalidateFile(filePath);
  });

  context.subscriptions.push(docChangeDisposable);

  // Register the main fuzzy find command
  const disposable = commands.registerCommand(COMMANDS.FIND, () => {
    // Capture the current cursor position for restoration if user cancels
    const editor = window.activeTextEditor;
    const originalSelection = editor?.selection;

    // Track whether the user accepted a selection (Enter) vs cancelled (ESC)
    let itemAccepted = false;

    // Create the QuickPick UI for displaying search results
    const quickPick = window.createQuickPick<QuickPickItemWithSelection>();

    // Configure QuickPick behavior
    quickPick.placeholder = INPUT_PLACEHOLDER;
    quickPick.items = [];
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;
    quickPick.canSelectMany = false;

    // CRITICAL: Disable VSCode's built-in filtering
    // The Rust fuzzy search engine handles ALL matching logic
    // VSCode's filtering would interfere with our pre-scored results
    // Note: These properties are not exposed in the official VSCode API types
    // but are available at runtime for advanced QuickPick customization
    type QuickPickInternal = typeof quickPick & {
      sortByLabel?: boolean;
      filterProvider?: (() => null) | null;
    };
    (quickPick as QuickPickInternal).sortByLabel = false;
    (quickPick as QuickPickInternal).filterProvider = () => null;

    // Handle search input changes - trigger new search on each keystroke
    quickPick.onDidChangeValue((newPattern) => {
      // Clear results when search pattern is empty
      if (newPattern.length === 0) {
        quickPick.items = [];
        return;
      }

      // Execute fuzzy search with the new pattern
      const newItems = search(newPattern);

      // Update the QuickPick with new results
      // Items have alwaysShow=true to bypass VSCode filtering
      quickPick.items = newItems;

      // Auto-select the first (best) match and apply its selection
      // IMPORTANT: Set activeItems AFTER items to ensure references are valid
      if (newItems.length > 0) {
        quickPick.activeItems = [quickPick.items[0]];

        // Manually apply the first selection for immediate visual feedback
        // Setting activeItems doesn't always trigger onDidChangeActive
        const firstItem = quickPick.items[0];
        if (firstItem.selection) {
          applySelectionFromItem(firstItem);
        }
      }
    });

    // Handle navigation between search results (arrow keys)
    // Apply the selection for each result as the user navigates
    quickPick.onDidChangeActive(([item]) => {
      if (!item) {
        return;
      }

      applySelectionFromItem(item);
    });

    // Handle user accepting a selection (Enter key)
    // Just close the QuickPick - selection is already applied from onDidChangeActive
    quickPick.onDidAccept(() => {
      itemAccepted = true;
      quickPick.hide();
    });

    // Handle QuickPick closing (both accept and cancel)
    // Restore original cursor position only if user cancelled (ESC)
    quickPick.onDidHide(() => {
      if (!itemAccepted && originalSelection && editor) {
        editor.selection = originalSelection;
        editor.revealRange(originalSelection, TextEditorRevealType.InCenter);
      }
    });

    // Display the QuickPick UI
    quickPick.show();
  });

  context.subscriptions.push(disposable);
}

/**
 * VSCode extension deactivation entry point
 * Called when the extension is being deactivated
 *
 * Currently no cleanup is required as:
 * - Cache is automatically garbage collected
 * - Event subscriptions are managed by VSCode via context.subscriptions
 */
export function deactivate(): void {
  // No cleanup required
}
