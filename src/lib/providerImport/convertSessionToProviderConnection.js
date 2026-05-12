function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseJwtPayload(token) {
  if (typeof token !== "string" || !token.trim()) return undefined;
  const segments = token.split(".");
  if (segments.length < 2) return undefined;
  try {
    return JSON.parse(decodeBase64Url(segments[1]));
  } catch {
    return undefined;
  }
}

function normalizeTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1e11 ? value : value * 1000;
    const d = new Date(milliseconds);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function timestampFromUnixSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function getExpiresIn(expiresAt, now = new Date()) {
  if (!expiresAt) return undefined;
  const expMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expMs)) return undefined;
  return Math.max(0, Math.floor((expMs - now.getTime()) / 1000));
}

export function convertSessionToProviderConnection(record, forcedProvider, forcedAuthType) {
  if (!isPlainObject(record)) return null;

  const accessToken = firstNonEmpty(record.accessToken, record.access_token, record.token?.accessToken, record.token?.access_token, record.credentials?.accessToken, record.credentials?.access_token);
  if (!accessToken) return null;

  const payload = parseJwtPayload(accessToken);
  const auth = isPlainObject(payload?.["https://api.openai.com/auth"]) ? payload["https://api.openai.com/auth"] : {};
  const profile = isPlainObject(payload?.["https://api.openai.com/profile"]) ? payload["https://api.openai.com/profile"] : {};

  const refreshToken = firstNonEmpty(record.refreshToken, record.refresh_token, record.token?.refreshToken, record.token?.refresh_token, record.credentials?.refresh_token);
  const email = firstNonEmpty(record.user?.email, record.email, record.credentials?.email, record.providerSpecificData?.email, profile.email, payload?.email);
  const accountId = firstNonEmpty(record.account?.id, record.account_id, record.chatgptAccountId, record.providerSpecificData?.chatgptAccountId, record.providerSpecificData?.chatgpt_account_id, auth.chatgpt_account_id, record.provider === "codex" ? record.id : undefined);
  const planType = firstNonEmpty(record.account?.planType, record.account?.plan_type, record.planType, record.plan_type, record.providerSpecificData?.chatgptPlanType, record.providerSpecificData?.chatgpt_plan_type, auth.chatgpt_plan_type);
  const expiresAt = firstNonEmpty(timestampFromUnixSeconds(payload?.exp), normalizeTimestamp(record.expires), normalizeTimestamp(record.expiresAt), normalizeTimestamp(record.expires_at));
  const now = new Date();

  const parsedPriority = Number(record.priority);
  const hasPriority = Number.isFinite(parsedPriority);

  return {
    provider: forcedProvider || record.provider || "codex",
    authType: forcedAuthType || record.authType || "oauth",
    name: firstNonEmpty(email, "ChatGPT Account"),
    email,
    accessToken,
    refreshToken,
    expiresAt,
    expiresIn: getExpiresIn(expiresAt, now),
    testStatus: firstNonEmpty(record.testStatus, record.test_status, "active"),
    ...(hasPriority ? { priority: parsedPriority } : {}),
    isActive: typeof record.isActive === "boolean" ? record.isActive : !Boolean(record.disabled),
    createdAt: normalizeTimestamp(record.createdAt) || now.toISOString(),
    updatedAt: normalizeTimestamp(record.updatedAt) || now.toISOString(),
    providerSpecificData: {
      chatgptAccountId: accountId,
      chatgptPlanType: planType,
    },
  };
}
