"use strict";

const { Context } = require("../shim/context");
const browserToolsModule = require("../shim/tools");
const browserTools = browserToolsModule.browserTools || browserToolsModule;
const networkTools = require("./tools");
const { attachPage, detachPage, resetContext, configureNetworkLimitsFromEnv } = require("./state");

let installed = false;

function installNetworkMonitoring() {
  if (installed)
    return;

  configureNetworkLimitsFromEnv();
  patchContextLifecycle();
  for (const tool of networkTools)
    browserTools.push(tool);

  installed = true;
}

function patchContextLifecycle() {
  const originalOnPageCreated = Context.__patchedOnPageCreated || Context.prototype._onPageCreated;
  Context.prototype._onPageCreated = function(page) {
    originalOnPageCreated.call(this, page);
    try {
      attachPage(this, page);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("Failed to attach network monitor to page", error);
    }
  };

  const originalOnPageClosed = Context.__patchedOnPageClosed || Context.prototype._onPageClosed;
  Context.prototype._onPageClosed = function(tab) {
    try {
      detachPage(this, tab.page);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("Failed to detach network monitor from page", error);
    }
    return originalOnPageClosed.call(this, tab);
  };

  const originalCloseBrowserContext = Context.__patchedCloseBrowserContext || Context.prototype.closeBrowserContext;
  Context.prototype.closeBrowserContext = async function(...args) {
    try {
      return await originalCloseBrowserContext.apply(this, args);
    } finally {
      resetContext(this);
    }
  };

  const originalDispose = Context.__patchedDispose || Context.prototype.dispose;
  Context.prototype.dispose = async function(...args) {
    try {
      return await originalDispose.apply(this, args);
    } finally {
      resetContext(this);
    }
  };

  Context.__patchedOnPageCreated = Context.prototype._onPageCreated;
  Context.__patchedOnPageClosed = Context.prototype._onPageClosed;
  Context.__patchedCloseBrowserContext = Context.prototype.closeBrowserContext;
  Context.__patchedDispose = Context.prototype.dispose;
}

module.exports = {
  installNetworkMonitoring
};


