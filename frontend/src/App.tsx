import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DownloadSimple,
  FileArrowDown,
  FileText,
  LockKey,
  PaperPlaneTilt,
  Plus,
  SignOut,
  DotsThree,
  Stop,
  Warning,
} from "@phosphor-icons/react";
import { api, download, token } from "./api";
import { applyServerEvent, connectChat, stopAssistantMessage } from "./chat";
import { ChatThread, type ChatActions } from "./chat-view";
import { applyDecisionOnto, deriveResumeLocal } from "./edit-engine";
import { ReviewDeck } from "./review-deck";
import type {
  BaseVersion,
  ChatMessage,
  CoverLetter,
  Decision,
  Edit,
  MessagePart,
  Plan,
  Revision,
  Session,
  Resume,
} from "./types";

type Preview = "resume" | "cover";
type ActiveReview = { messageId: string; partId: string };
type ExportKind = "resume" | "cover" | "both";
type ExportState =
  | { status: "idle" }
  | { status: "preparing" | "slow" | "waking"; kind: ExportKind }
  | { status: "success"; message: string }
  | { status: "error"; message: string };
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
            Enter your passphrase to open the private tailoring interface. Work remains
            available only while this tab stays open.
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
  const [workingResume, setWorkingResume] = useState<Resume>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [preview, setPreview] = useState<Preview>("resume");
  const [previewHtml, setPreviewHtml] = useState("");
  const [draft, setDraft] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [activeReview, setActiveReview] = useState<ActiveReview>();
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const workingResumeRef = useRef(workingResume);
  workingResumeRef.current = workingResume;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const activeAssistantId = useRef<string | undefined>(undefined);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const validationGeneration = useRef(0);
  const exportTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const reviewBases = useRef(new Map<string, Resume>());
  const revisions = useRef(new Map<string, Revision>());
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const resizeDraft = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);
  useEffect(() => {
    resizeDraft(draftRef.current);
  }, [draft, resizeDraft]);

  const boot = useCallback(async () => {
    if (!token.get()) return;
    setError("");
    try {
      const repository = await api.base();
      setBase(repository);
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
      : api.previewResume(workingResumeRef.current ?? revision.resume)
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
  useEffect(() => () => clearTimeout(validationTimer.current), []);
  useEffect(() => () => exportTimers.current.forEach(clearTimeout), []);
  const estimatedPages = useMemo(
    () => Math.max(1, Math.ceil((previewHtml.match(/<section/g) || []).length / 3)),
    [previewHtml],
  );

  function updateSession(patch: Partial<Session>, nextMessages?: ChatMessage[]) {
    if (!sessionRef.current) return;
    const next: Session = {
      ...sessionRef.current,
      ...patch,
      messages: nextMessages ?? sessionRef.current.messages,
      updatedAt: now(),
    };
    sessionRef.current = next;
    setSession(next);
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
    messagesRef.current = next;
    setMessages(next);
    return next;
  }

  const validatePlanDecisions = useCallback((plan: Plan, decisions: Decision[], planBase: Resume) => {
    const sessionId = sessionRef.current?.sessionId;
    if (!sessionId) return;
    const generation = ++validationGeneration.current;
    clearTimeout(validationTimer.current);
    validationTimer.current = setTimeout(async () => {
      try {
        const result = await api.derive(planBase, plan, decisions, plan.base_snapshot_hash);
        if (generation !== validationGeneration.current) return;
        workingResumeRef.current = result.resume;
        setWorkingResume(result.resume);
        const currentSession = sessionRef.current;
        if (!currentSession) throw new Error("The current session is missing");
        const currentRevision = revisions.current.get(currentSession.activeRevisionId);
        if (!currentRevision) throw new Error("The current resume revision is missing");
        if (result.content_hash === currentRevision.contentHash) return;
        const revisionId = id("revision");
        const created = now();
        const nextRevision: Revision = {
          revisionId,
          sessionId,
          parentRevisionId: currentRevision.revisionId,
          resume: result.resume,
          contentHash: result.content_hash,
          createdAt: created,
          note: "Updated edit decisions",
        };
        const nextSession = { ...currentSession, activeRevisionId: revisionId, updatedAt: created };
        revisions.current.set(revisionId, nextRevision);
        revisionRef.current = nextRevision;
        sessionRef.current = nextSession;
        setSession(nextSession);
      } catch (value) {
        if (generation !== validationGeneration.current) return;
        setError(value instanceof Error ? value.message : "Could not validate edits");
      }
    }, 500);
  }, []);

  const patchPreview = useCallback((edit: Edit, decision: Decision): boolean => {
    const document = previewRef.current?.contentDocument;
    if (!document) return false;
    const target = document.querySelector<HTMLElement>(`[data-resume-id="${CSS.escape(edit.target_id)}"]`);
    if (!target) return false;
    if (edit.op === "rewrite_text") {
      const field = typeof edit.field === "string" ? edit.field : "text";
      const fieldTarget = target.dataset.resumeField === field
        ? target
        : target.querySelector<HTMLElement>(`[data-resume-field="${CSS.escape(field)}"]`);
      if (fieldTarget) {
        fieldTarget.textContent = decision.decision === "modified"
          ? decision.modified_after ?? ""
          : decision.decision === "rejected"
            ? typeof edit.before === "string" ? edit.before : ""
            : typeof edit.after === "string" ? edit.after : "";
      }
      return Boolean(fieldTarget);
    } else if (edit.op === "remove_item" || edit.op === "set_visibility") {
      target.hidden = decision.decision === "rejected" ? false : edit.op === "remove_item" || edit.visible === false;
      return true;
    } else if (edit.op === "replace_collection") {
      const field = typeof edit.field === "string" ? edit.field : "items";
      const fieldTarget = target.querySelector<HTMLElement>(`[data-resume-field="${CSS.escape(field)}"]`);
      const value = decision.decision === "rejected" ? edit.before : edit.after;
      if (fieldTarget && Array.isArray(value)) fieldTarget.textContent = value.join(" · ");
      return Boolean(fieldTarget && Array.isArray(value));
    } else if (edit.op === "move_item" && decision.decision !== "rejected") {
      const section = typeof edit.destination_collection === "string"
        ? document.querySelector<HTMLElement>(`[data-resume-section="${CSS.escape(edit.destination_collection)}"]`)
        : null;
      if (section) section.append(target);
      return Boolean(section);
    }
    return false;
  }, []);

  const reviewPart = useMemo(() => {
    if (!activeReview) return undefined;
    const message = messages.find((item) => item.id === activeReview.messageId);
    const part = message?.parts?.find((item) => item.id === activeReview.partId);
    return part?.type === "edits_proposed" ? part : undefined;
  }, [activeReview, messages]);

  const activeReviewEdit = reviewPart?.plan.edits.find(
    (edit) => edit.edit_id === (reviewPart.activeEditId ?? reviewPart.plan.edits[0]?.edit_id),
  );

  const focusPreviewTarget = useCallback((edit?: Edit) => {
    if (!edit) return;
    const frame = previewRef.current;
    const document = frame?.contentDocument;
    if (!document) return;
    document.querySelectorAll(".tailor-review-target").forEach((node) =>
      node.classList.remove("tailor-review-target"),
    );
    const escaped = CSS.escape(edit.target_id);
    const collection = typeof edit.collection === "string"
      ? edit.collection
      : typeof edit.destination_collection === "string"
        ? edit.destination_collection
        : undefined;
    const target = document.querySelector<HTMLElement>(`[data-resume-id="${escaped}"]`)
      ?? (collection
        ? document.querySelector<HTMLElement>(`[data-resume-section="${CSS.escape(collection)}"]`)
        : null);
    if (!target) return;
    target.classList.add("tailor-review-target");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  useEffect(() => {
    if (activeReviewEdit) requestAnimationFrame(() => focusPreviewTarget(activeReviewEdit));
  }, [activeReviewEdit, previewHtml, focusPreviewTarget]);

  const actions: ChatActions = useMemo(() => ({
    onReviewEdits: (messageId, partId) => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      const part = message?.parts?.find((p) => p.id === partId);
      if (!part || part.type !== "edits_proposed") return;
      const activeEditId = part.activeEditId
        ?? part.plan.edits.find((edit) => !part.decisions.some((decision) => decision.edit_id === edit.edit_id))?.edit_id
        ?? part.plan.edits[0]?.edit_id;
      void (() => {
        if (!reviewBases.current.has(part.plan.base_snapshot_hash)) {
          const history = [...revisions.current.values()];
          const baseRevision = history.find((item) => item.contentHash === part.plan.base_snapshot_hash);
          if (!baseRevision) {
            setError("The resume snapshot for this review is missing");
            return;
          }
          reviewBases.current.set(part.plan.base_snapshot_hash, baseRevision.resume);
        }
        const next = updateMessagePart(messageId, partId, (p) =>
          p.type === "edits_proposed" ? { ...p, activeEditId } : p,
        );
        const review = { messageId, partId };
        setActiveReview(review);
        updateSession({ activeReview: review }, next);
      })();
    },
    onCoverLetterChange: (messageId, partId, coverLetter: CoverLetter) => {
      const next = updateMessagePart(messageId, partId, (p) =>
        p.type === "cover_letter" ? { ...p, coverLetter } : p,
      );
      updateSession({ coverLetter }, next);
    },
    onEditMessage: (messageId, text) => {
      const target = messagesRef.current.find((m) => m.id === messageId);
      if (!target || target.role !== "user") return;
      stopGeneration();
      void runTurn(text, {
        historyOverride: target.messageHistoryBefore ?? [],
        truncateBeforeMessageId: messageId,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  async function runTurn(
    text: string,
    options?: { historyOverride?: unknown[]; truncateBeforeMessageId?: string },
  ) {
    const trimmed = text.trim();
    if (!trimmed || activeAssistantId.current) return;
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
      revisions.current.set(revisionId, currentRevision);
      revisionRef.current = currentRevision;
      workingResumeRef.current = currentRevision.resume;
      setSession(currentSession);
      setRevision(currentRevision);
      setWorkingResume(currentRevision.resume);
    }

    let baseTranscript = messagesRef.current;
    if (options?.truncateBeforeMessageId) {
      const index = baseTranscript.findIndex((m) => m.id === options.truncateBeforeMessageId);
      if (index !== -1) baseTranscript = baseTranscript.slice(0, index);
    }

    const activeSession = currentSession;
    const historyForRequest = options?.historyOverride
      ?? (activeSession.messageHistory.length ? activeSession.messageHistory : null);

    const userMessage: ChatMessage = {
      id: id("msg"),
      role: "user",
      content: trimmed,
      createdAt: now(),
      status: "complete",
      messageHistoryBefore: historyForRequest ?? [],
    };
    const assistantId = id("msg");
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      parts: [],
      createdAt: now(),
      status: "streaming",
    };
    let transcript = [...baseTranscript, userMessage, assistantMessage];
    messagesRef.current = transcript;
    setMessages(transcript);
    setDraft("");
    setConnecting(true);
    activeAssistantId.current = assistantId;

    const activeRevision = currentRevision!;
    const chatResume = workingResumeRef.current ?? activeRevision.resume;
    let socket: WebSocket;
    const finishTurn = () => {
      if (socketRef.current !== socket || activeAssistantId.current !== assistantId) return;
      socketRef.current = undefined;
      activeAssistantId.current = undefined;
      setConnecting(false);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Turn complete");
    };
    socket = connectChat(
      {
        message: trimmed,
        message_history: historyForRequest,
        resume: chatResume,
        analysis: activeSession.currentAnalysis ?? null,
      },
      (event) => {
        if (socketRef.current !== socket || activeAssistantId.current !== assistantId) return;
        transcript = applyServerEvent(transcript, assistantId, event);
        messagesRef.current = transcript;
        setMessages(transcript);
        if (event.type === "analysis.completed") {
          updateSession({
            currentAnalysis: event.analysis,
            company: event.analysis.company || sessionRef.current?.company,
            roleTitle: event.analysis.role_title || sessionRef.current?.roleTitle,
          });
        } else if (event.type === "cover_letter.drafted") {
          updateSession({ coverLetter: event.cover_letter });
        } else if (event.type === "edits.proposed") {
          reviewBases.current.set(event.plan.base_snapshot_hash, structuredClone(chatResume));
        } else if (event.type === "message.completed") {
          updateSession({ messageHistory: event.message_history }, transcript);
          finishTurn();
        } else if (event.type === "error") {
          setError(event.message);
          updateSession({}, transcript);
          finishTurn();
        }
      },
      () => {
        if (socketRef.current !== socket) return;
        socketRef.current = undefined;
        if (activeAssistantId.current === assistantId) activeAssistantId.current = undefined;
        setConnecting(false);
      },
      (message) => {
        if (socketRef.current !== socket) return;
        socketRef.current = undefined;
        if (activeAssistantId.current === assistantId) activeAssistantId.current = undefined;
        setError(message);
        setConnecting(false);
      },
    );
    socketRef.current = socket;
  }

  function sendMessage() {
    return runTurn(draft);
  }

  function stopGeneration() {
    const socket = socketRef.current;
    socketRef.current = undefined;
    const assistantId = activeAssistantId.current;
    activeAssistantId.current = undefined;
    setConnecting(false);
    if (assistantId) {
      const next = stopAssistantMessage(messagesRef.current, assistantId);
      messagesRef.current = next;
      setMessages(next);
      updateSession({}, next);
    }
    socket?.close();
  }

  async function exportArtifact(kind: ExportKind) {
    if (!session || !revision || !workingResume) return;
    setError("");
    exportTimers.current.forEach(clearTimeout);
    exportTimers.current = [
      setTimeout(() => setExportState((state) =>
        state.status === "preparing" ? { status: "slow", kind } : state,
      ), 2000),
      setTimeout(() => setExportState((state) =>
        state.status === "preparing" || state.status === "slow" ? { status: "waking", kind } : state,
      ), 8000),
    ];
    setExportState({ status: "preparing", kind });
    try {
      let result;
      if (kind === "resume")
        result = await api.exportResume(workingResume, session.company ?? "", session.roleTitle ?? "");
      else if (kind === "cover" && session.coverLetter)
        result = await api.exportCover(session.coverLetter, session.company ?? "", session.roleTitle ?? "");
      else if (kind === "both" && session.coverLetter)
        result = await api.exportBoth(
          workingResume,
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
      const pages = kind === "both"
        ? result.headers.get("X-Resume-Page-Count")
        : result.headers.get("X-Page-Count");
      setExportState({
        status: "success",
        message: pages ? `Downloaded, ${pages} page${pages === "1" ? "" : "s"}` : "Download ready",
      });
      exportTimers.current.push(setTimeout(() => setExportState({ status: "idle" }), 5000));
    } catch (value) {
      setExportState({
        status: "error",
        message: value instanceof Error ? value.message : "Export failed. Please try again.",
      });
    } finally {
      exportTimers.current.slice(0, 2).forEach(clearTimeout);
    }
  }

  async function startFresh() {
    if (!sessionRef.current && messagesRef.current.length === 0) {
      draftRef.current?.focus();
      return;
    }
    if (!confirm("Start a new session? Your current work will be permanently discarded."))
      return;

    socketRef.current?.close();
    clearTimeout(validationTimer.current);
    validationGeneration.current += 1;
    revisions.current.clear();
    reviewBases.current.clear();
    sessionRef.current = undefined;
    revisionRef.current = undefined;
    workingResumeRef.current = undefined;
    messagesRef.current = [];
    setSession(undefined);
    setRevision(undefined);
    setWorkingResume(undefined);
    setMessages([]);
    setDraft("");
    setPreview("resume");
    setPreviewHtml("");
    setActiveReview(undefined);
    setError("");
    setExportState({ status: "idle" });
    requestAnimationFrame(() => draftRef.current?.focus());
  }

  if (!authenticated) return <Login onDone={() => setAuthenticated(true)} />;
  return (
    <div className="app-shell">
      {error && (
        <div className="error-banner" role="alert">
          <Warning weight="fill" />
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <main className="workspace">
        <section className="control-pane">
          <div className="utility-bar">
            <div className="wordmark">
              tailor<span>.</span>
            </div>
            <div className="utility-actions">
              <button className="icon-button new-session" title="New session" onClick={() => void startFresh()}>
                <Plus weight="bold" />
              </button>
              <details className="utility-menu">
                <summary className="icon-button" title="More options" aria-label="More options">
                  <DotsThree weight="bold" />
                </summary>
                <div className="utility-menu__panel">
                  <button
                    onClick={() => {
                      token.clear();
                      setAuthenticated(false);
                    }}
                  >
                    <SignOut /> Log out
                  </button>
                </div>
              </details>
            </div>
          </div>
          {activeReview && reviewPart && revision && workingResume ? (
            <ReviewDeck
              plan={reviewPart.plan}
              decisions={reviewPart.decisions}
              resume={workingResume}
              activeEditId={reviewPart.activeEditId ?? reviewPart.plan.edits[0]?.edit_id ?? ""}
              busy={false}
              onActiveChange={(activeEditId) => {
                const next = updateMessagePart(activeReview.messageId, activeReview.partId, (part) =>
                  part.type === "edits_proposed" ? { ...part, activeEditId } : part,
                );
                updateSession({}, next);
              }}
              onDecision={(decision) => {
                const nextDecisions = [
                  ...reviewPart.decisions.filter((item) => item.edit_id !== decision.edit_id),
                  decision,
                ];
                const next = updateMessagePart(activeReview.messageId, activeReview.partId, (part) =>
                  part.type === "edits_proposed" ? { ...part, decisions: nextDecisions } : part,
                );
                const planBase = reviewBases.current.get(reviewPart.plan.base_snapshot_hash);
                if (!planBase) {
                  setError("The resume snapshot for this review is missing");
                  return;
                }
                try {
                  const isNewDecision = !reviewPart.decisions.some((item) => item.edit_id === decision.edit_id);
                  const nextResume = isNewDecision && workingResumeRef.current
                    ? applyDecisionOnto(workingResumeRef.current, reviewPart.plan, decision)
                    : deriveResumeLocal(planBase, reviewPart.plan, nextDecisions);
                  workingResumeRef.current = nextResume;
                  setWorkingResume(nextResume);
                  const patched = patchPreview(
                    reviewPart.plan.edits.find((edit) => edit.edit_id === decision.edit_id)!,
                    decision,
                  );
                  if (!patched) {
                    void api.previewResume(nextResume).then(setPreviewHtml).catch((value) => setError(value.message));
                  }
                } catch (value) {
                  setError(value instanceof Error ? value.message : "Could not apply this edit");
                  return;
                }
                updateSession({}, next);
                validatePlanDecisions(reviewPart.plan, nextDecisions, planBase);
              }}
              onClose={() => {
                setActiveReview(undefined);
                updateSession({ activeReview: undefined });
                const resume = workingResumeRef.current;
                if (resume) {
                  void api.previewResume(resume).then(setPreviewHtml).catch((value) => setError(value.message));
                }
              }}
            />
          ) : messages.length === 0 ? (
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
          {!activeReview && <div className="composer-area">
            <form
              className="chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
            >
              <textarea
                ref={(el) => {
                  draftRef.current = el;
                  resizeDraft(el);
                }}
                rows={1}
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
              {connecting ? (
                <button type="button" onClick={stopGeneration} title="Stop generating">
                  <Stop weight="fill" />
                </button>
              ) : (
                <button type="submit" disabled={!draft.trim()}>
                  <PaperPlaneTilt />
                </button>
              )}
            </form>
          </div>}
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
              <button
                disabled={!revision || exportState.status === "preparing" || exportState.status === "slow" || exportState.status === "waking"}
                onClick={() => exportArtifact(preview)}
              >
                <DownloadSimple />
                {exportState.status === "preparing" && exportState.kind === preview ? "Preparing…" : "PDF"}
              </button>
              <button
                disabled={!session?.coverLetter || exportState.status === "preparing" || exportState.status === "slow" || exportState.status === "waking"}
                onClick={() => exportArtifact("both")}
              >
                <FileArrowDown />
                {exportState.status === "preparing" && exportState.kind === "both" ? "Preparing…" : "Both"}
              </button>
            </div>
          </div>
          {exportState.status !== "idle" && (
            <div className={`export-status ${exportState.status}`} role="status" aria-live="polite">
              {exportState.status === "preparing" && "Preparing your PDF…"}
              {exportState.status === "slow" && "Rendering the document. This may take a moment."}
              {exportState.status === "waking" && "The export service may be waking up. Your work is safe."}
              {(exportState.status === "success" || exportState.status === "error") && exportState.message}
              {exportState.status === "error" && <button onClick={() => setExportState({ status: "idle" })}>Dismiss</button>}
            </div>
          )}
          {previewHtml ? (
            <iframe
              ref={previewRef}
              title={`${preview} preview`}
              sandbox="allow-same-origin"
              srcDoc={previewHtml}
              onLoad={() => focusPreviewTarget(activeReviewEdit)}
            />
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
