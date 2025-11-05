# Network Monitor Additions

The modified Playwright MCP server integrates network logging directly into the browser backend. Key points to know:

## Body capture limits

- Request bodies are stored up to **32 KB** and response bodies up to **64 KB** by default.
- Limits are defined in kilobytes and can be adjusted before launch through the MCP configuration:
  ```json
  {
    "networkMonitor": {
      "maxRequestBodyKB": 128,
      "maxResponseBodyKB": 256
    }
  }
  ```
- Alternatively, environment variables apply the same limits:
  - `PLAYWRIGHT_MCP_NETWORK_MAX_REQUEST_KB`
  - `PLAYWRIGHT_MCP_NETWORK_MAX_RESPONSE_KB`
- Setting very large values is allowed; use the usage tool to keep an eye on memory footprint.

## Runtime tuning (planned)

Dynamic limit updates at runtime are **not yet implemented**. Future work could introduce a tool that changes limits on the fly without restarting the server. When that becomes necessary, the TODO marker here serves as a reminder.

## New tools

- `browser_network_get_usage` — shows how many requests are stored and the estimated memory usage.
- `browser_network_get_requests` — now displays a `[cut …]` suffix when request or response bodies are truncated (saved/original sizes in KB).

Use these capabilities to decide whether to increase limits or clear history before capturing large payloads.
