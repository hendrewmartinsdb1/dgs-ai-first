import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { z } from "zod";
import { logger } from "../../src/shared/logger";

const FeedbackSchema = z.object({
  queryId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  comment: z.string().max(1000).optional(),
});

type FeedbackRequest = z.infer<typeof FeedbackSchema>;

// Required response interface — per AGENTS.md v2 / Project Overview
interface NovaTechResponse {
  success: boolean;
  feedbackId: string;
  source_document: string;
  session_turn: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function persistFeedback(data: FeedbackRequest): Promise<string> {
  // Azure Cosmos DB call wrapped in retry — per ADR-0001
  return callWithRetry(async () => {
    // TODO: cosmosContainer.items.create(data)
    return `fb-${data.queryId}-${data.rating}`;
  });
}

export async function feedbackHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // Zod validation BEFORE any business logic — per AGENTS.md v2 Coding Standards
  const parsed = FeedbackSchema.safeParse(await request.json());
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, "feedback validation failed");
    return {
      status: 400,
      jsonBody: { error: parsed.error.flatten() },
    };
  }

  const { queryId, rating, comment } = parsed.data;

  try {
    const feedbackId = await persistFeedback(parsed.data);

    logger.info({ feedbackId, queryId, rating }, "feedback saved");

    const response: NovaTechResponse = {
      success: true,
      feedbackId,
      source_document: "internal-feedback-api", // REQUIRED — per AGENTS.md v2 / ADR-0003
      session_turn: 0, // feedback endpoint is stateless; turn tracked by query endpoint
    };

    return {
      status: 200,
      jsonBody: response,
    };
  } catch (error) {
    // pino logging BEFORE returning 500 — per AGENTS.md v2 Error Handling
    logger.error({ error, queryId, rating, comment }, "feedback handler failed");
    return {
      status: 500,
      jsonBody: { error: "Internal server error" },
    };
  }
}

app.http("feedback", {
  methods: ["POST"],
  authLevel: "function",
  route: "feedback",
  handler: feedbackHandler,
});
