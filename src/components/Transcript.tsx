import type { Turn } from "./types";

export function Transcript({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) {
    return (
      <div className="transcript">
        <div className="empty">
          <p className="empty-kicker">Transcript</p>
          <p className="empty-title">Ask it to look at the workspace.</p>
          <p className="empty-copy">
            Tool calls show up here as cards, with the arguments and a short result, before the
            model answers.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="transcript" role="log" aria-label="Conversation">
      {turns.map((turn) =>
        turn.role === "user" ? (
          <article key={turn.id} className="turn">
            <p className="who">You</p>
            <p className="text">{turn.content}</p>
          </article>
        ) : (
          <article key={turn.id} className="turn">
            <p className="who">Assistant</p>
            {turn.blocks.map((block, index) =>
              block.type === "text" ? (
                <p key={`${turn.id}-text-${index}`} className="text">
                  {block.text}
                </p>
              ) : (
                <section
                  key={`${turn.id}-tool-${index}`}
                  className="tool"
                  data-ok={block.ok ? "true" : "false"}
                >
                  <header>
                    <span className="tool-name">{block.name}</span>
                    <span className={block.ok ? "tool-ok" : "tool-bad"}>{block.ok ? "ok" : "denied"}</span>
                  </header>
                  <p className="tool-args">{formatArgs(block.arguments)}</p>
                  <pre>{block.snippet}</pre>
                </section>
              ),
            )}
            {turn.pending && turn.blocks.at(-1)?.type !== "text" ? <p className="pending">Working</p> : null}
            {turn.error ? <p className="error">{turn.error}</p> : null}
            {turn.stopped ? <p className="stopped">Stopped.</p> : null}
          </article>
        ),
      )}
    </div>
  );
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "no arguments";
  return entries
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("   ");
}
