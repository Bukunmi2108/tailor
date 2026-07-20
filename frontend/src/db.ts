import type { Backup, BaseVersion, Revision, Session } from "./types";

const NAME = "tailor";
const VERSION = 1;
type Store = "base_versions" | "sessions" | "resume_revisions" | "app_metadata";
const ACTIVE_SESSION_KEY = "activeSessionId";

let dbPromise: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("base_versions"))
          db.createObjectStore("base_versions", { keyPath: "version_id" });
        if (!db.objectStoreNames.contains("sessions")) {
          const store = db.createObjectStore("sessions", {
            keyPath: "sessionId",
          });
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains("resume_revisions")) {
          const store = db.createObjectStore("resume_revisions", {
            keyPath: "revisionId",
          });
          store.createIndex("sessionId", "sessionId");
        }
        if (!db.objectStoreNames.contains("app_metadata"))
          db.createObjectStore("app_metadata", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}
function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}
function read<T>(store: Store, key: IDBValidKey): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error);
      }),
  );
}
function all<T>(store: Store): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      }),
  );
}
async function put<T>(store: Store, value: T) {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await done(tx);
}
async function remove(store: Store, key: IDBValidKey) {
  const database = await openDb();
  const tx = database.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await done(tx);
}

export const db = {
  getSession: (id: string) => read<Session>("sessions", id),
  getRevision: (id: string) => read<Revision>("resume_revisions", id),
  bases: () => all<BaseVersion>("base_versions"),
  async sessionRevisions(id: string): Promise<Revision[]> {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const request = database
        .transaction("resume_revisions")
        .objectStore("resume_revisions")
        .index("sessionId")
        .getAll(IDBKeyRange.only(id));
      request.onsuccess = () => resolve(request.result as Revision[]);
      request.onerror = () => reject(request.error);
    });
  },
  putBase: (base: BaseVersion) => put("base_versions", base),
  putSession: (session: Session) => put("sessions", session),
  async patchSession(id: string, patch: Partial<Session>) {
    const database = await openDb();
    const tx = database.transaction("sessions", "readwrite");
    const store = tx.objectStore("sessions");
    const current = await new Promise<Session>((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result as Session);
      request.onerror = () => reject(request.error);
    });
    store.put({ ...current, ...patch });
    await done(tx);
  },
  putRevision: (revision: Revision) => put("resume_revisions", revision),
  async saveRevision(session: Session, revision: Revision, expectedActive: string) {
    const database = await openDb();
    const tx = database.transaction(["sessions", "resume_revisions"], "readwrite");
    const sessions = tx.objectStore("sessions");
    const current = await new Promise<Session>((resolve, reject) => {
      const req = sessions.get(session.sessionId);
      req.onsuccess = () => resolve(req.result as Session);
      req.onerror = () => reject(req.error);
    });
    if (current.activeRevisionId !== expectedActive) {
      tx.abort();
      throw new Error("This session changed in another tab. Reload before saving.");
    }
    tx.objectStore("resume_revisions").put(revision);
    sessions.put(session);
    await done(tx);
  },
  async getActiveSession(): Promise<Session | undefined> {
    const pointer = await read<{ key: string; sessionId: string }>("app_metadata", ACTIVE_SESSION_KEY);
    if (!pointer) return undefined;
    return db.getSession(pointer.sessionId);
  },
  async setActiveSession(sessionId: string) {
    await put("app_metadata", { key: ACTIVE_SESSION_KEY, sessionId });
  },
  async clearActiveSession() {
    await remove("app_metadata", ACTIVE_SESSION_KEY);
  },
  /** Activate a new session while retaining earlier sessions and their revision history. */
  async replaceActiveSession(session: Session, revision: Revision) {
    const database = await openDb();
    const tx = database.transaction(["sessions", "resume_revisions", "app_metadata"], "readwrite");
    tx.objectStore("sessions").put(session);
    tx.objectStore("resume_revisions").put(revision);
    tx.objectStore("app_metadata").put({ key: ACTIVE_SESSION_KEY, sessionId: session.sessionId });
    await done(tx);
  },
  async backup(): Promise<Backup> {
    const active = await db.getActiveSession();
    return {
      format: "tailor-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      baseVersions: await db.bases(),
      sessions: active ? [active] : [],
      revisions: active ? await db.sessionRevisions(active.sessionId) : [],
    };
  },
  async restore(backup: Backup) {
    if (backup.format !== "tailor-backup" || backup.version !== 1)
      throw new Error("Unsupported backup file");
    for (const base of backup.baseVersions) await db.putBase(base);
    for (const session of backup.sessions) {
      await db.putSession(session);
      await db.setActiveSession(session.sessionId);
    }
    for (const revision of backup.revisions) await db.putRevision(revision);
  },
};

export async function withSessionLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(`tailor:${id}`, work);
  return work();
}
