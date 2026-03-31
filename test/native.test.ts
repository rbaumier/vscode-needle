import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { search, searchFile, searchText } from "../rust-needle";

describe("searchText", () => {
  test("finds matches in provided text", () => {
    const text = "first line\nsecond line\nthird line";
    const r = searchText(text, "second", 100);
    expect(r.count).toBe(1);
    expect(r.lineIndices[0]).toBe(1);
    expect(r.matchStarts[0]).toBe(0);
    expect(r.matchEnds[0]).toBe(6);
    expect(text.substring(r.lineStarts[0], r.lineEnds[0])).toBe("second line");
  });

  test("returns 0 count for no matches", () => {
    expect(searchText("hello world", "xyz", 100).count).toBe(0);
  });

  test("returns 0 count for empty pattern", () => {
    expect(searchText("hello", "", 100).count).toBe(0);
  });

  test("respects limit", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i} foo`).join("\n");
    expect(searchText(text, "foo", 10).count).toBe(10);
  });
});

describe("searchFile", () => {
  const tmpFile = join(tmpdir(), `needle-test-${crypto.randomUUID()}.txt`);

  afterAll(() => {
    try { unlinkSync(tmpFile); } catch {}
  });

  test("reads and searches a file from disk", () => {
    writeFileSync(tmpFile, "alpha\nbeta\ngamma\ndelta\n");
    const r = searchFile(tmpFile, "gamma", 100);
    expect(r.count).toBe(1);
    expect(r.lineIndices[0]).toBe(2);
    expect(r.matchStarts[0]).toBe(0);
  });

  test("returns 0 count for nonexistent file", () => {
    expect(searchFile("/tmp/does-not-exist-needle.txt", "foo", 100).count).toBe(0);
  });
});

describe("smart case", () => {
  test("lowercase query is case-insensitive", () => {
    const r = search(["Hello World", "hello world", "HELLO WORLD"], "hello", 100);
    expect(r).toHaveLength(3);
  });

  test("query with uppercase is case-sensitive", () => {
    const r = search(["Hello World", "hello world", "HELLO WORLD"], "Hello", 100);
    expect(r).toHaveLength(1);
    expect(r[0].lineIndex).toBe(0);
  });
});

describe("unicode", () => {
  test("matches accented characters", () => {
    const r = search(["let café = 42"], "café", 100);
    expect(r).toHaveLength(1);
    expect(r[0].matchStart).toBe(4);
    expect(r[0].matchEnd).toBe(8);
  });

  test("case-insensitive match on accented characters", () => {
    expect(search(["let Café = 42"], "café", 100)).toHaveLength(1);
  });

  test("matches CJK characters", () => {
    const r = search(["const 你好世界 = true"], "你好", 100);
    expect(r).toHaveLength(1);
    expect(r[0].matchStart).toBe(6);
    expect(r[0].matchEnd).toBe(8);
  });

  test("matches emoji", () => {
    expect(search(["const x = '🎉🎊🎈'"], "🎊", 100)).toHaveLength(1);
  });

  test("highlights have correct char offsets for multibyte", () => {
    const r = search(["àbcdé foo"], "foo", 100);
    expect(r).toHaveLength(1);
    expect(r[0].matchStart).toBe(6);
    expect(r[0].matchEnd).toBe(9);
    expect(r[0].highlights).toEqual([[6, 9]]);
  });
});

describe("selection bounds", () => {
  test("single word match selects the whole word", () => {
    const r = search(["function applySelectionFromItem() {"], "apply", 100);
    expect(r).toHaveLength(1);
    expect(r[0].selectionStart).toBe(9);
    expect(r[0].selectionEnd).toBe(31);
  });

  test("match spanning multiple words selects from first to last word", () => {
    const r = search(["const foo = bar"], "foo = bar", 100);
    expect(r).toHaveLength(1);
    expect(r[0].selectionStart).toBe(6);
    expect(r[0].selectionEnd).toBe(15);
  });
});

describe("line ordering and highlights", () => {
  test("results are in line order", () => {
    const r = search(["third foo", "first", "second foo", "fourth foo"], "foo", 100);
    expect(r).toHaveLength(3);
    expect(r[0].lineIndex).toBe(0);
    expect(r[1].lineIndex).toBe(2);
    expect(r[2].lineIndex).toBe(3);
  });

  test("highlights are contiguous ranges", () => {
    const r = search(["const foobar = 1"], "foobar", 100);
    expect(r[0].highlights).toEqual([[6, 12]]);
  });

  test("matchIndices covers the full match span", () => {
    const r = search(["abcdef"], "cde", 100);
    expect(r[0].matchIndices).toEqual([2, 3, 4]);
  });
});

describe("edge cases", () => {
  test("only first occurrence per line is returned", () => {
    const r = search(["foo bar foo baz foo"], "foo", 100);
    expect(r).toHaveLength(1);
    expect(r[0].matchStart).toBe(0);
  });

  test("pattern longer than line returns no match", () => {
    expect(search(["hi"], "this is much longer than the line", 100)).toHaveLength(0);
  });

  test("pattern equal to entire line matches", () => {
    const r = search(["hello"], "hello", 100);
    expect(r).toHaveLength(1);
    expect(r[0].matchStart).toBe(0);
    expect(r[0].matchEnd).toBe(5);
    expect(r[0].lineContent).toBe("hello");
  });

  test("limit defaults to 100 when omitted", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} foo`);
    expect(search(lines, "foo")).toHaveLength(100);
  });
});

describe("searchText flat API", () => {
  test("returns parallel arrays", () => {
    const text = "first line\nsecond foo line\nthird\nfourth foo";
    const r = searchText(text, "foo", 100);
    expect(r.count).toBe(2);
    expect(r.lineIndices).toEqual([1, 3]);
    expect(r.matchStarts).toEqual([7, 7]);
    expect(text.substring(r.lineStarts[0], r.lineEnds[0])).toBe("second foo line");
    expect(text.substring(r.lineStarts[1], r.lineEnds[1])).toBe("fourth foo");
  });

  test("byte offsets work for line extraction", () => {
    const text = "aaa\nbbb foo\nccc\nddd foo";
    const r = searchText(text, "foo", 100);
    for (let i = 0; i < r.count; i++) {
      const line = text.substring(r.lineStarts[i], r.lineEnds[i]);
      expect(line).toContain("foo");
    }
  });

  test("CRLF line endings do not leak into line content", () => {
    const raw = "first line\r\nsecond foo line\r\nthird\r\nfourth foo\r\n";
    const r = searchText(raw, "foo", 100);
    expect(r.count).toBe(2);
    // searchText normalizes \r\n to \n internally — use normalized text for substring
    const text = raw.replaceAll("\r\n", "\n");
    const line1 = text.substring(r.lineStarts[0], r.lineEnds[0]);
    const line2 = text.substring(r.lineStarts[1], r.lineEnds[1]);
    expect(line1).toBe("second foo line");
    expect(line2).toBe("fourth foo");
    expect(line1).not.toContain("\r");
    expect(line2).not.toContain("\r");
  });
});
