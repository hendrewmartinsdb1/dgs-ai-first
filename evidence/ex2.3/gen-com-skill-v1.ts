import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { z } from "zod";
import { logger } from "../../src/shared/logger";

// Zod schema — FIRST, before any logic (per skill rule MUST validate with Zod)
const IngestSchema = z.object({
  documentUrl: z.string().url(),
  documentType: z.enum(["pdf", "docx"]),
});

type IngestRequest = z.infer<typeof IngestSchema>;

// Required response shape — per skill (source_document is REQUIRED)
interface IngestResponse {
  success: boolean;
  jobId: string;
  source_document: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff retry — per skill / ADR-0001
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(Math.pow(2, attempt) * 100);
    }
  }
  throw new Error("unreachable");
}

async function triggerIndexing(data: IngestRequest): Promise<string> {
  // Azure AI Search indexing call — wrapped in retry (per ADR-0001)
  return callWithRetry(async () => {
    // TODO: azure AI Search indexer API call
    return `ingest-job-${data.documentType}-${Date.now()}`;
  });
}

export async function ingestHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // Step 1: Zod validation BEFORE any business logic (per skill: MUST validate first)
  const parsed = IngestSchema.safeParse(await request.json());
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, "ingest request validation failed");
    return {
      status: 400,
      jsonBody: { error: parsed.error.flatten() },
    };
  }

  const { documentUrl, documentType } = parsed.data;

  try {
    // Step 2: Business logic with Azure retry wrapper
    const jobId = await triggerIndexing(parsed.data);

    // pino logging — no console.log (per skill: MUST use pino)
    logger.info({ jobId, documentUrl, documentType }, "document ingestion triggered");

    // Step 3: Response MUST include source_document (per skill / ADR-0003)
    const response: IngestResponse = {
      success: true,
      jobId,
      source_document: documentUrl,
    };

    return { status: 200, jsonBody: response };
  } catch (error) {
    // Step 4: log error with pino, return generic 500 (no stack trace in response)
    logger.error({ error, documentUrl, documentType }, "ingest handler failed");
    return {
      status: 500,
      jsonBody: { error: "Internal server error" },
    };
  }
}

// v4 registration pattern — MUST use app.http() (per skill)
app.http("ingest", {
  methods: ["POST"],
  authLevel: "function",
  route: "ingest",
  handler: ingestHandler,
});
