import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { z } from "zod";
import { logger } from "../../src/shared/logger";

const FeedbackSchema = z.object({
  queryId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  comment: z.string().optional(),
});

type FeedbackRequest = z.infer<typeof FeedbackSchema>;

interface FeedbackResponse {
  success: boolean;
  feedbackId: string;
  source_document: string;
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

async function saveFeedback(data: FeedbackRequest): Promise<string> {
  return callWithRetry(async () => {
    // TODO: persist to Cosmos DB via Azure SDK
    return `fb-${Date.now()}`;
  });
}

export async function feedbackHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const parsed = FeedbackSchema.safeParse(await request.json());
  if (!parsed.success) {
    return {
      status: 400,
      jsonBody: { error: parsed.error.flatten() },
    };
  }

  try {
    const feedbackId = await saveFeedback(parsed.data);
    logger.info({ feedbackId, queryId: parsed.data.queryId }, "feedback saved");

    const response: FeedbackResponse = {
      success: true,
      feedbackId,
      source_document: "internal-feedback-api",
    };

    return {
      status: 200,
      jsonBody: response,
    };
  } catch (error) {
    logger.error({ error, queryId: parsed.data.queryId }, "feedback handler failed");
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
