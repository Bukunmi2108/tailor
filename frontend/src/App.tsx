import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowClockwise,
  Check,
  ClockCounterClockwise,
  DownloadSimple,
  FileArrowDown,
  FileText,
  FloppyDisk,
  LockKey,
  Plus,
  SignOut,
  Sparkle,
  Trash,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react";
import { api, download, token } from "./api";
import { db, withSessionLock } from "./db";
import { wordDiff } from "./diff";
import type {
  Analysis,
  BaseVersion,
  Backup,
  CoverLetter,
  Decision,
  Edit,
  Plan,
  Resume,
  Revision,
  Session,
} from "./types";

type Tab = "job" | "edits" | "cover" | "history";
type Preview = "resume" | "cover";
const channel =
  "BroadcastChannel" in window ? new BroadcastChannel("tailor-sessions") : null;
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
            Enter your passphrase to open the private tailoring interface. Your
            sessions remain in this browser.
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

function Diff({ edit }: { edit: Edit }) {
  const parts = useMemo(
    () =>
      typeof edit.before === "string" && typeof edit.after === "string"
        ? wordDiff(edit.before, edit.after)
        : undefined,
    [edit.before, edit.after],
  );
  if (!parts) return <p className="operation">{edit.op.replaceAll("_", " ")}</p>;
  return (
    <p className="diff">
      {parts.map((part, index) => (
        <span key={index} className={part.kind}>
          {part.value}
        </span>
      ))}
    </p>
  );
}

const EditCard = memo(function EditCard({
  edit,
  decision,
  onDecision,
}: {
  edit: Edit;
  decision?: Decision;
  onDecision: (decision: Decision) => void;
}) {
  const [custom, setCustom] = useState(
    decision?.modified_after ?? edit.after ?? "",
  );
  const selected = decision?.decision;
  return (
    <article className={`edit-card ${edit.risk}`}>
      <header>
        <div>
          <span className="target">{edit.target_id}</span>
          <h3>{edit.rationale}</h3>
        </div>
        <span className={`risk ${edit.risk}`}>{edit.risk}</span>
      </header>
      <Diff edit={edit} />
      {edit.warnings?.map((warning) => (
        <p className="warning" key={warning}>
          <Warning /> {warning}
        </p>
      ))}
      <div className="evidence">
        {edit.evidence_ids.map((item) => (
          <code key={item}>{item}</code>
        ))}
      </div>
      {selected === "modified" && (
        <textarea
          aria-label="Modified replacement"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() =>
            onDecision({
              edit_id: edit.edit_id,
              decision: "modified",
              modified_after: custom,
            })
          }
        />
      )}
      <div className="decision-row">
        <button
          className={selected === "approved" ? "selected" : ""}
          onClick={() =>
            onDecision({ edit_id: edit.edit_id, decision: "approved" })
          }
        >
          <Check />
          Approve
        </button>
        {typeof edit.after === "string" && (
          <button
            className={selected === "modified" ? "selected" : ""}
            onClick={() =>
              onDecision({
                edit_id: edit.edit_id,
                decision: "modified",
                modified_after: custom,
              })
            }
          >
            Edit
          </button>
        )}
        <button
          className={selected === "rejected" ? "selected reject" : ""}
          onClick={() =>
            onDecision({ edit_id: edit.edit_id, decision: "rejected" })
          }
        >
          Reject
        </button>
      </div>
    </article>
  );
});

