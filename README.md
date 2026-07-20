# Tailor

Tailor is a personal, human-in-the-loop resume tailoring workspace. It turns a pasted job description into evidence-linked edit proposals, keeps every approved state as a browser-local revision, previews a fixed resume template as HTML, and generates PDF files only on request.

The complete product and architecture baseline is in [docs/plan.md](docs/plan.md).

## Architecture

- `frontend/`: React, Vite, TypeScript, IndexedDB session history, deployed to Vercel.
- `backend/`: stateless FastAPI service, YAML-defined Pydantic AI agents and resume tools, typed edit validation, Jinja templates, and WeasyPrint export.
- `backend/canon/resume.yaml`: validated repository seed with stable content IDs.
- `backend/canon/reference/resume0726.pdf`: immutable source and visual reference.
- `backend/render/templates/resume-v1`: immutable resume renderer shared by browser preview and PDF export.

The backend does not keep sessions or generated artifacts. A browser backup contains bases, sessions, revisions, plans, decisions, and cover-letter state. Downloaded PDFs remain in the user's filesystem.

## Local setup

Requirements: `uv`, Python 3.11 or newer, Node.js 20 or newer, and the WeasyPrint system libraries listed in `backend/Dockerfile`.

```bash
make setup
cp backend/.env.example backend/.env
make auth-hash
```

Put the generated Argon2id value in `TAILOR_PASSWORD_HASH`, generate a strong random `AUTH_SIGNING_SECRET`, and set `MODELSCOPE_API_TOKEN`. Then run:

```bash
make dev
```

Copy `frontend/.env.example` to `frontend/.env.local` for local development. The application calls the configured backend URL directly and is available at `http://localhost:5173`.

## Verification

```bash
make lint
make test
```

Agent tests do not spend API credit. Provider behavior is tested through validation boundaries; perform a live smoke test deliberately after configuring a token.

## Hugging Face Space

Create a public Docker Space with `backend/` as its repository contents. Configure the values from `backend/.env.example` in Space Settings. `backend/Dockerfile` listens on port 7860 and includes WeasyPrint dependencies. It builds with `backend/` as its Docker context.

Required secrets:

- `MODELSCOPE_API_TOKEN`
- `TAILOR_PASSWORD_HASH`
- `AUTH_SIGNING_SECRET`

Set `ALLOWED_ORIGINS` to the Vercel production origin and any intentionally supported preview origins. Never commit `.env`.

## Vercel

Deploy `frontend/` as the Vercel project root and set `VITE_API_BASE_URL` to the Hugging Face Space origin. The frontend makes direct cross-origin API requests, so `ALLOWED_ORIGINS` on the backend must list the Vercel production and intentionally supported preview origins.

## Base updates

Tailoring decisions never modify `backend/canon/resume.yaml`. The Promote control creates an immutable browser-local base version and downloads a validated replacement YAML file. Replacing the repository seed and committing it remain deliberate local actions, not application behavior.

## Security boundary

The passphrase protects API use and model quota. The Space is public, so committed source, canonical resume content, reference PDF, fonts, and templates are public. The access token is short-lived and stored only in `sessionStorage`; the reusable passphrase is not retained by the frontend.
