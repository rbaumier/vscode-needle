import type { FuzzyMatch } from "../rust-fuzzy";

type CacheEntry = {
  filePath: string;
  fileVersion: number; // document.version for invalidation
  pattern: string;
  results: FuzzyMatch[];
  timestamp: number;
};

class SearchCache {
  private readonly cache = new Map<string, CacheEntry>();

  // biome-ignore lint/style/noMagicNumbers: magic number for cache expiration
  private readonly maxAge = 5 * 60 * 1000; // 5 minutes

  private getCacheKey(filePath: string, pattern: string): string {
    return `${filePath}::${pattern}`;
  }

  /**
   * Get cached results if available and valid
   * Returns null if cache miss or invalidated
   */
  get(filePath: string, pattern: string, currentVersion: number): FuzzyMatch[] | null {
    const key = this.getCacheKey(filePath, pattern);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if file version changed (file was modified)
    if (entry.fileVersion !== currentVersion) {
      this.cache.delete(key);
      return null;
    }

    // Check if entry is too old
    const age = Date.now() - entry.timestamp;
    if (age > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    return entry.results;
  }

  /**
   * Store search results in cache
   */
  set(filePath: string, pattern: string, version: number, results: FuzzyMatch[]): void {
    const key = this.getCacheKey(filePath, pattern);
    this.cache.set(key, {
      filePath,
      fileVersion: version,
      pattern,
      results,
      timestamp: Date.now(),
    });

    // Clean old entries periodically
    if (this.cache.size % 10 === 0) {
      this.cleanOldEntries();
    }
  }

  /**
   * Invalidate all cache entries for a specific file
   */
  invalidateFile(filePath: string): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.filePath === filePath) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clean entries older than maxAge
   */
  private cleanOldEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.maxAge) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): { size: number; entries: Array<{ pattern: string; age: number }> } {
    const now = Date.now();
    const entries = Array.from(this.cache.values()).map((entry) => ({
      pattern: entry.pattern,
      // biome-ignore lint/style/noMagicNumbers: magic number for cache age
      age: (now - entry.timestamp) / 1000,
    }));

    return { size: this.cache.size, entries };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }
}

export const searchCache = new SearchCache();
