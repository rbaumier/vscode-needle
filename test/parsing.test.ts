import { describe, expect, test } from "bun:test";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { quote } from "shell-quote";

const exec = promisify(execCallback);

/**
 * Find the best fuzzy match position in content.
 */
function findFuzzyMatch(content: string, pattern: string): { start: number; end: number } | null {
  if (!pattern) {
    return null;
  }

  const contentLower = content.toLowerCase();
  const patternLower = pattern.toLowerCase();

  let patternIdx = 0;
  let matchStart = -1;
  let matchEnd = -1;

  for (let i = 0; i < contentLower.length && patternIdx < patternLower.length; i++) {
    if (contentLower[i] === patternLower[patternIdx]) {
      if (matchStart === -1) {
        matchStart = i;
      }
      matchEnd = i + 1;
      patternIdx++;
    }
  }

  if (patternIdx === patternLower.length) {
    return { start: matchStart, end: matchEnd };
  }

  return null;
}

describe("End-to-end search workflow", () => {
  test("should find 'parse' with 'prse' in real file", async () => {
    const path = quote(["/Users/rbaumier/www/go-to-fuzzy/src/search.ts"]);
    const p = quote(["prse"]);
    const command = `cat ${path} | nl -ba -s $'\\t' | fzf -f ${p} | head -100`;

    const { stdout } = await exec(command);

    console.log("Command output:");
    console.log(stdout);

    expect(stdout).toContain("parse");

    const lines = stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
  });

  test("should parse fzf output correctly for 'prse' pattern", async () => {
    const path = quote(["/Users/rbaumier/www/go-to-fuzzy/src/search.ts"]);
    const p = quote(["prse"]);
    const command = `cat ${path} | nl -ba -s $'\\t' | fzf -f ${p} | head -100`;

    const { stdout } = await exec(command);
    const lines = stdout.trim().split("\n");

    console.log(`Found ${lines.length} lines`);

    // Parse first line
    const firstLine = lines[0];
    console.log("First line:", firstLine);

    const [lineNumber, lineContent] = firstLine.split("\t");
    console.log("Line number:", lineNumber?.trim());
    console.log("Line content:", lineContent);

    expect(lineNumber).toBeDefined();
    expect(lineContent).toBeDefined();

    // Test fuzzy match on parsed content
    const match = findFuzzyMatch(lineContent, "prse");
    console.log("Fuzzy match result:", match);

    if (match) {
      const matchedText = lineContent.substring(match.start, match.end);
      console.log("Matched text:", matchedText);
    }
  });

  test("should handle lines with 'parseSearchOutput' correctly", async () => {
    const content = "function parseSearchOutput(output: string, pattern: string): ParsedLine[] {";
    const match = findFuzzyMatch(content, "prse");

    console.log("Content:", content);
    console.log("Match:", match);

    expect(match).not.toBeNull();

    if (match) {
      const matchedText = content.substring(match.start, match.end);
      console.log("Matched substring:", matchedText);
      expect(matchedText).toContain("p");
      expect(matchedText).toContain("r");
      expect(matchedText).toContain("s");
      expect(matchedText).toContain("e");
    }
  });
});
