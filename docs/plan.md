# Tailor — Product and Architecture Plan

**Project codename:** `tailor`  
**Author:** Bukunmi Akinyemi  
**Status:** Design baseline — v1.1  
**Last updated:** 2026-07-20  
**Starting artifact:** `C:\Users\BUNKUNMI\Downloads\resume0726.pdf`  
**Deployment:** Vercel frontend, Hugging Face Spaces backend  
**Model provider:** ModelScope API Inference

## 1. Executive Summary

Tailor is a human-in-the-loop resume tailoring application. It starts from one canonical, structured resume and one frozen visual template recreated from the supplied reference PDF. For each pasted job description, an agent analyzes the role and proposes grounded, structured content edits. The user approves, rejects, or modifies each proposal. The resulting working resume is rendered immediately in the browser and exported to PDF only when requested.

The system separates four concerns:

1. **Canonical content:** a repository-tracked YAML resume with stable identifiers.
2. **Presentation:** a fixed, versioned HTML/CSS template based on `resume0726.pdf`.
3. **Session state:** browser-persisted revisions, proposed edits, decisions, and export metadata.
4. **Model inference:** ModelScope API calls made only by the backend.

The agent never edits files directly. It returns typed proposals. The backend validates those proposals and derives a working snapshot only from approved decisions supplied by the browser. The repository YAML changes only through a deliberate human edit in the local repository; the in-application base-promotion flow creates a browser-local base version and downloads replacement YAML.

The application accepts the current three-page resume as its baseline. Page count is informational and never blocks export.

## 2. Product Goal

Build a dependable resume-tailoring workflow that:

- preserves the design and structure of the supplied resume across every session;
- prevents silent changes and unsupported claims;
- makes multiple rounds of revision safe and recoverable;
- provides a fast browser preview without repeatedly generating PDFs;
- produces a matching cover letter grounded in resume evidence;
- persists every meaningful session revision;
- works with a Vercel-hosted React frontend and a FastAPI backend on Hugging Face Spaces;
- uses a ModelScope API token without exposing it to the browser;
- does not require a Git push for normal use or session persistence.

## 3. Product Principles and Invariants

### 3.1 Fixed-template invariant

Every base resume, working draft, browser preview, and exported PDF is rendered through the same versioned resume template. Session data and model output can modify approved content fields only. They cannot provide or change HTML, CSS, fonts, margins, section components, or layout properties.

### 3.2 Frozen-session-baseline invariant

Every session is pinned to the exact base-resume version and template version that existed when the session was created. Later base changes do not silently alter an existing session.

### 3.3 Explicit-approval invariant

No agent proposal affects the working resume until the user approves it or replaces it with a human-authored modification and approves that modification.

### 3.4 Canonical-update invariant

Approving an edit for a job application does not update the canonical resume. Updating the canonical resume is a separate, explicit action with its own preview and confirmation.

### 3.5 Persistent-revision invariant

The model's conversation state is never treated as durable memory. The browser stores session snapshots and change metadata in IndexedDB. The current working resume can be reconstructed after a browser refresh, backend restart, or later return from the same browser profile.

### 3.6 Evidence invariant

Agent-generated claims must identify the canonical or session evidence atoms from which they were derived. Evidence linkage assists review and deterministic checking; it does not remove the human approval requirement.

### 3.7 Export invariant

PDF generation occurs only when explicitly requested or when a final-layout confirmation is requested. Browser preview remains the default interactive rendering path.

## 4. Scope

### 4.1 Version 1 scope

- Import the supplied resume into structured YAML.
- Recreate its visual design as one fixed HTML/CSS template.
- Paste a job description manually.
- Analyze role requirements and keyword coverage.
- Propose typed, evidence-linked resume edits.
- Approve, reject, or modify individual edits.
- Support multiple agent passes and human revisions in one session.
- Autosave session revisions.
- Restore, compare, and revert revisions.
- Render the working resume in a browser preview.
- Export the selected revision to PDF.
- Generate and revise an evidence-linked cover letter.
- List and reopen prior sessions.
- Explicitly promote selected session changes into a new base-resume version.

### 4.2 Non-goals for version 1

- Multiple visual resume templates.
- Automatic job-board scraping.
- Automatic application submission.
- Multi-user accounts and collaboration.
- Claims of exact ATS scoring.
- A hard one-page, two-page, or three-page limit.
- Automatic promotion of tailored content into the canonical resume.
- Allowing the model to edit template or repository files.
- Running a local language model on the Hugging Face Space.

## 5. Starting Artifacts and Repository Sources

The supplied PDF is copied into the repository as a permanent visual and content reference. Its content is extracted once into canonical YAML. Runtime tailoring uses the YAML, not repeated PDF extraction.

```text
tailor/
├── canon/
│   ├── resume.yaml
│   ├── resume.schema.json
│   └── reference/
│       └── resume0726.pdf
├── backend/
├── frontend/
├── docs/
│   └── plan.md
└── templates/
```

The artifacts have distinct roles:

| Artifact | Purpose | Runtime mutability |
|---|---|---|
| `canon/reference/resume0726.pdf` | Original content and visual reference | Never modified by the application |
| `canon/resume.yaml` | Repository canonical seed | Modified only by a deliberate human edit in the local repository; in-app promotion downloads replacement YAML |
| Resume HTML/CSS/fonts | Fixed presentation system | Never modified by an agent or session |
| Browser IndexedDB | Plans, decisions, revisions, cover letters, and export metadata | Updated during normal use |

The starting PDF is three A4 pages and uses Times New Roman with limited Arial usage. The public repository uses Tinos and Arimo as Apache 2.0 metric-compatible substitutes rather than redistributing Microsoft font files. Three pages are accepted as the initial layout. Tailored drafts may remain three pages or grow or shrink when content changes. The UI reports the resulting page estimate or export page count but does not block export.

## 6. System Context

```text
┌─────────────────────────────────────────────────────────────┐
│ Vercel                                                     │
│ React + Vite + TypeScript                                  │
│                                                            │
│ JD input · analysis · edit decisions · revision history    │
│ browser resume preview · cover letter · export controls    │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS JSON API
                           │ authenticated application requests
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Hugging Face Space — Docker SDK                            │
│ FastAPI backend                                             │
│                                                            │
│ Agent orchestration · guardrails · edit validation          │
│ Jinja rendering · WeasyPrint on-demand export               │
│ stateless request processing                                │
└──────────────┬────────────────────────────┬─────────────────┘
               │
               │ OpenAI-compatible API
               ▼
┌──────────────────────────┐
│ ModelScope API Inference │
│ configured model chain   │
└──────────────────────────┘
```

The Vercel application never receives the ModelScope token. All model calls originate from the Hugging Face Space. IndexedDB in the user's browser is the authoritative session store; the backend does not retain session state between requests.

## 7. Deployment Architecture

### 7.1 Frontend on Vercel

The frontend is a static Vite application deployed through Vercel.

Responsibilities:

