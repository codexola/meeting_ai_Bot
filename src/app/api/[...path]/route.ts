import { NextRequest, NextResponse } from "next/server";
import { backendApiUrl } from "@/lib/backendUrl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: { path: string[] } };

async function proxy(request: NextRequest, pathSegments: string[]) {
  const backend = backendApiUrl();
  const search = request.nextUrl.search;
  const target = `${backend}/api/${pathSegments.join("/")}${search}`;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  const accept = request.headers.get("accept");
  if (accept) {
    headers.set("accept", accept);
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  try {
    const res = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });

    const outHeaders = new Headers();
    const resType = res.headers.get("content-type");
    if (resType) {
      outHeaders.set("content-type", resType);
    }
    outHeaders.set("cache-control", "no-store");

    return new NextResponse(res.body, {
      status: res.status,
      headers: outHeaders,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json(
      {
        error: "backend_unreachable",
        message:
          "Cannot reach the meeting server. Ensure the VPS API runs on port 8000 (0.0.0.0) and is reachable from the internet.",
        backend: backend,
        detail,
      },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params.path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params.path);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params.path);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params.path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params.path);
}
