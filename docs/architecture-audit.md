# Tailor — Architecture Audit

Date: 2026-07-21
Scope: full read of `backend/app/**` and `frontend/src/**` at `b034577`.
Method: read every source file end-to-end; claims below are cited to `file:line` and, where behavioural, verified against library source or the data flow. Nothing here is inferred from names.

This audit grades findings, not the author. Several of these are the *same root cause* surfacing in different files — that's called out where it applies, because fixing the root collapses multiple rows at once.

---

## Summary

| # | Severity | Finding | Primary location |
|---|----------|---------|------------------|
| 1 | **Critical** | Edit-application logic implemented **4 times**; the copies already diverge | `engine.py:69`, `edit-engine.ts:33`, `edit-engine.ts:88`, `App.tsx:247` |
| 2 | **Critical** | Preview has 4 uncoordinated writers + optimistic DOM patch that a later re-render clobbers (race) | `App.tsx:155,665,684`, `App.tsx:247` |
| 3 | **High** | Optimistic apply succeeds while backend `derive` rejects → edit shown *and* error banner, inconsistent state | `App.tsx:658-677`, `engine.py:124` |
| 4 | **High** | CORS: `/export/both` page-count headers not exposed cross-origin → prod bug | `main.py:23-30`, `api.py:167-178` |
| 5 | **High** | Shadow-state antipattern: 4 `useState` mirrored by 4 `useRef`, hand-synced during render; `socketRef!==socket` guards copy-pasted at every callback | `App.tsx:115-122,442,456,480,486` |
| 6 | **Medium** | Backend `warnings` computed then dropped on the floor by the client | `engine.py:139`, `api.ts:78`, `App.tsx:215` |
| 7 | **Medium** | `tool.result` double-emitted for the 3 resume tools | `websocket/chat.py:115`, `resume.py:68,86,107` |
| 8 | **Medium** | Recursive id-tree-walk reimplemented **5 times** | `engine.py:40`, `edit-engine.ts:5`, `review-deck.tsx:23`, `resume.py:120`, `models.py:129` |
| 9 | **Medium** | 4 variants of "fetch + auth header + error parse" | `api.ts:21,42,90,105` |
| 10 | **Low** | `busy` prop hardcoded `false` → all busy/"Applying" UI in ReviewDeck is dead | `App.tsx:638`, `review-deck.tsx` |
| 11 | **Low** | Dead exports: `api.provider`, `decisionsForPlan` | `api.ts:67`, `chat.ts:154` |
| 12 | **Low** | Two page-count mechanisms: fragile `<section>/3` guess vs authoritative backend count | `App.tsx:173` vs `api.py:130` |
| 13 | **Low** | Backend emits `session.started`/`agent.started`/`session.completed`; client consumes none | `chat.py:62,76,98`, `chat.ts:94` |
| 14 | **Product** | Client carries revision-graph + content-hash versioning + a full edit engine for a disposable single-user tool | `App.tsx`, `types.ts:116` |
| 15 | **Product** | `template_version` plumbed everywhere; exactly one value is ever valid | `api.ts`, `rendering.py:15-16` |

Test-coverage gaps are in their own section at the end.

---

## Critical

### 1. Edit-application logic exists in four places and has already drifted

The rules for turning `(resume, plan, decision)` into a new resume are written out four independent times:

- `backend/app/engine.py:69` — `_apply` / `derive_resume`. **The authority.**
- `frontend/src/edit-engine.ts:33` — `apply` / `deriveResumeLocal`. Hand-port of the same op switch.
- `frontend/src/edit-engine.ts:88` — `applyDecisionOnto`. A *third* variant that applies one decision incrementally instead of replaying.
- `frontend/src/App.tsx:247` — `patchPreview`. A *fourth* copy of the op switch that mutates the iframe DOM.

They have already diverged:

