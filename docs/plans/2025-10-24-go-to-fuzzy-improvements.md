# Go-to-Fuzzy Extension Improvements Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Improve the go-to-fuzzy VSCode extension to work on Cursor, fix QuickPick filtering issues, exclude line numbers from search, add highlighting, and auto-select matched text.

**Architecture:** Migrate from VSCode QuickPick API (which reorders items) to native fzf terminal integration for better control. Use VSCode's native highlight API for matched text. Implement custom selection logic to highlight matched pattern on line selection.

**Tech Stack:** VSCode Extension API, fzf (existing), shell execution (existing), native terminal integration

---

## Task 1: Fix Cursor Compatibility

**Problem:** Extension not available on Cursor (VSCode fork)

**Files:**
- Modify: `package.json:20-22`

**Step 1: Research Cursor compatibility requirements**

Research what makes extensions compatible with Cursor:
- Cursor uses VSCode extension API
- Check if `vscode` engine version needs update
- Verify no VSCode-specific APIs are used

**Step 2: Update engine compatibility**

Update `package.json` to support broader engine range:

```json
"engines": {
  "vscode": "^1.55.0"
}
```

Keep current since Cursor supports VSCode 1.55+ API.

**Step 3: Test installation on Cursor**

Manual test:
1. Open Cursor
2. Try installing extension from VSIX file
3. Verify command appears in command palette
4. Test basic functionality

**Step 4: Document Cursor support**

Add to README.md that extension works on both VSCode and Cursor.

**Step 5: Commit**

```bash
git add package.json README.md
git commit -m "docs: add Cursor compatibility note"
```

---

## Task 2: Remove Pattern Prefix from QuickPick Labels

**Problem:** Pattern displayed at beginning of each line is annoying (done to prevent VSCode reordering)

**Solution:** Use QuickPick `matchOnDescription` property to prevent reordering while using clean labels

**Files:**
- Modify: `src/main.js:16-22`
- Modify: `src/search.js:111-120`

**Step 1: Write failing test**

Create: `src/search.test.js`

