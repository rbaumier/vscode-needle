import type { SearchMatch } from "../rust-needle";

type CacheEntry = {
  filePath: string;
  fileVersion: number;
  pattern: string;
  results: SearchMatch[];
  timestamp: number;
};

class SearchCache {
  private readonly cache = new Map<string, CacheEntry>();

  private readonly MAX_AGE_MS = 5 * 60 * 1_000;
  private readonly CLEANUP_INTERVAL = 10;

  private getCacheKey(filePath: string, pattern: string): string {
    return `${filePath}::${pattern}`;
  }

  get(filePath: string, pattern: string, currentVersion: number): SearchMatch[] | null {
    const key = this.getCacheKey(filePath, pattern);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (entry.fileVersion !== currentVersion) {
      this.cache.delete(key);
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.MAX_AGE_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.results;
  }

  set(filePath: string, pattern: string, version: number, results: SearchMatch[]): void {
    const key = this.getCacheKey(filePath, pattern);
    this.cache.set(key, {
      filePath,
      fileVersion: version,
      pattern,
      results,
      timestamp: Date.now(),
    });

    if (this.cache.size % this.CLEANUP_INTERVAL === 0) {
      this.cleanOldEntries();
    }
  }

  invalidateFile(filePath: string): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.filePath === filePath) {
        this.cache.delete(key);
      }
    }
  }

  private cleanOldEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.MAX_AGE_MS) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const searchCache = new SearchCache();
