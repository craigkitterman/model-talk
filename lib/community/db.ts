"use client";

import { endpoints } from "./config";
import { resetSession, session } from "./auth";

/** Minimal Firestore REST encoder/decoder. Enough for our documents; no SDK weight. */
type FsValue =
  | { stringValue: string } | { integerValue: string } | { doubleValue: number } | { booleanValue: boolean }
  | { nullValue: null } | { arrayValue: { values?: FsValue[] } } | { mapValue: { fields?: Record<string, FsValue> } }
  | { timestampValue: string };

export function encode(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === "object") {
    const fields: Record<string, FsValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val !== undefined) fields[k] = encode(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

export function decode(v: FsValue | undefined): unknown {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decode);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, decode(x)]));
  return undefined;
}

export function decodeDoc(doc: { name: string; fields?: Record<string, FsValue> }) {
  const id = doc.name.split("/").pop()!;
  return { id, ...(decode({ mapValue: { fields: doc.fields ?? {} } }) as Record<string, unknown>) };
}

async function authed(): Promise<{ uid: string; headers: Record<string, string> }> {
  const s = await session();
  return { uid: s.uid, headers: { "content-type": "application/json", authorization: `Bearer ${s.idToken}` } };
}

/**
 * Create a document with server-assigned time in the named field. Uses documents:commit
 * with a REQUEST_TIME transform so firestore.rules can insist `field == request.time`.
 * `currentDocument.exists=false` makes it create-only: a second write fails, never overwrites.
 */
export async function createWithServerTime(path: string, data: Record<string, unknown>, timeField: string, retry = true): Promise<{ uid: string }> {
  const { uid, headers } = await authed();
  const base = endpoints().firestore;
  // Firestore wants the resource name, not a URL: projects/{p}/databases/(default)/documents/{path}
  const name = `${base.replace(/^https?:\/\/[^/]+\/v1\//, "")}/${path}`;
  const fields = (encode({ ...data, uid }) as { mapValue: { fields: Record<string, FsValue> } }).mapValue.fields;
  const res = await fetch(`${base}:commit`, {
    method: "POST", headers,
    body: JSON.stringify({
      writes: [{
        update: { name, fields },
        updateTransforms: [{ fieldPath: timeField, setToServerValue: "REQUEST_TIME" }],
        currentDocument: { exists: false },
      }],
    }),
  });
  if ((res.status === 401 || res.status === 403) && retry) {
    // stale or foreign token: sign in again once and retry
    resetSession();
    return createWithServerTime(path, data, timeField, false);
  }
  if (!res.ok) throw new Error(`firestore ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { uid };
}

export async function getDoc(path: string) {
  const res = await fetch(`${endpoints().firestore}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore ${res.status}`);
  return decodeDoc(await res.json());
}

export async function listCollection(path: string, limit = 200) {
  const res = await fetch(`${endpoints().firestore}/${path}?pageSize=${limit}`);
  if (!res.ok) throw new Error(`firestore ${res.status}`);
  const j = await res.json();
  return ((j.documents ?? []) as { name: string; fields?: Record<string, FsValue> }[]).map(decodeDoc);
}
