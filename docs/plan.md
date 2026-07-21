# Tailor — Product and Architecture Plan

**Project codename:** `tailor`  
**Author:** Bukunmi Akinyemi  
**Status:** Implemented baseline — v1.2
**Last updated:** 2026-07-21
**Starting artifact:** `C:\Users\BUNKUNMI\Downloads\resume0726.pdf`  
**Deployment:** Vercel frontend, Docker backend on a shared Contabo workspace VPS
**Model provider:** ModelScope API Inference

## 1. Executive Summary

Tailor is a human-in-the-loop resume tailoring application. It starts from one canonical, structured resume and one frozen visual template recreated from the supplied reference PDF. For each pasted job description, an agent analyzes the role and proposes grounded, structured content edits. The user approves, rejects, or modifies each proposal. The resulting working resume is rendered immediately in the browser and exported to PDF only when requested.

The system separates four concerns:

1. **Canonical content:** a repository-tracked YAML resume with stable identifiers.
2. **Presentation:** a fixed, versioned HTML/CSS template based on `resume0726.pdf`.
3. **Session state:** one disposable in-memory workspace containing revisions, proposed edits, decisions, and cover-letter state.
4. **Model inference:** ModelScope API calls made only by the backend.

The agent never edits files directly. It returns typed proposals. The backend validates those proposals and derives a working snapshot only from approved decisions supplied by the browser. The repository YAML changes only through a deliberate human edit in the local repository.

The application accepts the current three-page resume as its baseline. Page count is informational and never blocks export.

## 2. Product Goal

Build a dependable resume-tailoring workflow that:

- preserves the design and structure of the supplied resume across every session;
- prevents silent changes and unsupported claims;
- makes multiple rounds of revision safe and recoverable;
- provides a fast browser preview without repeatedly generating PDFs;
- produces a matching cover letter grounded in resume evidence;
- tracks every meaningful revision during the active tab session;
- works with a Vercel-hosted React frontend and a containerized FastAPI backend on the workspace VPS;
- uses a ModelScope API token without exposing it to the browser;
- does not require a Git push for normal use.

## 3. Product Principles and Invariants

### 3.1 Fixed-template invariant

Every base resume, working draft, browser preview, and exported PDF is rendered through the same versioned resume template. Session data and model output can modify approved content fields only. They cannot provide or change HTML, CSS, fonts, margins, section components, or layout properties.

### 3.2 Frozen-session-baseline invariant

Every session is pinned to the exact base-resume version and template version that existed when the session was created. Later base changes do not silently alter an existing session.

### 3.3 Explicit-approval invariant

No agent proposal affects the working resume until the user approves it or replaces it with a human-authored modification and approves that modification.

### 3.4 Canonical-update invariant

Approving an edit for a job application does not update the canonical resume. Updating the canonical resume is a separate, explicit action with its own preview and confirmation.

### 3.5 Ephemeral-session invariant

The model's conversation state is never treated as durable memory. The frontend holds the active conversation, resume snapshots, and change metadata in memory for the lifetime of the tab. Starting a new session, refreshing, or closing the tab intentionally discards that state.

### 3.6 Evidence invariant

Agent-generated claims must identify the canonical or session evidence atoms from which they were derived. Evidence linkage assists agent inspection and human review; it does not remove the human approval requirement.

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
- Track accepted revisions during the active tab session.
- Render the working resume in a browser preview.
- Export the selected revision to PDF.
- Generate and revise an evidence-linked cover letter.

### 4.2 Non-goals for version 1

- Multiple visual resume templates.
- Automatic job-board scraping.
- Automatic application submission.
- Multi-user accounts and collaboration.
- Claims of exact ATS scoring.
- A hard one-page, two-page, or three-page limit.
- Automatic promotion of tailored content into the canonical resume.
- Allowing the model to edit template or repository files.
- Running a local language model inside the Tailor backend container.

## 5. Starting Artifacts and Repository Sources

The supplied PDF is copied into the repository as a permanent visual and content reference. Its content is extracted once into canonical YAML. Runtime tailoring uses the YAML, not repeated PDF extraction.

