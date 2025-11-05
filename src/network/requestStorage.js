"use strict";

class RequestStorage {
  constructor() {
    this.requests = new Map();
    this.requestCounter = 0;
    this.activePageMonitors = new Map();
  }

  saveRequest(data) {
    const requestId = `req-${++this.requestCounter}`;
    const record = {
      id: requestId,
      timestamp: Date.now(),
      ...data
    };
    if (typeof record.requestBodyBytes !== "number")
      record.requestBodyBytes = record.requestBody ? Buffer.byteLength(record.requestBody) : 0;
    if (typeof record.requestBodySize !== "number")
      record.requestBodySize = record.requestBodyBytes;
    if (typeof record.responseBodyBytes !== "number")
      record.responseBodyBytes = record.responseBody ? Buffer.byteLength(record.responseBody) : 0;
    if (typeof record.responseBodySize !== "number")
      record.responseBodySize = record.responseBodyBytes;
    this.requests.set(requestId, record);
    return record;
  }

  updateRequest(requestId, patch) {
    const existing = this.requests.get(requestId);
    if (!existing)
      return null;
    Object.assign(existing, patch);
    if (patch.responseBody !== undefined && typeof existing.responseBodyBytes !== "number")
      existing.responseBodyBytes = existing.responseBody ? Buffer.byteLength(existing.responseBody) : 0;
    if (patch.responseBodySize !== undefined && typeof existing.responseBodySize !== "number")
      existing.responseBodySize = patch.responseBodySize;
    if (patch.requestBody !== undefined && typeof existing.requestBodyBytes !== "number")
      existing.requestBodyBytes = existing.requestBody ? Buffer.byteLength(existing.requestBody) : 0;
    if (patch.requestBodySize !== undefined && typeof existing.requestBodySize !== "number")
      existing.requestBodySize = patch.requestBodySize;
    return existing;
  }

  getRequest(requestId) {
    return this.requests.get(requestId) ?? null;
  }

  queryRequests(filters = {}) {
    const {
      pageId,
      urlPattern,
      method,
      status,
      resourceType,
      since,
      search,
      limit
    } = filters;

    let results = Array.from(this.requests.values());

    if (pageId)
      results = results.filter((entry) => entry.pageId === pageId);

    if (urlPattern) {
      const pattern = makeWildcardRegExp(urlPattern);
      if (pattern)
        results = results.filter((entry) => pattern.test(entry.url));
    }

    if (method)
      results = results.filter((entry) => (entry.method || "").toUpperCase() === method.toUpperCase());

    if (typeof status === "number")
      results = results.filter((entry) => entry.status === status);

    if (resourceType)
      results = results.filter((entry) => entry.resourceType === resourceType);

    if (since) {
      const sinceTs = normalizeTimestamp(since);
      if (sinceTs)
        results = results.filter((entry) => entry.timestamp >= sinceTs);
    }

    if (search) {
      const pattern = makeSearchRegExp(search);
      if (pattern) {
        results = results.filter((entry) => {
          if (pattern.test(entry.url))
            return true;
          if (entry.requestBody && pattern.test(entry.requestBody))
            return true;
          if (entry.responseBody && pattern.test(entry.responseBody))
            return true;
          return false;
        });
      }
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    const total = results.length;
    const limited = typeof limit === "number" && limit > 0 ? results.slice(0, limit) : results;

    return {
      total,
      results: limited.map((entry) => ({ ...entry }))
    };
  }

  clearRequests(options = {}) {
    const { pageId } = options;
    if (!pageId) {
      const total = this.requests.size;
      this.requests.clear();
      return total;
    }

    let removed = 0;
    for (const [id, request] of this.requests.entries()) {
      if (request.pageId === pageId) {
        this.requests.delete(id);
        removed++;
      }
    }
    return removed;
  }

  registerPageMonitor(pageId, monitorId) {
    this.activePageMonitors.set(pageId, monitorId);
  }

  unregisterPageMonitor(pageId) {
    this.activePageMonitors.delete(pageId);
  }

  reset() {
    this.requests.clear();
    this.activePageMonitors.clear();
    this.requestCounter = 0;
  }

  getStats() {
    const stats = {
      total: this.requests.size,
      byMethod: {},
      byStatus: {},
      byResourceType: {},
      byPage: {},
      activeMonitors: this.activePageMonitors.size,
      usage: this.getUsage()
    };

    for (const request of this.requests.values()) {
      const method = (request.method || "unknown").toUpperCase();
      stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;

      const status = typeof request.status === "number" ? String(request.status) : "unknown";
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

      const resourceType = request.resourceType || "unknown";
      stats.byResourceType[resourceType] = (stats.byResourceType[resourceType] || 0) + 1;

      const pageId = request.pageId || "unknown";
      const byPage = stats.byPage[pageId] || { count: 0 };
      byPage.count++;
      byPage.title = request.pageTitle || byPage.title;
      byPage.url = request.pageUrl || byPage.url;
      stats.byPage[pageId] = byPage;
    }

    return stats;
  }

  getUsage() {
    let requestBytes = 0;
    let responseBytes = 0;
    let requestOriginalBytes = 0;
    let responseOriginalBytes = 0;
    let requestTruncated = 0;
    let responseTruncated = 0;

    for (const entry of this.requests.values()) {
      const reqSaved = entry.requestBodyBytes || 0;
      const reqOriginal = entry.requestBodySize ?? reqSaved;
      const resSaved = entry.responseBodyBytes || 0;
      const resOriginal = entry.responseBodySize ?? resSaved;
      requestBytes += reqSaved;
      requestOriginalBytes += reqOriginal;
      responseBytes += resSaved;
      responseOriginalBytes += resOriginal;
      if (entry.requestBodyTruncated)
        requestTruncated++;
      if (entry.responseBodyTruncated)
        responseTruncated++;
    }

    return {
      totalRequests: this.requests.size,
      requestBytes,
      requestOriginalBytes,
      requestTruncated,
      responseBytes,
      responseOriginalBytes,
      responseTruncated,
      estimatedMemoryBytes: requestBytes + responseBytes
    };
  }
}

function makeWildcardRegExp(pattern) {
  try {
    const escaped = pattern.replace(/[.+^${}()|\[\]\\]/g, "\\$&");
    const wildcard = escaped.replace(/\*/g, ".*");
    return new RegExp(wildcard, "i");
  } catch {
    return null;
  }
}

function makeSearchRegExp(query) {
  if (!query)
    return null;
  try {
    return new RegExp(query, "i");
  } catch {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, "i");
  }
}

function normalizeTimestamp(value) {
  if (typeof value === "number")
    return value;
  if (typeof value === "string") {
    const date = new Date(value);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

module.exports = {
  RequestStorage
};


