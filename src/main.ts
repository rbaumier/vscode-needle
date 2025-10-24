import * as vscode from "vscode";
import search from "./search";

const INPUT_PLACEHOLDER = "Please input your search pattern.";
const EMPTY_PATTERN = "";
const COMMANDS = {
  FIND: "go-to-fuzzy.find",
};

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(COMMANDS.FIND, async () => {
    // Save the current cursor position before opening the quick pick
    const editor = vscode.window.activeTextEditor;
    const originalSelection = editor?.selection;

    const items = await search(EMPTY_PATTERN);
    const quickPick = vscode.window.createQuickPick();

    Object.assign(quickPick, {
      value: EMPTY_PATTERN,
      placeholder: INPUT_PLACEHOLDER,
      items,
      matchOnDescription: false,
      matchOnDetail: false,
    });

    // when the user type into the search input
    // -> launch a new search each time
    quickPick.onDidChangeValue(async (newPattern) => {
      if (newPattern.length === 0) {
        return;
      }
      const newItems = await search(newPattern);
      quickPick.items = newItems;
    });

    // when we cycle between the search results,
    // go to the targeted line and select the matching pattern
    quickPick.onDidChangeActive(([item]) => {
      if (!item) {
        return;
      }
      const typedItem = item as any;
      if (!typedItem.line) {
        return;
      }
      const selection = typedItem.line.matching.selection;
      if (vscode.window.activeTextEditor) {
        vscode.window.activeTextEditor.selections = [selection];
        vscode.window.activeTextEditor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
      }
    });

    // when pressing enter, ensure the matched text is selected
    quickPick.onDidAccept(() => {
      const activeItem = quickPick.activeItems[0] as any;
      if (activeItem?.line) {
        const selection = activeItem.line.matching.selection;
        if (vscode.window.activeTextEditor) {
          vscode.window.activeTextEditor.selections = [selection];
          vscode.window.activeTextEditor.revealRange(
            selection,
            vscode.TextEditorRevealType.InCenter
          );
        }
      }
      quickPick.hide();
    });

    // when pressing escape, restore the original cursor position
    quickPick.onDidHide(() => {
      if (originalSelection && editor) {
        editor.selection = originalSelection;
        editor.revealRange(originalSelection, vscode.TextEditorRevealType.InCenter);
      }
    });

    quickPick.show();
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // do nothing as we have no cleanup to do
}