```text
tailor/
├── backend/
│   ├── Dockerfile
│   ├── canon/
│   │   ├── resume.yaml
│   │   ├── resume.schema.json
│   │   └── reference/resume0726.pdf
│   ├── app/
│   └── render/
├── frontend/
│   ├── vercel.json
│   └── src/
├── Makefile
├── docs/
│   └── plan.md
```

The artifacts have distinct roles:

| Artifact | Purpose | Runtime mutability |
|---|---|---|
| `backend/canon/reference/resume0726.pdf` | Original content and visual reference | Never modified by the application |
| `backend/canon/resume.yaml` | Repository canonical seed | Modified only by a deliberate human edit in the local repository |
| Resume HTML/CSS/fonts | Fixed presentation system | Never modified by an agent or session |
| Frontend memory | Active plans, decisions, revisions, and cover letter | Discarded on new session, refresh, or tab close |

The starting PDF is three A4 pages and uses Times New Roman with limited Arial usage. The public repository uses Tinos and Arimo as Apache 2.0 metric-compatible substitutes rather than redistributing Microsoft font files. Three pages are accepted as the initial layout. Tailored drafts may remain three pages or grow or shrink when content changes. The UI reports the resulting page estimate or export page count but does not block export.

## 6. System Context

```text
┌─────────────────────────────────────────────────────────────┐
│ Vercel                                                     │
│ React + Vite + TypeScript                                  │
│                                                            │
│ JD input · analysis · edit decisions · active revision     │
│ browser resume preview · cover letter · export controls    │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS JSON API
                           │ authenticated application requests
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Contabo workspace VPS — Docker                             │
│ FastAPI backend                                             │
│                                                            │
│ Pydantic AI agents · resume tools · edit validation         │
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

The Vercel application never receives the ModelScope token. All model calls originate from the Tailor backend container. The open frontend tab owns the disposable active session; the backend does not retain session state between requests.

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

- `VITE_API_BASE_URL` identifies the HTTPS DuckDNS backend origin.
- Only non-secret values may use `VITE_` variables because Vite exposes them to client code.

Recommended request path:

```text
Browser on Vercel → HTTPS → Caddy/Sablier → Tailor backend
```

The backend allows only the configured Vercel production and preview origins through HTTP CORS and WebSocket Origin validation. The public backend URL is not secret; ModelScope and authentication secrets remain backend-only.

### 7.2 Backend on the workspace VPS

Use the existing backend Docker image because the backend requires:

- FastAPI;
- system packages needed by WeasyPrint;
- embedded fonts;
- control of the runtime entrypoint;
- a predictable stateless runtime for model, validation, rendering, and export requests.
- enough control to run WeasyPrint and support scale-to-zero cold starts.

The repository is public, so its source, Docker configuration, template files, canonical YAML, and reference PDF are publicly readable. ModelScope credentials, passphrase hash, and token-signing secret live only in `/opt/workspace/apps/tailor/.env` on the VPS. Tailor's application authentication protects API use and quota consumption; it does not make repository files private.

The backend image contains application code, canonical assets, and template assets. Runtime session data does not rely on container disk. Caddy, Sablier, and the socket proxy form the always-on workspace control plane; the Tailor container may stop after 24 hours without traffic and wake on the next request.

Required backend configuration:

| Variable | Classification | Purpose |
|---|---|---|
| `MODELSCOPE_API_TOKEN` | Secret | Authenticate ModelScope inference calls |
| `MODELSCOPE_BASE_URL` | Variable | ModelScope OpenAI-compatible API base URL |
| `PRIMARY_MODEL_NAME` | Variable | Primary ModelScope model ID |
| `SECONDARY_MODEL_NAME` | Variable | Secondary ModelScope model ID |
| `FALLBACK_MODEL_BASE_URL` | Variable | Existing independent llama.cpp Space endpoint |
| `FALLBACK_MODEL_NAME` | Variable | Nemotron emergency-fallback model ID |
| `FALLBACK_MODEL_ENABLED` | Variable | Enable or disable the configured fallback chain |
| `ALLOWED_ORIGINS` | Variable | Vercel production and preview origins |
| `APP_ENV` | Variable | Local, preview, or production behavior |
| `TAILOR_PASSWORD_HASH` | Secret | Argon2id hash of the personal application passphrase |
| `AUTH_SIGNING_SECRET` | Secret | Sign and verify short-lived access tokens |
| `AUTH_TOKEN_TTL_HOURS` | Variable | Access-token lifetime, initially 8–12 hours |

The ModelScope token is configured in the mode-0600 VPS environment file and is never committed to Git or passed through GitHub Actions.

### 7.3 Stateless backend and ephemeral frontend state

The backend does not require durable disk. Each request includes the exact validated inputs needed for analysis, planning, preview rendering, or export. Temporary files created for PDF generation are deleted after the response completes.

The frontend holds the active job description, analysis, plan, decisions, resume revisions, and cover letter in React memory. PDFs are returned directly to the browser for download and are not archived by the backend. Starting a new session, refreshing, closing the tab, or navigating to a fresh deployment discards the workspace by design.

### 7.4 Access control

Although the product is single-user and stateless, its ModelScope-backed routes must not be available for unrestricted public use.

The backend stores an Argon2id passphrase hash and an independent token-signing secret in its protected VPS environment file. The frontend displays a custom passphrase dialog and sends the passphrase once over HTTPS to `POST /api/auth/login`. After successful constant-time verification, the backend returns a short-lived signed bearer token.

The frontend stores the token in `sessionStorage`, not durable application storage, and sends it as an `Authorization: Bearer` header on protected requests. Closing the tab, logging out, or token expiry requires authentication again. The reusable passphrase is never stored by the frontend after the login request completes.

The backend remains stateless: it verifies the token signature and expiry without a session database. Login attempts use an in-memory, best-effort rate limiter, authentication failures are generic, allowed frontend origins are explicit, and authorization headers are never logged. The limiter may reset when the container restarts, which is acceptable for the single-user v1 deployment. Health, readiness, login, and an allowlisted non-sensitive public-configuration route are public; every other route requires authentication.

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

Pydantic AI is the agent framework. Each task is defined by a versioned YAML agent specification loaded with `Agent.from_file`. Agents use typed `PromptedOutput`, an OpenAI-compatible `OpenAIChatModel` for every endpoint, a `FallbackModel` spanning the configured primary, secondary, and independent models, and a custom resume capability that exposes evidence-search and evidence-inspection tools. Pydantic models remain the authoritative output contract.

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

1. create a Pydantic AI agent with the authoritative Pydantic output type wrapped in `PromptedOutput`;
2. let Pydantic AI include the JSON schema in the prompt and parse the returned JSON;
3. validate the result against the output model;
4. on parse or validation failure, let the agent issue one bounded schema-repair retry;
5. use `FallbackModel` for retryable provider, quota, timeout, and server failures across the configured model chain;
6. if the agent cannot produce a valid typed result, fail the run without creating a plan or changing the active revision.

Native schema mode may be enabled later as an optimization for a specific model only after a live compatibility test. It does not replace backend Pydantic validation.

The backend never applies raw model prose as an edit plan. Pydantic AI validates the typed response, and the edit engine enforces target existence, exact before values, protected fields, operation shape, and snapshot identity when the human approves proposals. The frontend admits a plan into the active in-memory session only after typed generation succeeds.

## 9. Canonical Resume Model

### 9.1 Canonical YAML

`backend/canon/resume.yaml` is the repository-tracked operational base resume. Every addressable content item has a permanent stable ID. The deployed application reads this base but never writes into the deployment checkout.

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
- Session-only additions receive session-scoped IDs and do not become canonical IDs unless a human later adds them to repository YAML.
- Base content IDs come from validated repository YAML. The frontend generates session, plan, decision-set, revision, cover-letter, and export-record IDs. The backend generates or normalizes IDs for validated agent-proposed operations and session-only content; IDs supplied by raw model output are never trusted directly.

### 9.3 Base versions

The repository YAML is the operational base for every new in-memory session.

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
└── source: repository_import | direct_edit
```