- render application UI;
- hold temporary form state;
- call the FastAPI backend;
- display browser-rendered resume HTML in a sandboxed preview frame;
- show save, generation, and export states;
- never contain provider tokens or backend secrets.

Configuration:

- `VITE_API_BASE_URL` identifies the deployed backend URL when direct cross-origin requests are used.
- Alternatively, Vercel can rewrite `/api/*` to the Hugging Face Space, giving the browser a same-origin API surface.
- Only non-secret values may use `VITE_` variables because Vite exposes them to client code.

Recommended request path:

```text
Browser → https://tailor.example/api/* → Vercel rewrite → HF Space
```

This avoids hard-coding the Space URL throughout the frontend and simplifies CORS. The backend must still validate the expected origin and must not assume a rewrite is an authentication mechanism.

### 7.2 Backend on Hugging Face Spaces

Use a Docker Space because the backend requires:

- FastAPI;
- system packages needed by WeasyPrint;
- embedded fonts;
- control of the runtime entrypoint;
- a predictable stateless runtime for model, validation, rendering, and export requests.

The version 1 Space is public. Its repository source, Docker configuration, template files, canonical YAML, and reference PDF are therefore publicly readable. This is an accepted deployment tradeoff. ModelScope credentials, passphrase hash, and token-signing secret remain private in Hugging Face Space Secrets. Tailor's application authentication protects API use and quota consumption; it does not make files committed to a public Space repository private.

The backend image contains application code, canonical assets, and template assets. Runtime session data must not rely on the Space's default filesystem because ordinary Space disk is ephemeral and can be lost on restart or rebuild.

Required backend configuration:

| Variable | Classification | Purpose |
|---|---|---|
| `MODELSCOPE_API_TOKEN` | Secret | Authenticate ModelScope inference calls |
| `MODELSCOPE_BASE_URL` | Variable | ModelScope OpenAI-compatible API base URL |
| `PRIMARY_MODEL_NAME` | Variable | Primary ModelScope model ID |
| `SECONDARY_MODEL_NAME` | Variable | Secondary ModelScope model ID |
| `FALLBACK_MODEL_BASE_URL` | Variable | Existing independent llama.cpp Space endpoint |
| `FALLBACK_MODEL_NAME` | Variable | Nemotron emergency-fallback model ID |
| `MODEL_FALLBACK_ENABLED` | Variable | Enable or disable the configured fallback chain |
| `ALLOWED_ORIGINS` | Variable | Vercel production and preview origins |
| `APP_ENV` | Variable | Local, preview, or production behavior |
| `TAILOR_PASSWORD_HASH` | Secret | Argon2id hash of the personal application passphrase |
| `AUTH_SIGNING_SECRET` | Secret | Sign and verify short-lived access tokens |
| `AUTH_TOKEN_TTL_HOURS` | Variable | Access-token lifetime, initially 8–12 hours |

The ModelScope token is configured through Hugging Face Space Secrets and is never committed to Git.

### 7.3 Stateless backend and browser persistence

The backend does not require durable disk. Each request includes the exact validated inputs needed for analysis, planning, preview rendering, or export. Temporary files created for PDF generation are deleted after the response completes.

IndexedDB in the stable production frontend origin stores:

- job descriptions and corrected analyses;
- plans and decision sets;
- complete resume revision snapshots;
- cover-letter revisions;
- base versions promoted inside the application;
- export metadata.

PDFs are returned directly to the browser for download and are not archived by the backend. The frontend supports JSON export and import of application state for manual backup and migration. Clearing browser data, using a different browser profile, or changing the frontend origin loses locally stored state unless a backup was exported.

### 7.4 Access control

Although the product is single-user and stateless, its ModelScope-backed routes must not be available for unrestricted public use.

The backend stores an Argon2id passphrase hash and an independent token-signing secret in Hugging Face Space Secrets. The frontend displays a custom passphrase dialog and sends the passphrase once over HTTPS to `POST /api/auth/login`. After successful constant-time verification, the backend returns a short-lived signed bearer token.

The frontend stores the token in `sessionStorage`, not IndexedDB or `localStorage`, and sends it as an `Authorization: Bearer` header on protected requests. Closing the tab, logging out, or token expiry requires authentication again. The reusable passphrase is never stored by the frontend after the login request completes.

The backend remains stateless: it verifies the token signature and expiry without a session database. Login attempts use an in-memory, best-effort rate limiter, authentication failures are generic, allowed frontend origins are explicit, and authorization headers are never logged. The limiter may reset when the stateless Space restarts, which is acceptable for the single-user v1 deployment. Health, readiness, login, and an allowlisted non-sensitive public-configuration route are public; every other route requires authentication.

## 8. ModelScope Agent Integration

### 8.1 Provider interface

ModelScope API Inference exposes OpenAI-compatible interfaces for supported language models. The backend should isolate provider-specific details behind a small adapter:

```text
ModelProvider
├── generate_tailor_plan(request) -> TailorPlanDraft
├── generate_cover_letter(request) -> CoverLetterDraft
├── health_check() -> ProviderStatus
└── model_metadata() -> ModelMetadata
```

Pydantic AI may be used if its custom OpenAI-compatible provider path works reliably with the selected ModelScope model. Direct use of the OpenAI-compatible Python SDK is an acceptable fallback and may be simpler. Pydantic models remain the authoritative validation layer regardless of the client library.

### 8.2 Selecting the best available model

“Best available” must be operationally defined rather than permanently tied to one model name. ModelScope's supported API-Inference models and usage characteristics can change.

The accepted initial model chain is:

1. `Qwen/Qwen3.5-397B-A17B` as the primary ModelScope model;
2. `Qwen/Qwen3.5-35B-A3B` as the secondary ModelScope model;
3. the existing `NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf` llama.cpp Hugging Face Space as the independent emergency fallback.

The configured model IDs remain environment-controlled so the chain can change without application code changes. Phase 0 evaluates the two ModelScope candidates against the same tailoring fixtures. The 397B model remains primary only if it materially outperforms the 35B model in groundedness and structured-output reliability. Every run records and displays the provider and model that produced it. Emergency-fallback output defaults to `risk: review`.

Candidate models are evaluated against a fixed resume-tailoring dataset using these criteria:

| Criterion | Priority |
|---|---|
| Structured-output success rate | Critical |
| Unsupported-claim rate | Critical |
| Evidence-ID accuracy | Critical |
| Meaning preservation | Critical |
| JD relevance of proposed edits | High |
| Conflict-free edit plans | High |
| Instruction adherence | High |
| Latency | Medium |
| Token and quota consumption | Medium |

The selected model must pass the evaluation suite, not merely be the largest or newest model. Reasoning models may require provider-specific parameters, so the adapter supports model-specific request configuration without leaking it into domain services.

Every generated plan records:

- provider name;
- model ID;
- prompt version;
- request timestamp;
- response identifier when available;
- latency;
- token usage when available;
- validation attempt count.

### 8.3 Quotas and failure behavior

ModelScope API Inference is quota-limited and supported models evolve. The UI and backend must handle:

