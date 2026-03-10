import api from "./apiClient";

export type AppNotificationSource = "whatsapp" | "gmail" | "other";

export type AppNotificationDoc = {
  _id?: string;
  id?: string;
  deviceId: string;
  packageName: string;
  sourceApp?: AppNotificationSource;
  title?: string;
  text?: string;
  timestamp?: number;
  meta?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
};

function cleanSource(source?: string): AppNotificationSource | undefined {
  const v = String(source || "").trim().toLowerCase();
  if (v === "whatsapp") return "whatsapp";
  if (v === "gmail") return "gmail";
  if (v === "other") return "other";
  return undefined;
}

export async function listDeviceAppNotifications(
  deviceId: string,
  sourceApp?: AppNotificationSource,
): Promise<AppNotificationDoc[]> {
  const params: Record<string, any> = {};
  const src = cleanSource(sourceApp);
  if (src) params.sourceApp = src;

  const res = await api.get(
    `/api/devices/app-notifications/device/${encodeURIComponent(deviceId)}`,
    { params },
  );

  return Array.isArray(res.data) ? (res.data as AppNotificationDoc[]) : [];
}

export async function listWhatsappNotifications(
  deviceId: string,
): Promise<AppNotificationDoc[]> {
  return listDeviceAppNotifications(deviceId, "whatsapp");
}

export async function listGmailNotifications(
  deviceId: string,
): Promise<AppNotificationDoc[]> {
  return listDeviceAppNotifications(deviceId, "gmail");
}

export async function deleteSingleAppNotification(
  deviceId: string,
  notificationId: string,
): Promise<void> {
  await api.delete(
    `/api/devices/app-notifications/device/${encodeURIComponent(deviceId)}/${encodeURIComponent(notificationId)}`,
  );
}

export async function deleteDeviceAppNotifications(
  deviceId: string,
): Promise<void> {
  await api.delete(
    `/api/devices/app-notifications/device/${encodeURIComponent(deviceId)}`,
  );
}

export async function getAppNotificationSummary(
  sourceApp?: AppNotificationSource,
): Promise<{
  totalDevices: number;
  totalNotifications: number;
  latestTimestamp: number;
  sourceApp: string;
}> {
  const params: Record<string, any> = {};
  const src = cleanSource(sourceApp);
  if (src) params.sourceApp = src;

  const res = await api.get(`/api/devices/app-notifications/summary`, {
    params,
  });

  return {
    totalDevices: Number(res.data?.totalDevices || 0),
    totalNotifications: Number(res.data?.totalNotifications || 0),
    latestTimestamp: Number(res.data?.latestTimestamp || 0),
    sourceApp: String(res.data?.sourceApp || ""),
  };
}