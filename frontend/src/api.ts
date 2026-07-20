import type {
  Analysis,
  BaseVersion,
  CoverLetter,
  Decision,
  Plan,
  Resume,
} from "./types";

const API = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "https://bukunmi2108-tailor.hf.space"
).replace(/\/$/, "");
const TOKEN_KEY = "tailor-access-token";

export const token = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (value: string) => sessionStorage.setItem(TOKEN_KEY, value),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData))
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
  return response.json() as Promise<T>;
}

async function blobRequest(path: string, body: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.get() ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      (
        await response.json().catch(() => ({ detail: response.statusText }))
      ).detail,
    );
  return { blob: await response.blob(), headers: response.headers };
}

export const api = {
  login: (passphrase: string) =>
    request<{ access_token: string; expires_at: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ passphrase }),
    }),
  base: () => request<BaseVersion>("/api/base/current"),
  provider: () =>
    request<{
      configured: boolean;
      models: Array<{ model: string; ready: boolean }>;
    }>("/api/provider/status"),
  analyze: (jd_raw: string, resume: Resume) =>
    request<{ analysis: Analysis; model_id: string }>("/api/agent/analyze", {
      method: "POST",
      body: JSON.stringify({ jd_raw, resume }),
    }),
  plan: (
    jd_raw: string,
    resume: Resume,
    analysis: Analysis,
    instruction: string,
    prior_decisions: Decision[],
  ) =>
    request<{ plan: Plan; model_id: string }>("/api/agent/plan", {
      method: "POST",
      body: JSON.stringify({
        jd_raw,
        resume,
        analysis,
        instruction: instruction || null,
        prior_decisions,
      }),
    }),
  derive: (
    snapshot: Resume,
    plan: Plan,
    decisions: Decision[],
    expected_snapshot_hash: string,
  ) =>
    request<{ resume: Resume; content_hash: string; warnings: string[] }>(
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
  previewResume: async (resume: Resume) => {
    const response = await fetch(`${API}/api/render/resume-preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.get() ?? ""}`,
      },
      body: JSON.stringify({
        resume,
        template_version: resume.template_version,
      }),
    });
    if (!response.ok) throw new Error("Preview failed");
    return response.text();
  },
  previewCover: async (cover_letter: CoverLetter) => {
    const response = await fetch(`${API}/api/render/cover-preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.get() ?? ""}`,
      },
      body: JSON.stringify({ cover_letter, template_version: "cover-v1" }),
    });
    if (!response.ok) throw new Error("Preview failed");
    return response.text();
  },
  cover: (
    jd_raw: string,
    resume: Resume,
    analysis: Analysis,
    tone: string,
    length: string,
    points: string,
  ) =>
    request<{ cover_letter: CoverLetter; model_id: string }>(
      "/api/agent/cover-letter",
      {
        method: "POST",
        body: JSON.stringify({
          jd_raw,
          resume,
          analysis,
          tone,
          length,
          points,
        }),
      },
    ),
  exportResume: (resume: Resume, company: string, role_title: string) =>
    blobRequest("/api/export/resume", {
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
    blobRequest("/api/export/cover-letter", {
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
    blobRequest("/api/export/both", {
      resume,
      cover_letter,
      resume_template_version: resume.template_version,
      cover_template_version: "cover-v1",
      company,
      role_title,
    }),
  yaml: (resume: Resume) =>
    blobRequest("/api/base/serialize-yaml", {
      resume,
      template_version: resume.template_version,
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
