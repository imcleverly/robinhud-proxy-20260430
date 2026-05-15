# Custom Provider Headers & API Call Logging

## Discovery

**Original Request:**
1. Add settings to custom providers allowing optional key-value custom headers on each request
2. Add logging for every API call: which provider is being called, with what headers

**Research Findings:**
- Custom provider nodes store data in a JSON `data` column — adding `customHeaders` auto-persists
- `providerSpecificData` flows from connection to executor at runtime
- `BaseExecutor.buildHeaders()` and `DefaultExecutor.buildHeaders()` are where headers are built
- `BaseExecutor.execute()` is where the actual fetch happens — ideal place for logging
- Provider node update route already syncs fields to connection's `providerSpecificData`

## Non-Goals
- Not adding headers to built-in providers (openai, claude, gemini, etc.)
- Not building a UI for per-request header overrides — this is a per-provider-node config
- Not adding custom headers to embedding providers (can be a follow-up)

## Ghost Diffs
- Considered adding headers at the `chatCore.js` level — rejected because executor is the right abstraction layer; keeps it provider-agnostic
- Considered a separate DB table for custom headers — rejected because the existing JSON `data` column handles it naturally
- Considered blocking override of auth headers — rejected because users may legitimately need to override Authorization for custom providers with non-standard auth (the whole point of "custom" providers). The custom headers are set by the admin/owner, not end-users.

## Validation & Security Rules

### customHeaders validation (API layer):
- Shape: plain object only `{ "key": "value" }` — no arrays, no nested objects
- Key: non-empty string, trimmed, no CR/LF characters (header injection prevention)
- Value: string only (coerce to string if not), trimmed, no CR/LF characters
- Max: 20 headers, key max 100 chars, value max 2000 chars
- Invalid entries silently stripped during validation
- Empty object `{}` treated same as no custom headers

### Merge order in executor:
1. Default headers (`Content-Type`, config headers)
2. Auth headers (provider-specific)
3. Stream Accept header
4. Custom headers (LAST — intentionally allows override, since admin controls this)

### Logging policy:
- Log level: `log?.info?.()` — matches existing proxy/request logging pattern
- Log header KEYS only, never values
- URL logged without query string (strip after `?`) to prevent token leakage
- Format: `log?.info?.("API_CALL", \`${provider} → ${sanitizedUrl} | headers: [${headerKeys}]\`)`

---

## Tasks

### 1. Add customHeaders to Provider Node API + sync to connections
**Depends on**: none
**Files**:
- Modify: `src/app/api/provider-nodes/route.js` (POST handler, ~line 53-96)
- Modify: `src/app/api/provider-nodes/[id]/route.js` (PUT handler, ~line 5-80)
**What**: 
- Accept optional `customHeaders` (object, key-value pairs) from request body
- Validate per rules above: plain object, string keys/values, no CR/LF, size limits
- Create helper `sanitizeCustomHeaders(headers)` that validates and returns clean object or `{}`
- Pass `customHeaders` to `createProviderNode()` / `updateProviderNode()`
- In PUT: sync `customHeaders` to connection's `providerSpecificData` (same pattern as baseUrl/prefix)
**Must NOT**: Break existing create/update flows; customHeaders is optional; empty/missing = no custom headers
**Verify**: `node --check src/app/api/provider-nodes/route.js && node --check "src/app/api/provider-nodes/[id]/route.js"` — exit 0

### 2. Add customHeaders UI to Add/Edit modals
**Depends on**: 1 (API must accept customHeaders for end-to-end, but UI code is independent)
**Files**:
- Modify: `src/app/(dashboard)/dashboard/providers/page.js` — `AddOpenAICompatibleModal` (~line 922-1109) and `AddAnthropicCompatibleModal` (~line 1117-1291)
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/EditCompatibleNodeModal.js`
**What**:
- Add a "Custom Headers (optional)" section below Base URL in each modal
- Dynamic key-value rows: each row has key Input, value Input, and remove (X) button
- "Add Header" button to add new empty row
- Store internally as array `[{key, value}, ...]`, convert to object `{key: value}` on submit
- On edit modal open: convert node's `customHeaders` object back to array for display
- Include `customHeaders` in form submission payload
- Default: no rows shown, just the "Add Header" button
**Must NOT**: Make headers required; must be fully optional; don't show section if no headers and user hasn't clicked "Add Header"
**Verify**: `node --check "src/app/(dashboard)/dashboard/providers/page.js" && node --check "src/app/(dashboard)/dashboard/providers/[id]/EditCompatibleNodeModal.js"` — exit 0

### 3. Inject customHeaders into executor buildHeaders and add API call logging
**Depends on**: none
**Files**:
- Modify: `open-sse/executors/base.js` — `buildHeaders()` (~line 42-72) and `execute()` (~line 98-157)
- Modify: `open-sse/executors/default.js` — `buildHeaders()` (~line 53-161)
**What**:
- **Both buildHeaders()**: accept `credentials` parameter (already available). After all other headers are set, merge `credentials?.providerSpecificData?.customHeaders` if it's a non-empty object. Custom headers go LAST so they can override.
- **BaseExecutor.buildHeaders()**: currently signature is `buildHeaders(credentials, stream)` — credentials already passed, just add merge at end
- **DefaultExecutor.buildHeaders()**: same — add merge at end before return
- **BaseExecutor.execute()**: after line 120 (headers built), add logging:
  ```js
  const sanitizedUrl = url.split("?")[0];
  log?.info?.("API_CALL", `${this.provider} → ${sanitizedUrl} | headers: [${Object.keys(headers).join(", ")}]`);
  ```
**Must NOT**: Log header VALUES; log URL query strings
**References**: 
- `open-sse/executors/base.js:42-72` — current buildHeaders
- `open-sse/executors/base.js:98-157` — current execute
- `open-sse/executors/default.js:53-161` — DefaultExecutor buildHeaders
**Verify**: `node --check open-sse/executors/base.js && node --check open-sse/executors/default.js` — exit 0
