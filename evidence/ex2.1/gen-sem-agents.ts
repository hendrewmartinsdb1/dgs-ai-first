import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

interface QueryRequest {
  question: string;
}

interface QueryResponse {
  answer: string;
}

export async function queryHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a request.");

  let body: QueryRequest;

  try {
    body = (await request.json()) as QueryRequest;
  } catch {
    return {
      status: 400,
      jsonBody: { error: "Invalid JSON body" },
    };
  }

  if (!body.question || typeof body.question !== "string") {
    return {
      status: 400,
      jsonBody: { error: "question field is required and must be a string" },
    };
  }

  try {
    // TODO: integrate with Azure OpenAI
    const answer = `You asked: ${body.question}`;

    const response: QueryResponse = {
      answer,
    };

    return {
      status: 200,
      jsonBody: response,
    };
  } catch (error) {
    context.log("Error processing query:", error);
    return {
      status: 500,
      jsonBody: { error: "Internal server error" },
    };
  }
}

app.http("query", {
  methods: ["POST"],
  authLevel: "function",
  route: "query",
  handler: queryHandler,
});
