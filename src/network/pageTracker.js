"use strict";

const { Tab } = require("../shim/tab");

const requestIdSymbol = Symbol("networkRequestId");
let trackerCounter = 0;

class PageTracker {
  constructor(options) {
    this.context = options.context;
    this.page = options.page;
    this.pageId = options.pageId;
    this.storage = options.storage;
    this.maxBodyLength = options.maxBodyLength ?? 64 * 1024;
    this.maxPostDataLength = options.maxPostDataLength ?? 32 * 1024;
    this.monitorId = `monitor-${++trackerCounter}`;
    this._disposed = false;

    this.latestUrl = safePageUrl(this.page);
    this.latestTitle = safePageTitle(this.page);

    this._onRequest = this._onRequest.bind(this);
    this._onResponse = this._onResponse.bind(this);
    this._onRequestFailed = this._onRequestFailed.bind(this);

    this.page.on("request", this._onRequest);
    this.page.on("response", this._onResponse);
    this.page.on("requestfailed", this._onRequestFailed);

    this.storage.registerPageMonitor(this.pageId, this.monitorId);
  }

  dispose() {
    if (this._disposed)
      return;
    this._disposed = true;
    this.page.off("request", this._onRequest);
    this.page.off("response", this._onResponse);
    this.page.off("requestfailed", this._onRequestFailed);
    this.storage.unregisterPageMonitor(this.pageId);
  }

  snapshot() {
    this.latestUrl = safePageUrl(this.page) || this.latestUrl;
    this.latestTitle = safePageTitle(this.page) || this.latestTitle;
    return {
      pageId: this.pageId,
      url: this.latestUrl,
      title: this.latestTitle
    };
  }

  _onRequest(request) {
    try {
      this.latestUrl = safePageUrl(this.page);
      this.latestTitle = safePageTitle(this.page);

      const { value: requestBody, truncated: requestBodyTruncated } = safeTruncate(() => request.postData(), this.maxPostDataLength);

      const record = this.storage.saveRequest({
        pageId: this.pageId,
        pageUrl: this.latestUrl,
        pageTitle: this.latestTitle,
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        isNavigationRequest: request.isNavigationRequest(),
        frameUrl: safeFrameUrl(request),
        requestHeaders: safeClone(request.headers?.()),
        requestBody,
        requestBodyTruncated,
        status: null,
        statusText: null,
        responseHeaders: null,
        responseBody: null,
        responseBodyTruncated: false,
        responseBodyError: null,
        timing: null,
        error: null
      });

      request[requestIdSymbol] = record.id;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("Failed to capture request", error);
    }
  }

  async _onResponse(response) {
    try {
      this.latestUrl = safePageUrl(this.page);
      this.latestTitle = safePageTitle(this.page);
      const request = response.request();
      const requestId = request[requestIdSymbol];
      if (!requestId)
        return;

      const contentType = getHeader(response.headers(), "content-type");
      const status = response.status();
      const statusText = response.statusText();
      const bodyResult = await this._readResponseBody(response, contentType);
      const timing = safeTiming(response);

      this.storage.updateRequest(requestId, {
        status,
        statusText,
        responseHeaders: safeClone(response.headers?.()),
        responseBody: bodyResult.body,
        responseBodyTruncated: bodyResult.truncated,
        responseBodyError: bodyResult.error,
        contentType,
        timing,
        durationMs: timing?.duration ?? null
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("Failed to capture response", error);
    }
  }

  _onRequestFailed(request) {
    try {
      this.latestUrl = safePageUrl(this.page);
      this.latestTitle = safePageTitle(this.page);
      const requestId = request[requestIdSymbol];
      if (!requestId)
        return;
      this.storage.updateRequest(requestId, {
        status: 0,
        statusText: "FAILED",
        error: request.failure()?.errorText || "Request failed"
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("Failed to capture failed request", error);
    }
  }

  async _readResponseBody(response, contentType) {
    try {
      const text = await response.text();
      if (typeof text !== "string")
        return { body: null, truncated: false, error: null };
      const truncated = text.length > this.maxBodyLength;
      const body = truncated ? text.slice(0, this.maxBodyLength) : text;
      return { body, truncated, error: null };
    } catch (error) {
      return { body: null, truncated: false, error: error?.message || String(error) };
    }
  }
}

function safePageUrl(page) {
  try {
    return page.url();
  } catch {
    return "about:blank";
  }
}

function safePageTitle(page) {
  try {
    const tab = Tab.forPage(page);
    if (tab)
      return tab.lastTitle();
    return page.url();
  } catch {
    return "";
  }
}

function safeFrameUrl(request) {
  try {
    const frame = request.frame?.();
    if (!frame)
      return null;
    return frame.url();
  } catch {
    return null;
  }
}

function safeClone(value) {
  if (!value)
    return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function getHeader(headers, name) {
  if (!headers)
    return null;
  if (typeof headers.get === "function")
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? null;
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function safeTiming(response) {
  try {
    const timing = response.timing();
    if (!timing)
      return null;
    const startTime = timing.startTime || 0;
    const normalize = (value) => typeof value === "number" && value >= 0 ? value - startTime : null;
    return {
      startTime,
      domainLookup: normalize(timing.domainLookup),
      connectStart: normalize(timing.connectStart),
      connectEnd: normalize(timing.connectEnd),
      requestStart: normalize(timing.requestStart),
      responseStart: normalize(timing.responseStart),
      responseEnd: normalize(timing.responseEnd),
      duration: typeof timing.responseEnd === "number" && typeof startTime === "number" ? timing.responseEnd - startTime : null
    };
  } catch {
    return null;
  }
}

function safeTruncate(producer, maxLength) {
  try {
    const value = producer();
    if (!value || typeof value !== "string")
      return { value: value ?? null, truncated: false };
    if (value.length > maxLength)
      return { value: value.slice(0, maxLength), truncated: true };
    return { value, truncated: false };
  } catch {
    return { value: null, truncated: false };
  }
}

module.exports = {
  PageTracker,
  requestIdSymbol
};


