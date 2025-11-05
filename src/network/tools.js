"use strict";

const { z } = require("../shim/sdk");
const { defineTool } = require("../shim/tool");
const { getRequestStorage, getTrackedPages, getLimits } = require("./state");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const KB = 1024;

const getRequestsTool = defineTool({
  capability: "core-network",
  schema: {
    name: "browser_network_get_requests",
    title: "Get network requests",
    description: "Return recent network requests with filtering options",
    type: "readOnly",
    inputSchema: z.object({
      pageId: z.string().describe("Identifier of the page (see stats)" ).optional(),
      urlPattern: z.string().describe("URL wildcard (supports *)").optional(),
      method: z.string().describe("HTTP method").optional(),
      status: z.number().int().describe("HTTP status").optional(),
      resourceType: z.string().describe("Resource type from Playwright").optional(),
      since: z.any().describe("Return requests after this timestamp. Accepts ms since epoch (e.g. 1730796000000) or an ISO string (e.g. \"2025-11-05T11:00:00Z\"). Pass inside JSON object.").optional(),
      search: z.string().describe("Case-insensitive search in URL or bodies (plain text/regex). Wildcards are not supported here; use urlPattern for \"*\" matching.").optional(),
      limit: z.number().int().positive().max(MAX_LIMIT).describe("Maximum number of requests to return (default 50)").optional()
    })
  },
  handle: async (context, params, response) => {
    const storage = getRequestStorage(context);
    const limit = params.limit ?? DEFAULT_LIMIT;
    const normalizedSince = normalizeSince(params.since);
    const { results, total } = storage.queryRequests({
      pageId: params.pageId,
      urlPattern: params.urlPattern,
      method: params.method,
      status: params.status,
      resourceType: params.resourceType,
      since: normalizedSince,
      search: params.search,
      limit
    });

    if (!results.length) {
      response.addResult(renderEmptyResult(params));
      return;
    }

    response.addResult(renderRequests(results, total, limit));
  }
});

const getRequestDetailsTool = defineTool({
  capability: "core-network",
  schema: {
    name: "browser_network_get_request_details",
    title: "Get request details",
    description: "Return full details for a request by id",
    type: "readOnly",
    inputSchema: z.object({
      requestId: z.string().describe("Request identifier from get requests")
    })
  },
  handle: async (context, params, response) => {
    const storage = getRequestStorage(context);
    const request = storage.getRequest(params.requestId);
    if (!request) {
      response.addError(`Request ${params.requestId} not found.`);
      return;
    }
    response.addResult(renderRequestDetails(request));
  }
});

const clearRequestsTool = defineTool({
  capability: "core-network",
  schema: {
    name: "browser_network_clear_requests",
    title: "Clear stored requests",
    description: "Clear recorded requests globally or for a specific page",
    type: "action",
    inputSchema: z.object({
      pageId: z.string().describe("Optional page identifier to clear").optional()
    })
  },
  handle: async (context, params, response) => {
    const storage = getRequestStorage(context);
    const removed = storage.clearRequests({ pageId: params.pageId });
    if (removed === 0) {
      response.addResult(params.pageId ? `No requests to clear for page ${params.pageId}.` : "No requests were stored.");
      return;
    }
    response.addResult(params.pageId ? `Cleared ${removed} requests for page ${params.pageId}.` : `Cleared ${removed} requests.`);
  }
});

const getStatsTool = defineTool({
  capability: "core-network",
  schema: {
    name: "browser_network_get_stats",
    title: "Network stats",
    description: "Show summary statistics for recorded requests",
    type: "readOnly",
    inputSchema: z.object({})
  },
  handle: async (context, _params, response) => {
    const storage = getRequestStorage(context);
    const stats = storage.getStats();
    const pages = getTrackedPages(context);
    response.addResult(renderStats(stats, pages));
  }
});

const getUsageTool = defineTool({
  capability: "core-network",
  schema: {
    name: "browser_network_get_usage",
    title: "Network storage usage",
    description: "Shows how much memory the recorded network data uses",
    type: "readOnly",
    inputSchema: z.object({})
  },
  handle: async (context, _params, response) => {
    const storage = getRequestStorage(context);
    const usage = storage.getUsage();
    const limits = getLimits();
    response.addResult(renderUsageReport(usage, limits));
  }
});

