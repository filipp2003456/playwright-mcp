"use strict";

const { PageTracker } = require("./pageTracker");
const { RequestStorage } = require("./requestStorage");

const KB = 1024;
const DEFAULT_LIMITS = {
  maxRequestBodyBytes: 32 * KB,
  maxResponseBodyBytes: 64 * KB
};

const contextState = new WeakMap();
let pageCounter = 0;
let currentLimits = { ...DEFAULT_LIMITS };

function ensureContextState(context) {
  let state = contextState.get(context);
  if (!state) {
    state = {
      storage: new RequestStorage(),
      trackers: new Map()
    };
    contextState.set(context, state);
  }
  return state;
}

function attachPage(context, page) {
  const state = ensureContextState(context);
  if (state.trackers.has(page))
    return state.trackers.get(page);
  const pageId = `page-${++pageCounter}`;
  const tracker = new PageTracker({
    context,
    page,
    pageId,
    storage: state.storage,
    limits: { ...currentLimits }
  });
  state.trackers.set(page, tracker);
  return tracker;
}

function detachPage(context, page) {
  const state = contextState.get(context);
  if (!state)
    return;
  const tracker = state.trackers.get(page);
  if (!tracker)
    return;
  tracker.dispose();
  state.trackers.delete(page);
}

function resetContext(context) {
  const state = contextState.get(context);
  if (!state)
    return;
  for (const tracker of state.trackers.values())
    tracker.dispose();
  state.trackers.clear();
  state.storage.reset();
}

function getRequestStorage(context) {
  return ensureContextState(context).storage;
}

function getTrackedPages(context) {
  const state = contextState.get(context);
  if (!state)
    return [];
  return Array.from(state.trackers.values()).map((tracker) => tracker.snapshot());
}

function configureNetworkLimits(options = {}) {
  const next = { ...currentLimits };
  if (options.maxRequestBodyKB !== undefined) {
    const parsed = parseLimitOption(options.maxRequestBodyKB);
    if (parsed !== undefined)
      next.maxRequestBodyBytes = parsed * KB;
  }
  if (options.maxResponseBodyKB !== undefined) {
    const parsed = parseLimitOption(options.maxResponseBodyKB);
    if (parsed !== undefined)
      next.maxResponseBodyBytes = parsed * KB;
  }
  currentLimits = next;
}

function configureNetworkLimitsFromEnv() {
  const requestEnv = process.env.PLAYWRIGHT_MCP_NETWORK_MAX_REQUEST_KB;
  const responseEnv = process.env.PLAYWRIGHT_MCP_NETWORK_MAX_RESPONSE_KB;
  const options = {};
  if (requestEnv !== undefined)
    options.maxRequestBodyKB = requestEnv;
  if (responseEnv !== undefined)
    options.maxResponseBodyKB = responseEnv;
  if (Object.keys(options).length)
    configureNetworkLimits(options);
}

function parseLimitOption(value) {
  if (value === null || value === undefined)
    return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    return undefined;
  return Math.round(number);
}

function getLimits() {
  return { ...currentLimits };
}

module.exports = {
  ensureContextState,
  attachPage,
  detachPage,
  resetContext,
  getRequestStorage,
  getTrackedPages,
  configureNetworkLimits,
  configureNetworkLimitsFromEnv,
  getLimits
};


