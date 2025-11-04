"use strict";

let cached;

function getBundle() {
  if (!cached)
    cached = load();
  return cached;
}

function load() {
  const baseDir = getPlaywrightBaseDir();
  const path = require("path");
  const fs = require("fs");
  const candidates = [
    "lib/mcp/sdk/bundle.js",
    "lib/server/mcp/sdk/bundle.js",
    "lib/mcp/sdk.js",
    "lib/server/mcp/sdk.js"
  ];

  for (const candidate of candidates) {
    const absolutePath = path.join(baseDir, candidate);
    try {
      if (fs.existsSync(absolutePath)) {
        // eslint-disable-next-line import/no-dynamic-require, global-require
        return require(absolutePath);
      }
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND" && error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED")
        throw error;
    }
  }

  throw new Error("Unable to locate Playwright MCP SDK bundle. Update shim with new path.");
}

function getPlaywrightBaseDir() {
  const path = require("path");
  const playwrightPackage = require.resolve("playwright/package.json");
  return path.dirname(playwrightPackage);
}

module.exports = getBundle();


