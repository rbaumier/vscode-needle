import { writeFileSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchDocument } from "./rust-needle";

const PATTERN = "foo";
const RUNS = 10;

const sizes = [
  { lines: 300_000, label: "300K" },
  { lines: 1_000_000, label: "1M" },
  { lines: 3_000_000, label: "3M" },
  { lines: 10_000_000, label: "10M" },
  { lines: 30_000_000, label: "30M" },
  { lines: 100_000_000, label: "100M" },
  { lines: 300_000_000, label: "300M" },
];

function generateFile(lineCount: number): string {
  const path = join(tmpdir(), `needle-bench-${lineCount}.txt`);
  const chunkSize = 100_000;
  const chunks: string[] = [];

  for (let i = 0; i < lineCount; i++) {
    // ~1 in 50 lines contains the pattern
    if (i % 50 === 0) {
      chunks.push(`line ${i} with foo inside`);
    } else {
      chunks.push(`line ${i} some random content here`);
    }

    if (chunks.length >= chunkSize) {
      if (i < chunkSize) {
        writeFileSync(path, chunks.join("\n") + "\n");
      } else {
        writeFileSync(path, chunks.join("\n") + "\n", { flag: "a" });
      }
      chunks.length = 0;
    }
  }

  if (chunks.length > 0) {
    writeFileSync(path, chunks.join("\n") + "\n", { flag: "a" });
  }

  return path;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

function formatTime(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(1)}ms`;
}

console.log("Needle Benchmark");
console.log("=================\n");
console.log(`Pattern: "${PATTERN}" | Runs: ${RUNS} (median) | Limit: 100\n`);
console.log("| Lines | File size | Search time | Matches |");
console.log("|-------|-----------|-------------|---------|");

for (const { lines, label } of sizes) {
  process.stdout.write(`Generating ${label} lines...`);
  const path = generateFile(lines);
  const fileSize = statSync(path).size;
  process.stdout.write(` ${formatSize(fileSize)}. Benchmarking...`);

  // Warmup
  searchDocument({ path }, PATTERN, 100);

  const times: number[] = [];
  let matchCount = 0;

  for (let r = 0; r < RUNS; r++) {
    const start = performance.now();
    const results = searchDocument({ path }, PATTERN, 100);
    const elapsed = performance.now() - start;
    times.push(elapsed);
    matchCount = results.length;
  }

  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];

  console.log(`\r| ${label.padEnd(5)} | ${formatSize(fileSize).padEnd(9)} | ${formatTime(median).padEnd(11)} | ${String(matchCount).padEnd(7)} |`);

  unlinkSync(path);
}

console.log("\n> Apple M-series, median of 10 runs, limit=100 matches");
