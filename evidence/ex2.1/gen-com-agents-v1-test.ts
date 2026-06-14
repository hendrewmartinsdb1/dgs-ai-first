import { describe, it, expect, vi, beforeEach } from "vitest";
import { feedbackHandler } from "./gen-com-agents-v1";
import { HttpRequest, InvocationContext } from "@azure/functions";

vi.mock("../../src/shared/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

function makeRequest(body: unknown): HttpRequest {
  return { json: async () => body, method: "POST" } as unknown as HttpRequest;
}

function makeContext(): InvocationContext {
  return { log: vi.fn() } as unknown as InvocationContext;
}

describe("feedbackHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when queryId is missing", async () => {
    const res = await feedbackHandler(
      makeRequest({ rating: 1 }),
      makeContext()
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is out of range", async () => {
    const res = await feedbackHandler(
      makeRequest({ queryId: "q1", rating: 5 }),
      makeContext()
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with feedbackId and source_document on valid input", async () => {
    const res = await feedbackHandler(
      makeRequest({ queryId: "q1", rating: 2, comment: "good" }),
      makeContext()
    );
    expect(res.status).toBe(200);
    const body = res.jsonBody as { success: boolean; feedbackId: string; source_document: string };
    expect(body.success).toBe(true);
    expect(body.feedbackId).toBeDefined();
    expect(body.source_document).toBeDefined();
  });

  it("returns 200 without optional comment field", async () => {
    const res = await feedbackHandler(
      makeRequest({ queryId: "q2", rating: 3 }),
      makeContext()
    );
    expect(res.status).toBe(200);
  });
});