- **Protected fields.** `engine.py:89` rejects a `rewrite_text` on `name/email/phone/company/dates/institution`. The client (`edit-engine.ts:45`) has **no such check**. The client will apply an edit the server refuses.
- **Warnings.** `engine.py:139` accumulates `effective.warnings`; neither client engine looks at warnings at all.
- **`replace_collection` comparison.** Server uses Python deep equality (`engine.py:102`); client uses `JSON.stringify` (`edit-engine.ts:56`). Equivalent *today* for ordered `list[str]`, but they will drift the moment the shape changes.

**Why it's critical:** this is the source of Findings 2 and 3, and every future edit op has to be written correctly in four dialects (Python dict-mutation, TS dict-mutation, TS incremental, DOM mutation) or the UI lies to the user.

**Fix (direction, not a patch):** make the server the single source of truth for derivation and delete `deriveResumeLocal` + `applyDecisionOnto`, *or* extract one shared spec and generate/port mechanically with a cross-check test (see Finding 16). If optimistic UI must stay, keep exactly one client engine and drive the preview from its output rather than a parallel DOM-patching engine. Do not keep four.

### 2. The preview is written by four uncoordinated paths; the optimistic DOM patch races a re-render that overwrites it

`previewHtml` / the iframe DOM is mutated by:

1. the effect at `App.tsx:155` (fires on `revision`/`preview`/`coverLetter`), which `setPreviewHtml` from a server render;
2. `patchPreview` at `App.tsx:665`, which mutates the iframe DOM in place;
3. the fallback at `App.tsx:670` and the `onClose` handler at `App.tsx:684`, each `setPreviewHtml`;
4. `validatePlanDecisions` (`App.tsx:213`), which ~500 ms later may mint a new `Revision`, whose state change re-fires path (1).

Concrete sequence after approving an edit: `patchPreview` mutates the DOM immediately → 500 ms later `validatePlanDecisions` creates a revision → effect (1) re-renders the whole `srcDoc` → the optimistic patch is discarded and the iframe reloads (`onLoad` → `focusPreviewTarget`, `App.tsx:785`). Decisions made faster than the 500 ms debounce interleave writer (2) and writer (1) with no ordering guarantee. The `cancelled` flag at `App.tsx:157` only protects a single effect run — it does nothing across these four independent writers.

**Why it's critical:** this is the visible "race condition." Best case it's a flicker/reload; worse case the preview and `workingResume` disagree for a window.

**Fix:** one writer. Derive `previewHtml` from a single source (`workingResume`) via one effect, and drop in-place DOM patching — or commit to DOM patching and never re-render `srcDoc` underneath it. Pick one owner for the iframe.

---

## High

### 3. Optimistic apply and authoritative derive can disagree, leaving edit-shown + error-banner at once

In `onDecision` (`App.tsx:645`): the client optimistically updates `workingResume` (via `applyDecisionOnto`/`deriveResumeLocal`) and patches the preview, then schedules `validatePlanDecisions` → `api.derive` (`App.tsx:677`, `213`). If the server raises `EditConflict` (409 — e.g. the protected-field gap from Finding 1, or a stale `before`), `api.derive` throws, caught at `App.tsx:240` → `setError("Could not validate edits")`. But `workingResume` and the preview were **already** updated optimistically. The user sees the edit applied *and* an error, with no new revision created.

