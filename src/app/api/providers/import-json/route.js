import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { convertSessionToProviderConnection } from "@/lib/providerImport/convertSessionToProviderConnection";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const payload = body?.connection;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ error: "connection must be a JSON object" }, { status: 400 });
    }

    if (!payload.provider || typeof payload.provider !== "string") {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    const provider = payload.provider.trim();
    const authType = payload.authType || "oauth";
    const converted = convertSessionToProviderConnection(payload, provider, authType);

    const connection = await createProviderConnection(
      converted || {
        ...payload,
        provider,
        authType,
      }
    );

    const result = { ...connection };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to import provider JSON" }, { status: 500 });
  }
}