At application startup, the backend validates `resume.yaml` and exposes the validated repository base plus its hash. A session clones that snapshot into memory when the first message is sent. A deployment cannot alter an already-open tab, while refreshed and new sessions use the newly deployed base.

### 9.4 Updating the base

The supported path is a deliberate human edit to `backend/canon/resume.yaml` in the local repository. After deployment, the backend validates and exposes that repository seed. The deployed backend does not attempt to commit or push Git changes.

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

The reference PDF uses Times New Roman regular, bold, and italic faces, with limited Arial usage. Because the repository is public, Microsoft font files are not copied from Windows or extracted from the subset fonts embedded in the PDF.

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
├── source: base | decisions | human_edit | agent_pass
├── change_summary
├── created_at
└── created_by: system | agent | human
```

Complete snapshots are preferred because a resume is small and snapshots make subsequent agent passes and export reliable. Edit metadata is retained in memory alongside snapshots for explanation and diffing.

### 11.3 Multiple agent passes

Every new agent pass targets the current active revision, not the original base unless explicitly requested.

```text
Revision 0: frozen base
Revision 1: first approved plan
Revision 2: human-modified profile
Revision 3: second agent pass against Revision 2
Revision 4: third agent pass against Revision 3
```

The request sent to the agent contains:

- original job description;
- current resume revision;
- current JD analysis;
- relevant prior decisions, especially rejected proposals;
- the user's new revision instruction;
- base evidence accessible to the current revision.

Every proposed edit includes an expected current value, item hash, collection hash, or anchor appropriate to its operation. Stale proposals fail validation instead of being silently applied.

### 11.4 In-memory updates

Decision state updates after:

- approval or rejection;
- human modification;
- bulk decision;

A new resume revision snapshot is created only when the derived content hash changes. A rejection or decision-only change with an unchanged working resume updates the decision set without creating a duplicate resume snapshot.

Successful agent passes update plans and run metadata in memory. Cover-letter edits update the active cover letter. These changes do not create resume revisions unless resume content also changed.

Rapid UI actions update the active in-memory workspace immediately. Asynchronous server validation is generation-checked so an older response cannot replace a newer decision state. Each tab is an independent workspace. The backend verifies that a plan matches the supplied snapshot hash but does not own session state.

### 11.5 Revision lifetime

Revision snapshots support multiple agent passes during the active session. They are internal working state, not durable history, and are discarded with the workspace.

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
- do not enter the canonical resume without a separate human edit to repository YAML.

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

Human-modified values pass through the same typed operation and protected-field application path as agent text. The modification and approval decision are recorded.

Decision updates include the plan's expected snapshot hash. The frontend ignores superseded validation responses, and the backend rejects a plan whose expected snapshot hash does not match the snapshot supplied in the request. Separate tabs do not synchronize.

## 15. Agent Workflow

### 15.1 Tailoring workflow

The preferred workflow is two-stage:

1. Analyze the job description.
2. Let the user inspect or correct the analysis.
3. Propose edits against the current resume revision.
4. Validate the typed plan through Pydantic AI.
5. Present proposals without applying them.

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

### 15.3 Agent capabilities and application validation

The YAML-defined agents use a custom `ResumeTools` capability. It exposes typed tools to search verified resume atoms, inspect exact evidence IDs, and inspect corrected job requirements. The agent must use these tools before citing evidence or targeting an operation.

Truthfulness is achieved through evidence-aware agent behavior and explicit human approval. At application time the edit engine enforces only mechanical invariants: the plan targets the supplied snapshot hash, targets and collections exist, `before` values match exactly, protected factual fields cannot be changed through generic rewrites, duplicate IDs are rejected, operations are schema-valid, and conflicting or stale operations fail.

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
POST   /api/base/serialize-yaml
```