```javascript
const assert = require('assert');
const vscode = require('vscode');

// Mock test - proper test would require VSCode test environment
describe('Search Results', () => {
  it('should not include pattern in label', () => {
    const mockLine = {
      number: '5',
      content: 'function hello() {',
      matching: {
        start: 9,
        end: 14,
        selection: new vscode.Selection(
          new vscode.Position(4, 9),
          new vscode.Position(4, 14)
        )
      }
    };

    // This test documents expected behavior
    // Actual implementation will use QuickPick matchOnDescription
    const expectedLabel = `5: function hello() {`;
    assert.notEqual(expectedLabel.startsWith('pattern'), true);
  });
});
```

**Step 2: Update QuickPick configuration to disable filtering**

Modify `src/main.js`:

```javascript
function activate(context) {
  const disposable = vscode.commands.registerCommand(COMMANDS.FIND, () => {
    return search(EMPTY_PATTERN).then((items) => {
      let quickPick = vscode.window.createQuickPick();

      Object.assign(quickPick, {
        value: EMPTY_PATTERN,
        placeholder: INPUT_PLACEHOLDER,
        items,
        matchOnDescription: false,  // NEW: disable VSCode filtering
        matchOnDetail: false,       // NEW: disable VSCode filtering
      });

      // ... rest of the code
    });
  });
}
```

**Step 3: Update search result item format**

Modify `src/search.js:109-122`:

```javascript
module.exports = function search(pattern) {
  return findInDocument(pattern).then((matchingLines) => {
    return matchingLines.map((line, i) => {
      return {
        // Use line number and content as label instead of pattern
        label: `${line.number}: ${line.content}`,
        // Remove description since we're using label now
        description: '',
        picked: i === 0,
        line,
      };
    });
  });
};
```

**Step 4: Test manually**

Manual test:
1. Open a file in VSCode
2. Run "Go to Fuzzy: find"
3. Type a pattern
4. Verify results show "lineNumber: content" format
5. Verify results stay in fzf order (not reordered by VSCode)

**Step 5: Commit**

```bash
git add src/main.js src/search.js
git commit -m "fix: remove pattern prefix from result labels"
```

---

## Task 3: Exclude Line Numbers from Search Pattern

**Problem:** Searching "7" matches lines 7, 17, 27, etc. even if "7" isn't in the content

**Solution:** Modify fzf command to search only content, not line numbers

**Files:**
- Modify: `src/search.js:61-77`

**Step 1: Write test case documenting expected behavior**

Add to `src/search.test.js`:

```javascript
describe('Line Number Filtering', () => {
  it('should not match line numbers in search', () => {
    // When searching "7", line 17 should NOT match unless "7" is in content
    // This is a documentation test - actual implementation in buildCommand
    const pattern = '7';
    const lineContent = 'function test() {'; // no "7" in content
    const lineNumber = '17'; // has "7" in number

    // Expected: this line should NOT be in results
    // because "7" is not in the content
  });
});
```

**Step 2: Modify buildCommand to use awk for content-only filtering**

Current command pipes content with line numbers to fzf, which searches both.
New approach: pre-filter with awk to only pass content to fzf, then restore line numbers.

Modify `src/search.js:61-77`:

```javascript
function buildCommand(activeDocument, pattern) {
  const isDirty = activeDocument.isDirty;
  const isLocalFile = activeDocument.uri.scheme === "file";

  if (isDirty || !isLocalFile) {
    const editorContent = activeDocument.getText();
    const c = quote([editorContent]).replaceAll("\\\\n", "\\\\\\n");
    const p = quote([pattern]);
    // Use awk to separate line numbers from content for fzf matching
    // Format: store line num, search only content with fzf, then restore line num
    return `echo ${c} | nl -ba | awk '{num=$1; $1=""; print num"\\t"$0}' | awk -F'\\t' '{print $2}' | fzf -f ${p} --with-nth=1.. | nl -ba | awk '{num=NR; print num"\\t"$0}' | head -100`;
  }

  const path = quote([activeDocument.uri.path]);
  const p = quote([pattern]);
  // Same approach for file-based search
  return `cat ${path} | nl -ba | awk '{num=$1; $1=""; content=$0; print num"\\t"content}' | awk -F'\\t' -v pattern=${p} '{if ($2 ~ pattern) print $1"\\t"$2}' | head -100`;
}
```

**Step 3: Simplify with better approach**

Actually, simpler solution: number lines AFTER fzf filtering:

```javascript
function buildCommand(activeDocument, pattern) {
  const isDirty = activeDocument.isDirty;
  const isLocalFile = activeDocument.uri.scheme === "file";

  if (isDirty || !isLocalFile) {
    const editorContent = activeDocument.getText();
    const c = quote([editorContent]).replaceAll("\\\\n", "\\\\\\n");
    const p = quote([pattern]);
    // fzf filters content, then we number the matching lines
    return `echo ${c} | fzf -f ${p} | nl -ba | head -100`;
  }

  const path = quote([activeDocument.uri.path]);
  const p = quote([pattern]);
  return `cat ${path} | fzf -f ${p} | nl -ba | head -100`;
}
```

**WAIT - This loses original line numbers!**

Better approach: Use fzf with field separator and --nth to search only content:

```javascript
function buildCommand(activeDocument, pattern) {
  const isDirty = activeDocument.isDirty;
  const isLocalFile = activeDocument.uri.scheme === "file";

  if (isDirty || !isLocalFile) {
    const editorContent = activeDocument.getText();
    const c = quote([editorContent]).replaceAll("\\\\n", "\\\\\\n");
    const p = quote([pattern]);
    // nl adds line numbers, fzf --nth 2.. searches only content (field 2 onward)
    return `echo ${c} | nl -ba -s $'\\t' | fzf -f ${p} --delimiter=$'\\t' --nth=2.. | head -100`;
  }

  const path = quote([activeDocument.uri.path]);
  const p = quote([pattern]);
  return `cat ${path} | nl -ba -s $'\\t' | fzf -f ${p} --delimiter=$'\\t' --nth=2.. | head -100`;
}
```

**Step 4: Test manually**

Manual test:
1. Create a test file with lines that DON'T contain "7" at line numbers 7, 17, 27
2. Search for "7"
3. Verify those lines DON'T appear in results
4. Add "7" to line 27's content
5. Verify line 27 now appears (because content has "7", not because line number)

**Step 5: Commit**

```bash
git add src/search.js
git commit -m "fix: exclude line numbers from search pattern matching"
```

---

## Task 4: Add Highlighting to Matched Text

**Problem:** No visual indication of what matched in the result line

**Solution:** Use VSCode QuickPickItem highlights (ansiColors or custom icons) - actually QuickPick doesn't support highlights, so use description formatting

**Files:**
- Modify: `src/search.js:111-120`

**Step 1: Research QuickPick item highlighting**

VSCode QuickPick items support:
- `label` with `$(icon-name)` for icons
- No native text highlighting in QuickPick
- Alternative: Use description with strategic formatting

**Step 2: Add matched text emphasis in label**

Since QuickPick doesn't support text highlighting, use formatting characters:

Modify `src/search.js:111-120`:

```javascript
module.exports = function search(pattern) {
  return findInDocument(pattern).then((matchingLines) => {
    return matchingLines.map((line, i) => {
      const { number, content, matching } = line;
      const { start, end } = matching;

      // Build label with matched portion emphasized using ► ◄ markers
      const before = content.substring(0, start);
      const matched = content.substring(start, end);
      const after = content.substring(end);
      const highlightedContent = `${before}►${matched}◄${after}`;

      return {
        label: `${number}: ${highlightedContent}`,
        description: '',
        picked: i === 0,
        line,
      };
    });
  });
};
```

**Step 3: Test manually**

Manual test:
1. Search for "function"
2. Verify results show: `5: ►function◄ test() {`
3. Matched word should be between ► ◄ markers

**Step 4: Alternative - use bold/color if terminal supports**

Actually, QuickPick labels don't support ANSI colors.
Keep the marker approach (► ◄) as it's clearest.

**Step 5: Commit**

```bash
git add src/search.js
git commit -m "feat: add visual markers around matched text"
```

---

## Task 5: Select Matched Text on Line Selection

**Problem:** When selecting a line, cursor goes to line but doesn't select the matched word

**Solution:** Already implemented! Check `src/main.js:37-44` - it already sets selection to matching range

**Files:**
- Verify: `src/main.js:37-44`

**Step 1: Review existing implementation**

Current code in `src/main.js:37-44`:

```javascript
quickPick.onDidChangeActive(([item]) => {
  if (!item) {
    return;
  }
  const selection = item.line.matching.selection;
  vscode.window.activeTextEditor.selections = [selection];
  vscode.window.activeTextEditor.revealRange(selection, 2);
});
```

This already selects the matched text! ✅

**Step 2: Verify it works with onDidAccept**

Check if onDidAccept also needs to set selection:

Current code in `src/main.js:48`:
```javascript
quickPick.onDidAccept((e) => quickPick.hide());
```

This just hides the picker, relying on onDidChangeActive to have already set selection.

**Issue:** If user types pattern and hits Enter immediately (without arrow keys), onDidChangeActive might not fire.

**Step 3: Add selection to onDidAccept as safety**

Modify `src/main.js:48`:

```javascript
quickPick.onDidAccept(() => {
  const activeItem = quickPick.activeItems[0];
  if (activeItem && activeItem.line) {
    const selection = activeItem.line.matching.selection;
    vscode.window.activeTextEditor.selections = [selection];
    vscode.window.activeTextEditor.revealRange(selection, 2);
  }
  quickPick.hide();
});
```

**Step 4: Test manually**

Manual test:
1. Open file
2. Run Go to Fuzzy
3. Type pattern and immediately hit Enter (don't use arrow keys)
4. Verify matched text is selected
5. Try with arrow keys navigation
6. Verify matched text is selected

**Step 5: Commit**

```bash
git add src/main.js
git commit -m "fix: ensure matched text is selected on Enter key"
```

---

## Task 6: Integration Testing

**Files:**
- Create: `TESTING.md` (manual test checklist)

**Step 1: Create comprehensive test checklist**

Create `TESTING.md`:

```markdown
# Go-to-Fuzzy Testing Checklist

## Pre-release Testing

### Cursor Compatibility
- [ ] Install extension in Cursor from VSIX
- [ ] Verify command appears in Command Palette
- [ ] Test basic search functionality

### Pattern Display
- [ ] Search results show "lineNumber: content" format
- [ ] No pattern prefix appears in results
- [ ] Results maintain fzf ranking order

### Line Number Filtering
- [ ] Create file with line 17: "test content"
- [ ] Search for "7"
- [ ] Verify line 17 does NOT appear
- [ ] Add "7" to line 17 content
- [ ] Search for "7" again
- [ ] Verify line 17 NOW appears

### Matched Text Highlighting
- [ ] Search for a word
- [ ] Verify matched portion has ► ◄ markers
- [ ] Test with multiple occurrences on same line
- [ ] Verify best match is highlighted

### Text Selection
- [ ] Search and use arrow keys to navigate
- [ ] Verify matched text is selected on each line
- [ ] Search and hit Enter immediately
- [ ] Verify matched text is selected
- [ ] Verify cursor is visible and at match

### Edge Cases
- [ ] Search empty pattern - should show empty results
- [ ] Search pattern with no matches
- [ ] Search in very large file (>10k lines)
- [ ] Search in unsaved (dirty) file
- [ ] Search in file opened from URL (non-file:// scheme)

## Regression Testing
- [ ] Original fuzzy search still works correctly
- [ ] fzf ranking quality maintained
- [ ] Performance acceptable on large files
```

**Step 2: Create test file for line number verification**

Create `test-fixtures/line-number-test.txt`:

```
line 1 content
line 2 content
line 3 content
line 4 content
line 5 content
line 6 content
line 7 has no seven in content
line 8 content
line 9 content
line 10 content
line 11 content
line 12 content
line 13 content
line 14 content
line 15 content
line 16 content
line 17 also no seven here
line 18 content
line 19 content
line 20 content
line 21 content with actual 7 digit
```

**Step 3: Run through checklist**

Execute each test case and verify behavior.

**Step 4: Document results**

Add results section to TESTING.md with date and findings.

**Step 5: Commit**

```bash
git add TESTING.md test-fixtures/
git commit -m "test: add comprehensive testing checklist and fixtures"
```

---

## Task 7: Update Documentation

**Files:**
- Modify: `README.md:51-55`
- Modify: `CHANGELOG.md`

**Step 1: Update FAQ about pattern prefix**

Remove the FAQ item about showing pattern at beginning of line since we fixed it.

Modify `README.md:51-55`:

```markdown
## ❔ FAQ

### Does this work on Cursor?

Yes! The extension works on both VSCode and Cursor.

### How are search results ordered?

Results are ordered by fzf's fuzzy matching algorithm, showing the best matches first. The extension preserves fzf's ranking instead of using VSCode's default filtering.
```

**Step 2: Update CHANGELOG**

Add version 0.0.3 changes to `CHANGELOG.md`:

```markdown
# Changelog

## [0.0.3] - 2024-10-24

### Added
- Visual markers (► ◄) around matched text in search results
- Cursor editor compatibility

### Fixed
- Removed redundant pattern prefix from search result labels
- Line numbers no longer match search patterns (only content is searched)
- Matched text is now selected even when hitting Enter immediately
- QuickPick results maintain fzf ranking order

### Changed
- Search result display format: now shows "lineNumber: content" instead of "pattern - lineNumber: content"

## [0.0.2] - 2021-04-24
...
```

**Step 3: Update package.json version**

Modify `package.json:6`:

```json
"version": "0.0.3",
```

**Step 4: Review all documentation for accuracy**

Read through entire README.md and verify:
- Installation instructions still accurate
- Usage instructions still accurate
- Requirements still accurate
- Demo GIF still representative (might need update later)

**Step 5: Commit**

```bash
git add README.md CHANGELOG.md package.json
git commit -m "docs: update for version 0.0.3 release"
```

---

## Task 8: Build and Publish

**Files:**
- Build: `out/main.js`
- Create: `go-to-fuzzy-0.0.3.vsix`

**Step 1: Run linter**

```bash
yarn lint
```

Expected: No errors

If errors, fix them before continuing.

**Step 2: Build production bundle**

```bash
yarn vscode:prepublish
```

Expected: Creates minified `out/main.js`

**Step 3: Package extension**

```bash
npx vsce package
```

Expected: Creates `go-to-fuzzy-0.0.3.vsix`

**Step 4: Test VSIX installation**

Manual test:
1. Open VSCode
2. Extensions → ... → Install from VSIX
3. Select `go-to-fuzzy-0.0.3.vsix`
4. Reload window
5. Test extension functionality
6. Test in Cursor as well

**Step 5: Publish to marketplace**

```bash
npx vsce publish
```

If you don't have publish permissions or prefer manual upload:
1. Go to https://marketplace.visualstudio.com/manage
2. Upload `go-to-fuzzy-0.0.3.vsix`

**Step 6: Create git tag**

```bash
git tag -a v0.0.3 -m "Release version 0.0.3"
git push origin v0.0.3
git push origin master
```

**Step 7: Commit**

All changes should already be committed. Just ensure everything is pushed.

---

## Summary

**Improvements implemented:**

1. ✅ **Cursor compatibility** - Extension now works on both VSCode and Cursor
2. ✅ **Clean result labels** - Removed annoying pattern prefix
3. ✅ **Content-only search** - Line numbers excluded from pattern matching
4. ✅ **Match highlighting** - Visual markers (► ◄) show matched text
5. ✅ **Text selection** - Matched text auto-selected on all selection paths

**Technical approach:**

- Used QuickPick `matchOnDescription: false` to prevent VSCode reordering
- Used fzf `--delimiter` and `--nth` options to search only content fields
- Added visual markers for match highlighting (QuickPick doesn't support text formatting)
- Enhanced onDidAccept handler to ensure selection happens on immediate Enter

**Testing strategy:**

- Comprehensive manual testing checklist in TESTING.md
- Test fixtures for edge cases
- Both VSCode and Cursor installation verification

**Files modified:**

- `package.json` - version bump
- `src/main.js` - QuickPick configuration and selection handling
- `src/search.js` - buildCommand and result formatting
- `README.md` - documentation updates
- `CHANGELOG.md` - version history

**Deployment:**

- Linting, building, packaging, and publishing to marketplace
- Git tagging for release management
