import type {
  BaseVersion,
  CoverLetter,
  Decision,
  Plan,
  Resume,
} from "./types";

const API = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:7860"
).replace(/\/$/, "");
const TOKEN_KEY = "tailor-access-token";

export const token = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (value: string) => sessionStorage.setItem(TOKEN_KEY, value),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

/**
 * Single fetch path: attaches auth, sets JSON content type, clears the token on 401, and
 * raises the server's `detail` on failure. Callers pick the body shape (json/text/blob).
 */
async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const accessToken = token.get();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API}${path}`, { ...init, headers });
  if (response.status === 401) token.clear();
  if (!response.ok) {
    const detail = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw new Error(
      typeof detail.detail === "string"
        ? detail.detail
        : JSON.stringify(detail.detail),
    );
  }
  return response;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await send(path, init)).json() as Promise<T>;
}

async function requestText(path: string, body: unknown, signal?: AbortSignal): Promise<string> {
  return (await send(path, { method: "POST", body: JSON.stringify(body), signal })).text();
}

async function requestBlob(path: string, body: unknown) {
  const response = await send(path, { method: "POST", body: JSON.stringify(body) });
  return { blob: await response.blob(), headers: response.headers };
}

export const api = {
  login: (passphrase: string) =>
    requestJson<{ access_token: string; expires_at: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ passphrase }),
    }),
  base: () => requestJson<BaseVersion>("/api/base/current"),
  derive: (
    snapshot: Resume,
    plan: Plan,
    decisions: Decision[],
    expected_snapshot_hash: string,
  ) =>
    requestJson<{ resume: Resume; content_hash: string; warnings: string[] }>(
      "/api/resume/derive",
      {
        method: "POST",
        body: JSON.stringify({
          snapshot,
          plan,
          decisions,
          expected_snapshot_hash,
        }),
      },
    ),
  previewResume: (resume: Resume, signal?: AbortSignal) =>
    requestText("/api/render/resume-preview", {
      resume,
      template_version: resume.template_version,
    }, signal),
  previewCover: (cover_letter: CoverLetter, signal?: AbortSignal) =>
    requestText("/api/render/cover-preview", {
      cover_letter,
      template_version: "cover-v1",
    }, signal),
  exportResume: (resume: Resume, company: string, role_title: string) =>
    requestBlob("/api/export/resume", {
      resume,
      template_version: resume.template_version,
      company,
      role_title,
    }),
  exportCover: (
    cover_letter: CoverLetter,
    company: string,
    role_title: string,
  ) =>
    requestBlob("/api/export/cover-letter", {
      cover_letter,
      template_version: "cover-v1",
      company,
      role_title,
    }),
  exportBoth: (
    resume: Resume,
    cover_letter: CoverLetter,
    company: string,
    role_title: string,
  ) =>
    requestBlob("/api/export/both", {
      resume,
      cover_letter,
      resume_template_version: resume.template_version,
      cover_template_version: "cover-v1",
      company,
      role_title,
    }),
};

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