The deployed application does not promote session changes into a durable base. Canonical changes are made deliberately in the repository YAML.

### 17.3 Analysis and plans

```text
POST   /api/agent/analyze
POST   /api/agent/plan
```

The browser supplies the job description, current resume revision, corrected analysis, relevant prior decisions, and revision instruction required by each operation. The backend returns a validated result but does not retain it. The frontend keeps successful results in the active tab's memory.

Long provider calls may initially remain open HTTP requests. A job resource is introduced only if deployment timeouts require it. Any temporary job state is best-effort and may disappear on backend restart; the active browser revision remains safe.

### 17.4 Decisions and preview

```text
POST   /api/resume/derive
POST   /api/render/resume-preview
POST   /api/render/cover-preview
```

The derive request contains the exact plan-base snapshot, plan, complete decision set, and expected revision hash. The backend returns a validated new snapshot, content hash, and warnings. The browser assigns the in-memory revision relationship only after the response succeeds.

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

### 18.4 Active-workspace controls

- current revision indicator;
- request another agent pass against the active revision;
- enter a human revision instruction.

### 18.5 Session reset

- a plus action starts a new blank session;
- confirmation clearly states that the current work will be permanently discarded;
- reset stops active generation and clears revisions, review state, conversation, analysis, and cover letter.

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

