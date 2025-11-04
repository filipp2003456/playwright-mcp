"use strict";

let cached;

function getTools() {
  if (!cached)
    cached = load();
  return cached;
}

function load() {
  const baseDir = getPlaywrightBaseDir();
  const path = require("path");
  const fs = require("fs");
  const candidates = [
    "lib/mcp/browser/tools.js",
    "lib/server/mcp/tools.js",
    "lib/mcp/tools.js"
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

  throw new Error("Unable to locate Playwright MCP tools module. Update shim with new path.");
}

function getPlaywrightBaseDir() {
  const path = require("path");
  const playwrightPackage = require.resolve("playwright/package.json");
  return path.dirname(playwrightPackage);
}

module.exports = getTools();


