import * as assert from 'assert';
import * as vscode from 'vscode';
import { describe as suite, it as test, before as suiteSetup } from 'mocha';

suite('Extension E2E Test Suite - Specification Validation', () => {
  vscode.window.showInformationMessage('Start E2E tests.');

  let testDocument: vscode.TextDocument;
  let testEditor: vscode.TextEditor;

  suiteSetup(async () => {
    // Create test document with EXACT lines from specification table
    const content = [
      'export async function applySelectionFromItem(): boolean {',
      'export async function applySelectionFromItem(): boolean {',
      'export async function applySelectionFromItem(): boolean {',
      'export async function applySelectionFromItem(): boolean {',
      'export async function applySelectionFromItem(): boolean {',
      'const my_super_variable = 42;',
      '// TODO: fix this issue now',
    ].join('\n');

    testDocument = await vscode.workspace.openTextDocument({
      content,
      language: 'typescript'
    });

    testEditor = await vscode.window.showTextDocument(testDocument);
  });

  test('Command go-to-fuzzy.find should be registered', async () => {
    try {
      await vscode.commands.executeCommand('go-to-fuzzy.find');
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    } catch (e) {
      // Ignore
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('go-to-fuzzy.find'), 'Command not registered');
  });

  // ====================================================================
  // SPEC TABLE TESTS - EXACT IMPLEMENTATION
  // ====================================================================

  test('Spec Row 1: apply → applySelectionFromItem (Cas A: 1 mot)', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;
    const mainModule = await import('../../src/main');
    const applySelectionFromItem = mainModule.applySelectionFromItem;

    await vscode.window.showTextDocument(testDocument);
    testEditor.selection = new vscode.Selection(0, 0, 0, 0);

    const results = await search('apply');
    assert.ok(results.length > 0, 'Should find results for "apply"');

    const firstItem = results[0] as any;
    assert.ok(firstItem.line, 'Should have line data');
    assert.ok(firstItem.label.includes('applySelectionFromItem'), 'Should match line with applySelectionFromItem');

    // Apply selection
    applySelectionFromItem(firstItem);
    await new Promise(resolve => setTimeout(resolve, 100));

    const selectedText = testDocument.getText(testEditor.selection);
    assert.strictEqual(selectedText, 'applySelectionFromItem',
      'Spec: Should select "applySelectionFromItem" (Cas A: 1 mot)');
  });

  test('Spec Row 2: appply (typo) → applySelectionFromItem (Cas A: 1 mot)', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;
    const mainModule = await import('../../src/main');
    const applySelectionFromItem = mainModule.applySelectionFromItem;

    await vscode.window.showTextDocument(testDocument);
    testEditor.selection = new vscode.Selection(0, 0, 0, 0);

    const results = await search('appply');
    assert.ok(results.length > 0, 'Should find results for "appply" (typo)');

    const firstItem = results[0] as any;
    applySelectionFromItem(firstItem);
    await new Promise(resolve => setTimeout(resolve, 100));

    const selectedText = testDocument.getText(testEditor.selection);
    assert.strictEqual(selectedText, 'applySelectionFromItem',
      'Spec: Should select "applySelectionFromItem" despite typo (Cas A: 1 mot)');
  });

  test('Spec Row 3: expfnitem → export async function applySelectionFromItem (Cas B: 3 mots)', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;
    const mainModule = await import('../../src/main');
    const applySelectionFromItem = mainModule.applySelectionFromItem;

    await vscode.window.showTextDocument(testDocument);
    testEditor.selection = new vscode.Selection(0, 0, 0, 0);

    const results = await search('expfnitem');
    assert.ok(results.length > 0, 'Should find results for "expfnitem"');

    const firstItem = results[0] as any;
    applySelectionFromItem(firstItem);
    await new Promise(resolve => setTimeout(resolve, 100));

    const selectedText = testDocument.getText(testEditor.selection);
    assert.strictEqual(selectedText, 'export async function applySelectionFromItem',
      'Spec: Should select "export async function applySelectionFromItem" (Cas B: 3 mots)');
  });

  test('Spec Row 4: afrom → applySelectionFromItem (Cas A: 1 mot même si chars loin)', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;
    const mainModule = await import('../../src/main');
    const applySelectionFromItem = mainModule.applySelectionFromItem;

    await vscode.window.showTextDocument(testDocument);
    testEditor.selection = new vscode.Selection(0, 0, 0, 0);

    const results = await search('afrom');
    assert.ok(results.length > 0, 'Should find results for "afrom"');

    const firstItem = results[0] as any;
    applySelectionFromItem(firstItem);
    await new Promise(resolve => setTimeout(resolve, 100));

    const selectedText = testDocument.getText(testEditor.selection);
    assert.strictEqual(selectedText, 'applySelectionFromItem',
      'Spec: Should select "applySelectionFromItem" (Cas A: 1 mot même si chars loin)');
  });

  test('Spec Row 5: asyncbool → async function applySelectionFromItem(): boolean (Cas B: 2 blocs)', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;
    const mainModule = await import('../../src/main');
    const applySelectionFromItem = mainModule.applySelectionFromItem;

    await vscode.window.showTextDocument(testDocument);
    testEditor.selection = new vscode.Selection(0, 0, 0, 0);

    const results = await search('asyncbool');
    assert.ok(results.length > 0, 'Should find results for "asyncbool"');

    const firstItem = results[0] as any;
    applySelectionFromItem(firstItem);
    await new Promise(resolve => setTimeout(resolve, 100));

    const selectedText = testDocument.getText(testEditor.selection);
    assert.strictEqual(selectedText, 'async function applySelectionFromItem(): boolean',
      'Spec: Should select "async function applySelectionFromItem(): boolean" (Cas B: 2 blocs)');
  });

  test('Spec Row 6: msv → my_super_variable (Cas A: 1 mot identifiant complet)', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;
    const mainModule = await import('../../src/main');
    const applySelectionFromItem = mainModule.applySelectionFromItem;

    await vscode.window.showTextDocument(testDocument);
    testEditor.selection = new vscode.Selection(0, 0, 0, 0);

    const results = await search('msv');
    assert.ok(results.length > 0, 'Should find results for "msv"');

    const firstItem = results[0] as any;
    assert.ok(firstItem.label.includes('my_super_variable'),
      'Should match line with my_super_variable');

    applySelectionFromItem(firstItem);
    await new Promise(resolve => setTimeout(resolve, 100));

    const selectedText = testDocument.getText(testEditor.selection);
    assert.strictEqual(selectedText, 'my_super_variable',
      'Spec: Should select "my_super_variable" (Cas A: 1 mot identifiant complet)');
  });

  test('Spec Row 7: tdfix → TODO: fix (Cas B: 2 mots)', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;
    const mainModule = await import('../../src/main');
    const applySelectionFromItem = mainModule.applySelectionFromItem;

    await vscode.window.showTextDocument(testDocument);
    testEditor.selection = new vscode.Selection(0, 0, 0, 0);

    const results = await search('tdfix');
    assert.ok(results.length > 0, 'Should find results for "tdfix"');

    const firstItem = results[0] as any;
    assert.ok(firstItem.label.includes('TODO'),
      'Should match line with TODO');

    applySelectionFromItem(firstItem);
    await new Promise(resolve => setTimeout(resolve, 100));

    const selectedText = testDocument.getText(testEditor.selection);
    assert.strictEqual(selectedText, 'TODO: fix',
      'Spec: Should select "TODO: fix" (Cas B: 2 mots)');
  });

  // ====================================================================
  // ADDITIONAL TESTS
  // ====================================================================

  test('Highlights: Non-contiguous matches work', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;

    const results = await search('afrom');
    assert.ok(results.length > 0, 'Should find results');

    const firstItem = results[0] as any;
    assert.ok(firstItem.highlights, 'Should have highlights');
    assert.ok(Array.isArray(firstItem.highlights), 'Highlights should be an array');
    assert.ok(firstItem.highlights.length > 0, 'Should have at least one highlight range');
  });

  test('Empty pattern returns empty results', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;

    const results = await search('');
    assert.strictEqual(results.length, 0, 'Empty pattern should return no results');
  });

  test('Debug: ondid → onDidAccept (should select full word)', async () => {
    const searchModule = await import('../../src/search');
    const search = searchModule.default;
    const { applySelectionFromItem } = await import('../../src/main');

    // Create a test line with onDidAccept
    const testLine = 'function onDidAccept() {';
    await testEditor.edit(editBuilder => {
      editBuilder.insert(new vscode.Position(7, 0), testLine + '\n');
    });

    const results = await search('ondid');

    // Find the result for our test line
    const matchingResult = results.find(r => r.line.content.includes('onDidAccept'));
    assert.ok(matchingResult, 'Should find onDidAccept line');

    // Apply selection
    applySelectionFromItem(matchingResult);

    // Check the selected text
    const selectedText = testDocument.getText(testEditor.selection);
    console.log(`Selected text for "ondid": "${selectedText}"`);
    console.log(`Selection range: ${testEditor.selection.start.character}-${testEditor.selection.end.character}`);

    assert.strictEqual(selectedText, 'onDidAccept',
      'Should select entire word "onDidAccept", not just "onDid"');
  });
});
