import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { search, searchDocument } from "../rust-needle";

describe("searchDocument with text source", () => {
  test("finds matches in provided text", () => {
    const results = searchDocument(
      { text: "first line\nsecond line\nthird line" },
      "second",
      100
    );
    expect(results).toHaveLength(1);
    expect(results[0].lineIndex).toBe(1);
    expect(results[0].lineContent).toBe("second line");
    expect(results[0].matchStart).toBe(0);
    expect(results[0].matchEnd).toBe(6);
  });

  test("returns empty array for no matches", () => {
    const results = searchDocument({ text: "hello world" }, "xyz", 100);
    expect(results).toHaveLength(0);
  });

  test("returns empty array for empty pattern", () => {
    const results = searchDocument({ text: "hello" }, "", 100);
    expect(results).toHaveLength(0);
  });

  test("returns empty array when neither text nor path is set", () => {
    const results = searchDocument({}, "hello", 100);
    expect(results).toHaveLength(0);
  });

  test("respects limit", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i} foo`).join("\n");
    const results = searchDocument({ text }, "foo", 10);
    expect(results).toHaveLength(10);
  });
});

describe("searchDocument with file path source", () => {
  const tmpFile = join(tmpdir(), `needle-test-${crypto.randomUUID()}.txt`);

  afterAll(() => {
    try { unlinkSync(tmpFile); } catch {}
  });

  test("reads and searches a file from disk", () => {
    writeFileSync(tmpFile, "alpha\nbeta\ngamma\ndelta\n");
    const results = searchDocument({ path: tmpFile }, "gamma", 100);
    expect(results).toHaveLength(1);
    expect(results[0].lineIndex).toBe(2);
    expect(results[0].lineContent).toBe("gamma");
    expect(results[0].matchStart).toBe(0);
  });

  test("returns empty array for nonexistent file", () => {
    const results = searchDocument({ path: "/tmp/does-not-exist-needle.txt" }, "foo", 100);
    expect(results).toHaveLength(0);
  });
});

describe("smart case", () => {
  test("lowercase query is case-insensitive", () => {
    const results = search(["Hello World", "hello world", "HELLO WORLD"], "hello", 100);
    expect(results).toHaveLength(3);
  });

  test("query with uppercase is case-sensitive", () => {
    const results = search(["Hello World", "hello world", "HELLO WORLD"], "Hello", 100);
    expect(results).toHaveLength(1);
    expect(results[0].lineIndex).toBe(0);
  });
});

describe("unicode", () => {
  test("matches accented characters", () => {
    const results = search(["let café = 42"], "café", 100);
    expect(results).toHaveLength(1);
    expect(results[0].matchStart).toBe(4);
    expect(results[0].matchEnd).toBe(8);
  });

  test("case-insensitive match on accented characters", () => {
    const results = search(["let Café = 42"], "café", 100);
    expect(results).toHaveLength(1);
  });

  test("matches CJK characters", () => {
    const results = search(["const 你好世界 = true"], "你好", 100);
    expect(results).toHaveLength(1);
    expect(results[0].matchStart).toBe(6);
    expect(results[0].matchEnd).toBe(8);
  });

  test("matches emoji", () => {
    const results = search(["const x = '🎉🎊🎈'"], "🎊", 100);
    expect(results).toHaveLength(1);
  });

  test("highlights have correct char offsets for multibyte", () => {
    const results = search(["àbcdé foo"], "foo", 100);
    expect(results).toHaveLength(1);
    expect(results[0].matchStart).toBe(6);
    expect(results[0].matchEnd).toBe(9);
    expect(results[0].highlights).toEqual([[6, 9]]);
  });
});

describe("selection bounds", () => {
  test("single word match selects the whole word", () => {
    const results = search(["function applySelectionFromItem() {"], "apply", 100);
    expect(results).toHaveLength(1);
    expect(results[0].selectionStart).toBe(9);
    expect(results[0].selectionEnd).toBe(31);
  });

  test("match spanning multiple words selects from first to last word", () => {
    const results = search(["const foo = bar"], "foo = bar", 100);
    expect(results).toHaveLength(1);
    expect(results[0].selectionStart).toBe(6);
    expect(results[0].selectionEnd).toBe(15);
  });
});

describe("line ordering and highlights", () => {
  test("results are in line order", () => {
    const lines = ["third foo", "first", "second foo", "fourth foo"];
    const results = search(lines, "foo", 100);
    expect(results).toHaveLength(3);
    expect(results[0].lineIndex).toBe(0);
    expect(results[1].lineIndex).toBe(2);
    expect(results[2].lineIndex).toBe(3);
  });

  test("highlights are contiguous ranges", () => {
    const results = search(["const foobar = 1"], "foobar", 100);
    expect(results).toHaveLength(1);
    expect(results[0].highlights).toEqual([[6, 12]]);
  });

  test("matchIndices covers the full match span", () => {
    const results = search(["abcdef"], "cde", 100);
    expect(results).toHaveLength(1);
    expect(results[0].matchIndices).toEqual([2, 3, 4]);
  });
});

describe("edge cases", () => {
  test("only first occurrence per line is returned", () => {
    const results = search(["foo bar foo baz foo"], "foo", 100);
    expect(results).toHaveLength(1);
    expect(results[0].matchStart).toBe(0);
  });

  test("pattern longer than line returns no match", () => {
    const results = search(["hi"], "this is much longer than the line", 100);
    expect(results).toHaveLength(0);
  });

  test("pattern equal to entire line matches", () => {
    const results = search(["hello"], "hello", 100);
    expect(results).toHaveLength(1);
    expect(results[0].matchStart).toBe(0);
    expect(results[0].matchEnd).toBe(5);
    expect(results[0].lineContent).toBe("hello");
  });

  test("limit defaults to 100 when omitted", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} foo`);
    const results = search(lines, "foo");
    expect(results).toHaveLength(100);
  });
});