function renderEmptyResult(filters) {
  const lines = ["No requests match the current filters."];
  if (filters.pageId)
    lines.push(`- pageId: ${filters.pageId}`);
  if (filters.urlPattern)
    lines.push(`- urlPattern: ${filters.urlPattern}`);
  if (filters.method)
    lines.push(`- method: ${filters.method}`);
  if (filters.status)
    lines.push(`- status: ${filters.status}`);
  if (filters.resourceType)
    lines.push(`- resourceType: ${filters.resourceType}`);
  if (filters.search)
    lines.push(`- search: ${filters.search}`);
  return lines.join("\n");
}

function renderRequests(requests, total, limit) {
  const lines = [];
  lines.push(`Showing ${requests.length} of ${total} request(s).`);
  if (requests.length === limit)
    lines.push(`Use "limit" to see more (max ${MAX_LIMIT}).`);
  if (requests.some(hasTruncation))
    lines.push("* cut req/resp — saved/original size in KB");
  lines.push("");
  for (const request of requests) {
    const parts = [];
    parts.push(`[${request.id}]`);
    if (request.method)
      parts.push(request.method.toUpperCase());
    const status = typeof request.status === "number" ? request.status : "-";
    if (request.statusText)
      parts.push(`${status} ${request.statusText}`);
    else
      parts.push(String(status));
    if (request.resourceType)
      parts.push(request.resourceType);
    parts.push(request.url);
    const duration = typeof request.durationMs === "number" ? ` (${Math.round(request.durationMs)} ms)` : "";
    const cutInfo = renderCutInfo(request);
    const suffix = cutInfo ? ` ${cutInfo}` : "";
    lines.push(`- ${parts.join(" | ")}${duration}${suffix}`);
    if (request.pageId)
      lines.push(`  page: ${request.pageId} (${request.pageTitle || request.pageUrl || ""})`);
  }
  return lines.join("\n");
}

function renderCutInfo(request) {
  const parts = [];
  if (request.requestBodyTruncated)
    parts.push(`req ${formatKB(request.requestBodyBytes)}/${formatKB(request.requestBodySize)} KB`);
  if (request.responseBodyTruncated)
    parts.push(`resp ${formatKB(request.responseBodyBytes)}/${formatKB(request.responseBodySize)} KB`);
  if (!parts.length)
    return "";
  return `[cut ${parts.join(" | ")}]`;
}

function hasTruncation(request) {
  return Boolean(request.requestBodyTruncated || request.responseBodyTruncated);
}

function renderRequestDetails(request) {
  const lines = [];
  lines.push(`Request ${request.id}`);
  lines.push(`- method: ${request.method}`);
  lines.push(`- url: ${request.url}`);
  if (request.pageId)
    lines.push(`- page: ${request.pageId} (${request.pageTitle || request.pageUrl || ""})`);
  if (typeof request.timestamp === "number")
    lines.push(`- timestamp: ${new Date(request.timestamp).toISOString()}`);
  if (typeof request.status === "number") {
    const statusSuffix = request.statusText ? ` ${request.statusText}` : "";
    lines.push(`- status: ${request.status}${statusSuffix}`);
  }
  if (request.durationMs)
    lines.push(`- duration: ${Math.round(request.durationMs)} ms`);
  if (request.error)
    lines.push(`- error: ${request.error}`);
  if (request.resourceType)
    lines.push(`- resourceType: ${request.resourceType}`);
  if (request.frameUrl)
    lines.push(`- frame: ${request.frameUrl}`);

  if (hasTruncation(request)) {
    lines.push(`- storage: req ${formatKB(request.requestBodyBytes)}/${formatKB(request.requestBodySize)} KB, resp ${formatKB(request.responseBodyBytes)}/${formatKB(request.responseBodySize)} KB`);
  }

  lines.push("");
  if (request.requestHeaders)
    lines.push(formatSection("Request headers", request.requestHeaders));
  if (request.requestBody)
    lines.push(formatBody("Request body", request.requestBody, request.requestBodyTruncated));
  if (request.responseHeaders)
    lines.push(formatSection("Response headers", request.responseHeaders));
  if (request.responseBodyError)
    lines.push(`Response body unavailable: ${request.responseBodyError}`);
  else if (request.responseBody)
    lines.push(formatBody("Response body", request.responseBody, request.responseBodyTruncated));

  if (request.timing)
    lines.push(formatTiming(request.timing));

  return lines.filter(Boolean).join("\n");
}