## 19. In-Memory Workspace Model

The frontend owns exactly one active workspace. React state and in-memory maps hold its session metadata, conversation, frozen starting revision, accepted resume revisions, review snapshots, analysis, decisions, and cover letter.

Important relationships remain explicit while the tab is open:

- a session references one frozen repository base and template version;
- a plan references the exact resume snapshot hash it targeted;
- a decision set references one plan;
- a resume revision references its parent revision;
- a cover letter cites resume evidence IDs.

There is no IndexedDB, localStorage, backend database, session archive, or application-state backup. The plus action asks for confirmation and then permanently clears the active workspace. Refreshing or closing the tab has the same data-loss consequence. Downloaded PDFs are independent filesystem artifacts and are not removed.

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

The actual downloaded PDF is durable only in the user's chosen download location. It can be regenerated only while the source workspace remains open; after reset or refresh, the user must recreate the tailoring session.

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

The product sends resume content and job descriptions to ModelScope for inference. The UI should disclose this. The reset control discards the active in-memory workspace; downloaded PDFs remain under the user's filesystem control. Raw prompts and responses should not be logged by default beyond what is necessary for local debugging and audit.

## 22. Reliability and Failure Recovery

| Failure | Required behavior |
|---|---|
| ModelScope timeout | Preserve active revision, record failed run, allow retry |
| Invalid structured response | Validate, bounded repair retry, then show failure |
| Quota exhausted | Show provider-specific message without losing work |
| Backend restart | Open tab retains state and can retry after the backend returns |
| Browser refresh or tab close | Active work is intentionally discarded |
| Superseded decision response | Ignore it using the validation generation check |
| Preview render failure | Keep editor usable and expose retry |
| PDF export failure | Preserve revision, record failure, allow retry |
| Lost downloaded PDF | Regenerate it only while the active workspace remains open |
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
- accepted decisions produce the expected snapshot hash;
- superseded asynchronous validation responses cannot overwrite newer decisions.

### 23.3 Agent architecture

Tests verify that every YAML agent specification loads, the custom resume capability exposes its typed tools, the configured Pydantic AI model is a fallback chain, and malformed typed output receives the bounded Pydantic AI retry behavior. Agent quality is measured with real JD fixtures rather than heuristic fabrication-lint fixtures.

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
6. Request another agent pass against the current revision.
7. Generate a cover letter.
8. Export resume and cover letter.
9. Start a new session and confirm the prior workspace is cleared.
10. Refresh and confirm the application returns to a blank workspace.

Deployment smoke tests verify direct Vercel-to-VPS requests, CORS and WebSocket Origin behavior, cold start, ephemeral reset behavior, secret presence, provider availability, and export dependencies.

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
- evidence-tool usage and citation accuracy;
- proposal approval rate;
- provider latency;
- preview latency;
- export latency;
- workspace resets;

## 25. Build Sequence

### Phase 0 — Artifact and deployment feasibility

Deliverables:

- copy `resume0726.pdf` into the repository;
- confirm the Tinos and Arimo files, variants, checksums, and Apache 2.0 attribution;
- confirm ModelScope endpoint and candidate model IDs with the user's token configured outside Git;
- test structured output with representative schemas;
- confirm refresh and reset intentionally clear the frontend workspace;
- confirm Vercel-to-VPS authentication and routing approach;
- benchmark browser HTML render and WeasyPrint export.

Exit criteria:

- at least one ModelScope model reliably returns valid test structures;
- an open browser tab remains usable across backend cold starts and restarts after retry;
- the Vercel deployment can securely call the backend;
- WeasyPrint works in the production Docker image.

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

### Phase 2 — In-memory session and revision core

Deliverables:

- one disposable active session;
- complete in-memory revision snapshots;
- deterministic decision derivation;
- generation checks for asynchronous validation;
- confirmed new-session reset.

Exit criteria:

- revisions remain coherent through multiple passes in one open tab;
- a new session clears all prior workspace state;
- superseded validation cannot overwrite newer work.

### Phase 3 — Pydantic AI agents and typed edit engine

Deliverables:

- discriminated edit types;
- decision sets;
- deterministic derivation;
- conflict validation;
- YAML agent specifications and resume capabilities;
- protected-field validation;
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
- corrected analysis retained in the active session;
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
- active revision state;
- deployment through Vercel.

Exit criteria:

- the full tailoring workflow works across deployed frontend and backend;
- browser preview updates without PDF generation;
- refresh returns to a blank workspace;
- mobile layout remains usable.

### Phase 6 — PDF export

Deliverables:

- explicit WeasyPrint export;
- direct PDF download;
- authoritative page count;

Exit criteria:

- exports use the exact active revision;
- exports complete without backend retention;
- reference-template visual tests pass.

### Phase 7 — Cover letters

Deliverables:

- evidence-linked cover-letter generation;
- paragraph revisions;
- cover preview and PDF export;

Exit criteria:

- cover letters cite existing evidence IDs;
- cover letters remain editable and exportable during the active session.

## 26. Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Unsupported agent claims | Evidence-linked edits, deterministic warnings, protected fields, human approval |
| ModelScope model changes | Configurable model ID, provider adapter, evaluation suite, recorded model metadata |
| ModelScope quota exhaustion | Explicit error state, retries, model configuration, no loss of session work |
| Browser/PDF pagination differences | Shared template and CSS, approximate browser labeling, authoritative export count |
| Template drift | Versioned frozen template, no agent markup, visual regression tests |
| Accidental refresh or tab close | Explicitly disclose that the workspace is ephemeral; export final artifacts before leaving |
| Token exposure | Backend-only Space secret; no Vite secret variables |
| Public backend abuse | Passphrase login, short-lived signed tokens, route authorization, origin checks, and login rate limiting |
| Stale edits across revisions | Plan-base revision IDs, exact expected values, optimistic concurrency |
| Base changes during an open session | The active session keeps its cloned starting snapshot |
| Human modification bypasses checks | Run human text through the validation and warning pipeline |
| Export layout changes after a renderer upgrade | Keep templates versioned in the repository and export important artifacts before discarding the workspace |
| Font or renderer differences | Pin fonts, dependencies, and renderer; run visual regression tests |

## 27. Architecture Decisions

The following decisions are accepted for version 1:

1. The supplied July resume PDF is the starting reference artifact.
2. The operational base resume is structured YAML copied into the Git repository.
3. The baseline is three pages; page length is not constrained.
4. Browser HTML is the live preview path.
5. WeasyPrint runs only for explicit export or explicit final-layout confirmation.
6. Every session uses the same fixed resume design and structural template.
7. Session revisions exist only in memory for the lifetime of the open frontend tab.
8. Complete resume snapshots are retained in memory for accepted revisions.
9. Canonical updates require a distinct human-confirmed operation.
10. Git push is not required for application operation; canonical YAML changes remain a separate repository action.
11. ModelScope is the inference provider.
12. The initial model chain is Qwen3.5-397B-A17B, Qwen3.5-35B-A3B, then the independent Nemotron3 Nano llama.cpp Space.
13. Model IDs remain configurable and the two ModelScope candidates are compared through tailoring evaluations.
14. Structured output uses Pydantic AI `PromptedOutput`, Pydantic validation, one bounded repair request, and `FallbackModel`; native provider JSON Schema is optional only after model-specific verification.
15. The ModelScope token exists only in backend secrets.
16. Vercel hosts the frontend and the workspace VPS hosts the Docker backend behind Caddy and Sablier.
17. The backend is stateless; no durable Space volume or backend database is required for version 1.
18. PDFs are returned directly for download and are not archived by the backend.
19. Tailor intentionally provides no application-state persistence, history archive, or backup/import flow in version 1.
20. Authentication uses a custom passphrase dialog, an Argon2id hash in backend secrets, and a short-lived signed bearer token stored in browser `sessionStorage`.
21. The backend verifies tokens statelessly; no Vercel Function or authentication database is required.
22. The GitHub repository is public and the backend is protected by Tailor's application authentication; repository-tracked source and canonical assets are accepted as publicly readable.
23. Tinos and Arimo are bundled under Apache 2.0 as metric-compatible substitutes for Times New Roman and Arial; Microsoft font files are not committed.
24. Content ordering is adaptive: the agent may propose reordering schema-defined sections and items, selecting or omitting content, and adopting evidence-supported JD terminology while the visual template remains fixed.
25. Truthfulness, evidence linkage, protected facts, schema validity, and explicit approval are the ordering and ATS-optimization boundaries; chronology and base order are not hard constraints.
26. The agent may propose new session-only bullets, summaries, taglines, project descriptions, and skill placements when every factual component is supported by cited evidence.
27. Session-only content may split, combine, or reframe compatible evidence and adopt supported ATS terminology, but cannot transfer facts across ownership boundaries or enter the canonical resume without a separate repository edit.
28. There is exactly one disposable active workspace per tab.
29. Starting a new session permanently clears the current in-memory workspace after confirmation and cannot remove already downloaded PDFs.
30. Refreshing or closing the tab intentionally discards the workspace.
31. Template versions are immutable directories retained in the repository; historical sessions never silently fall forward to a newer template.
32. Tabs are independent; generation checks prevent stale asynchronous validation from overwriting newer in-tab decisions, while the backend validates supplied snapshot hashes.
33. Base IDs come from canonical YAML, browser-domain record IDs come from the frontend, and agent-operation IDs are generated or normalized by the backend rather than trusted from model output.
34. JD requirements carry stable analysis-scoped IDs used by edit and cover-letter evidence references.
35. Export responses include download metadata but neither frontend nor backend archives the PDF.

## 28. Decision Review Status

Questions 1 through 9 are resolved in Section 27. No product-architecture decision from the review remains open. Phase 0 still contains verification work, including live model evaluation, deployment checks, font checksums, and visual acceptance, but these are validation gates rather than unresolved product choices.

## 29. Definition of MVP Complete

The MVP is complete when the deployed application can:

1. Load the validated base resume derived from `resume0726.pdf`.
2. Create an in-memory session pinned to a base and template version.
3. Accept and analyze a pasted job description through ModelScope.
4. Let the user correct the analysis.
5. Generate valid, evidence-linked edit proposals against the active revision.
6. Let the user approve, reject, and modify proposals individually.
7. Track complete revision snapshots through multiple passes in the active tab.
8. Request another agent pass against the latest selected revision.
9. Render the active revision through the fixed browser template.
10. Export the exact active revision to PDF on demand.
11. Clearly warn before permanently discarding work through the new-session action.
12. Return to a blank workspace after reset or refresh.
13. Keep the ModelScope token out of the frontend, repository, logs, and artifacts.
14. Preserve active-tab work through provider failures, quota errors, and stale client responses.

Cover-letter generation is the next complete milestone if it is not included in the first MVP release.

## 30. Current Platform References

- ModelScope API Inference introduction: <https://modelscope.cn/docs/model-service/API-Inference/intro>
- ModelScope API Inference limits and supported-model behavior: <https://www.modelscope.cn/docs/model-service/API-Inference/limits>
- Sablier scale-to-zero documentation: <https://sablierapp.dev/tutorials/getting-started/>
- Sablier Docker socket proxy guidance: <https://sablierapp.dev/how-to-guides/advanced/security/docker-socket-proxy/>
- Vercel Vite deployment: <https://vercel.com/docs/frameworks/frontend/vite>
- WeasyPrint documentation: <https://doc.courtbouillon.org/weasyprint/stable/>
- WeasyPrint API and versioning: <https://doc.courtbouillon.org/weasyprint/stable/api_reference.html>