- invalid or expired token;
- unsupported or removed model ID;
- daily or per-model quota exhaustion;
- rate limiting;
- provider timeout;
- malformed structured output;
- partial network failure;
- model refusal;
- provider-specific incompatibility with response-format parameters.

Provider failures never corrupt a session. A failed run is recorded separately and the previous working revision remains active. The user may retry the same run or select a different configured model.

### 8.4 Structured output strategy

Native ModelScope `response_format: json_schema` is not a production dependency. A live probe on 2026-07-20 against the ModelScope connection and `Qwen/Qwen3-235B-A22B-Instruct-2507` accepted the request but returned no choices. The same endpoint returned parseable JSON when given strict JSON-only instructions.

The production strategy is:

1. send a strict JSON-only prompt containing the required response shape;
2. extract and parse the JSON response;
3. validate it with the authoritative Pydantic model;
4. on validation failure, make one bounded repair request containing the validation errors;
5. after repeated invalid output, advance to the next configured model;
6. if no configured model returns valid output, fail the run without creating a plan or changing the active revision.

Native schema mode may be enabled later as an optimization for a specific model only after a live compatibility test. It does not replace backend Pydantic validation.

The backend never applies raw model prose as an edit plan. It parses the response, validates it, normalizes it, runs deterministic guardrails, and returns the proposed plan. The frontend persists a plan in IndexedDB only after the validated response succeeds.

## 9. Canonical Resume Model

### 9.1 Canonical YAML

`canon/resume.yaml` is the repository-tracked seed and portable representation of the base resume. Every addressable content item has a permanent stable ID. In the deployed application, IndexedDB identifies the current browser-local operational base version because writing into the Space checkout would not provide durable repository history.

Representative structure:

```yaml
schema_version: 1
base_version: 1

meta:
  name: "Bukunmi Enoch Akinyemi"
  headline: "AI Engineer · Legal Tech"
  contact:
    location: "Osun, Nigeria · Remote"
    phone: "+234 913 709 9774"
    email: "bkakinyemi21@gmail.com"
    links:
      - id: link.linkedin
        label: "LinkedIn"
        url: "https://www.linkedin.com/"

profile:
  id: profile.main
  text: "First Class law graduate turned AI engineer who builds production legal AI systems."
  evidence_ids:
    - exp.qanooni
    - exp.casesimpli
    - proj.citation_benchmark

experience:
  - id: exp.qanooni
    company: "Qanooni AI"
    title: "Software Engineer (Legal AI)"
    location: "Dubai-based, Remote"
    start_date: "2025-10"
    end_date: "2026-06"
    tagline:
      id: exp.qanooni.tagline
      text: "Built production AI systems for legal drafting and review at scale."
    bullets:
      - id: exp.qanooni.b1
        text: "Integrated DocETL pipeline orchestration (Split → ParallelMap → CodeMap → Reduce)."
        tags:
          - pipelines
          - docetl
          - orchestration
```

The final schema must represent all content visible in the supplied PDF, including:

- header and contact links;
- profile;
- experience roles, dates, taglines, bullets, and stack lines;
- projects and their individual links;
- education, honors, GPA, thesis, and current-study status;
- technical skill groups;
- certifications and dates;
- leadership;
- languages.

### 9.2 Stable ID rules

- IDs are permanent once published in a base version.
- Text may change without changing its ID when it remains the same semantic item.
- Deleted IDs are retired and never reused.
- New canonical items receive new IDs.
- Session-only additions receive session-scoped IDs and do not become canonical IDs unless promoted into a new base version.
- Base content IDs come from validated repository YAML. The frontend generates session, plan, decision-set, revision, cover-letter, and export-record IDs. The backend generates or normalizes IDs for validated agent-proposed operations and session-only content; IDs supplied by raw model output are never trusted directly.

### 9.3 Base versions

The repository YAML seeds the first base version, while IndexedDB retains immutable browser-local versions used by sessions and identifies the current operational base.

```text
BaseResumeVersion
├── version_id
├── schema_version
├── resume_snapshot
├── content_hash
├── template_version
├── created_at
├── previous_version_id
├── change_note
└── source: repository_import | direct_edit | promoted_session_change
```

At application startup, the backend validates `resume.yaml` and exposes the validated repository base plus its hash. The frontend registers that seed in IndexedDB when it is not already present. A newly deployed repository seed does not silently replace existing sessions or a newer browser-local base created in the application.

### 9.4 Updating the base

Two supported paths exist:

1. A human directly edits `canon/resume.yaml` in the local repository; after deployment, the backend validates and exposes that repository seed and the frontend registers it as a base version.
2. A human selects one or more session changes, previews their effect on the base, and explicitly confirms promotion.

The second path writes a new browser-local base version to IndexedDB only after confirmation. It also downloads a YAML representation that can later replace `canon/resume.yaml` in the local repository. The deployed backend does not attempt to commit or push Git changes. A local Git commit or push remains optional and outside normal session saving.

## 10. Fixed Template and Rendering

### 10.1 Template ownership

The template is repository code and has its own version identifier. It contains no agent-generated markup.

```text
backend/render/templates/
├── resume-v1/
│   ├── resume.html
│   └── resume.css
├── cover-v1/
│   ├── cover.html
│   └── cover.css
└── fonts/
```

Template versions are immutable repository assets. A design change adds a new directory such as `resume-v2`; it never overwrites `resume-v1`. Preview and export requests identify the pinned template version, and the backend rejects an unavailable version rather than silently rendering with the latest template. Retaining old template directories keeps historical sessions reproducible.

The template preserves the reference resume's:

- A4 geometry;
- header alignment;
- typography hierarchy;
- section components and heading treatment;
- role and date layout;
- bullet indentation;
- project presentation;
- link styling;
- vertical rhythm;
- page-break preferences.

### 10.2 Font strategy

The reference PDF uses Times New Roman regular, bold, and italic faces, with limited Arial usage. Because the Hugging Face Space repository is public, Microsoft font files are not copied from Windows or extracted from the subset fonts embedded in the PDF.

The template bundles:

- Tinos Regular, Bold, Italic, and Bold Italic as the Times New Roman substitute;
- Arimo Regular, Bold, Italic, and Bold Italic as the Arial substitute;
- the Apache 2.0 license text and font attribution.

Tinos and Arimo are metric-compatible with Times New Roman and Arial respectively, which helps preserve character widths and pagination. Their glyph outlines are not identical. Template acceptance therefore requires close agreement in structure, hierarchy, line wrapping, spacing, and pagination rather than pixel-identical letterforms.

### 10.3 Structural rules

The agent cannot:

- add arbitrary visual sections;
- rename section headings;
- provide HTML or CSS;
- change fonts, margins, colors, columns, or spacing;
- move content outside the section types allowed by the schema;
- hide the header or contact block;
- create session-specific templates.

The agent is not constrained to the base content order. It may propose reordering sections, experience roles, projects, bullets, skill groups, skills, certifications, and other schema-defined items when the result is more relevant to the job description. It may also select, omit, rewrite, or emphasize content and adopt exact JD terminology when cited evidence supports the same underlying claim.

