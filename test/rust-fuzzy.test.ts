import { describe, expect, test } from "bun:test";
import { fuzzySearch } from "../rust-fuzzy";

describe("Rust fuzzy search", () => {
  test("should match 'prse' with 'parse'", () => {
    const lines = [
      "function parseSearchOutput(output: string): ParsedLine[]",
      "const result = true",
      "export function parse(content: string)",
    ];

    const results = fuzzySearch(lines, "prse", 10);

    expect(results.length).toBeGreaterThan(0);
    const firstMatch = results[0];
    expect(firstMatch.lineContent).toContain("parse");
  });

  test("should return results sorted by score", () => {
    const lines = [
      "property value",
      "parse function",
      "parseSearchOutput method",
      "other content",
    ];

    const results = fuzzySearch(lines, "prse", 10);

    expect(results.length).toBeGreaterThan(0);
    // First result should have highest score
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test("should provide match positions", () => {
    const lines = ["function parseSearchOutput(output: string)"];

    const results = fuzzySearch(lines, "prse", 10);

    expect(results.length).toBe(1);
    const match = results[0];
    expect(match.matchStart).toBeDefined();
    expect(match.matchEnd).toBeDefined();
    expect(match.matchEnd).toBeGreaterThan(match.matchStart);
  });

  test("should handle empty pattern", () => {
    const lines = ["function parse()"];
    const results = fuzzySearch(lines, "", 10);
    expect(results.length).toBe(0);
  });

  test("should handle no matches", () => {
    const lines = ["hello world", "foo bar"];
    const results = fuzzySearch(lines, "xyz", 10);
    expect(results.length).toBe(0);
  });

  test("should respect limit parameter", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `parse function ${i}`);
    const results = fuzzySearch(lines, "prse", 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  test("should be case-insensitive", () => {
    const lines = ["ParseFunction", "PARSE_FUNCTION", "parse_function"];
    const results = fuzzySearch(lines, "prse", 10);
    expect(results.length).toBe(3);
  });

  test("should handle special characters", () => {
    const lines = ["function parse(data) { return true; }"];
    const results = fuzzySearch(lines, "prse", 10);
    expect(results.length).toBe(1);
  });

  test("should match with gaps", () => {
    const lines = ["property"];
    const results = fuzzySearch(lines, "pry", 10);
    expect(results.length).toBe(1);
  });

  test("should prefer exact matches", () => {
    const lines = ["parse", "property", "parseSearchOutput"];
    const results = fuzzySearch(lines, "parse", 10);
    expect(results.length).toBeGreaterThan(0);
    // Exact match should have highest score
    expect(results[0].lineContent).toBe("parse");
  });
});