**Fix:** resolve Finding 1 (if the server is the authority, don't show the edit until it confirms), or make the client run the *exact* same validation before optimistic apply and roll back on server rejection.

### 4. `/export/both` page-count headers are not exposed cross-origin (production bug)

`api.py:167-178` sets `Access-Control-Expose-Headers: X-Resume-Page-Count, ...` on the response. But `starlette/middleware/cors.py` builds its own value from the middleware's `expose_headers` and does `headers.update(self.simple_headers)` (line 153), which **overwrites** the route's header. The middleware config (`main.py:29`) lists only `Content-Disposition, X-Page-Count, X-Content-Hash` — not `X-Resume-Page-Count`.

Result: for the cross-origin deployment described in the README (Vercel frontend, separate backend), the browser cannot read `X-Resume-Page-Count`, so `App.tsx:548` gets `null` and the "Both" export always reports "Download ready" with no page count. The per-route `Access-Control-Expose-Headers` in `api.py` (both `_pdf_response` and `export_both`) are dead — the middleware always wins.

**Fix:** add `X-Resume-Page-Count, X-Cover-Page-Count, X-Resume-Hash, X-Cover-Hash` to the single `expose_headers` list in `main.py`, and delete the per-route `Access-Control-Expose-Headers` since they never take effect.

### 5. Shadow-state antipattern is the root of the race-proneness

`App.tsx:115-122` mirrors four `useState`s (`session`, `revision`, `workingResume`, `messages`) with four `useRef`s, **assigned during render** (`sessionRef.current = session`, etc.). Every mutation then dual-writes (`workingResumeRef.current = x; setWorkingResume(x)` — ~10 sites). Every async callback re-checks `socketRef.current !== socket || activeAssistantId.current !== assistantId` (`App.tsx:442,456,480,486`) as a hand-rolled mutex.

Needing that guard at *every* callback is the tell: the state model invites stale-closure races, so each call site patches it manually. Writing refs during render is also a React anti-pattern (works here only because they're latest-value mirrors).

**Fix:** move the turn/session lifecycle into a `useReducer` or a small state machine (idle → connecting → streaming → complete) with a single owner, or an external store (Zustand/`useSyncExternalStore`). That removes the ref-mirroring and the per-callback guards together. This is the enabling refactor for Findings 2 and 3.

---

## Medium

### 6. Backend `warnings` are computed then discarded

`derive_resume` returns `warnings` (`engine.py:139`), `/api/resume/derive` returns them (`api.py:104`), `api.ts:78` types them — and `validatePlanDecisions` uses only `.resume` and `.content_hash` (`App.tsx:215-217`). The warnings channel — arguably the point of typed edit validation — is dead. Either surface them or stop computing them.

### 7. `tool.result` emitted twice for the resume tools

`websocket/chat.py:111-115` blanket-emits `tool.result` for **every** `FunctionToolResultEvent` (comment there says so). But `resume.py` also manually emits `tool.result` for `search_resume` (`:68`), `inspect_resume_evidence` (`:86`), and `inspect_job_requirements` (`:107`). So those three double-fire. The tailoring tools (`tailoring.py`) emit domain events instead and rely on the blanket one. Harmless only because the frontend `completeTool` (`chat.ts:76`) is idempotent — but it's inconsistent and confusing. Pick one place to close tool activity: either the blanket hook or per-tool, not both.

### 8. The same recursive id-tree-walk is written five times

`_find` (`engine.py:40`), `find` (`edit-engine.ts:5`), `findAtom` (`review-deck.tsx:23`), `_resume_atoms.visit` (`resume.py:120`), `unique_ids.visit` (`models.py:129`) are all "walk the resume tree looking at `.id`". Five copies, three languages-of-idiom. Extract one per language (`walk_by_id` in Python, one in TS) and reuse.

### 9. Four variants of fetch + auth + error-parse

`request` (`api.ts:21`), `blobRequest` (`api.ts:42`), and the inline fetches in `previewResume` (`api.ts:90`) and `previewCover` (`api.ts:105`) each re-implement "set auth header, POST JSON, parse error `detail`". `previewResume`/`previewCover` differ only in body and return type. Collapse to one `request` that can return `text`/`blob`/`json`.

---

## Low

### 10. `busy` is hardcoded `false`, so ReviewDeck's busy UI is unreachable

`App.tsx:638` passes `busy={false}`. All of `review-deck.tsx` `disabled={busy}`, the guard at `:172`, and the `busy ? "Applying"` label (`:242`) can never trigger, because decision application is synchronous-optimistic. Either wire `busy` to the in-flight `validatePlanDecisions` or delete the prop and its branches.

### 11. Dead exports

`api.provider` (`api.ts:67`) — never called anywhere. `decisionsForPlan` (`chat.ts:154`) — never called anywhere. Also note `api.provider`'s return type (`{model, ready}`) doesn't even match the backend (`{model, endpoint, ready}`, `api.py:85`), so it was stale before it was dead. Delete both.

### 12. Two disagreeing page-count mechanisms

`estimatedPages` (`App.tsx:173`) guesses pages as `count('<section') / 3` on the preview HTML — unrelated to how WeasyPrint actually paginates. The backend already returns the exact count (`X-Page-Count`, `api.py:130`). The toolbar shows the guess ("About N pages"); export shows the truth. Drop the guess or reconcile them.

### 13. Lifecycle events emitted but never consumed

Backend sends `session.started` (`chat.py:62`), `agent.started` (`:76`), `session.completed` (`:98`). `applyServerEvent` (`chat.ts:94`) has no case for any of them (fall through `default`), and `App.tsx`'s `onEvent` doesn't special-case them. Three events crossing the wire that nothing reads. Either use them (e.g. distinguish "connecting" from "thinking") or stop sending them.

---

## Product-direction observations (judgment calls, not defects)

These are decisions, not bugs. Flagging the mismatch; the call is yours.

### 14. The client is a distributed-systems client for a single-tab tool

The README frames Tailor as personal, disposable, single-user, stateless-backend. Yet the browser maintains a `revisions` map with `parentRevisionId` chains (`types.ts:116`, `App.tsx:129`), `reviewBases` snapshots keyed by content hash (`App.tsx:128`), content-hash versioning, and a full reimplementation of the server's edit engine — machinery you'd build for multi-user collaborative editing with server persistence. For one person editing one résumé in one tab that discards on refresh, most of it is cost without payoff. Whether the fix is "the product should do less" or "keep the features, delete the client-side engine and let the stateless server derive" is a real fork — they lead to different codebases.

### 15. Version scaffolding with exactly one version

`template_version` is threaded through `SnapshotRequest`, every export request, `previewResume`, `previewCover`, and validated in `rendering.py:15-16` — where the only accepted values are `{"resume-v1"}` and `{"cover-v1"}`. `resume.template_version` is even read client-side to populate the request that the server then re-validates. It's plumbing for a second template that doesn't exist. Fine to keep as a deliberate extension point; worth naming as such so it isn't mistaken for load-bearing.

---

## Test-coverage gaps

Current: `test_engine.py` (133 lines) covers the server engine reasonably; `edit-engine.test.ts` covers `deriveResumeLocal` (3 cases); `test_websocket_security.py`, `test_render.py`, `test_api.py`, `test_agent_architecture.py` exist.

Not covered, and directly relevant to the findings above:

- **16. No cross-check that the client and server engines agree.** Given Finding 1, the single highest-value test is a golden fixture run through both `derive_resume` (Python) and `deriveResumeLocal` (TS) asserting identical output — it would have caught the protected-field drift. Without it, the four engines drift silently.
- **17. `applyDecisionOnto` and `patchPreview` are untested.** The incremental path and the DOM-patching path — the two most race-prone pieces — have zero tests.
- **18. No test for the optimistic-then-rejected flow** (Finding 3): approve an edit the server 409s, assert the UI rolls back rather than showing edit + error.
- **19. No CORS/expose-headers test** (Finding 4): an integration test asserting the browser-visible headers on `/export/both` would have caught it.

---

## Suggested order of attack

1. **Finding 5** (state machine) first — it's the enabler; Findings 2 and 3 mostly dissolve once there's one owner of turn/preview state.
2. **Finding 1** — decide "server is authority" vs "one shared client engine", then delete the extras. Add test 16 as the guardrail.
3. **Finding 4** — one-line-ish CORS fix, real prod bug, cheap.
4. Mediums 6–9 and the dead-code Lows (10–13) are independent cleanups that can go anytime.
5. Products 14–15 are a conversation to have before, not during, the refactor — they change how much of 1 and 5 you even keep.
