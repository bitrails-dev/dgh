export type Locale = "ar" | "en";

const apiBase = (import.meta as any).env?.PUBLIC_PORTAL_API_BASE || "http://localhost:8080";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error?.message || `HTTP ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return (await res.json()) as T;
}

export const portalApi = {
  me: () => request<{ patient: { verification_status: string; full_name_ar: string } }>("/v1/me"),
  signup: (payload: any) => request<{ ok: boolean }>("/v1/auth/signup", { method: "POST", body: JSON.stringify(payload) }),
  requestOtp: (payload: any) => request<{ ok: boolean }>("/v1/auth/request-otp", { method: "POST", body: JSON.stringify(payload) }),
  verifyOtp: (payload: any) => request<{ ok: boolean }>("/v1/auth/verify-otp", { method: "POST", body: JSON.stringify(payload) }),
  logout: () => request<{ ok: boolean }>("/v1/auth/logout", { method: "POST", body: "{}" }),

  clinics: () => request<{ clinics: any[] }>("/v1/clinics"),
  visitTypes: () => request<{ visit_types: any[] }>("/v1/visit-types"),
  providers: (clinicId?: string) => request<{ providers: any[] }>(`/v1/providers${clinicId ? `?clinic_id=${encodeURIComponent(clinicId)}` : ""}`),
  slots: (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return request<{ slots: any[] }>(`/v1/slots?${qs}`);
  },
  createAppointment: (payload: any) => request<{ appointment: any }>("/v1/appointments", { method: "POST", body: JSON.stringify(payload) }),
  cancelAppointment: (payload: { appointment_id: string }) => request<{ ok: boolean }>("/v1/appointments/cancel", { method: "POST", body: JSON.stringify(payload) }),
  rescheduleAppointment: (payload: { appointment_id: string; slot_id: string }) => request<{ ok: boolean }>("/v1/appointments/reschedule", { method: "POST", body: JSON.stringify(payload) }),
  appointments: () => request<{ appointments: any[] }>("/v1/appointments"),
  bootstrapDemo: (adminKey: string) =>
    request<{ ok: boolean; seeded: { clinics: number; providers: number; slots: number; visitTypes: number } }>("/v1/admin/bootstrap-demo", {
      method: "POST",
      headers: { "X-Admin-Key": adminKey },
      body: "{}",
    }),
  verifyReception: (adminKey: string, nid: string) =>
    request<{ ok: boolean }>("/v1/admin/reception/verify", {
      method: "POST",
      headers: { "X-Admin-Key": adminKey },
      body: JSON.stringify({ nid }),
    }),
  adminSlots: (adminKey: string, params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return request<{ slots: any[] }>(`/v1/admin/slots?${qs}`, {
      headers: { "X-Admin-Key": adminKey },
    });
  },
  createAdminSlot: (adminKey: string, payload: any) =>
    request<{ ok: boolean; slot: any }>("/v1/admin/slots", {
      method: "POST",
      headers: { "X-Admin-Key": adminKey },
      body: JSON.stringify(payload),
    }),
  deleteAdminSlot: (adminKey: string, slotId: string) =>
    request<{ ok: boolean }>("/v1/admin/slots/delete", {
      method: "POST",
      headers: { "X-Admin-Key": adminKey },
      body: JSON.stringify({ slot_id: slotId }),
    }),
};

