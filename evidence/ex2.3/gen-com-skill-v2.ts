import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { z } from "zod";
import { logger } from "../../src/shared/logger";

// Zod schema — validates BEFORE any logic (per skill v2: MUST validate first)
const IngestSchema = z.object({
  documentUrl: z.string().url(),
  documentType: z.enum(["pdf", "docx"]),
});

type IngestRequest = z.infer<typeof IngestSchema>;

// Required response shape — source_document REQUIRED (per skill v2 / ADR-0003)
// source_document = doc_id in Azure AI Search index (e.g. "PROC-042-v2")
// For ingest endpoint: documentUrl serves as identifier until indexing assigns doc_id
interface IngestResponse {
  success: boolean;
  jobId: string;
  source_document: string; // doc_id from Azure AI Search, or documentUrl for ingest
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff retry — per skill v2 / ADR-0001
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

async function submitIndexingJob(data: IngestRequest): Promise<string> {
  // Azure AI Search indexer call — wrapped in retry (per skill v2 / ADR-0001)
  return callWithRetry(async () => {
    // TODO: azureSearchIndexerClient.run(indexerName, { documentUrl: data.documentUrl })
    return `ingest-${data.documentType}-${Date.now()}`;
  });
}

export async function ingestHandler(
  request: HttpRequest,
  _context: InvocationContext  // prefixed with _ — context.log MUST NOT be used (per skill v2)
): Promise<HttpResponseInit> {
  // Step 1: Zod validation BEFORE any business logic
  // logger.warn = client validation failure (not a system error)
  const parsed = IngestSchema.safeParse(await request.json());
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, "ingest validation failed");
    return {
      status: 400,
      jsonBody: { error: parsed.error.flatten() },
    };
  }

  const { documentUrl, documentType } = parsed.data;

  try {
    // Step 2: Azure call wrapped in callWithRetry (per skill v2 / ADR-0001)
    const jobId = await submitIndexingJob(parsed.data);

    // logger.info for successful operations — no console.* or context.log (per skill v2)
    logger.info({ jobId, documentUrl, documentType }, "document indexing job submitted");

    // Step 3: Response MUST include source_document (per skill v2 / ADR-0003)
    // For ingest: documentUrl is the source identifier until AI Search assigns doc_id
    const response: IngestResponse = {
      success: true,
      jobId,
      source_document: documentUrl,
    };

    return { status: 200, jsonBody: response };
  } catch (error) {
    // Step 4: logger.error for system failures — pino, no stack trace in response body
    logger.error({ error, documentUrl, documentType }, "ingest handler failed");
    return {
      status: 500,
      jsonBody: { error: "Internal server error" },
    };
  }
}

// v4 registration pattern — MUST use app.http() (per skill v2)
app.http("ingest", {
  methods: ["POST"],
  authLevel: "function",
  route: "ingest",
  handler: ingestHandler,
});