Every adaptive ordering or terminology change remains a typed proposal requiring approval. The renderer continues to use the same fixed component for each section and item type regardless of approved order. Hard constraints are truthfulness, evidence linkage, protected factual fields, schema-valid structure, and human approval—not chronology or base ordering.

### 10.4 Browser preview

The hot path never invokes WeasyPrint:

```text
Approved session revision
        ↓
Jinja render using fixed template
        ↓
HTML response
        ↓
sandboxed iframe in the Vercel frontend
```

The preview uses the same content, template, CSS tokens, fonts, A4 width, and print-oriented styles as export. It updates after decisions or edits without generating a PDF.

The browser and WeasyPrint are different rendering engines, so exact line breaks and pagination may differ slightly. The product guarantees consistent design and structure, not identical browser and PDF pixels. The PDF export is authoritative for final pagination.

The preview frame must:

- be sandboxed;
- contain no scripts;
- use a strict content security policy where practical;
- render model and user text only as escaped content;
- use validated links;
- prevent arbitrary external resource loading.

### 10.5 Page reporting

The browser may display an approximate page count based on A4 page shells or measured content height. It is labeled as an estimate.

On export, WeasyPrint returns the authoritative integer page count. The UI may report differences from the base:

```text
Base: 3 pages · Current export: 4 pages
```

No page count disables export.

### 10.6 PDF export

```text
POST export request
        ↓
Load exact revision snapshot
        ↓
Render fixed Jinja template
        ↓
WeasyPrint
        ↓
PDF + page count + artifact hash
```

The export record includes:

- session ID;
- revision ID;
- base version ID and hash;
- template version;
- renderer version;
- model and prompt metadata for agent-authored content;
- artifact hash;
- page count;
- download filename;
- creation timestamp.

WeasyPrint and its system dependencies are pinned because renderer upgrades can change layout. Visual regression tests are required before updating the renderer version.

## 11. Session, Revision, and Memory Model

### 11.1 Session state

```text
Session
├── session_id
├── created_at
├── updated_at
├── status
├── base_version_id
├── template_version
├── jd_raw
├── company
├── role_title
├── active_revision_id
└── latest_plan_id
```

### 11.2 Revision state

Every meaningful accepted state is stored as a complete structured snapshot plus metadata.

```text
ResumeRevision
├── revision_id
├── session_id
├── revision_number
├── parent_revision_id
├── resume_snapshot
├── content_hash
├── source: base | decisions | human_edit | agent_pass | restore
├── change_summary
├── created_at
└── created_by: system | agent | human
```

Complete snapshots are preferred because a resume is small and snapshots make restoration and export reliable. Edit metadata is retained alongside snapshots for explanation and diffing.

### 11.3 Multiple agent passes

Every new agent pass targets the current active revision, not the original base unless explicitly requested.

```text
Revision 0: frozen base
Revision 1: first approved plan
Revision 2: human-modified profile
Revision 3: second agent pass against Revision 2
Revision 4: restored Revision 2 with selected new edits
```

The request sent to the agent contains:

- original job description;
- current resume revision;
- current JD analysis;
- relevant prior decisions, especially rejected proposals;
- the user's new revision instruction;
- base evidence accessible to the current revision.

Every proposed edit includes an expected current value, item hash, collection hash, or anchor appropriate to its operation. Stale proposals fail validation instead of being silently applied.

### 11.4 Autosave

Decision state autosaves after:

- approval or rejection;
- human modification;
- bulk decision;

A new resume revision snapshot is created only when the derived content hash changes. A rejection or decision-only change with an unchanged working resume updates the decision set without creating a duplicate resume snapshot. Restoring history updates the active revision pointer or creates an explicit branch revision according to the restore action.

Successful agent passes save plans and run metadata, cover-letter edits save cover-letter revisions, and successful exports save export records. These records do not create resume revisions unless resume content also changed.

Rapid UI actions may be debounced briefly, but the interface exposes `Saving`, `Saved`, and `Save failed` states. Local compare-and-swap occurs inside an IndexedDB transaction using the expected active revision ID. `BroadcastChannel` notifies other tabs, and Web Locks are used where available to serialize session writes. The backend can verify that a plan matches the supplied snapshot hash, but it cannot determine the browser's current local revision.

### 11.5 Undo, restore, and branching

- Undo selects or creates a revision derived from an earlier snapshot.
- Restoring history never deletes newer revisions.
- A new agent pass after restoring an old revision creates a new branch through `parent_revision_id`.
- The UI may initially show this as a linear history while preserving parent links for later branch visualization.

## 12. Job Description Analysis

```text
JDAnalysis
├── company
├── role_title
├── seniority
├── requirements[]
├── culture_signals[]
├── constraints[]
├── red_flags[]
└── ambiguities[]

JDRequirement
├── requirement_id
├── kind: must_have | nice_to_have | responsibility | keyword
├── text
├── normalized_text
├── source_excerpt
└── coverage
```

Requirements and keywords have backend-normalized stable IDs within an analysis revision. The original JD wording and source excerpt are retained alongside an optional normalized form. Edit `jd_evidence[]` and cover-letter `jd_requirement_ids[]` reference these IDs. Coverage is reported as:

- `exact` — the exact JD term already appears in supported resume evidence;
- `supported_alias` — equivalent evidence exists and the exact JD terminology may be adopted without changing the claim;
- `partial` — related evidence exists but does not fully establish the requirement;
- `missing` — no supporting resume evidence is identified;
- `uncertain` — model confidence or wording is too ambiguous for a stronger classification.

The user can correct analysis before edit generation. This avoids generating a full plan from a mistaken interpretation.

## 13. Typed Edit Model

A discriminated operation union replaces one highly nullable generic edit object.

```text
ResumeEdit
├── RewriteText
├── RemoveItem
├── MoveItem
├── AddItem
├── ReplaceCollection
└── SetVisibility
```

`AddItem` carries a discriminated payload for schema-defined types including bullets, text blocks, projects, skill items, certifications, education items, and leadership items. `MoveItem` can target a section under the resume root or an item under its valid parent. `SetVisibility` includes or omits an existing item without deleting canonical evidence. `ReplaceCollection` handles complete ordered collections such as the visible skills within an existing group.

Shared proposal metadata:

```text
EditMetadata
├── edit_id
├── plan_id
├── rationale
├── jd_evidence[]
├── source_ids[]
├── risk: safe | review
├── warnings[]
└── generated_by_model
```

Representative operations:

```text
RewriteText
├── target_id
├── expected_before
└── after

RemoveItem
├── target_id
├── parent_id
└── expected_item_hash

MoveItem
├── target_id
├── expected_parent_id
├── destination_parent_id
├── expected_after_id
└── move_after_id

AddItem
├── parent_id
├── session_item_id
├── item_type
├── payload
├── source_ids[]
└── insert_after_id

ReplaceCollection
├── target_id
├── expected_collection_hash
└── ordered_items[]

SetVisibility
├── target_id
├── expected_visibility
└── visible
```

Ordering uses stable item anchors instead of raw numeric positions wherever possible.

