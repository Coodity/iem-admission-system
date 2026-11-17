const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';

export type DocStatus = 'Pending' | 'Verified' | 'Rejected';
export type AppStatus = 'Submitted' | 'Under Review' | 'Approved' | 'Rejected';
export type FeeType = 'Application' | 'Admission';

export interface AppDoc {
  label: string; originalName?: string; status: DocStatus; reason: string; reuploads: number;
  uploadedAt?: string; verifiedBy?: string; verifiedAt?: string;
}
export interface Payment { type: FeeType; amount: number; reference: string; status: string; at: string }
export interface FeeRecord { type: FeeType; status: 'Pending' | 'Paid'; amount: number; recordedBy: string; recordedAt: string }
export interface HistoryEntry { status: string; at: string; by: string; byId?: string }
export interface Application {
  _id: string; appId: string; applicantName: string; course: string; campus: string;
  qualification: string; marks: number; docs: AppDoc[]; payments: Payment[]; feeRecords?: FeeRecord[];
  feeVerified: boolean; feeVerifiedBy?: string; status: AppStatus; decisionReason: string;
  history: HistoryEntry[]; createdAt: string; updatedAt: string;
  feeSchedule?: { Application: number; Admission: number | null }; // staff responses only
}
export interface Course { _id: string; name: string; campuses: string[]; minPercent: number; fee: number; active?: boolean }
export interface Note {
  _id: string; appId: string; applicantEmail?: string; trigger: string; content: string;
  sentAt: string; deliveryStatus: 'Sent' | 'Failed'; failureReason?: string;
}
export interface StaffMember { _id: string; name: string; email: string; role: 'officer' | 'admin'; active: boolean }
export interface AuditEntry { _id: string; logId: string; userId: string; userName: string; role?: string; action: string; target: string; at: string }
export interface Report {
  type: string; title: string; columns: string[]; rows: (string | number)[][];
  total: number; from: string; to: string; generatedAt: string;
}

export class ApiError extends Error {
  fields: Record<string, string>;
  constructor(message: string, fields: Record<string, string> = {}) {
    super(message);
    this.fields = fields;
  }
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const hadToken = !!localStorage.getItem('token');
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...authHeader(),
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && hadToken) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(data?.error || 'Request failed', data?.errors || {});
  }
  return data as T;
}

async function fetchBlob(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { headers: authHeader() });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(data?.error || 'Could not download the file');
  }
  return res.blob();
}

// Opens a protected file (staff only) in a new tab
export async function openFile(path: string) {
  const blob = await fetchBlob(path);
  window.open(URL.createObjectURL(blob), '_blank');
}

// Saves a protected file (CSV / PDF export) to the user's device
export async function downloadFile(path: string, fileName: string) {
  const url = URL.createObjectURL(await fetchBlob(path));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmtDate = (d?: string) => (d ? new Date(d).toLocaleString() : '—');

// Builds a query string, leaving out empty values
export function qs(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
}
