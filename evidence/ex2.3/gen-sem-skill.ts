import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

interface IngestRequest {
  documentUrl: string;
  documentType: "pdf" | "docx";
}

export async function ingestHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Ingest function triggered");

  let body: IngestRequest;
  try {
    body = (await request.json()) as IngestRequest;
  } catch {
    return {
      status: 400,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  if (!body.documentUrl || typeof body.documentUrl !== "string") {
    return {
      status: 400,
      body: JSON.stringify({ error: "documentUrl is required" }),
    };
  }

  if (body.documentType !== "pdf" && body.documentType !== "docx") {
    return {
      status: 400,
      body: JSON.stringify({ error: "documentType must be pdf or docx" }),
    };
  }

  try {
    // TODO: download document from URL
    // TODO: extract text from document
    // TODO: chunk and index in Azure AI Search
    console.log(`Ingesting document: ${body.documentUrl}`);

    return {
      status: 200,
      body: JSON.stringify({
        success: true,
        message: "Document ingested successfully",
        documentUrl: body.documentUrl,
        documentType: body.documentType,
      }),
    };
  } catch (error) {
    context.log("Error:", error);
    return {
      status: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

app.http("ingest", {
  methods: ["POST"],
  authLevel: "function",
  route: "ingest",
  handler: ingestHandler,
});