### 13.1 Session-only content

The agent may propose new session-only bullets, summaries, taglines, project descriptions, and skill placements when every factual component is traceable to cited resume evidence. It may split a dense item, combine compatible evidence, reframe existing facts, or adopt supported ATS terminology.

New session items:

- carry backend-approved session-scoped IDs;
- identify all source evidence IDs;
- remain attached to a schema-valid parent;
- pass the same protected-field, number, technology, and ownership checks as rewrites;
- do not enter the canonical resume without separate human-confirmed promotion.

Evidence combination respects ownership boundaries. Facts from compatible items within the same role or project may be combined. Metrics, tools, responsibilities, and outcomes cannot be transferred between unrelated employers or projects. A profile may summarize evidence across roles because it is explicitly a cross-resume summary.

### 13.2 Conflict rules

- One plan cannot contain two text rewrites for the same target.
- An item cannot be removed and rewritten in the same plan.
- Removing a parent invalidates edits to its descendants.
- A move must refer to an existing source parent, schema-compatible destination parent, and valid destination anchor.
- A rewrite's `expected_before`, a removal's item hash, a collection replacement's collection hash, and a visibility change's expected state must match the current plan-base revision.
- Additions must use backend-approved session IDs.
- Dates, employers, role titles, contact information, and link targets are protected fields unless a dedicated human-authorized operation exists.

## 14. Decision and Application Engine

```text
EditDecision
├── edit_id
├── decision: approved | rejected | modified
├── modified_value
├── decided_at
└── decided_by
```

The pure application function derives a new snapshot from a frozen plan-base revision and a complete normalized decision set:

```text
derive_revision(plan_base_snapshot, plan, decisions) -> ResumeSnapshot
```

The function does not mutate its input. Recomputing from the same frozen inputs produces the same output.

Human-modified values pass the same structural, link, number, protected-field, and layout-warning checks as agent text. Warnings may be overridden by the human, but the override is recorded.

Decision updates include an expected local session revision. Before persisting the returned snapshot, the frontend performs an IndexedDB transactional compare-and-swap. A stale tab aborts its local write, reloads the active revision, and may resubmit. The backend separately rejects a plan whose expected snapshot hash does not match the snapshot supplied in the request.

## 15. Agent Workflow

### 15.1 Tailoring workflow

The preferred workflow is two-stage:

1. Analyze the job description.
2. Let the user inspect or correct the analysis.
3. Propose edits against the current resume revision.
4. Validate and normalize the plan.
5. Run deterministic guardrails.
6. Present proposals without applying them.

This costs an additional model call compared with a single-stage workflow but prevents incorrect analysis from contaminating every edit.

### 15.2 Tailor prompt contract

The model is instructed to:

- use only facts supported by supplied evidence;
- report missing requirements instead of fabricating coverage;
- preserve dates, employers, metrics, and scope;
- prefer a small number of high-impact edits;
- optimize content selection and ordering for the specific JD rather than mechanically preserving base order;
- adopt exact ATS-relevant JD terminology only when cited evidence supports the same underlying concept;
- preserve the resume's technical and direct voice;
- cite job-description evidence for every edit;
- cite resume evidence IDs for every changed claim;
- avoid visual or formatting instructions;
- avoid proposing arbitrary section types;
- mark claim strengthening as review risk;
- return only the requested structured output.

Conciseness is a quality preference, not a hard page-count constraint.

### 15.3 Deterministic guardrails

Guardrails run on agent and human modifications before a revision is saved:

- target and parent IDs exist;
- expected values match the plan-base revision;
- protected fields remain unchanged;
- evidence IDs exist;
- numbers remain bound to their source evidence;
- employer-specific facts are not transferred between roles;
- every factual component of a new session item is supported by its cited evidence;
- new content does not transfer metrics, tools, responsibilities, or outcomes across ownership boundaries;
- unfamiliar technology or proper-noun additions are flagged;
- changed leadership or ownership verbs are flagged;
- conflicting operations are rejected;
- URLs use approved schemes;
- content contains no HTML;
- excessively large text changes receive a review warning;
- browser page estimate is updated after application.

These checks are warning and conflict controls, not a mathematical guarantee of truth. Human review remains mandatory.

## 16. Cover Letter Workflow

Cover letters are generated from:

- the selected resume revision;
- corrected JD analysis;
- user-selected tone and length;
- optional points the user wants emphasized.

```text
CoverLetter
├── cover_letter_id
├── session_id
├── resume_revision_id
├── greeting
├── paragraphs[]
├── close
├── model_metadata
└── revision_number

CoverParagraph
├── paragraph_id
├── text
├── source_ids[]
├── jd_requirement_ids[]
├── authored_by
└── warnings[]
```

Stable paragraph IDs allow inline edits and regeneration without using paragraph text as a database key. A paragraph must cite resume evidence, but citations do not automatically prove semantic groundedness. The UI shows evidence links and requires human approval before export.

Cover letters have their own revision history and use their pinned immutable cover-template version, sharing typography and spacing tokens with the corresponding resume template.

## 17. API Surface

### 17.1 Health and configuration

```text
Public:
GET    /healthz
GET    /readyz
GET    /api/config/public
POST   /api/auth/login

Protected:
GET    /api/provider/status
POST   /api/auth/logout
```

`/readyz` verifies required configuration, template loading, and provider configuration without exposing secret values. It does not require a database or persistent volume.

Login verifies the submitted passphrase and returns a short-lived signed token. Logout cannot revoke an already-issued stateless token; it is a convenience response while the client deletes its token from `sessionStorage`. `/api/config/public` exposes only an allowlisted non-sensitive payload. Every route under the protected group and all remaining `/api` routes require a valid bearer token.

### 17.2 Base resume and portability

```text
GET    /api/base/current
POST   /api/base/promotions/preview
POST   /api/base/serialize-yaml
```

The frontend stores promoted base versions in IndexedDB. The serialization endpoint validates a supplied base snapshot and returns portable YAML for download; it does not write into the deployed repository.

### 17.3 Analysis and plans

```text
POST   /api/agent/analyze
POST   /api/agent/plan
```

The browser supplies the job description, current resume revision, corrected analysis, relevant prior decisions, and revision instruction required by each operation. The backend returns a validated result but does not retain it. The frontend saves successful results in IndexedDB.

Long provider calls may initially remain open HTTP requests. A job resource is introduced only if deployment timeouts require it. Any temporary job state is best-effort and may disappear on backend restart; the active browser revision remains safe.

### 17.4 Decisions and preview

```text
POST   /api/resume/derive
POST   /api/render/resume-preview
POST   /api/render/cover-preview
```

The derive request contains the exact plan-base snapshot, plan, complete decision set, and expected revision hash. The backend returns a validated new snapshot, content hash, and warnings. The browser assigns the local revision relationship and persists it only after the response succeeds.

Preview requests contain the exact selected snapshot and pinned template version and return escaped HTML rendered through that immutable template. Preview HTML is not stored server-side.

### 17.5 Cover letter and export

