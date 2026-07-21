# Tailor

Tailor is a personal, human-in-the-loop resume tailoring workspace. It turns a pasted job description into evidence-linked edit proposals, tracks approved states for the lifetime of the open tab, previews a fixed resume template as HTML, and generates PDF files only on request.

The complete product and architecture baseline is in [docs/plan.md](docs/plan.md).

## Architecture

- `frontend/`: React, Vite, TypeScript, and an intentionally disposable in-memory workspace, deployed to Vercel.
- `backend/`: stateless FastAPI service, YAML-defined Pydantic AI agents and resume tools, typed edit validation, Jinja templates, and WeasyPrint export.
- `backend/canon/resume.yaml`: validated repository seed with stable content IDs.
- `backend/canon/reference/resume0726.pdf`: immutable source and visual reference.
- `backend/render/templates/resume-v1`: immutable resume renderer shared by browser preview and PDF export.

The backend does not keep sessions or generated artifacts. Refreshing or closing the tab discards the active session. Downloaded PDFs remain in the user's filesystem.

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

## Production deployment

The frontend is deployed from `frontend/` on Vercel. The backend runs as a Docker container on the shared Contabo workspace VPS. Caddy terminates HTTPS and Sablier stops the backend after 24 hours without traffic, then starts it on the next request. The gateway and Sablier remain running so cold starts are reachable.

Production infrastructure is declared under `deploy/`:

- `deploy/workspace/gateway/`: shared Caddy, Sablier, and restricted Docker socket proxy;
- `deploy/workspace/bin/deploy-tailor`: server-side revision deployment command;
- `deploy/tailor/compose.yaml`: Tailor backend service, resource limits, health check, and scale-to-zero labels;
- `.github/workflows/pipeline.yml`: backend/frontend CI followed by a gated main-branch VPS deployment.

The VPS keeps the backend environment in `/opt/workspace/apps/tailor/.env`; deployments never overwrite it. `backend/Dockerfile` listens on port 7860 and includes the WeasyPrint dependencies.

Required secrets:

- `MODELSCOPE_API_TOKEN`
- `TAILOR_PASSWORD_HASH`
- `AUTH_SIGNING_SECRET`

Set `ALLOWED_ORIGINS` to the exact Vercel production origin and any intentionally supported preview origins. Never commit `.env`. PostgreSQL is not part of Tailor: application state remains intentionally disposable in browser memory.

## Vercel

Deploy `frontend/` as the Vercel project root and set `VITE_API_BASE_URL` to the HTTPS DuckDNS backend origin. The frontend makes direct cross-origin API and WebSocket requests, so `ALLOWED_ORIGINS` on the backend must list the Vercel production and intentionally supported preview origins.

## Base updates

Tailoring decisions never modify `backend/canon/resume.yaml`. Replacing the repository seed and committing it remain deliberate local actions, not application behavior.

## Security boundary

The passphrase protects API use and model quota; it does not make this public repository private. The access token is short-lived and stored only in `sessionStorage`; the reusable passphrase is not retained by the frontend. HTTP CORS and WebSocket Origin checks both enforce the configured frontend origins.
