import { runAgent } from "@/lib/agent";
import { getConfig } from "@/lib/config";
import { ChatInputError, parseClientMessages } from "@/lib/messages";
import { encodeSse } from "@/lib/sse";
import type { ServerEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let messages;
  let config;
  try {
    config = getConfig();
    const body = (await request.json()) as { messages?: unknown };
    messages = parseClientMessages(body.messages);
  } catch (error) {
    const badInput = error instanceof ChatInputError || error instanceof SyntaxError;
    const message =
      error instanceof ChatInputError
        ? error.message
        : error instanceof SyntaxError
          ? "Request body must be JSON."
          : error instanceof Error
            ? error.message
            : "Bad request.";
    return Response.json({ error: message }, { status: badInput ? 400 : 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (event: ServerEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          closed = true;
        }
      };
      try {
        await runAgent({ messages, emit, signal: request.signal, config });
      } catch (error) {
        console.error(error);
        emit({ type: "error", message: "The chat request failed." });
        emit({ type: "done" });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
