import { describe, it, expect, vi } from "vitest";
import { queryHandler } from "./gen-sem-agents";
import { HttpRequest, InvocationContext } from "@azure/functions";

function makeRequest(body: unknown): HttpRequest {
  return {
    json: async () => body,
    method: "POST",
  } as unknown as HttpRequest;
}

function makeContext(): InvocationContext {
  return {
    log: vi.fn(),
  } as unknown as InvocationContext;
}

describe("queryHandler", () => {
  it("returns 400 when question is missing", async () => {
    const req = makeRequest({});
    const ctx = makeContext();
    const res = await queryHandler(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 200 with answer when question is provided", async () => {
    const req = makeRequest({ question: "What is the SLA?" });
    const ctx = makeContext();
    const res = await queryHandler(req, ctx);
    expect(res.status).toBe(200);
    expect((res.jsonBody as { answer: string }).answer).toContain("What is the SLA?");
  });

  it("returns 400 when body is not valid JSON", async () => {
    const req = {
      json: async () => { throw new Error("invalid json"); },
      method: "POST",
    } as unknown as HttpRequest;
    const ctx = makeContext();
    const res = await queryHandler(req, ctx);
    expect(res.status).toBe(400);
  });
});
