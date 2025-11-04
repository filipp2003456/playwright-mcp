"use strict";

const { PageTracker } = require("./pageTracker");
const { RequestStorage } = require("./requestStorage");

const contextState = new WeakMap();
let pageCounter = 0;

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
    storage: state.storage
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

module.exports = {
  ensureContextState,
  attachPage,
  detachPage,
  resetContext,
  getRequestStorage,
  getTrackedPages
};


