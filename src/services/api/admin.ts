import api from "./apiClient";
import type { AdminSessionDoc } from "../../types";

export async function getAdminLogin(): Promise<{ username: string; password: string }> {
  const res = await api.get(`/api/admin/login`);
  return {
    username: res.data?.username || "",
    password: res.data?.password || "",
  };
}

export async function saveAdminLogin(username: string, password: string) {
  const res = await api.put(`/api/admin/login`, { username, password });
  return res.data;
}

export async function getGlobalPhone(): Promise<string> {
  const res = await api.get(`/api/admin/globalPhone`);
  const data = res.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "phone" in data) return (data as any).phone || "";
  return "";
}

export async function setGlobalPhone(phone: string) {
  const res = await api.put(`/api/admin/globalPhone`, { phone });
  return res.data;
}

export async function createAdminSession(admin: string, deviceId: string) {
  const res = await api.post(`/api/admin/session/create`, { admin, deviceId });
  return res.data;
}

export async function pingAdminSession(admin: string, deviceId: string) {
  const res = await api.post(`/api/admin/session/ping`, { admin, deviceId });
  return res.data;
}

export async function listSessions(): Promise<AdminSessionDoc[]> {
  const res = await api.get(`/api/admin/sessions`);
  return Array.isArray(res.data) ? res.data : [];
}

export async function logoutDevice(deviceId: string) {
  const res = await api.delete(`/api/admin/sessions/${encodeURIComponent(deviceId)}`);
  return res.data;
}

export async function logoutAll() {
  const res = await api.delete(`/api/admin/sessions`);
  return res.data;
}
