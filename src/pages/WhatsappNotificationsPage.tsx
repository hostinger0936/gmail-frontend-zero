import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import wsService from "../services/ws/wsService";
import {
  listWhatsappNotifications,
  deleteSingleAppNotification,
  deleteDeviceAppNotifications,
  type AppNotificationDoc,
} from "../services/api/appNotifications";
import AnimatedAppBackground from "../components/layout/AnimatedAppBackground";

function safeString(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function getTimestamp(m: any): number {
  const t = m?.timestamp ?? m?.time ?? m?.createdAt ?? m?.date;
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const n = Number(t);
    if (!Number.isNaN(n)) return n;
    const d = Date.parse(t);
    if (!Number.isNaN(d)) return d;
  }
  return 0;
}

function normalizeEvent(msg: any): { type: string; event: string; deviceId: string; data: any } {
  const type = safeString(msg?.type);
  const event = safeString(msg?.event);
  const deviceId = safeString(msg?.deviceId ?? msg?.id ?? msg?.uniqueid ?? msg?.data?.uniqueid);
  const data = msg?.data ?? msg?.payload ?? {};
  return { type, event, deviceId, data };
}

function isWhatsappNotification(item: any): boolean {
  const sourceApp = safeString(item?.sourceApp).trim().toLowerCase();
  const packageName = safeString(item?.packageName).trim().toLowerCase();

  return (
    sourceApp === "whatsapp" ||
    packageName === "com.whatsapp" ||
    packageName === "com.whatsapp.w4b"
  );
}

function SurfaceCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-[24px] border border-slate-200 bg-white/92 shadow-[0_8px_24px_rgba(15,23,42,0.06)]",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export default function WhatsappNotificationsPage() {
  const { deviceId = "" } = useParams<{ deviceId: string }>();
  const nav = useNavigate();
  const did = decodeURIComponent(deviceId || "");

  const mountedRef = useRef(true);

  const [items, setItems] = useState<AppNotificationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [wsConnected, setWsConnected] = useState(wsService.isConnected());

  async function loadNotifications() {
    setLoading(true);
    try {
      const list = await listWhatsappNotifications(did);
      if (!mountedRef.current) return;

      const normalized = (Array.isArray(list) ? list : [])
        .filter((item) => isWhatsappNotification(item))
        .slice()
        .sort((a, b) => getTimestamp(b) - getTimestamp(a));

      setItems(normalized);
    } catch (e) {
      console.error("load whatsapp notifications failed", e);
      if (!mountedRef.current) return;
      setItems([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    wsService.connect();
    loadNotifications();

    return () => {
      mountedRef.current = false;
    };
  }, [did]);

  useEffect(() => {
    const offStatus = wsService.onStatusChange((connected) => {
      setWsConnected(connected);
    });

    const offMessage = wsService.onMessage((msg) => {
      const { type, event, deviceId: evDid, data } = normalizeEvent(msg);

      if (type === "event" && event === "app-notification") {
        const targetId = safeString(data?.deviceId ?? evDid);
        if (targetId !== did) return;
        if (!isWhatsappNotification(data)) return;

        const incomingId = safeString(data?.id ?? data?._id).trim();
        const nextItem: AppNotificationDoc = {
          ...(data || {}),
          _id: incomingId || `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          deviceId: did,
          timestamp: Number(data?.timestamp || msg?.timestamp || Date.now()),
        };

        setItems((prev) => {
          const exists = incomingId
            ? prev.some((x) => safeString(x._id ?? x.id).trim() === incomingId)
            : false;

          if (exists) return prev;

          return [nextItem, ...prev].sort((a, b) => getTimestamp(b) - getTimestamp(a));
        });

        return;
      }

      if (type === "event" && event === "app-notification:deleted") {
        const targetId = safeString(data?.deviceId ?? evDid);
        if (targetId !== did) return;

        const removedId = safeString(data?.id ?? data?._id).trim();
        if (!removedId) return;

        setItems((prev) =>
          prev.filter((item) => safeString(item._id ?? item.id).trim() !== removedId),
        );
        return;
      }

      if (type === "event" && event === "app-notification:clearDevice") {
        const targetId = safeString(data?.deviceId ?? evDid);
        if (targetId !== did) return;
        setItems([]);
      }
    });

    return () => {
      offStatus();
      offMessage();
    };
  }, [did]);

  async function handleDelete(item: AppNotificationDoc) {
    const notificationId = safeString(item?._id ?? item?.id).trim();
    if (!notificationId) {
      alert("Notification id not found");
      return;
    }

    if (!confirm("Delete this WhatsApp notification?")) return;

    setDeletingId(notificationId);

    try {
      await deleteSingleAppNotification(did, notificationId);

      setItems((prev) =>
        prev.filter((x) => safeString(x._id ?? x.id).trim() !== notificationId),
      );

      alert("Notification deleted");
    } catch (e) {
      console.error("delete whatsapp notification failed", e);
      alert("Failed to delete notification");
    } finally {
      setDeletingId("");
    }
  }

  async function handleDeleteAll() {
    if (!items.length) {
      alert("No WhatsApp notifications found");
      return;
    }

    if (!confirm("Delete all WhatsApp notifications for this device?")) return;

    setDeletingAll(true);
    try {
      await deleteDeviceAppNotifications(did);
      setItems([]);
      alert("All WhatsApp notifications deleted");
    } catch (e) {
      console.error("delete all whatsapp notifications failed", e);
      alert("Failed to delete all notifications");
    } finally {
      setDeletingAll(false);
    }
  }

  const headerCount = useMemo(() => items.length, [items]);

  if (!did) {
    return <div className="p-6">Missing device id</div>;
  }

  return (
    <AnimatedAppBackground>
      <div className="mx-auto w-full max-w-[420px] px-3 pb-24 pt-4">
        <SurfaceCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-2xl text-emerald-700">
                  🟢
                </div>
                <div>
                  <div className="text-[22px] font-extrabold tracking-tight text-slate-900">
                    WhatsApp Notifications
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {headerCount} items • {wsConnected ? "Live connected" : "Live reconnecting"}
                  </div>
                </div>
              </div>

              <div className="mt-2 break-all text-[12px] text-slate-500">{did}</div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => nav(`/devices/${encodeURIComponent(did)}`)}
                className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-slate-800 hover:bg-slate-50"
                type="button"
              >
                Back
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <button
              onClick={() => loadNotifications()}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-[13px] font-extrabold text-slate-700 hover:bg-slate-50"
              type="button"
            >
              Refresh
            </button>

            <button
              onClick={() => handleDeleteAll()}
              disabled={deletingAll || loading || items.length === 0}
              className="h-11 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-[13px] font-extrabold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              {deletingAll ? "Deleting..." : "Delete All"}
            </button>

            <button
              onClick={() => nav(`/devices/${encodeURIComponent(did)}/gmail-notifications`)}
              className="h-11 rounded-2xl border border-red-200 bg-red-50 px-4 text-[13px] font-extrabold text-red-700 hover:bg-red-100"
              type="button"
            >
              Open Gmail
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center text-slate-500">
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-slate-500">
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-4">
                  <div className="font-extrabold text-slate-800">No WhatsApp notifications found</div>
                  <div className="max-w-[260px] text-[12px] text-slate-500">
                    Live notifications will appear here for both WhatsApp and WhatsApp Business.
                  </div>
                </div>
              </div>
            ) : (
              items.map((item) => {
                const notificationId = safeString(item?._id ?? item?.id).trim();
                const title = safeString(item?.title).trim() || "(No title)";
                const text = safeString(item?.text).trim() || "—";
                const pkg = safeString(item?.packageName).trim();
                const ts = getTimestamp(item);
                const isDeleting = deletingId === notificationId;

                return (
                  <div
                    key={notificationId || `${pkg}-${ts}-${title}`}
                    className="w-full rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_6px_20px_rgba(15,23,42,0.05)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-extrabold text-slate-900">
                          {title}
                        </div>

                        <div className="mt-1 break-words text-[11px] text-slate-500">
                          {pkg || "com.whatsapp"}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-[11px] text-slate-400">
                          {ts ? new Date(ts).toLocaleString() : "-"}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          disabled={isDeleting || !notificationId}
                          className="mt-2 h-8 rounded-xl border border-rose-200 bg-rose-50 px-3 text-[11px] font-extrabold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 break-words whitespace-pre-wrap text-[13px] text-slate-800">
                      {text}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SurfaceCard>
      </div>
    </AnimatedAppBackground>
  );
}