```text
POST   /api/agent/cover-letter
POST   /api/agent/cover-paragraph
POST   /api/export/resume
POST   /api/export/cover-letter
POST   /api/export/both
```

Cover-letter generation receives the exact resume revision and JD analysis. Export requests contain exact resume or cover-letter snapshots and their pinned template-version metadata. The backend returns generated files directly and deletes temporary server copies after the response. The frontend records export metadata locally; the downloaded file is the durable artifact.

## 18. Frontend Experience

### 18.1 Layout

The application uses a split-pane desktop layout:

- left pane for inputs, analysis, edits, cover letter, and history;
- right pane for the browser-rendered A4 preview.

On smaller screens, panes become stacked or switchable views without changing application behavior.

### 18.2 Job Description tab

- large paste area;
- create or update session action;
- analysis status;
- editable analysis summary;
- must-have and nice-to-have groups;
- coverage chips;
- constraints, red flags, and ambiguities;
- generate-plan action after analysis confirmation.

### 18.3 Edits tab

Each proposal shows:

- target breadcrumb;
- word-level diff;
- rationale;
- JD-evidence chips;
- resume-evidence chips;
- risk badge and deterministic warnings;
- approve, reject, and modify controls.

Bulk actions:

- approve all currently safe proposals;
- reject undecided proposals;
- reset decisions for the active plan.

Bulk approval remains visibly reviewable and does not include `review` edits.

### 18.4 Revision controls

- current revision indicator;
- save status;
- revision history drawer;
- compare selected revisions;
- restore revision;
- request another agent pass against the active revision;
- enter a human revision instruction.

### 18.5 History and local-data controls

- active and archived session views;
- archive and restore actions;
- permanent session deletion with confirmation;
- export one session as versioned JSON;
- export all application data as versioned JSON;
- validate and import a JSON backup;
- display approximate browser storage usage;
- clear all local Tailor data behind a stronger confirmation.

### 18.6 Cover Letter tab

- tone and length controls;
- optional emphasis points;
- generate action;
- paragraph-level evidence display;
- inline paragraph editing;
- paragraph regeneration;
- cover-letter revision history.

### 18.7 Preview pane

- sandboxed browser iframe;
- fixed A4 page styling;
- resume or cover-letter toggle;
- estimated page count;
- preview update status;
- explicit PDF export button;
- latest authoritative export page count after export.

The preview updates from HTML after accepted revision changes. It does not call WeasyPrint on every decision.

## 19. Browser Persistence Model

IndexedDB object stores:

```text
base_versions
sessions
jd_analyses
agent_runs
plans
decision_sets
resume_revisions
cover_letters
cover_letter_revisions
export_records
app_metadata
```

Important relationships:

- a session references one frozen base version and template version;
- a plan references the exact resume revision it targeted;
- a decision set references one plan and one expected revision;
- a resume revision references its parent revision;
- a cover letter references the exact resume revision used as evidence;
- an export record references exact resume and cover-letter revisions.

IndexedDB schema upgrades are versioned and transactional. Validated domain objects are serialized as JSON-compatible records. Searchable metadata such as company, role, updated date, status, model ID, and hashes receives IndexedDB indexes.

The application provides:

- export of all or selected session state to a versioned JSON backup;
- validation before importing a backup;
- collision handling for existing IDs;
- a clear warning that clearing site data deletes unexported history;
- startup detection and reporting of IndexedDB availability or quota errors.

Browser-local sessions have no automatic expiry. They remain until the user archives or permanently deletes them. Archiving hides a session from the default history view without removing its data. Permanent session deletion removes its JD, analysis, plans, decisions, resume revisions, cover-letter revisions, agent-run metadata, and export metadata after confirmation.

A separate confirmed clear-all action removes sessions, browser-local base versions, revisions, export records, and application preferences. It does not affect the repository base resume, PDFs already downloaded to the filesystem, or JSON backups already downloaded by the user.

Backups never contain the reusable passphrase, bearer token, ModelScope token, or backend signing secret. Failed agent runs retain an error category and non-secret model metadata rather than unnecessary full provider payloads.

## 20. Export Delivery

Export filenames are presentation metadata, not trusted server filesystem paths. Company and role names are sanitized, while generated download names include a short content hash.

The backend creates PDFs in request-scoped temporary storage, returns them directly, and removes temporary files afterward. It does not maintain an artifact archive.

The browser stores an export record containing:

- export ID;
- session and revision IDs;
- base version ID and hash;
- pinned template version;
- renderer version;
- relevant model and prompt metadata;
- kind;
- filename;
- page count;
- content hash;
- creation time.

The actual downloaded PDF is durable only in the user's chosen download location. If it is lost, the browser can regenerate it while the referenced revision remains in IndexedDB. A JSON session backup contains revision data and export metadata, not PDF bytes.

## 21. Security and Privacy

### 21.1 Secret handling

- ModelScope token exists only in backend secrets.
- Only an Argon2id passphrase hash is stored; the plaintext passphrase is never configured or logged.
- The token-signing secret is separate from the passphrase hash.
- Access tokens are short-lived and stored in browser `sessionStorage`.
- Secrets are never returned by configuration routes.
- Logs redact authorization headers and tokens.
- No secret is placed in a `VITE_` environment variable.
- Local `.env` files are ignored by Git.

### 21.2 Untrusted content

Job descriptions, model output, and human edits are untrusted strings.

- Jinja autoescaping is enabled.
- Model output cannot contain active HTML.
- Preview iframe is sandboxed.
- Link protocols are validated.
- WeasyPrint resource loading is restricted to known template assets.
- Filenames never use unsanitized company or role strings.
- Errors shown to the browser do not expose filesystem paths or secrets.

### 21.3 Personal data

The product sends resume content and job descriptions to ModelScope for inference. The UI should disclose this. Browser-local session deletion and clear-all controls must be supported. Downloaded PDFs and JSON backups remain under the user's filesystem control. Raw prompts and responses should not be logged by default beyond what is necessary for local debugging and audit.

## 22. Reliability and Failure Recovery

| Failure | Required behavior |
|---|---|
| ModelScope timeout | Preserve active revision, record failed run, allow retry |
| Invalid structured response | Validate, bounded repair retry, then show failure |
| Quota exhausted | Show provider-specific message without losing work |
| Backend restart | Browser resubmits required state; IndexedDB session remains available |
| Browser refresh | Reload active session and saved revision |
| Stale decision request | Return conflict and require reload |
| Preview render failure | Keep editor usable and expose retry |
| PDF export failure | Preserve revision, record failure, allow retry |
| Lost downloaded PDF | Regenerate it from the retained browser revision |
| IndexedDB unavailable or cleared | Warn clearly; support versioned JSON export/import backups |
| Canon changed | New sessions use new base; old sessions retain frozen base |
| Template changed | New template version; existing sessions remain pinned |

## 23. Testing Strategy

### 23.1 Canonical data

- YAML validates against Pydantic models.
- IDs are unique.
- retired IDs are not reused.
- links are valid.
- all content in the reference resume is represented.
- load and serialization preserve semantic content.

