import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DownloadSimple,
  FileArrowDown,
  FileText,
  FloppyDisk,
  LockKey,
  PaperPlaneTilt,
  Plus,
  SignOut,
  DotsThree,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react";
import { api, download, token } from "./api";
import { applyServerEvent, connectChat } from "./chat";
import { ChatThread, type ChatActions } from "./chat-view";
import { db, withSessionLock } from "./db";
import { deriveResumeLocal } from "./edit-engine";
import { ReviewDeck } from "./review-deck";
import type {
  BaseVersion,
  Backup,
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
  const [workingResume, setWorkingResume] = useState<Resume>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [preview, setPreview] = useState<Preview>("resume");
  const [previewHtml, setPreviewHtml] = useState("");
  const [draft, setDraft] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [activeReview, setActiveReview] = useState<ActiveReview>();
  const importRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const workingResumeRef = useRef(workingResume);
  workingResumeRef.current = workingResume;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const validationGeneration = useRef(0);
  const reviewBases = useRef(new Map<string, Resume>());
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

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
        setWorkingResume(activeRevision?.resume);
        setMessages(active.messages);
        setActiveReview(active.activeReview);
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
        await db.patchSession(next.sessionId, {
          ...patch,
          messages: nextMessages ?? messagesRef.current,
          updatedAt: next.updatedAt,
        });
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
    messagesRef.current = next;
    setMessages(next);
    return next;
  }

  const validatePlanDecisions = useCallback((plan: Plan, decisions: Decision[], planBase: Resume) => {
    const sessionId = sessionRef.current?.sessionId;
    if (!sessionId) return;
    const generation = ++validationGeneration.current;
    clearTimeout(validationTimer.current);
    setSaveState("saving");
    validationTimer.current = setTimeout(async () => {
      try {
        const result = await api.derive(planBase, plan, decisions, plan.base_snapshot_hash);
        if (generation !== validationGeneration.current) return;
        workingResumeRef.current = result.resume;
        setWorkingResume(result.resume);
        await withSessionLock(sessionId, async () => {
        const currentSession = await db.getSession(sessionId);
        if (!currentSession) throw new Error("The current session is missing");
        const currentRevision = await db.getRevision(currentSession.activeRevisionId);
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
        await db.saveRevision(nextSession, nextRevision, currentRevision.revisionId);
        revisionRef.current = nextRevision;
        sessionRef.current = nextSession;
        setSession(nextSession);
        });
        setSaveState("saved");
      } catch (value) {
        if (generation !== validationGeneration.current) return;
        setSaveState("failed");
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

  useEffect(() => {
    if (!reviewPart || !session || reviewBases.current.has(reviewPart.plan.base_snapshot_hash)) return;
    void db.sessionRevisions(session.sessionId).then((history) => {
      const baseRevision = history.find((item) => item.contentHash === reviewPart.plan.base_snapshot_hash);
      if (baseRevision) reviewBases.current.set(reviewPart.plan.base_snapshot_hash, baseRevision.resume);
    });
  }, [reviewPart, session]);

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
      void (async () => {
        if (!reviewBases.current.has(part.plan.base_snapshot_hash)) {
          const history = sessionRef.current
            ? await db.sessionRevisions(sessionRef.current.sessionId)
            : [];
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
        persistSessionPatch({ activeReview: review }, next);
      })();
    },
    onCoverLetterChange: (messageId, partId, coverLetter: CoverLetter) => {
      const next = updateMessagePart(messageId, partId, (p) =>
        p.type === "cover_letter" ? { ...p, coverLetter } : p,
      );
      persistSessionPatch({ coverLetter }, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

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
      revisionRef.current = currentRevision;
      workingResumeRef.current = currentRevision.resume;
      setSession(currentSession);
      setRevision(currentRevision);
      setWorkingResume(currentRevision.resume);
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
    const chatResume = workingResumeRef.current ?? activeRevision.resume;
    socketRef.current = connectChat(
      {
        message: text,
        message_history: activeSession.messageHistory.length ? activeSession.messageHistory : null,
        resume: chatResume,
        analysis: activeSession.currentAnalysis ?? null,
      },
      (event) => {
        transcript = applyServerEvent(transcript, assistantId, event);
        setMessages(transcript);
        if (event.type === "analysis.completed") {
          persistSessionPatch({
            currentAnalysis: event.analysis,
            company: event.analysis.company || sessionRef.current?.company,
            roleTitle: event.analysis.role_title || sessionRef.current?.roleTitle,
          });
        } else if (event.type === "cover_letter.drafted") {
          persistSessionPatch({ coverLetter: event.cover_letter });
        } else if (event.type === "message.completed") {
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
    if (!session || !revision || !workingResume) return;
    setError("");
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
    } catch (value) {
      setError(value instanceof Error ? value.message : "Export failed");
    }
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

  async function startFresh() {
    if (!sessionRef.current && messagesRef.current.length === 0) {
      draftRef.current?.focus();
      return;
    }
    if (!confirm("Start a fresh tailoring session? Your current session will remain saved in this browser."))
      return;

    socketRef.current?.close();
    clearTimeout(persistTimer.current);
    clearTimeout(validationTimer.current);
    validationGeneration.current += 1;
    const current = sessionRef.current;
    if (current) {
      await db.putSession({
        ...current,
        activeRevisionId: revisionRef.current?.revisionId ?? current.activeRevisionId,
        messages: messagesRef.current,
        updatedAt: now(),
      });
    }
    await db.clearActiveSession();
    setSession(undefined);
    setRevision(undefined);
    setWorkingResume(undefined);
    setMessages([]);
    setDraft("");
    setPreview("resume");
    setPreviewHtml("");
    setActiveReview(undefined);
    setError("");
    setSaveState("saved");
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
                  <button onClick={backup}><FloppyDisk /> Export backup</button>
                  <button onClick={() => importRef.current?.click()}><UploadSimple /> Import backup</button>
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
              <input
                ref={importRef}
                hidden
                type="file"
                accept="application/json"
                onChange={(e) => restore(e.target.files?.[0])}
              />
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
                persistSessionPatch({}, next);
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
                  const nextResume = deriveResumeLocal(planBase, reviewPart.plan, nextDecisions);
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
                persistSessionPatch({}, next);
                validatePlanDecisions(reviewPart.plan, nextDecisions, planBase);
              }}
              onClose={() => {
                setActiveReview(undefined);
                persistSessionPatch({ activeReview: undefined });
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
                ref={draftRef}
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
              <button type="submit" disabled={connecting || !draft.trim()}>
                <PaperPlaneTilt />
              </button>
            </form>
            <span className={`save-state ${saveState}`}>{saveState}</span>
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
              <button disabled={!revision} onClick={() => exportArtifact(preview)}>
                <DownloadSimple />
                PDF
              </button>
              <button disabled={!session?.coverLetter} onClick={() => exportArtifact("both")}>
                <FileArrowDown />
                Both
              </button>
            </div>
          </div>
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