function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(token.get()));
  const [base, setBase] = useState<BaseVersion>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session>();
  const [revision, setRevision] = useState<Revision>();
  const [sessionHistory, setSessionHistory] = useState<Revision[]>([]);
  const [tab, setTab] = useState<Tab>("job");
  const [preview, setPreview] = useState<Preview>("resume");
  const [previewHtml, setPreviewHtml] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [instruction, setInstruction] = useState("");
  const [coverPoints, setCoverPoints] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">(
    "saved",
  );
  const importRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const refreshSessions = useCallback(
    async () =>
      setSessions(
        (await db.sessions()).sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      ),
    [],
  );
  const loadSession = useCallback(async (item: Session) => {
    const active = await db.getRevision(item.activeRevisionId);
    if (!active) throw new Error("Active revision is missing");
    const revisions = await db.sessionRevisions(item.sessionId);
    setSession(item);
    setRevision(active);
    setSessionHistory(
      revisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    setPreview("resume");
    setTab("job");
  }, []);
  const boot = useCallback(async () => {
    if (!token.get()) return;
    setError("");
    try {
      const repository = await api.base();
      await db.putBase({ ...repository, createdAt: now() });
      setBase(repository);
      await refreshSessions();
    } catch (value) {
      if (!token.get()) setAuthenticated(false);
      setError(
        value instanceof Error ? value.message : "Could not start Tailor",
      );
    }
  }, [refreshSessions]);
  useEffect(() => {
    if (authenticated) void boot();
  }, [authenticated, boot]);
  useEffect(() => {
    const listener = (event: MessageEvent<{ sessionId: string }>) => {
      if (event.data.sessionId === session?.sessionId)
        void db
          .getSession(event.data.sessionId)
          .then((updated) => updated && loadSession(updated));
      void refreshSessions();
    };
    channel?.addEventListener("message", listener);
    return () => channel?.removeEventListener("message", listener);
  }, [session?.sessionId, loadSession, refreshSessions]);
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
  const estimatedPages = useMemo(
    () =>
      Math.max(1, Math.ceil((previewHtml.match(/<section/g) || []).length / 3)),
    [previewHtml],
  );

  async function newSession() {
    if (!base) return;
    const sessionId = id("session"),
      revisionId = id("revision"),
      created = now();
    const firstRevision: Revision = {
      revisionId,
      sessionId,
      resume: structuredClone(base.resume_snapshot),
      contentHash: base.content_hash,
      createdAt: created,
      note: "Frozen base",
    };
    const next: Session = {
      sessionId,
      baseVersionId: base.version_id,
      activeRevisionId: revisionId,
      templateVersion: base.template_version,
      jdRaw: "",
      decisions: [],
      status: "draft",
      createdAt: created,
      updatedAt: created,
    };
    await db.putRevision(firstRevision);
    await db.putSession(next);
    await loadSession(next);
    await refreshSessions();
  }
  async function persistSession(next: Session) {
    setSaveState("saving");
    try {
      await db.putSession(next);
      setSession(next);
      setSaveState("saved");
      channel?.postMessage({ sessionId: next.sessionId });
      await refreshSessions();
    } catch {
      setSaveState("failed");
    }
  }
  const patchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function patchSession(patch: Partial<Session>) {
    if (!session) return;
    const next = { ...session, ...patch, updatedAt: now() };
    setSession(next);
    setSaveState("saving");
    clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(() => void persistSession(next), 400);
  }
  async function analyze() {
    if (!session || !revision || session.jdRaw.trim().length < 30) return;
    setBusy("Analyzing the role");
    setError("");
    try {
      const result = await api.analyze(session.jdRaw, revision.resume);
      await persistSession({
        ...session,
        analysis: result.analysis,
        company: result.analysis.company,
        roleTitle: result.analysis.role_title,
        updatedAt: now(),
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Analysis failed");
    } finally {
      setBusy("");
    }
  }
  async function makePlan() {
    if (!session || !revision || !session.analysis) return;
    setBusy("Building grounded edits");
    setError("");
    try {
      const result = await api.plan(
        session.jdRaw,
        revision.resume,
        session.analysis,
        instruction,
        session.decisions,
      );
      await persistSession({
        ...session,
        plan: result.plan,
        decisions: [],
        updatedAt: now(),
      });
      setTab("edits");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Plan failed");
    } finally {
      setBusy("");
    }
  }
  const applyDecisions = useCallback(
    async (decisions: Decision[]) => {
      const session = sessionRef.current;
      const revision = revisionRef.current;
      if (!session || !revision || !session.plan) return;
      setBusy("Applying decisions");
      setError("");
      try {
        await withSessionLock(session.sessionId, async () => {
          const history = await db.sessionRevisions(session.sessionId);
          const planBase = history.find(
            (item) => item.contentHash === session.plan!.base_snapshot_hash,
          );
          if (!planBase)
            throw new Error("The revision targeted by this plan is missing");
          const result = await api.derive(
            planBase.resume,
            session.plan!,
            decisions,
            session.plan!.base_snapshot_hash,
          );
          const revisionId = id("revision");
          const created = now();
          const nextRevision: Revision = {
            revisionId,
            sessionId: session.sessionId,
            parentRevisionId: revision.revisionId,
            resume: result.resume,
            contentHash: result.content_hash,
            createdAt: created,
            note: "Updated edit decisions",
          };
          const nextSession = {
            ...session,
            activeRevisionId: revisionId,
            decisions,
            updatedAt: created,
            status: "ready" as const,
          };
          await db.saveRevision(nextSession, nextRevision, revision.revisionId);
          setRevision(nextRevision);
          setSession(nextSession);
          setSessionHistory((current) => [nextRevision, ...current]);
          channel?.postMessage({ sessionId: session.sessionId });
          await refreshSessions();
        });
      } catch (value) {
        setError(
          value instanceof Error ? value.message : "Could not apply edits",
        );
      } finally {
        setBusy("");
      }
    },
    [refreshSessions],
  );
  const decide = useCallback(
    async (nextDecision: Decision) => {
      const session = sessionRef.current;
      if (!session) return;
      await applyDecisions([
        ...session.decisions.filter(
          (item) => item.edit_id !== nextDecision.edit_id,
        ),
        nextDecision,
      ]);
    },
    [applyDecisions],
  );
  async function approveSafe() {
    if (!session?.plan) return;
    const safe = session.plan.edits
      .filter((edit) => edit.risk === "safe")
      .map((edit) => ({
        edit_id: edit.edit_id,
        decision: "approved" as const,
      }));
    const untouched = session.decisions.filter(
      (decision) => !safe.some((item) => item.edit_id === decision.edit_id),
    );
    await applyDecisions([...untouched, ...safe]);
  }
  async function generateCover() {
    if (!session || !revision || !session.analysis) return;
    setBusy("Writing grounded cover letter");
    setError("");
    try {
      const result = await api.cover(
        session.jdRaw,
        revision.resume,
        session.analysis,
        "professional and warm",
        "standard",
        coverPoints,
      );
      await persistSession({
        ...session,
        coverLetter: result.cover_letter,
        updatedAt: now(),
      });
      setPreview("cover");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Cover letter failed");
    } finally {
      setBusy("");
    }
  }
  async function updateCover(letter: CoverLetter) {
    if (!session) return;
    await persistSession({ ...session, coverLetter: letter, updatedAt: now() });
  }
  async function exportArtifact(kind: "resume" | "cover" | "both") {
    if (!session || !revision) return;
    setBusy("Rendering final files");
    setError("");
    try {
      let result;
      if (kind === "resume")
        result = await api.exportResume(
          revision.resume,
          session.company ?? "",
          session.roleTitle ?? "",
        );
      else if (kind === "cover" && session.coverLetter)
        result = await api.exportCover(
          session.coverLetter,
          session.company ?? "",
          session.roleTitle ?? "",
        );
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
    } finally {
      setBusy("");
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
      await refreshSessions();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Import failed");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }
  async function deleteSession(item: Session) {
    if (
      !confirm(
        `Delete ${item.roleTitle || "this draft"} and all local revisions?`,
      )
    )
      return;
    await db.removeSession(item.sessionId);
    if (session?.sessionId === item.sessionId) {
      setSession(undefined);
      setRevision(undefined);
    }
    await refreshSessions();
  }
  async function restoreRevision(target: Revision) {
    if (!session || !revision || target.revisionId === revision.revisionId)
      return;
    await withSessionLock(session.sessionId, async () => {
      const createdAt = now();
      const restored: Revision = {
        ...target,
        revisionId: id("revision"),
        sessionId: session.sessionId,
        parentRevisionId: revision.revisionId,
        createdAt,
        note: `Restored revision from ${new Date(target.createdAt).toLocaleString()}`,
      };
      const nextSession: Session = {
        ...session,
        activeRevisionId: restored.revisionId,
        updatedAt: createdAt,
      };
      await db.saveRevision(nextSession, restored, revision.revisionId);
      await loadSession(nextSession);
      channel?.postMessage({ sessionId: session.sessionId });
      await refreshSessions();
    });
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
          <button
            className="icon-button"
            title="Export backup"
            onClick={backup}
          >
            <FloppyDisk />
          </button>
          <button
            className="icon-button"
            title="Import backup"
            onClick={() => importRef.current?.click()}
          >
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
      {busy && (
        <div className="busy-bar">
          <Sparkle weight="fill" />
          <span>{busy}</span>
        </div>
      )}
      <main className="workspace">
        <section className="control-pane">
          <nav className="tabs" aria-label="Workspace sections">
            {(
              [
                ["job", "Job"],
                ["edits", "Edits"],
                ["cover", "Letter"],
                ["history", "History"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={tab === value ? "active" : ""}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </nav>
          {!session && tab !== "history" && (
            <div className="empty">
              <FileText />
              <h2>Start with a job description.</h2>
              <p>
                A new session freezes the current base resume. Every later
                decision becomes a recoverable revision.
              </p>
              <button className="primary" onClick={newSession}>
                <Plus />
                New tailoring session
              </button>
            </div>
          )}
          {session && tab === "job" && (
            <div className="pane-content">
              <div className="pane-heading">
                <div>
                  <p className="kicker">Job description</p>
                  <h2>{session.roleTitle || "Untitled application"}</h2>
                </div>
                <button
                  className="quiet danger"
                  onClick={() => deleteSession(session)}
                >
                  <Trash />
                  Delete
                </button>
              </div>
              <label htmlFor="jd">Paste the complete job description</label>
              <textarea
                id="jd"
                className="jd-input"
                value={session.jdRaw}
                onChange={(e) => patchSession({ jdRaw: e.target.value })}
              />
              <div className="action-row">
                <button
                  className="primary"
                  disabled={Boolean(busy) || session.jdRaw.trim().length < 30}
                  onClick={analyze}
                >
                  <Sparkle />
                  Analyze role
                </button>
                {session.analysis && (
                  <button onClick={makePlan}>
                    <ArrowClockwise />
                    Propose edits
                  </button>
                )}
              </div>
              {session.analysis && (
                <AnalysisView
                  analysis={session.analysis}
                  onChange={(analysis) => patchSession({ analysis })}
                />
              )}{" "}
              {session.analysis && (
                <>
                  <label htmlFor="instruction">
                    Direction for this editing pass
                  </label>
                  <textarea
                    id="instruction"
                    className="short-input"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="Optional: emphasize evaluation work and technical leadership"
                  />
                </>
              )}
            </div>
          )}
          {session && tab === "edits" && (
            <div className="pane-content">
              <div className="pane-heading">
                <div>
                  <p className="kicker">Approval queue</p>
                  <h2>
                    {session.plan
                      ? `${session.plan.edits.length} proposed edits`
                      : "No plan yet"}
                  </h2>
                </div>
                {session.plan && (
                  <button className="quiet" onClick={approveSafe}>
                    Approve safe
                  </button>
                )}
              </div>
              {!session.plan ? (
                <div className="empty compact">
                  <p>Analyze the role and request a plan first.</p>
                  <button onClick={() => setTab("job")}>Return to job</button>
                </div>
              ) : (
                session.plan.edits.map((edit) => (
                  <EditCard
                    key={edit.edit_id}
                    edit={edit}
                    decision={session.decisions.find(
                      (item) => item.edit_id === edit.edit_id,
                    )}
                    onDecision={decide}
                  />
                ))
              )}
            </div>
          )}
          {session && tab === "cover" && (
            <div className="pane-content">
              <div className="pane-heading">
                <div>
                  <p className="kicker">Cover letter</p>
                  <h2>Ground every paragraph.</h2>
                </div>
              </div>
              <label htmlFor="cover-points">Specific points to include</label>
              <textarea
                id="cover-points"
                className="short-input"
                value={coverPoints}
                onChange={(e) => setCoverPoints(e.target.value)}
              />
              <button
                className="primary full"
                disabled={!session.analysis || Boolean(busy)}
                onClick={generateCover}
              >
                <Sparkle />
                {session.coverLetter ? "Regenerate letter" : "Generate letter"}
              </button>
              {session.coverLetter && (
                <CoverEditor
                  letter={session.coverLetter}
                  onChange={updateCover}
                />
              )}
            </div>
          )}
          {tab === "history" && (
            <div className="pane-content">
              <div className="pane-heading">
                <div>
                  <p className="kicker">Browser archive</p>
                  <h2>{sessions.length} saved sessions</h2>
                </div>
                <button className="primary small" onClick={newSession}>
                  <Plus />
                  New
                </button>
              </div>
              <div className="history-list">
                {sessions.map((item) => (
                  <article
                    key={item.sessionId}
                    className={
                      item.sessionId === session?.sessionId ? "current" : ""
                    }
                  >
                    <button
                      className="history-main"
                      onClick={() => loadSession(item)}
                    >
                      <strong>
                        {item.roleTitle || "Untitled application"}
                      </strong>
                      <span>{item.company || "Company not detected"}</span>
                      <time>
                        {new Date(item.updatedAt).toLocaleDateString()}
                      </time>
                    </button>
                    <button
                      className="icon-button"
                      title="Archive"
                      onClick={() =>
                        db
                          .putSession({ ...item, status: "archived" })
                          .then(refreshSessions)
                      }
                    >
                      <Archive />
                    </button>
                    <button
                      className="icon-button danger"
                      title="Delete"
                      onClick={() => deleteSession(item)}
                    >
                      <Trash />
                    </button>
                  </article>
                ))}
              </div>
              {sessionHistory.length > 0 && (
                <section className="revision-list">
                  <div className="revision-list__heading">
                    <h3>Current session revisions</h3>
                    <span>{sessionHistory.length}</span>
                  </div>
                  {sessionHistory.map((item) => {
                    const active = item.revisionId === revision?.revisionId;
                    return (
                      <button
                        key={item.revisionId}
                        className={active ? "active" : ""}
                        disabled={active}
                        onClick={() => restoreRevision(item)}
                      >
                        <span>{item.note}</span>
                        <time>{new Date(item.createdAt).toLocaleString()}</time>
                      </button>
                    );
                  })}
                </section>
              )}
            </div>
          )}
        </section>
        <section className="preview-pane">
          <div className="preview-toolbar">
            <div className="segmented">
              <button
                className={preview === "resume" ? "active" : ""}
                onClick={() => setPreview("resume")}
              >
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
                disabled={!revision}
                onClick={() => exportArtifact(preview)}
              >
                <DownloadSimple />
                PDF
              </button>
              <button
                disabled={!session?.coverLetter}
                onClick={() => exportArtifact("both")}
              >
                <FileArrowDown />
                Both
              </button>
              <button
                disabled={!revision}
                onClick={promoteBase}
                title="Create a local base version and download YAML"
              >
                <ClockCounterClockwise />
                Promote
              </button>
            </div>
          </div>
          {previewHtml ? (
            <iframe
              title={`${preview} preview`}
              sandbox=""
              srcDoc={previewHtml}
            />
          ) : (
            <div className="preview-empty">
              <FileText />
              <p>
                Create or open a session to preview the fixed resume template.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function AnalysisView({
  analysis,
  onChange,
}: {
  analysis: Analysis;
  onChange: (value: Analysis) => void;
}) {
  return (
    <section className="analysis">
      <div className="analysis-title">
        <h3>Role analysis</h3>
        <span>{analysis.seniority}</span>
      </div>
      <p>{analysis.summary}</p>
      <div className="requirements">
        {analysis.requirements.map((requirement, index) => (
          <div key={requirement.requirement_id} className="requirement">
            <select
              aria-label="Coverage"
              value={requirement.coverage}
              onChange={(event) => {
                const requirements = [...analysis.requirements];
                requirements[index] = {
                  ...requirement,
                  coverage: event.target.value as typeof requirement.coverage,
                };
                onChange({ ...analysis, requirements });
              }}
            >
              <option value="covered">Covered</option>
              <option value="partial">Partial</option>
              <option value="missing">Missing</option>
            </select>
            <textarea
              aria-label="Requirement"
              value={requirement.text}
              onChange={(event) => {
                const requirements = [...analysis.requirements];
                requirements[index] = {
                  ...requirement,
                  text: event.target.value,
                };
                onChange({ ...analysis, requirements });
              }}
            />
          </div>
        ))}
      </div>
      {analysis.red_flags.length > 0 && (
        <div className="red-flags">
          <strong>Review before applying</strong>
          {analysis.red_flags.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      )}
    </section>
  );
}
function CoverEditor({
  letter,
  onChange,
}: {
  letter: CoverLetter;
  onChange: (letter: CoverLetter) => void;
}) {
  return (
    <div className="cover-editor">
      <label>
        Greeting
        <input
          value={letter.greeting}
          onChange={(e) => onChange({ ...letter, greeting: e.target.value })}
        />
      </label>
      {letter.paragraphs.map((paragraph, index) => (
        <label key={paragraph.paragraph_id}>
          Paragraph {index + 1}
          <textarea
            value={paragraph.text}
            onChange={(e) => {
              const paragraphs = [...letter.paragraphs];
              paragraphs[index] = { ...paragraph, text: e.target.value };
              onChange({ ...letter, paragraphs });
            }}
          />
          <span className="citations">
            Evidence: {paragraph.evidence_ids.join(", ")}
          </span>
        </label>
      ))}
      <label>
        Closing
        <textarea
          value={letter.close}
          onChange={(e) => onChange({ ...letter, close: e.target.value })}
        />
      </label>
    </div>
  );
}

export default App;
