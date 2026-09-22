"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pushSse } from "@/lib/sse";
import type { HealthReport, ServerEvent } from "@/lib/types";
import { Composer } from "./Composer";
import { Transcript } from "./Transcript";
import { PROMPTS, type AssistantTurn, type Block, type Turn } from "./types";

type HealthState =
  | { phase: "loading" }
  | { phase: "ready"; report: HealthReport }
  | { phase: "error"; message: string };

export function ChatApp() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>({ phase: "loading" });
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const report = (await response.json()) as HealthReport & { error?: string };
      if (!response.ok && !report.ollama && report.model === undefined) {
        setHealth({ phase: "error", message: report.error ?? "Health check failed." });
        return;
      }
      setHealth({ phase: "ready", report });
    } catch {
      setHealth({ phase: "error", message: "Couldn't reach the app's health check." });
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshHealth(), 15_000);
    const onFocus = () => void refreshHealth();
    window.addEventListener("focus", onFocus);
    const kickoff = window.setTimeout(() => void refreshHealth(), 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(kickoff);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshHealth]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [turns]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || pendingRef.current) return;
      if (text.length > 8000) {
        setComposerError("Keep a message under 8000 characters.");
        return;
      }
      setComposerError(null);

      const history = [...turns, { id: crypto.randomUUID(), role: "user" as const, content: text }];
      const assistantId = crypto.randomUUID();
      setTurns([...history, { id: assistantId, role: "assistant", blocks: [], pending: true }]);
      setDraft("");
      pendingRef.current = true;
      setPending(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.flatMap((turn) => {
              if (turn.role === "user") return [{ role: "user", content: turn.content }];
              const content = assistantText(turn);
              return content ? [{ role: "assistant", content }] : [];
            }),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Request failed (${response.status}).`);
        }
        if (!response.body) throw new Error("The server returned an empty response.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer = pushSse(buffer, decoder.decode(value, { stream: true }), (data) => {
            const event = JSON.parse(data) as ServerEvent;
            applyEvent(assistantId, event);
          });
        }
        setTurns((current) => finishTurn(current, assistantId, {}));
      } catch (error) {
        if (controller.signal.aborted) {
          setTurns((current) => finishTurn(current, assistantId, { stopped: true }));
          return;
        }
        const message = error instanceof Error ? error.message : "Something went wrong.";
        setTurns((current) => finishTurn(current, assistantId, { error: message }));
      } finally {
        pendingRef.current = false;
        setPending(false);
        abortRef.current = null;
      }
    },
    [turns],
  );

  function applyEvent(id: string, event: ServerEvent) {
    if (event.type === "done") return;
    setTurns((current) =>
      current.map((turn) => {
        if (turn.id !== id || turn.role !== "assistant") return turn;
        if (event.type === "delta") return { ...turn, blocks: appendText(turn.blocks, event.text) };
        if (event.type === "tool") {
          return {
            ...turn,
            blocks: [
              ...turn.blocks,
              {
                type: "tool",
                name: event.name,
                arguments: event.arguments,
                ok: event.ok,
                snippet: event.snippet,
              },
            ],
          };
        }
        return { ...turn, error: event.message };
      }),
    );
  }

  const report = health.phase === "ready" ? health.report : null;
  const pill = describeHealth(health);

  return (
    <div className="app">
      <aside className="sidebar">
        <div>
          <p className="kicker">Local first</p>
          <h1>local-agent-chat</h1>
          <p className="lede">
            A chat with Ollama on this machine. It can list and read one folder, and you can see
            every tool call.
          </p>
        </div>

        <div className="status-block">
          <p className="pill" role="status" title={pill.detail}>
            <span className={`dot ${pill.tone}`} />
            {pill.label}
          </p>
          <dl>
            <div>
              <dt>Model</dt>
              <dd>{report?.model ?? "llama3.2"}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>
                <code>{report?.workspaceRoot ?? "demo-files"}</code>
                {report && !report.workspaceOk ? <span className="warn"> Missing</span> : null}
              </dd>
            </div>
            <div>
              <dt>Shell</dt>
              <dd>{report?.shellEnabled ? "on · date, echo" : "off"}</dd>
            </div>
          </dl>
          {pill.detail ? <p className="status-detail">{pill.detail}</p> : null}
        </div>

        <div className="prompts">
          <p className="prompts-label">Try</p>
          {PROMPTS.map((prompt) => (
            <button key={prompt.label} type="button" disabled={pending} onClick={() => void send(prompt.text)}>
              {prompt.label}
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="scroller" ref={scrollerRef}>
          <Transcript turns={turns} />
        </div>
        <Composer
          draft={draft}
          pending={pending}
          error={composerError}
          onDraft={setDraft}
          onSend={() => void send(draft)}
          onStop={() => abortRef.current?.abort()}
        />
      </main>
    </div>
  );
}

function appendText(blocks: Block[], text: string): Block[] {
  const last = blocks.at(-1);
  if (last?.type === "text") {
    return [...blocks.slice(0, -1), { type: "text", text: last.text + text }];
  }
  return [...blocks, { type: "text", text }];
}

function finishTurn(
  turns: Turn[],
  id: string,
  patch: { error?: string; stopped?: boolean },
): Turn[] {
  return turns.map((turn) => {
    if (turn.id !== id || turn.role !== "assistant") return turn;
    const next: AssistantTurn = { ...turn, pending: false };
    if (patch.error) next.error = patch.error;
    if (patch.stopped) next.stopped = true;
    return next;
  });
}

function assistantText(turn: AssistantTurn): string {
  return turn.blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function describeHealth(health: HealthState): { label: string; tone: string; detail?: string } {
  if (health.phase === "loading") return { label: "Checking Ollama", tone: "checking" };
  if (health.phase === "error") return { label: "Status unknown", tone: "offline", detail: health.message };
  if (!health.report.ollama) {
    return { label: "Ollama offline", tone: "offline", detail: health.report.error };
  }
  if (!health.report.modelPresent) {
    return { label: "Model not pulled", tone: "missing", detail: health.report.error };
  }
  if (!health.report.workspaceOk) {
    return { label: "Ollama online", tone: "missing", detail: health.report.error };
  }
  return { label: "Ollama online", tone: "online" };
}
