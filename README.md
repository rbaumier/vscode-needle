# Needle

<p align="center">
  <img alt="Needle icon" src="https://github.com/rbaumier/vscode-needle/blob/master/assets/icon.png?raw=true" width="200">
</p>

## What

Needle is a VSCode/Cursor extension for fast in-file text search. Type a pattern, see all matching lines, jump to the one you want.

Powered by a native Rust engine for instant results, even on large files.

<p align="center">
  <img alt="Extension in action" src="https://github.com/rbaumier/vscode-needle/blob/master/assets/demo.gif?raw=true">
</p>

## Installation

### VSCode

[Install from the VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=rbaumier.needle)

### Cursor

[Install from Open VSX](https://open-vsx.org/extension/rbaumier/needle)

Or search for "Needle" directly in the Cursor extensions panel.

> **Note:** This extension works on both VSCode and Cursor.

## Usage

### Set a keyboard shortcut

1. Open **Command Palette** (Cmd/Ctrl + Shift + P)
2. Choose **"Preferences: Open Keyboard Shortcuts"**
3. Search for **"needle.find"**
4. Set a **keybinding**

### Or, just try it

1. Open Command Palette **(Cmd/Ctrl + Shift + P)**
2. Choose **"Needle: Find in file"**

## How it works

- **Smart case**: case-insensitive by default, case-sensitive if your query contains uppercase
- **Substring matching**: finds exact contiguous matches in each line
- **Rust-powered**: native search engine via napi-rs for sub-millisecond performance
- **Results in line order**: matches appear top-to-bottom as they occur in the file

## FAQ

### Does this work on Cursor?

Yes! The extension works on both VSCode and Cursor.

### How are search results ordered?

Results are displayed in line order (top to bottom). The first match in the file appears first.
