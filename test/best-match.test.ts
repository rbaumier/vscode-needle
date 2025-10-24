import { describe, expect, test } from "bun:test";

/**
 * Find the best fuzzy match position in content.
 * Finds the shortest/most compact match.
 */
function findFuzzyMatch(content: string, pattern: string): { start: number; end: number } | null {
  if (!pattern) {
    return null;
  }

  const contentLower = content.toLowerCase();
  const patternLower = pattern.toLowerCase();

  // Extract word boundaries (alphanumeric sequences)
  const wordBoundaryRegex = /\b\w+\b/g;
  const words: Array<{ text: string; start: number; end: number }> = [];
  let match;

  while ((match = wordBoundaryRegex.exec(content)) !== null) {
    words.push({
      text: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Find best word match (prefer longer words that contain the pattern)
  let bestWordMatch: { start: number; end: number; wordLength: number } | null = null;

  for (const word of words) {
    let patternIdx = 0;
    let matchStart = -1;
    let matchEnd = -1;

    for (let i = 0; i < word.text.length && patternIdx < patternLower.length; i++) {
      if (word.text[i] === patternLower[patternIdx]) {
        if (matchStart === -1) {
          matchStart = i;
        }
        matchEnd = i + 1;
        patternIdx++;
      }
    }

    // If this word contains all pattern characters
    if (patternIdx === patternLower.length) {
      // Prefer longer words (e.g., "parse" over "prse", "parseSearchOutput" over "parse")
      if (!bestWordMatch || word.text.length > bestWordMatch.wordLength) {
        bestWordMatch = {
          start: word.start + matchStart,
          end: word.start + matchEnd,
          wordLength: word.text.length,
        };
      }
    }
  }

  if (bestWordMatch) {
    return { start: bestWordMatch.start, end: bestWordMatch.end };
  }

  // Fallback: find first fuzzy match across entire content
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

describe("Best match selection", () => {
  test("should prefer 'parse' word over spread out match", () => {
    const content = "proper fuzzy matching: pattern \"prse\" matches \"parse\" in order";
    const result = findFuzzyMatch(content, "prse");

    expect(result).not.toBeNull();
    console.log("Match:", result);
    console.log("Matched text:", content.substring(result!.start, result!.end));

    // Should match "parse" (5 chars) not the spread out match (36 chars)
    const matchedText = content.substring(result!.start, result!.end);
    expect(matchedText).toBe("parse");
  });

  test("should find 'parse' in 'parseSearchOutput'", () => {
    const content = "function parseSearchOutput(output: string, pattern: string)";
    const result = findFuzzyMatch(content, "prse");

    expect(result).not.toBeNull();
    console.log("Match:", result);
    console.log("Matched text:", content.substring(result!.start, result!.end));

    const matchedText = content.substring(result!.start, result!.end);
    expect(matchedText).toBe("parse");
  });

  test("should find exact match when available", () => {
    const content = "this is parse function";
    const result = findFuzzyMatch(content, "parse");

    expect(result).not.toBeNull();
    console.log("Match:", result);

    const matchedText = content.substring(result!.start, result!.end);
    expect(matchedText).toBe("parse");
  });
});
