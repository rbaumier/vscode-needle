import { describe, expect, test } from "bun:test";

/**
 * Find the best fuzzy match position in content.
 * Returns the start and end indices of the matched characters.
 * Uses proper fuzzy matching: pattern "prse" matches "parse" in order.
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

  // Find the characters of the pattern in order
  for (let i = 0; i < contentLower.length && patternIdx < patternLower.length; i++) {
    if (contentLower[i] === patternLower[patternIdx]) {
      if (matchStart === -1) {
        matchStart = i;
      }
      matchEnd = i + 1;
      patternIdx++;
    }
  }

  // If we matched all pattern characters, return the range
  if (patternIdx === patternLower.length) {
    return { start: matchStart, end: matchEnd };
  }

  return null;
}

describe("findFuzzyMatch", () => {
  test("should match 'prse' in 'parse'", () => {
    const result = findFuzzyMatch("parse", "prse");
    expect(result).not.toBeNull();
    expect(result?.start).toBe(0);
    expect(result?.end).toBe(5);
  });

  test("should match 'prse' in 'this is a parse function'", () => {
    const result = findFuzzyMatch("this is a parse function", "prse");
    expect(result).not.toBeNull();
    // p is at index 10, e is at index 14
    expect(result?.start).toBe(10);
    expect(result?.end).toBe(15);
  });

  test("should match 'func' in 'function'", () => {
    const result = findFuzzyMatch("function", "func");
    expect(result).not.toBeNull();
    expect(result?.start).toBe(0);
    expect(result?.end).toBe(4);
  });

  test("should match 'test' in 'testFunction'", () => {
    const result = findFuzzyMatch("testFunction", "test");
    expect(result).not.toBeNull();
    expect(result?.start).toBe(0);
    expect(result?.end).toBe(4);
  });

  test("should match case-insensitive", () => {
    const result = findFuzzyMatch("ParseFunction", "prse");
    expect(result).not.toBeNull();
    expect(result?.start).toBe(0);
    expect(result?.end).toBe(5);
  });

  test("should return null for non-matching pattern", () => {
    const result = findFuzzyMatch("hello world", "xyz");
    expect(result).toBeNull();
  });

  test("should return null for empty pattern", () => {
    const result = findFuzzyMatch("hello world", "");
    expect(result).toBeNull();
  });

  test("should match with gaps", () => {
    const result = findFuzzyMatch("property", "pry");
    expect(result).not.toBeNull();
    // p at 0, r at 1, y at 7
    expect(result?.start).toBe(0);
    expect(result?.end).toBe(8);
  });

  test("should match scattered characters", () => {
    const result = findFuzzyMatch("const myVariable = parse(data)", "prse");
    expect(result).not.toBeNull();
    // Should find 'parse' word
    const matched = "const myVariable = parse(data)".substring(result!.start, result!.end);
    expect(matched).toContain("p");
    expect(matched).toContain("r");
    expect(matched).toContain("s");
    expect(matched).toContain("e");
  });
});
