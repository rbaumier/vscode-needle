import type { SearchResults } from "../rust-needle";

type CacheEntry = {
  filePath: string;
  fileVersion: number;
  pattern: string;
  data: { results: SearchResults; text: string };
  timestamp: number;
};

const CACHE_MAX_AGE_MS = 5 * 60 * 1_000;
const CACHE_CLEANUP_INTERVAL = 10;

class SearchCache {
  private readonly cache = new Map<string, CacheEntry>();

  private getCacheKey(filePath: string, pattern: string): string {
    return `${filePath}::${pattern}`;
  }

  get(filePath: string, pattern: string, currentVersion: number): { results: SearchResults; text: string } | null {
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
    if (age > CACHE_MAX_AGE_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(filePath: string, pattern: string, version: number, data: { results: SearchResults; text: string }): void {
    const key = this.getCacheKey(filePath, pattern);
    this.cache.set(key, {
      filePath,
      fileVersion: version,
      pattern,
      data,
      timestamp: Date.now(),
    });

    if (this.cache.size % CACHE_CLEANUP_INTERVAL === 0) {
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
      if (now - entry.timestamp > CACHE_MAX_AGE_MS) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const searchCache = new SearchCache();
