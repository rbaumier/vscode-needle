import { describe, expect, test } from "bun:test";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { quote } from "shell-quote";

const exec = promisify(execCallback);

describe("fzf integration", () => {
  test("fzf should find 'parse' when searching 'prse'", async () => {
    const content = "this is a parse function\nanother line\ntest function";
    const pattern = "prse";

    const c = quote([content]).replaceAll("\\\\n", "\\\\\\n");
    const p = quote([pattern]);
    const command = `echo ${c} | nl -ba -s $'\\t' | fzf -f ${p} | head -100`;

    const { stdout } = await exec(command);

    expect(stdout).toContain("parse");
  });

  test("fzf should find 'function' when searching 'func'", async () => {
    const content = "this is a parse function\nanother line\ntest function";
    const pattern = "func";

    const c = quote([content]).replaceAll("\\\\n", "\\\\\\n");
    const p = quote([pattern]);
    const command = `echo ${c} | nl -ba -s $'\\t' | fzf -f ${p} | head -100`;

    const { stdout } = await exec(command);

    expect(stdout).toContain("function");
    expect(stdout.trim().split("\n").length).toBe(2); // Should find 2 lines
  });

  test("should parse fzf output correctly", async () => {
    const content = "this is a parse function";
    const pattern = "prse";

    const c = quote([content]).replaceAll("\\\\n", "\\\\\\n");
    const p = quote([pattern]);
    const command = `echo ${c} | nl -ba -s $'\\t' | fzf -f ${p} | head -100`;

    const { stdout } = await exec(command);
    const lines = stdout.trim().split("\n");

    expect(lines.length).toBeGreaterThan(0);

    const [lineNumber, lineContent] = lines[0].split("\t");
    expect(lineNumber.trim()).toBe("1");
    expect(lineContent).toBe("this is a parse function");
  });
});
