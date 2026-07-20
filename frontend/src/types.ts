export type TextAtom = {
  id: string;
  text: string;
  tags?: string[];
  evidence_ids?: string[];
  visible?: boolean;
};
export type Resume = {
  schema_version: number;
  base_version: number;
  template_version: string;
  section_order: string[];
  meta: {
    name: string;
    headline: string;
    contact: {
      location: string;
      phone: string;
      email: string;
      links: Array<{ id: string; label: string; url: string }>;
    };
  };
  profile: TextAtom;
  experience: Array<{
    id: string;
    company: string;
    title: string;
    location: string;
    dates: string;
    tagline?: TextAtom;
    bullets: TextAtom[];
    visible?: boolean;
  }>;
  projects: Array<{
    id: string;
    name: string;
    links: Array<{ id: string; label: string; url: string }>;
    text: string;
    tags: string[];
    visible?: boolean;
  }>;
  education: Array<{
    id: string;
    institution: string;
    qualification: string;
    dates: string;
    details: TextAtom;
    visible?: boolean;
  }>;
  skills: Array<{
    id: string;
    label: string;
    items: string[];
    visible?: boolean;
  }>;
  certifications: Array<{ id: string; text: string; visible?: boolean }>;
  leadership: Array<{
    id: string;
    title: string;
    text: string;
    visible?: boolean;
  }>;
  languages: Array<{
    id: string;
    language: string;
    proficiency: string;
    visible?: boolean;
  }>;
};
export type Requirement = {
  requirement_id: string;
  text: string;
  priority: "must_have" | "nice_to_have";
  keywords: string[];
  coverage: "covered" | "partial" | "missing";
  evidence_ids: string[];
};
export type Analysis = {
  company?: string;
  role_title: string;
  seniority: string;
  requirements: Requirement[];
  culture_signals: string[];
  red_flags: string[];
  summary: string;
};
export type Edit = {
  edit_id: string;
  target_id: string;
  op: string;
  rationale: string;
  jd_requirement_ids: string[];
  evidence_ids: string[];
  risk: "safe" | "review";
  warnings: string[];
  before?: string;
  after?: string;
  field?: string;
  visible?: boolean;
  [key: string]: unknown;
};
export type Plan = {
  plan_id: string;
  base_snapshot_hash: string;
  edits: Edit[];
  keyword_coverage: Record<string, string>;
  notes: string[];
  model_id?: string;
  created_at: string;
};
export type Decision = {
  edit_id: string;
  decision: "approved" | "rejected" | "modified";
  modified_after?: string;
};
export type Revision = {
  revisionId: string;
  sessionId: string;
  parentRevisionId?: string;
  resume: Resume;
  contentHash: string;
  createdAt: string;
  note: string;
};
export type CoverLetter = {
  greeting: string;
  paragraphs: Array<{
    paragraph_id: string;
    text: string;
    evidence_ids: string[];
  }>;
  close: string;
  signoff: string;
  name: string;
};
export type Session = {
  sessionId: string;
  baseVersionId: string;
  activeRevisionId: string;
  templateVersion: string;
  jdRaw: string;
  analysis?: Analysis;
  plan?: Plan;
  decisions: Decision[];
  coverLetter?: CoverLetter;
  company?: string;
  roleTitle?: string;
  status: "draft" | "ready" | "archived";
  createdAt: string;
  updatedAt: string;
};
export type BaseVersion = {
  version_id: string;
  schema_version: number;
  resume_snapshot: Resume;
  content_hash: string;
  template_version: string;
  source: string;
  createdAt?: string;
  previous_version_id?: string;
  change_note?: string;
};
export type Backup = {
  format: "tailor-backup";
  version: 1;
  exportedAt: string;
  baseVersions: BaseVersion[];
  sessions: Session[];
  revisions: Revision[];
};
