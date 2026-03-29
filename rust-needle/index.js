const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const { platform, arch } = process;

let nativeBinding = null;
let localFileExisted = false;
let loadError = null;

function isMusl() {
  if (!process.report || typeof process.report.getReport !== "function") {
    try {
      const lddPath = require("node:child_process").execSync("which ldd").toString().trim();
      return readFileSync(lddPath, "utf8").includes("musl");
    } catch {
      return true;
    }
  }
  const { glibcVersionRuntime } = process.report.getReport().header;
  return !glibcVersionRuntime;
}

switch (platform) {
  case "darwin":
    switch (arch) {
      case "x64":
        localFileExisted = existsSync(join(__dirname, "rust-needle.darwin-x64.node"));
        try {
          if (localFileExisted) {
            nativeBinding = require("./rust-needle.darwin-x64.node");
          } else {
            nativeBinding = require("rust-needle-darwin-x64");
          }
        } catch (e) {
          loadError = e;
        }
        break;
      case "arm64":
        localFileExisted = existsSync(join(__dirname, "rust-needle.darwin-arm64.node"));
        try {
          if (localFileExisted) {
            nativeBinding = require("./rust-needle.darwin-arm64.node");
          } else {
            nativeBinding = require("rust-needle-darwin-arm64");
          }
        } catch (e) {
          loadError = e;
        }
        break;
      default:
        throw new Error(`Unsupported architecture on macOS: ${arch}`);
    }
    break;
  case "linux":
    switch (arch) {
      case "x64":
        if (isMusl()) {
          localFileExisted = existsSync(join(__dirname, "rust-needle.linux-x64-musl.node"));
          try {
            if (localFileExisted) {
              nativeBinding = require("./rust-needle.linux-x64-musl.node");
            } else {
              nativeBinding = require("rust-needle-linux-x64-musl");
            }
          } catch (e) {
            loadError = e;
          }
        } else {
          localFileExisted = existsSync(join(__dirname, "rust-needle.linux-x64-gnu.node"));
          try {
            if (localFileExisted) {
              nativeBinding = require("./rust-needle.linux-x64-gnu.node");
            } else {
              nativeBinding = require("rust-needle-linux-x64-gnu");
            }
          } catch (e) {
            loadError = e;
          }
        }
        break;
      case "arm64":
        if (isMusl()) {
          localFileExisted = existsSync(join(__dirname, "rust-needle.linux-arm64-musl.node"));
          try {
            if (localFileExisted) {
              nativeBinding = require("./rust-needle.linux-arm64-musl.node");
            } else {
              nativeBinding = require("rust-needle-linux-arm64-musl");
            }
          } catch (e) {
            loadError = e;
          }
        } else {
          localFileExisted = existsSync(join(__dirname, "rust-needle.linux-arm64-gnu.node"));
          try {
            if (localFileExisted) {
              nativeBinding = require("./rust-needle.linux-arm64-gnu.node");
            } else {
              nativeBinding = require("rust-needle-linux-arm64-gnu");
            }
          } catch (e) {
            loadError = e;
          }
        }
        break;
      default:
        throw new Error(`Unsupported architecture on Linux: ${arch}`);
    }
    break;
  default:
    throw new Error(`Unsupported platform: ${platform}`);
}

if (!nativeBinding) {
  if (loadError) {
    throw loadError;
  }
  throw new Error("Failed to load native binding");
}

const { search, searchDocument, DocumentSource } = nativeBinding;

module.exports.search = search;
module.exports.searchDocument = searchDocument;
module.exports.DocumentSource = DocumentSource;