### 23.2 Edit engine

- reject-all derives the plan-base snapshot unchanged;
- the same frozen inputs produce the same output hash;
- input snapshots are not mutated;
- stale expected values fail;
- conflicting operations fail;
- moves remain deterministic;
- session additions receive stable IDs;
- protected fields cannot be changed through generic rewrite operations;
- human modifications are validated;
- restoration reproduces the stored snapshot hash.
- IndexedDB compare-and-swap rejects a stale active revision;
- cross-tab notifications reload newer state;
- concurrent session writes serialize through Web Locks where supported.

### 23.3 Guardrails

Fixtures cover:

- fabricated technologies;
- new and reformatted numbers;
- metrics transferred between employers;
- altered employers, titles, dates, or contact details;
- inflated ownership language;
- stale targets;
- invalid evidence IDs;
- HTML injection;
- unsafe links;
- oversized changes;
- parent-child edit conflicts.

### 23.4 Agent evaluation

Use a versioned set of real target job descriptions. Evaluate candidate ModelScope models for:

- valid structured output;
- unsupported-claim rate;
- correct evidence references;
- meaning preservation;
- useful keyword coverage;
- edit relevance;
- plan conflict rate;
- instruction adherence;
- latency and quota usage.

Agent evaluations are separate from the default unit-test suite because they consume remote quota and can vary with provider behavior.

### 23.5 Rendering

- HTML snapshots detect structural changes.
- Browser screenshots verify desktop and mobile preview states.
- PDF smoke tests assert successful export and page count.
- Rasterized PDF visual regression compares output against the approved baseline.
- Text extraction verifies reading order and missing content.
- Link checks verify clickable PDF destinations.
- Font checks fail when expected font assets are unavailable.
- Every template version referenced by a retained fixture can still render.
- Requests for unavailable template versions fail rather than falling forward to the latest template.

### 23.6 End-to-end

Playwright scenarios:

1. Create a session from a pasted JD.
2. Correct analysis.
3. Generate a plan.
4. Approve, reject, and modify different edits.
5. Confirm browser preview updates.
6. Refresh and confirm the revision restores.
7. Request another agent pass against the current revision.
8. Restore an earlier revision.
9. Generate a cover letter.
10. Export resume and cover letter.
11. Reopen the session and regenerate a PDF from the recorded revision, verifying the revision hash, template version, extracted content, and expected page behavior.

Deployment smoke tests verify Vercel-to-Space routing, CORS or rewrite behavior, IndexedDB behavior on the stable production origin, secret presence, provider availability, and export dependencies.

## 24. Observability

Structured logs record:

- request ID;
- session ID where safe;
- route and status;
- agent run ID;
- provider model ID;
- latency;
- validation result;
- revision ID;
- export duration and page count.

Logs do not contain:

- ModelScope tokens;
- authorization headers;
- full resume content;
- full job descriptions;
- complete raw model responses by default.

Useful metrics:

- analysis success rate;
- plan success rate;
- structured-output retry rate;
- guardrail warning counts;
- proposal approval rate;
- provider latency;
- preview latency;
- export latency;
- IndexedDB save, import, and quota failures.

## 25. Build Sequence

### Phase 0 — Artifact and deployment feasibility

Deliverables:

- copy `resume0726.pdf` into the repository;
- confirm the Tinos and Arimo files, variants, checksums, and Apache 2.0 attribution;
- confirm ModelScope endpoint and candidate model IDs with the user's token configured outside Git;
- test structured output with representative schemas;
- confirm IndexedDB support and backup-file behavior on the production frontend origin;
- confirm Vercel-to-Space authentication and routing approach;
- benchmark browser HTML render and WeasyPrint export.

Exit criteria:

- at least one ModelScope model reliably returns valid test structures;
- browser session data remains available across Space restarts;
- the Vercel deployment can securely call the backend;
- WeasyPrint works in the Docker Space image.

### Phase 1 — Canonical resume and template

Deliverables:

- complete `resume.yaml` extracted from the reference PDF and checked manually;
- Pydantic schema and JSON Schema;
- immutable `resume-v1` and `cover-v1` HTML/CSS template directories;
- embedded Tinos and Arimo font families with attribution;
- browser preview of the canonical resume;
- reference PDF visual comparison.

Exit criteria:

- all reference content exists in structured data;
- no content is hard-coded in the template;
- the preview preserves the approved design and structure;
- PDF export is visually accepted as the template baseline.

### Phase 2 — Browser session and revision core

Deliverables:

- IndexedDB base versions;
- sessions;
- complete revision snapshots;
- autosave;
- restore and revision comparison;
- optimistic concurrency;
- IndexedDB transactional compare-and-swap, BroadcastChannel synchronization, and Web Locks integration;
- JSON backup export and import;
- IndexedDB schema-upgrade verification.

Exit criteria:

- revisions survive page reloads and backend restarts in the same browser profile;
- restoring a revision reproduces its content hash;
- stale updates cannot overwrite newer work.

### Phase 3 — Typed edit engine and guardrails

Deliverables:

- discriminated edit types;
- decision sets;
- deterministic derivation;
- conflict validation;
- evidence validation;
- protected-field and fabrication warnings;
- comprehensive unit tests.

Exit criteria:

- the engine never mutates the base or plan-base snapshot;
- conflicting and stale edits are rejected;
- human modifications follow the same validation path;
- all focused tests pass.

### Phase 4 — ModelScope tailoring agent

Deliverables:

- provider adapter;
- JD analysis call;
- corrected analysis saved in IndexedDB;
- edit-plan call;
- structured-output retry policy;
- model evaluation fixtures;
- provider failure UX.

Exit criteria:

- selected model meets the evaluation threshold;
- valid plans target the current revision;
- missing JD requirements remain explicitly missing;
- provider failures leave session state unchanged.

### Phase 5 — Core frontend

Deliverables:

- JD tab;
- analysis correction UI;
- word-diff edit checklist;
- decision controls;
- browser preview;
- revision history;
- save state;
- deployment through Vercel.

Exit criteria:

- the full tailoring workflow works across deployed frontend and backend;
- browser preview updates without PDF generation;
- refresh restores current work;
- mobile layout remains usable.

### Phase 6 — PDF export and local history

Deliverables:

- explicit WeasyPrint export;
- browser-local export metadata manifest;
- direct PDF download;
- authoritative page count;
- browser-local session history and deterministic regeneration.

Exit criteria:

- exports are tied to exact revisions;
- exports complete without backend retention;
- lost downloads can be regenerated from retained revisions;
- reference-template visual tests pass.

### Phase 7 — Cover letters and base promotion

Deliverables:

- evidence-linked cover-letter generation;
- paragraph revisions;
- cover preview and PDF export;
- preview and confirmation for promoting session changes to the base;
- new base-version registration.

Exit criteria:

- cover letters cite existing evidence IDs;
- cover revisions restore correctly;
- base promotion cannot occur through ordinary session approval;
- existing sessions remain unchanged after a new base version.

