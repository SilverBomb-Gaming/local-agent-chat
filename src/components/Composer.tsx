import { useEffect, useRef } from "react";

export function Composer({
  draft,
  pending,
  error,
  onDraft,
  onSend,
  onStop,
}: {
  draft: string;
  pending: boolean;
  error: string | null;
  onDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${Math.min(area.scrollHeight, 160)}px`;
  }, [draft]);

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) onStop();
        else onSend();
      }}
    >
      <label htmlFor="message">Message</label>
      <textarea
        id="message"
        ref={areaRef}
        rows={1}
        value={draft}
        placeholder="Ask about the workspace…"
        disabled={pending}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!pending) onSend();
          }
        }}
      />
      <div className="composer-row">
        <p className={error ? "hint is-error" : "hint"}>
          {error ?? "Enter to send. Shift+Enter for a new line. Nothing is stored on disk."}
        </p>
        <button type="submit" disabled={!pending && draft.trim() === ""}>
          {pending ? "Stop" : "Send"}
        </button>
      </div>
    </form>
  );
}
