import type { FuzzyMatch } from "../rust-fuzzy";
import { log } from "./logger";

interface CacheEntry {
  filePath: string;
  fileVersion: number; // document.version for invalidation
  pattern: string;
  results: FuzzyMatch[];
  timestamp: number;
}

class SearchCache {
  private cache = new Map<string, CacheEntry>();
  private maxAge = 5 * 60 * 1000; // 5 minutes

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
      log(`[CACHE MISS] No entry for "${pattern}" in ${filePath}`);
      return null;
    }

    // Check if file version changed (file was modified)
    if (entry.fileVersion !== currentVersion) {
      log(`[CACHE INVALIDATED] Version mismatch (cached: ${entry.fileVersion}, current: ${currentVersion})`);
      this.cache.delete(key);
      return null;
    }

    // Check if entry is too old
    const age = Date.now() - entry.timestamp;
    if (age > this.maxAge) {
      log(`[CACHE EXPIRED] Entry age: ${(age / 1000).toFixed(1)}s`);
      this.cache.delete(key);
      return null;
    }

    log(`[CACHE HIT] "${pattern}" in ${filePath} (${entry.results.length} results)`);
    return entry.results;
  }

  /**
   * Store search results in cache
   */
  set(
    filePath: string,
    pattern: string,
    version: number,
    results: FuzzyMatch[]
  ): void {
    const key = this.getCacheKey(filePath, pattern);
    this.cache.set(key, {
      filePath,
      fileVersion: version,
      pattern,
      results,
      timestamp: Date.now(),
    });

    log(`[CACHE SET] "${pattern}" in ${filePath} (${results.length} results, version ${version})`);

    // Clean old entries periodically
    if (this.cache.size % 10 === 0) {
      this.cleanOldEntries();
    }
  }

  /**
   * Invalidate all cache entries for a specific file
   */
  invalidateFile(filePath: string): void {
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.filePath === filePath) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      log(`[CACHE INVALIDATE] Removed ${removedCount} entries for ${filePath}`);
    }
  }

  /**
   * Clean entries older than maxAge
   */
  private cleanOldEntries(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.maxAge) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      log(`[CACHE CLEAN] Removed ${removedCount} expired entries`);
    }
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): { size: number; entries: Array<{ pattern: string; age: number }> } {
    const now = Date.now();
    const entries = Array.from(this.cache.values()).map((entry) => ({
      pattern: entry.pattern,
      age: (now - entry.timestamp) / 1000,
    }));

    return { size: this.cache.size, entries };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    log(`[CACHE CLEAR] Removed all ${size} entries`);
  }
}

export const searchCache = new SearchCache();
