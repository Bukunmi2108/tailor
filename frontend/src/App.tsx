import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClockCounterClockwise,
  DownloadSimple,
  FileArrowDown,
  FileText,
  FloppyDisk,
  LockKey,
  PaperPlaneTilt,
  SignOut,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react";
import { api, download, token } from "./api";
import { applyServerEvent, connectChat } from "./chat";
import { ChatThread, type ChatActions } from "./chat-view";
import { db, withSessionLock } from "./db";
import type {
  Analysis,
  BaseVersion,
  Backup,
  ChatMessage,
  CoverLetter,
  Decision,
  MessagePart,
  Plan,
  Revision,
  Session,
} from "./types";

type Preview = "resume" | "cover";
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

function Login({ onDone }: { onDone: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.login(passphrase);
      token.set(result.access_token);
      setPassphrase("");
      onDone();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="wordmark">
          tailor<span>.</span>
        </div>
        <div>
          <p className="kicker">Personal workspace</p>
          <h1>Resume work that stays grounded.</h1>
          <p className="lede">
            Enter your passphrase to open the private tailoring interface. Your session
            remains in this browser.
          </p>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="passphrase">Passphrase</label>
          <input
            id="passphrase"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy || !passphrase}>
            <LockKey weight="bold" />
            {busy ? "Checking…" : "Open Tailor"}
          </button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(token.get()));
  const [base, setBase] = useState<BaseVersion>();
  const [session, setSession] = useState<Session>();
  const [revision, setRevision] = useState<Revision>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [preview, setPreview] = useState<Preview>("resume");
  const [previewHtml, setPreviewHtml] = useState("");
  const [draft, setDraft] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const importRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const boot = useCallback(async () => {
    if (!token.get()) return;
    setError("");
    try {
      const repository = await api.base();
      await db.putBase({ ...repository, createdAt: now() });
      setBase(repository);
      const active = await db.getActiveSession();
      if (active) {
        const activeRevision = await db.getRevision(active.activeRevisionId);
        setSession(active);
        setRevision(activeRevision);
        setMessages(active.messages);
      }
    } catch (value) {
      if (!token.get()) setAuthenticated(false);
      setError(value instanceof Error ? value.message : "Could not start Tailor");
    }
  }, []);
  useEffect(() => {
    if (authenticated) void boot();
  }, [authenticated, boot]);
  useEffect(() => {
    if (!revision) return;
    let cancelled = false;
    (preview === "cover" && session?.coverLetter
      ? api.previewCover(session.coverLetter)
      : api.previewResume(revision.resume)
    )
      .then((html) => {
        if (!cancelled) setPreviewHtml(html);
      })
      .catch((value) => setError(value.message));
    return () => {
      cancelled = true;
    };
  }, [revision, preview, session?.coverLetter]);
  useEffect(() => () => socketRef.current?.close(), []);
  const estimatedPages = useMemo(
    () => Math.max(1, Math.ceil((previewHtml.match(/<section/g) || []).length / 3)),
    [previewHtml],
  );

  function persistSessionPatch(patch: Partial<Session>, nextMessages?: ChatMessage[]) {
    if (!sessionRef.current) return;
    const next: Session = {
      ...sessionRef.current,
      ...patch,
      messages: nextMessages ?? sessionRef.current.messages,
      updatedAt: now(),
    };
    setSession(next);
    setSaveState("saving");
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      try {
        await db.putSession(next);
        setSaveState("saved");
      } catch {
        setSaveState("failed");
      }
    }, 400);
  }

  function updateMessagePart(
    messageId: string,
    partId: string,
    updater: (part: MessagePart) => MessagePart,
  ): ChatMessage[] {
    const next = messagesRef.current.map((message) =>
      message.id === messageId
        ? {
            ...message,
            parts: (message.parts ?? []).map((part) => (part.id === partId ? updater(part) : part)),
          }
        : message,
    );
    setMessages(next);
    return next;
  }

  const applyPlanDecisions = useCallback(async (plan: Plan, decisions: Decision[]) => {
    const currentSession = sessionRef.current;
    const currentRevision = revisionRef.current;
    if (!currentSession || !currentRevision) return;
    setError("");
    try {
      await withSessionLock(currentSession.sessionId, async () => {
        const history = await db.sessionRevisions(currentSession.sessionId);
        const planBase = history.find((item) => item.contentHash === plan.base_snapshot_hash);
        if (!planBase) throw new Error("The revision targeted by this plan is missing");
        const result = await api.derive(planBase.resume, plan, decisions, plan.base_snapshot_hash);
        const revisionId = id("revision");
        const created = now();
        const nextRevision: Revision = {
          revisionId,
          sessionId: currentSession.sessionId,
          parentRevisionId: currentRevision.revisionId,
          resume: result.resume,
          contentHash: result.content_hash,
          createdAt: created,
          note: "Updated edit decisions",
        };
        const nextSession = { ...currentSession, activeRevisionId: revisionId, updatedAt: created };
        await db.saveRevision(nextSession, nextRevision, currentRevision.revisionId);
        setRevision(nextRevision);
        setSession(nextSession);
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not apply edits");
    }
  }, []);

  const actions: ChatActions = {
    onEditDecision: (messageId, partId, decision) => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      const part = message?.parts?.find((p) => p.id === partId);
      if (!part || part.type !== "edits_proposed") return;
      const nextDecisions = [...part.decisions.filter((d) => d.edit_id !== decision.edit_id), decision];
      const next = updateMessagePart(messageId, partId, (p) =>
        p.type === "edits_proposed" ? { ...p, decisions: nextDecisions } : p,
      );
      persistSessionPatch({}, next);
      void applyPlanDecisions(part.plan, nextDecisions);
    },
    onApproveSafeEdits: (messageId, partId) => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      const part = message?.parts?.find((p) => p.id === partId);
      if (!part || part.type !== "edits_proposed") return;
      const safe = part.plan.edits
        .filter((edit) => edit.risk === "safe")
        .map((edit) => ({ edit_id: edit.edit_id, decision: "approved" as const }));
      const untouched = part.decisions.filter((d) => !safe.some((s) => s.edit_id === d.edit_id));
      const nextDecisions = [...untouched, ...safe];
      const next = updateMessagePart(messageId, partId, (p) =>
        p.type === "edits_proposed" ? { ...p, decisions: nextDecisions } : p,
      );
      persistSessionPatch({}, next);
      void applyPlanDecisions(part.plan, nextDecisions);
    },
    onAnalysisChange: (messageId, partId, analysis: Analysis) => {
      const next = updateMessagePart(messageId, partId, (p) =>
        p.type === "analysis" ? { ...p, analysis } : p,
      );
      persistSessionPatch(
        {
          currentAnalysis: analysis,
          company: analysis.company || sessionRef.current?.company,
          roleTitle: analysis.role_title || sessionRef.current?.roleTitle,
        },
        next,
      );
    },
    onCoverLetterChange: (messageId, partId, coverLetter: CoverLetter) => {
      const next = updateMessagePart(messageId, partId, (p) =>
        p.type === "cover_letter" ? { ...p, coverLetter } : p,
      );
      persistSessionPatch({ coverLetter }, next);
    },
  };

  async function sendMessage() {
    const text = draft.trim();
    if (!text || connecting) return;
    setError("");
    let currentSession = sessionRef.current;
    let currentRevision = revisionRef.current;
    if (!currentSession) {
      if (!base) return;
      const sessionId = id("session");
      const revisionId = id("revision");
      const created = now();
      currentRevision = {
        revisionId,
        sessionId,
        resume: structuredClone(base.resume_snapshot),
        contentHash: base.content_hash,
        createdAt: created,
        note: "Frozen base",
      };
      currentSession = {
        sessionId,
        baseVersionId: base.version_id,
        activeRevisionId: revisionId,
        templateVersion: base.template_version,
        messages: [],
        messageHistory: [],
        createdAt: created,
        updatedAt: created,
      };
      await db.replaceActiveSession(currentSession, currentRevision);
      setSession(currentSession);
      setRevision(currentRevision);
    }

    const userMessage: ChatMessage = {
      id: id("msg"),
      role: "user",
      content: text,
      createdAt: now(),
      status: "complete",
    };
    const assistantId = id("msg");
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      parts: [],
      createdAt: now(),
      status: "streaming",
    };
    let transcript = [...messagesRef.current, userMessage, assistantMessage];
    setMessages(transcript);
    setDraft("");
    setConnecting(true);

    const activeSession = currentSession;
    const activeRevision = currentRevision!;
    socketRef.current = connectChat(
      {
        message: text,
        message_history: activeSession.messageHistory.length ? activeSession.messageHistory : null,
        resume: activeRevision.resume,
        analysis: activeSession.currentAnalysis ?? null,
      },
      (event) => {
        transcript = applyServerEvent(transcript, assistantId, event);
        setMessages(transcript);
        if (event.type === "message.completed") {
          persistSessionPatch({ messageHistory: event.message_history }, transcript);
        } else if (event.type === "error") {
          setError(event.message);
          persistSessionPatch({}, transcript);
        }
      },
      () => setConnecting(false),
      (message) => {
        setError(message);
        setConnecting(false);
      },
    );
  }

  async function exportArtifact(kind: "resume" | "cover" | "both") {
    if (!session || !revision) return;
    setError("");
    try {
      let result;
      if (kind === "resume")
        result = await api.exportResume(revision.resume, session.company ?? "", session.roleTitle ?? "");
      else if (kind === "cover" && session.coverLetter)
        result = await api.exportCover(session.coverLetter, session.company ?? "", session.roleTitle ?? "");
      else if (kind === "both" && session.coverLetter)
        result = await api.exportBoth(
          revision.resume,
          session.coverLetter,
          session.company ?? "",
          session.roleTitle ?? "",
        );
      else throw new Error("Generate a cover letter first");
      const ext = kind === "both" ? "zip" : "pdf";
      download(
        result.blob,
        `${(session.company || "tailored").toLowerCase().replace(/\W+/g, "-")}-${kind}.${ext}`,
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : "Export failed");
    }
  }

  async function promoteBase() {
    if (
      !revision ||
      !base ||
      !confirm(
        "Make this revision the browser-local base? Existing sessions will remain pinned to their original base.",
      )
    )
      return;
    const version: BaseVersion = {
      version_id: id("base"),
      schema_version: revision.resume.schema_version,
      resume_snapshot: revision.resume,
      content_hash: revision.contentHash,
      template_version: revision.resume.template_version,
      source: "promoted_session_change",
      createdAt: now(),
      previous_version_id: base.version_id,
      change_note: `Promoted from ${session?.roleTitle || "session"}`,
    };
    await db.putBase(version);
    setBase(version);
    const result = await api.yaml(revision.resume);
    download(result.blob, "resume.yaml");
  }

  async function backup() {
    const value = await db.backup();
    download(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
      `tailor-backup-${new Date().toISOString().slice(0, 10)}.json`,
    );
  }
  async function restore(file?: File) {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as Backup;
      await db.restore(value);
      await boot();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Import failed");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  if (!authenticated) return <Login onDone={() => setAuthenticated(true)} />;
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="wordmark">
          tailor<span>.</span>
        </div>
        <div className="top-actions">
          <span className={`save-state ${saveState}`}>{saveState}</span>
          <button className="icon-button" title="Export backup" onClick={backup}>
            <FloppyDisk />
          </button>
          <button className="icon-button" title="Import backup" onClick={() => importRef.current?.click()}>
            <UploadSimple />
          </button>
          <input
            ref={importRef}
            hidden
            type="file"
            accept="application/json"
            onChange={(e) => restore(e.target.files?.[0])}
          />
          <button
            className="icon-button"
            title="Log out"
            onClick={() => {
              token.clear();
              setAuthenticated(false);
            }}
          >
            <SignOut />
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <Warning weight="fill" />
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <main className="workspace">
        <section className="control-pane">
          {messages.length === 0 ? (
            <div className="empty">
              <FileText />
              <h2>Paste a job description or tell me what you need.</h2>
              <p>
                I'll analyze the role, propose grounded edits, and draft a cover letter as we talk —
                nothing changes on your resume until you approve it.
              </p>
            </div>
          ) : (
            <ChatThread messages={messages} actions={actions} />
          )}
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
          >
            <textarea
              placeholder="Paste a job description, ask a question, or request a change…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <button className="primary" type="submit" disabled={connecting || !draft.trim()}>
              <PaperPlaneTilt />
            </button>
          </form>
        </section>
        <section className="preview-pane">
          <div className="preview-toolbar">
            <div className="segmented">
              <button className={preview === "resume" ? "active" : ""} onClick={() => setPreview("resume")}>
                Resume
              </button>
              <button
                className={preview === "cover" ? "active" : ""}
                disabled={!session?.coverLetter}
                onClick={() => setPreview("cover")}
              >
                Cover letter
              </button>
            </div>
            <span className="page-estimate">
              About {estimatedPages} page{estimatedPages === 1 ? "" : "s"}
            </span>
            <div className="export-menu">
              <button disabled={!revision} onClick={() => exportArtifact(preview)}>
                <DownloadSimple />
                PDF
              </button>
              <button disabled={!session?.coverLetter} onClick={() => exportArtifact("both")}>
                <FileArrowDown />
                Both
              </button>
              <button disabled={!revision} onClick={promoteBase} title="Create a local base version and download YAML">
                <ClockCounterClockwise />
                Promote
              </button>
            </div>
          </div>
          {previewHtml ? (
            <iframe title={`${preview} preview`} sandbox="" srcDoc={previewHtml} />
          ) : (
            <div className="preview-empty">
              <FileText />
              <p>Start a conversation to preview the fixed resume template.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