## 26. Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Unsupported agent claims | Evidence-linked edits, deterministic warnings, protected fields, human approval |
| ModelScope model changes | Configurable model ID, provider adapter, evaluation suite, recorded model metadata |
| ModelScope quota exhaustion | Explicit error state, retries, model configuration, no loss of session work |
| Browser/PDF pagination differences | Shared template and CSS, approximate browser labeling, authoritative export count |
| Template drift | Versioned frozen template, no agent markup, visual regression tests |
| Session loss on Space restart | Stateless backend; authoritative session state remains in browser IndexedDB |
| Browser data is cleared | Versioned JSON backup export/import and explicit local-only warning |
| Token exposure | Backend-only Space secret; no Vite secret variables |
| Public backend abuse | Passphrase login, short-lived signed tokens, route authorization, origin checks, and login rate limiting |
| Stale edits across revisions | Plan-base revision IDs, exact expected values, optimistic concurrency |
| Base changes alter old sessions | Immutable base snapshots pinned per session |
| Human modification bypasses checks | Run human text through the validation and warning pipeline |
| Historical export layout changes after a renderer upgrade | Retain exact revision snapshots and immutable templates, record the renderer version, and disclose that a lost PDF may be semantically regenerated but not byte-identical after an approved renderer upgrade |
| Font or renderer differences | Pin fonts, dependencies, and renderer; run visual regression tests |

## 27. Architecture Decisions

The following decisions are accepted for version 1:

1. The supplied July resume PDF is the starting reference artifact.
2. The operational base resume is structured YAML copied into the Git repository.
3. The baseline is three pages; page length is not constrained.
4. Browser HTML is the live preview path.
5. WeasyPrint runs only for explicit export or explicit final-layout confirmation.
6. Every session uses the same fixed resume design and structural template.
7. Session revisions are stored in browser IndexedDB and never depend on model memory or backend disk.
8. Complete resume snapshots are stored for accepted revisions.
9. Canonical updates require a distinct human-confirmed operation.
10. Git push is not required for application operation or session persistence.
11. ModelScope is the inference provider.
12. The initial model chain is Qwen3.5-397B-A17B, Qwen3.5-35B-A3B, then the independent Nemotron3 Nano llama.cpp Space.
13. Model IDs remain configurable and the two ModelScope candidates are compared through tailoring evaluations.
14. Structured output uses strict JSON instructions, Pydantic validation, one bounded repair request, and safe model fallback; native JSON Schema is optional only after model-specific verification.
15. The ModelScope token exists only in backend secrets.
16. Vercel hosts the frontend and a Docker Hugging Face Space hosts the backend.
17. The backend is stateless; no durable Space volume or backend database is required for version 1.
18. PDFs are returned directly for download and are not archived by the backend.
19. Versioned JSON export/import provides manual backup and migration of browser-local history.
20. Authentication uses a custom passphrase dialog, an Argon2id hash in backend secrets, and a short-lived signed bearer token stored in browser `sessionStorage`.
21. The backend verifies tokens statelessly; no Vercel Function or authentication database is required.
22. The Hugging Face Docker Space is public and protected by Tailor's application authentication; repository-tracked source and canonical assets are accepted as publicly readable.
23. Tinos and Arimo are bundled under Apache 2.0 as metric-compatible substitutes for Times New Roman and Arial; Microsoft font files are not committed.
24. Content ordering is adaptive: the agent may propose reordering schema-defined sections and items, selecting or omitting content, and adopting evidence-supported JD terminology while the visual template remains fixed.
25. Truthfulness, evidence linkage, protected facts, schema validity, and explicit approval are the ordering and ATS-optimization boundaries; chronology and base order are not hard constraints.
26. The agent may propose new session-only bullets, summaries, taglines, project descriptions, and skill placements when every factual component is supported by cited evidence.
27. Session-only content may split, combine, or reframe compatible evidence and adopt supported ATS terminology, but cannot transfer facts across ownership boundaries or enter the canonical resume without separate promotion.
28. Browser-local sessions are retained indefinitely without automatic expiry until the user archives or permanently deletes them.
29. Session deletion removes related IndexedDB records but cannot remove PDFs or JSON backups already downloaded to the filesystem.
30. Tailor provides archive, restore, per-session export, full-data export/import, storage-usage reporting, and a separately confirmed clear-all action.
31. Template versions are immutable directories retained in the repository; historical sessions never silently fall forward to a newer template.
32. IndexedDB transactional compare-and-swap owns local concurrency, with BroadcastChannel and Web Locks coordinating tabs; the stateless backend validates supplied snapshot hashes only.
33. Base IDs come from canonical YAML, browser-domain record IDs come from the frontend, and agent-operation IDs are generated or normalized by the backend rather than trusted from model output.
34. JD requirements carry stable analysis-scoped IDs used by edit and cover-letter evidence references.
35. Export records contain browser-local metadata and a download filename, not a server storage location or archived PDF.

## 28. Decision Review Status

Questions 1 through 9 are resolved in Section 27. No product-architecture decision from the review remains open. Phase 0 still contains verification work, including live model evaluation, deployment checks, font checksums, visual acceptance, and IndexedDB backup testing, but these are validation gates rather than unresolved product choices.

## 29. Definition of MVP Complete

The MVP is complete when the deployed application can:

1. Load the validated base resume derived from `resume0726.pdf`.
2. Create a browser-persisted session pinned to a base and template version.
3. Accept and analyze a pasted job description through ModelScope.
4. Let the user correct the analysis.
5. Generate valid, evidence-linked edit proposals against the active revision.
6. Let the user approve, reject, and modify proposals individually.
7. Persist complete revision snapshots across page reloads and backend restarts in the same browser profile.
8. Request another agent pass against the latest selected revision.
9. Restore and compare earlier revisions.
10. Render every revision through the same fixed browser template.
11. Export an exact selected revision to PDF on demand.
12. Reopen the session and retrieve its revision and export history.
13. Keep the ModelScope token out of the frontend, repository, logs, and artifacts.
14. Preserve user work through provider failures, quota errors, and stale client requests.
15. Export and import a versioned JSON backup of browser-local session history.

Cover-letter generation and base promotion are the next complete milestone if they are not included in the first MVP release.

## 30. Current Platform References

- ModelScope API Inference introduction: <https://modelscope.cn/docs/model-service/API-Inference/intro>
- ModelScope API Inference limits and supported-model behavior: <https://www.modelscope.cn/docs/model-service/API-Inference/limits>
- Hugging Face Spaces overview and secrets: <https://huggingface.co/docs/hub/main/spaces-overview>
- Hugging Face Spaces disk and storage behavior: <https://huggingface.co/docs/hub/main/spaces-storage>
- Vercel Vite deployment: <https://vercel.com/docs/frameworks/frontend/vite>
- Vercel rewrites: <https://vercel.com/docs/routing/rewrites>
- WeasyPrint documentation: <https://doc.courtbouillon.org/weasyprint/stable/>
- WeasyPrint API and versioning: <https://doc.courtbouillon.org/weasyprint/stable/api_reference.html>