function renderStats(stats, pages) {
  const lines = [];
  lines.push(`Total requests: ${stats.total}`);
  lines.push(`Active monitors: ${stats.activeMonitors}`);
  lines.push("");
  lines.push("### By method");
  lines.push(renderCounterGroup(stats.byMethod));
  lines.push("");
  lines.push("### By status");
  lines.push(renderCounterGroup(stats.byStatus));
  lines.push("");
  lines.push("### By resource type");
  lines.push(renderCounterGroup(stats.byResourceType));
  lines.push("");
  lines.push("### Pages");
  if (!pages.length)
    lines.push("No active pages. Stats include closed pages until cleared.");
  for (const page of pages)
    lines.push(`- ${page.pageId}: ${page.title || page.url || "(untitled)"}`);
  lines.push("");
  lines.push("### Requests per page");
  lines.push(renderPerPage(stats.byPage));
  lines.push("");
  lines.push("### Storage usage");
  lines.push(renderUsageLines(stats.usage, getLimits()));
  return lines.join("\n");
}

function renderCounterGroup(counter) {
  const entries = Object.entries(counter || {});
  if (!entries.length)
    return "(empty)";
  return entries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

function renderPerPage(byPage) {
  const entries = Object.entries(byPage || {});
  if (!entries.length)
    return "(empty)";
  return entries.map(([pageId, info]) => `- ${pageId}: ${info.count} requests (${info.title || info.url || "(untitled)"})`).join("\n");
}

function formatSection(title, data) {
  const json = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return `${title}:\n\n\`\`\`\n${json}\n\`\`\``;
}

function formatBody(title, body, truncated) {
  const suffix = truncated ? " (truncated)" : "";
  return `${title}${suffix}:\n\n\`\`\`\n${body}\n\`\`\``;
}

function formatTiming(timing) {
  const lines = ["Timing (ms)"];
  for (const [key, value] of Object.entries(timing)) {
    if (value == null)
      continue;
    lines.push(`- ${key}: ${Math.round(value)}`);
  }
  return lines.join("\n");
}

function renderUsageReport(usage, limits) {
  const lines = [];
  lines.push(`Requests stored: ${usage.totalRequests}`);
  lines.push(`Estimated memory: ${formatMB(usage.estimatedMemoryBytes)} MB (${formatKB(usage.estimatedMemoryBytes)} KB)`);
  lines.push(`Request bodies: ${formatKB(usage.requestBytes)} KB saved / ${formatKB(usage.requestOriginalBytes)} KB original (truncated ${usage.requestTruncated})`);
  lines.push(`Response bodies: ${formatKB(usage.responseBytes)} KB saved / ${formatKB(usage.responseOriginalBytes)} KB original (truncated ${usage.responseTruncated})`);
  lines.push(`Current limits: request ${formatKB(limits.maxRequestBodyBytes)} KB, response ${formatKB(limits.maxResponseBodyBytes)} KB`);
  return lines.join("\n");
}

function renderUsageLines(usage, limits) {
  return [
    `- Estimated memory: ${formatMB(usage.estimatedMemoryBytes)} MB (${formatKB(usage.estimatedMemoryBytes)} KB)`,
    `- Request bodies: ${formatKB(usage.requestBytes)} KB saved / ${formatKB(usage.requestOriginalBytes)} KB original (truncated ${usage.requestTruncated})`,
    `- Response bodies: ${formatKB(usage.responseBytes)} KB saved / ${formatKB(usage.responseOriginalBytes)} KB original (truncated ${usage.responseTruncated})`,
    `- Limits: request ${formatKB(limits.maxRequestBodyBytes)} KB, response ${formatKB(limits.maxResponseBodyBytes)} KB`
  ].join("\n");
}

function formatKB(bytes) {
  if (!bytes)
    return "0";
  return Math.max(1, Math.round(bytes / KB)).toString();
}

function formatMB(bytes) {
  if (!bytes)
    return "0.0";
  return (bytes / (1024 * 1024)).toFixed(2);
}

function normalizeSince(value) {
  if (value === undefined || value === null || value === "")
    return undefined;
  if (typeof value === "number")
    return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed)
      return undefined;
    if (/^\d+$/.test(trimmed))
      return Number(trimmed);
    return trimmed;
  }
  throw new Error('Parameter "since" must be number (milliseconds since epoch) or ISO string, e.g. 1730796000000 or "2025-11-05T11:00:00Z".');
}

module.exports = [
  getRequestsTool,
  getRequestDetailsTool,
  clearRequestsTool,
  getStatsTool,
  getUsageTool
];


