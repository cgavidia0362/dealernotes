
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Final Stage 5B — Reporting upgrades (per‑rep drilldown, month‑to‑month) + prior fixes
 *
 * What's included:
 *  - Dealer Search: Region filter works globally, labeled "Region"
 *  - Unified Quick Notes on Home & Dealer Notes
 *  - Dealer Notes: Reps with access can edit details; delete dealer for Admin/Manager/Rep with access
 *  - Reporting:
 *      • Overall view (All Reps): existing KPIs + new month‑to‑month visits timeline
 *      • Rep selector: identical KPIs but filtered to a single rep's coverage/overrides
 *      • Visit KPIs: This Month, Last Month, Δ change
 *      • "Dealers not visited in last 30 days" list (by rep coverage)
 */

/* ----------------------------- Types & Models ----------------------------- */
type Role = "Admin" | "Manager" | "Rep";

type User = {
  id: string;
  name: string;
  username: string;
  role: Role;
  states: string[];
  regionsByState: Record<string, string[]>;
  phone?: string; // ← NEW
};


type Contact = { name: string; phone: string };

type DealerStatus = "Active" | "Pending" | "Prospect" | "Inactive" | "Black Listed";
type DealerType = "Franchise" | "Independent";

type Dealer = {
  id: string;
  name: string;
  state: string;
  region: string;
  type: DealerType;
  status: DealerStatus;
  address1?: string;
  address2?: string;
  city?: string;
  zip?: string;
  contacts: Contact[];
  assignedRepUsername?: string; // override
  lastVisited?: string; // YYYY-MM-DD
  sendingDeals?: boolean;
  noDealReasons?: {
    funding?: boolean;
    agreement?: boolean;
    feesRates?: boolean;
    programDiff?: boolean;
    eContracting?: boolean;
    notSigned?: boolean;
    other?: string;
  };
};

type NoteCategory = "Visit" | "Problem" | "Other" | "Manager";
type Note = {
  id: string;
  dealerId: string;
  authorUsername: string;
  tsISO: string;
  category: NoteCategory;
  text: string;
};

type Task = {
  id: string;
  dealerId: string;
  repUsername: string;
  text: string; // dealer name for quick glance
  createdAtISO: string;
};

type RouteKey = "login" | "dealer-search" | "dealer-notes" | "reporting" | "user-management";

/* ------------------------------- Persistence ------------------------------ */
const LS_USERS = "demo_users";
const LS_DEALERS = "demo_dealers";
const LS_REGIONS = "demo_regions";
const LS_TASKS = "demo_tasks";
const LS_NOTES = "demo_notes";
const LS_LAST_SELECTED_DEALER = "demo_last_selected_dealer";

type RegionsCatalog = Record<string, string[]>;

const loadLS = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};
const saveLS = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

/* --------------------------------- Seeders -------------------------------- */
function seedIfNeeded() {
  if (loadLS<User[]>(LS_USERS, []).length === 0) {
    const users: User[] = [
      {
        id: uid(),
        name: "Pronto Admin",
        username: "pronto",
        role: "Admin",
        states: ["IL", "TX"],
        regionsByState: { IL: ["Chicago North", "Chicago South"], TX: ["Dallas", "Houston"] },
      },
      {
        id: uid(),
        name: "General Manager",
        username: "manager",
        role: "Manager",
        states: ["IL", "TX"],
        regionsByState: { IL: ["Chicago North", "Chicago South"], TX: ["Dallas", "Houston"] },
      },
      {
        id: uid(),
        name: "Rep One",
        username: "rep1",
        role: "Rep",
        states: ["IL", "TX"],
        regionsByState: { IL: ["Chicago South"], TX: ["Dallas"] },
      },
    ];
    saveLS(LS_USERS, users);
  }

  if (Object.keys(loadLS<RegionsCatalog>(LS_REGIONS, {})).length === 0) {
    const regions: RegionsCatalog = { IL: ["Chicago North", "Chicago South"], TX: ["Dallas", "Houston"] };
    saveLS(LS_REGIONS, regions);
  }

  if (loadLS<Dealer[]>(LS_DEALERS, []).length === 0) {
    const dealers: Dealer[] = [
      {
        id: uid(),
        name: "Royalton Motors",
        state: "IL",
        region: "Chicago South",
        type: "Independent",
        status: "Active",
        address1: "123 Main St",
        city: "Chicago",
        zip: "60601",
        contacts: [{ name: "Fernando", phone: "(312) 555-0191" }],
        assignedRepUsername: "rep1",
        lastVisited: todayISO(),
        sendingDeals: true,
      },
      {
        id: uid(),
        name: "Oceanside Auto",
        state: "TX",
        region: "Dallas",
        type: "Independent",
        status: "Prospect",
        city: "Dallas",
        contacts: [{ name: "Yasin", phone: "(214) 555-2010" }],
        lastVisited: "2025-08-10",
        sendingDeals: false,
        noDealReasons: { eContracting: true, other: "Waiting on onboarding" },
      },
      {
        id: uid(),
        name: "Wise Auto Group",
        state: "IL",
        region: "Chicago North",
        type: "Franchise",
        status: "Pending",
        city: "Evanston",
        contacts: [{ name: "John", phone: "(847) 555-7711" }],
        lastVisited: "2025-08-15",
      },
    ];
    saveLS(LS_DEALERS, dealers);
  }

  if (loadLS<Task[]>(LS_TASKS, []).length === 0) saveLS(LS_TASKS, []);
  if (loadLS<Note[]>(LS_NOTES, []).length === 0) saveLS(LS_NOTES, []);
}
seedIfNeeded();

/* --------------------------------- Toasts --------------------------------- */
type ToastKind = "success" | "error";
type Toast = { id: string; kind: ToastKind; message: string };

const useToasts = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, number>>({});

  const showToast = (message: string, kind: ToastKind = "success") => {
    const id = uid();
    setToasts((prev) => [{ id, kind, message }, ...prev]);
    const timeout = window.setTimeout(() => dismiss(id), 3500);
    timers.current[id] = timeout as unknown as number;
  };

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  };

  return { toasts, showToast, dismiss };
};

const ToastHost: React.FC<{ toasts: Toast[]; dismiss: (id: string) => void }> = ({ toasts, dismiss }) => (
  <div className="fixed top-4 right-4 z-50 space-y-2">
    {toasts.map((t) => (
      <div
        key={t.id}
        className={`min-w-[260px] max-w-sm rounded-lg shadow-lg p-3 text-sm text-white flex items-start gap-2 ${
          t.kind === "success" ? "bg-green-600" : "bg-red-600"
        }`}
      >
        <div className="flex-1">{t.message}</div>
        <button className="opacity-80 hover:opacity-100 transition" onClick={() => dismiss(t.id)} title="Close">
          ✕
        </button>
      </div>
    ))}
  </div>
);

/* ------------------------------- Auth / App ------------------------------- */
type Session = { username: string; role: Role } | null;

const useData = () => {
  const [users, setUsers] = useState<User[]>(() => loadLS<User[]>(LS_USERS, []));
  const [dealers, setDealers] = useState<Dealer[]>(() => loadLS<Dealer[]>(LS_DEALERS, []));
  const [regions, setRegions] = useState<RegionsCatalog>(() => loadLS<RegionsCatalog>(LS_REGIONS, {}));
  const [tasks, setTasks] = useState<Task[]>(() => loadLS<Task[]>(LS_TASKS, []));
  const [notes, setNotes] = useState<Note[]>(() => loadLS<Note[]>(LS_NOTES, []));

  // Normalize regions to include any state/region found on dealers (helps old seeds)
  useEffect(() => {
    setRegions((prev) => {
      const next: RegionsCatalog = { ...prev };
      for (const d of dealers) {
        if (!next[d.state]) next[d.state] = [];
        if (!next[d.state].includes(d.region)) next[d.state] = [...next[d.state], d.region].sort();
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  useEffect(() => saveLS(LS_USERS, users), [users]);
  useEffect(() => saveLS(LS_DEALERS, dealers), [dealers]);
  useEffect(() => saveLS(LS_REGIONS, regions), [regions]);
  useEffect(() => saveLS(LS_TASKS, tasks), [tasks]);
  useEffect(() => saveLS(LS_NOTES, notes), [notes]);

  return { users, setUsers, dealers, setDealers, regions, setRegions, tasks, setTasks, notes, setNotes };
};

const brand = {
  primary: "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500",
  outline: "border border-blue-600 text-blue-600 hover:bg-blue-50",
  pill: "rounded-full",
};

/* ------------------------------- UI Shell --------------------------------- */
const LoginView: React.FC<{
  onLogin: (s: Session) => void;
  showToast: (m: string, k?: ToastKind) => void;
}> = ({ onLogin, showToast }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const creds = [
    { role: "Admin", u: "pronto", p: "main123" },
    { role: "Manager", u: "manager", p: "main123" },
    { role: "Rep", u: "rep1", p: "main123" },
  ];

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    const match = creds.find((c) => c.u === username && c.p === password);
    if (!match) return showToast("Invalid credentials.", "error");
    onLogin({ username: username, role: match.role as Role });
    showToast(`Welcome, ${username}!`, "success");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100">
      <div className="w-full max-w-md p-6 rounded-2xl bg-slate-800 shadow-xl">
        <h1 className="text-2xl font-semibold text-white text-center mb-6">Dealer Notes Portal</h1>
        <form onSubmit={handle} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Username</label>
            <input
              className="w-full rounded-lg bg-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="pronto / manager / rep1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Password</label>
            <input
              className="w-full rounded-lg bg-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              type="password"
              placeholder="main123"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button className={`w-full ${brand.primary} text-white font-medium rounded-lg px-4 py-2 focus:outline-none focus:ring-2`} type="submit">
            Log In
          </button>
        </form>

        <div className="mt-6 text-xs text-slate-300">
          <div className="font-semibold mb-1">Demo Accounts</div>
          <ul className="list-disc list-inside space-y-1">
            <li>Admin: pronto / main123</li>
            <li>Manager: manager / main123</li>
            <li>Rep: rep1 / main123</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

const TopBar: React.FC<{
  session: Session;
  route: RouteKey;
  setRoute: (r: RouteKey) => void;
  onLogout: () => void;
  can: { reporting: boolean; userMgmt: boolean };
  tasksForUser: Task[];
  onClickTask: (t: Task) => void;
}> = ({ session, route, setRoute, onLogout, can, tasksForUser, onClickTask }) => {
  return (
    <header className="w-full bg-white border-b sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-600 grid place-items-center text-white font-bold">DN</div>
          <div className="text-slate-800 font-semibold">Dealer Notes</div>
          {session && (
            <nav className="ml-6 hidden md:flex items-center gap-1">
              <Tab label="Dealer Search" active={route === "dealer-search"} onClick={() => setRoute("dealer-search")} />
              <Tab label="Reporting" active={route === "reporting"} onClick={() => setRoute("reporting")} disabled={!can.reporting} />
              <Tab label="User Management" active={route === "user-management"} onClick={() => setRoute("user-management")} disabled={!can.userMgmt} />
            </nav>
          )}
        </div>
        {session ? (
          <div className="flex items-center gap-2">
            {tasksForUser.slice(0, 3).map((t) => (
              <button
                key={t.id}
                onClick={() => onClickTask(t)}
                className="hidden sm:inline-flex items-center px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full hover:bg-red-200"
                title="Open task dealer"
              >
                New Task for ({t.text})
              </button>
            ))}
            <div className="text-sm text-slate-600 hidden sm:block">
              <span className="font-medium">{session.username}</span> • <span>{session.role}</span>
            </div>
            <button className={`hidden sm:inline-flex ${brand.outline} ${brand.pill} px-3 py-1.5`} onClick={onLogout}>
              Log Off
            </button>
          </div>
        ) : (
          <div />
        )}
      </div>

      {session && (
        <div className="md:hidden border-t">
          <div className="flex">
            <MobileTab label="Search" active={route === "dealer-search"} onClick={() => setRoute("dealer-search")} />
            <MobileTab label="Reporting" active={route === "reporting"} onClick={() => setRoute("reporting")} disabled={!can.reporting} />
            <MobileTab label="Users" active={route === "user-management"} onClick={() => setRoute("user-management")} disabled={!can.userMgmt} />
            <button className="ml-auto px-3 py-2 text-sm text-blue-600" onClick={onLogout}>
              Log Off
            </button>
          </div>
        </div>
      )}
    </header>
  );
};

const Tab: React.FC<{ label: string; active?: boolean; onClick?: () => void; disabled?: boolean }> = ({ label, active, onClick, disabled }) => (
  <button
    className={`px-3 py-1.5 rounded-md text-sm font-medium ${
      disabled ? "text-slate-300 cursor-not-allowed" : active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
    }`}
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
  >
    {label}
  </button>
);

const MobileTab: React.FC<{ label: string; active?: boolean; onClick?: () => void; disabled?: boolean }> = ({ label, active, onClick, disabled }) => (
  <button
    className={`flex-1 py-2 text-sm ${disabled ? "text-slate-300" : active ? "text-blue-700 border-b-2 border-blue-600" : "text-slate-600"}`}
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
  >
    {label}
  </button>
);

/* ------------------------------ Dealer Search ----------------------------- */

type AddDealerForm = {
  name: string;
  state: string;
  region: string;
  type: DealerType;
  status: DealerStatus;
  address1?: string;
  address2?: string;
  city?: string;
  zip?: string;
  assignedRepUsername?: string;
  contacts: Contact[];
};

const defaultAddDealerForm = (): AddDealerForm => ({
  name: "",
  state: "",
  region: "",
  type: "Independent",
  status: "Prospect",
  address1: "",
  address2: "",
  city: "",
  zip: "",
  assignedRepUsername: "",
  contacts: [{ name: "", phone: "" }],
});

const statusBadge = (s: DealerStatus) => {
  switch (s) {
    case "Active":
      return "bg-green-100 text-green-700";
    case "Pending":
      return "bg-blue-100 text-blue-700";
    case "Prospect":
      return "bg-yellow-100 text-yellow-800";
    case "Inactive":
      return "bg-slate-200 text-slate-700";
    case "Black Listed":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

// Shared quick note key (HOME & NOTES share the same per-user scratchpad)
const quickNoteKey = (username?: string | null) => `quicknote_shared_${username || "anon"}`;

const DealerSearchView: React.FC<{
  session: Session;
  users: User[];
  dealers: Dealer[];
  setDealers: React.Dispatch<React.SetStateAction<Dealer[]>>;
  regions: RegionsCatalog;
  setRegions: React.Dispatch<React.SetStateAction<RegionsCatalog>>;
  can: { reporting: boolean; userMgmt: boolean };
  setRoute: (r: RouteKey) => void;
  showToast: (m: string, k?: ToastKind) => void;
  tasksForUser: Task[];
  onClickTask: (t: Task) => void;
  notes: Note[]; // used for Daily Summary
}> = ({
  session,
  users,
  dealers,
  setDealers,
  regions,
  setRegions,
  can,
  setRoute,
  showToast,
  tasksForUser,
  onClickTask,
  notes,
}) => {
  const [q, setQ] = useState("");
  const [fRep, setFRep] = useState<string>("");
  const [fState, setFState] = useState<string>("");
  const [fRegion, setFRegion] = useState<string>("");
  const [fType, setFType] = useState<string>("");
  const [fStatus, setFStatus] = useState<string>("");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddDealerForm>(defaultAddDealerForm());

  // Quick Notes
  const [scratchOpen, setScratchOpen] = useState(false);
  const sKey = quickNoteKey(session?.username);
  const [scratch, setScratch] = useState<string>(() => loadLS<string>(sKey, ""));
  useEffect(() => {
    localStorage.setItem(sKey, JSON.stringify(scratch));
  }, [sKey, scratch]);

  // Daily Summary (reps only)
  const isRep = session?.role === "Rep";
  const [dailyOpen, setDailyOpen] = useState(false);

  // helpers
  const repOptions = users.filter((u) => u.role === "Rep");

  const stateOptions = useMemo(() => {
    const set = new Set<string>(Object.keys(regions));
    for (const d of dealers) set.add(d.state);
    return Array.from(set).sort();
  }, [regions, dealers]);

  const allRegions = useMemo(() => {
    const set = new Set<string>();
    for (const st of Object.keys(regions)) (regions[st] || []).forEach((r) => set.add(r));
    for (const d of dealers) set.add(d.region);
    return Array.from(set).sort();
  }, [regions, dealers]);

  // Display helpers
  const repNameForDealer = (d: Dealer) => {
    if (d.assignedRepUsername) {
      return users.find((x) => x.username === d.assignedRepUsername)?.name || d.assignedRepUsername;
    }
    const covering = users.filter(
      (u) => u.role === "Rep" && u.states.includes(d.state) && (u.regionsByState[d.state]?.includes(d.region) ?? false)
    );
    if (covering.length === 1) return covering[0].name;
    if (covering.length > 1) return covering.map((x) => x.name).join(", ");
    return "—";
  };

  // Derived filtered list (NOTE: override-only filter removed)
  const filtered = useMemo(() => {
    return dealers
      .filter((d) => {
        if (q) {
          const s = q.toLowerCase();
          const hay = [d.name, d.city || "", d.state, d.region].join(" ").toLowerCase();
          if (!hay.includes(s)) return false;
        }
        if (fRep) {
          if (d.assignedRepUsername) {
            if (d.assignedRepUsername !== fRep) return false;
          } else {
            const repUser = users.find((u) => u.username === fRep);
            if (!repUser) return false;
            const covers = repUser.states.includes(d.state) && (repUser.regionsByState[d.state]?.includes(d.region) ?? false);
            if (!covers) return false;
          }
        }
        if (fState && d.state !== fState) return false;
        if (fRegion && d.region !== fRegion) return false;
        if (fType && d.type !== fType) return false;
        if (fStatus && d.status !== fStatus) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dealers, q, fRep, fState, fRegion, fType, fStatus, users]);

  const regionListForState = (state: string) => (regions[state] || []).slice().sort();

  const goToDealer = (dealerId: string) => {
    saveLS(LS_LAST_SELECTED_DEALER, dealerId);
    setRoute("dealer-notes");
  };

  const resetForm = () => setForm(defaultAddDealerForm());

  const validateForm = (): string | null => {
    if (!form.name.trim()) return "Dealer Name is required.";
    if (!form.state) return "State is required.";
    if (!form.region) return "Region is required.";
    if (!form.type) return "Type is required.";
    if (!form.status) return "Status is required.";
    // when rep is logged in, assigned rep is forced to them (handled below)
    if (!(session?.role === "Rep") && !form.assignedRepUsername) return "Assigned Rep is required.";
    return null;
  };

  const ensureRegionInCatalog = (state: string, region: string) => {
    setRegions((prev) => {
      const next = { ...prev };
      if (!next[state]) next[state] = [];
      if (!next[state].includes(region)) next[state] = [...next[state], region].sort();
      return next;
    });
  };

  const addDealer = () => {
    const err = validateForm();
    if (err) return showToast(err, "error");

    // If a Rep is adding, force-assign to them
    const assignedRep = session?.role === "Rep" ? session.username : form.assignedRepUsername || "";

    ensureRegionInCatalog(form.state, form.region);
    const newDealer: Dealer = {
      id: uid(),
      name: form.name.trim(),
      state: form.state,
      region: form.region,
      type: form.type,
      status: form.status,
      address1: form.address1?.trim() || "",
      address2: form.address2?.trim() || "",
      city: form.city?.trim() || "",
      zip: form.zip?.trim() || "",
      contacts: form.contacts.filter((c) => c.name || c.phone).map((c) => ({ name: c.name.trim(), phone: c.phone.trim() })),
      assignedRepUsername: assignedRep || undefined,
      lastVisited: undefined,
      sendingDeals: undefined,
    };
    setDealers((prev) => [...prev, newDealer]);
    showToast(`Dealer "${newDealer.name}" added.`, "success");
    setAddOpen(false);
    resetForm();
  };

  const canSeeReporting = can.reporting && (session?.role === "Admin" || session?.role === "Manager");
  const canSeeUserMgmt = can.userMgmt && session?.role === "Admin";

  // ===== Daily Summary (today's notes by this rep) =====
  const isToday = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };

  const todaysNotesByMe = useMemo(() => {
    if (!isRep) return [];
    return notes
      .filter((n) => n.authorUsername === session!.username && isToday(n.tsISO))
      .sort((a, b) => (a.tsISO > b.tsISO ? -1 : 1));
  }, [notes, isRep, session]);

  const snippet = (s: string, len = 48) => (s.length > len ? s.slice(0, len) + "…" : s);
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString();
  const dealerById = (id: string) => dealers.find((d) => d.id === id);

  const buildDailySummaryPlainText = () => {
    if (todaysNotesByMe.length === 0) return "No notes recorded today.";
    const lines = todaysNotesByMe.map((n) => {
      const d = dealerById(n.dealerId);
      const where = d ? `${d.name} — ${d.region}, ${d.state}` : `(dealer removed)`;
      return `• ${fmtDateTime(n.tsISO)} | ${where} | ${n.category}: ${n.text}`;
    });
    return lines.join("\n");
  };

  // CSV export for daily summary
  const csvEscape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const downloadCSV = (filename: string, rows: (string | number)[][]) => {
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportDailyCSV = () => {
    const rows: (string | number)[][] = [["Time", "Dealer", "Region", "State", "Category", "Note"]];
    todaysNotesByMe.forEach((n) => {
      const d = dealerById(n.dealerId);
      rows.push([
        new Date(n.tsISO).toLocaleString(),
        d?.name || "",
        d?.region || "",
        d?.state || "",
        n.category,
        n.text || "",
      ]);
    });
    const today = new Date().toISOString().slice(0, 10);
    downloadCSV(`daily_summary_${today}_${session?.username}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      {/* Top actions row */}
      <div className="flex items-center gap-2">
        <button onClick={() => setAddOpen(true)} className={`${brand.primary} text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2`}>
          ➕ Add Dealer
        </button>
        {canSeeReporting && (
          <button onClick={() => setRoute("reporting")} className={`px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50`}>
            Reporting
          </button>
        )}
        {canSeeUserMgmt && (
          <button onClick={() => setRoute("user-management")} className={`px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50`}>
            User Management
          </button>
        )}

        {/* Daily Summary (reps only) */}
        {isRep && (
          <button
            onClick={() => setDailyOpen(true)}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white shadow"
            title="Show today's notes"
          >
            📄 Daily Summary
          </button>
        )}

        {/* Unified Quick Notes button (amber) */}
        <button
          onClick={() => setScratchOpen(true)}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow ${isRep ? "" : "ml-auto"}`}
          title="Open Quick Notes"
        >
          ✎ Quick Notes
        </button>
      </div>

      {/* Filters (note: override-only removed) */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <input
              className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search dealers, city, state, region…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div>
            <select className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" value={fRep} onChange={(e) => setFRep(e.target.value)}>
              <option value="">Rep (All)</option>
              {repOptions.map((r) => (
                <option key={r.username} value={r.username}>
                  {r.name} ({r.username})
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              value={fState}
              onChange={(e) => {
                const v = e.target.value;
                setFState(v);
                if (v && !(regions[v] || []).includes(fRegion)) setFRegion("");
              }}
            >
              <option value="">State (All)</option>
              {stateOptions.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          {/* Region filter works with/without State */}
          <div>
            <select className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" value={fRegion} onChange={(e) => setFRegion(e.target.value)}>
              <option value="">Region (All)</option>
              {(fState ? (regions[fState] || []) : allRegions).map((rg) => (
                <option key={rg} value={rg}>
                  {rg}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">Type (All)</option>
              <option value="Franchise">Franchise</option>
              <option value="Independent">Independent</option>
            </select>
          </div>
          <div>
            <select className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Status (All)</option>
              {["Active", "Pending", "Prospect", "Inactive", "Black Listed"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => {
              setQ("");
              setFRep("");
              setFState("");
              setFRegion("");
              setFType("");
              setFStatus("");
            }}
            className="text-sm text-blue-700 hover:underline"
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* Tasks row for reps (already shown in top bar as chips) */}
      {tasksForUser.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tasksForUser.map((t) => (
            <button
              key={t.id}
              onClick={() => onClickTask(t)}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 rounded-full hover:bg-red-200"
              title="Open task dealer"
            >
              New Task for ({t.text})
            </button>
          ))}
        </div>
      )}

      {/* Results (Last Note column removed) */}
      <div className="rounded-xl border bg-white p-0 shadow-sm overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 bg-slate-50">
              <th className="py-2 px-3">Dealer</th>
              <th className="py-2 px-3">Rep</th>
              <th className="py-2 px-3">Region</th>
              <th className="py-2 px-3">State</th>
              <th className="py-2 px-3">Type</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Last Visited</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const hasOverride = Boolean(d.assignedRepUsername);
              return (
                <tr key={d.id} className="border-t hover:bg-blue-50/40 cursor-pointer" onClick={() => goToDealer(d.id)}>
                  <td className="py-2 px-3 font-medium text-slate-800">{d.name}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <span>{repNameForDealer(d)}</span>
                      {hasOverride && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">override</span>}
                    </div>
                  </td>
                  <td className="py-2 px-3">{d.region}</td>
                  <td className="py-2 px-3">{d.state}</td>
                  <td className="py-2 px-3">{d.type}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge(d.status)}`}>{d.status}</span>
                  </td>
                  <td className="py-2 px-3">{d.lastVisited || "—"}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                {/* 7 columns now */}
                <td colSpan={7} className="py-6 text-center text-slate-500">
                  No dealers match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Dealer Modal */}
      {addOpen && (
        <Modal onClose={() => setAddOpen(false)} title="Add Dealer">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextField label="Dealer Name *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />

            {/* Assigned Rep: reps are forced to themselves and cannot change */}
            <SelectField
              label="Assigned Rep *"
              value={session?.role === "Rep" ? session.username : form.assignedRepUsername || ""}
              onChange={(v) => setForm((f) => ({ ...f, assignedRepUsername: v }))}
              options={[
                { label: "Select rep…", value: "" },
                ...repOptions.map((r) => ({ label: `${r.name} (${r.username})`, value: r.username })),
              ]}
              disabled={session?.role === "Rep"}
            />

            <SelectField
              label="State *"
              value={form.state}
              onChange={(v) => setForm((f) => ({ ...f, state: v, region: "" }))}
              options={[{ label: "Select state…", value: "" }, ...stateOptions.map((s) => ({ label: s, value: s }))]}
            />
            <SelectField
              label="Region *"
              value={form.region}
              onChange={(v) => setForm((f) => ({ ...f, region: v }))}
              options={[
                { label: form.state ? "Select region…" : "Select region…", value: "" },
                ...(form.state ? (regions[form.state] || []).map((r) => ({ label: r, value: r })) : allRegions.map((r) => ({ label: r, value: r }))),
              ]}
            />
            <SelectField
              label="Type *"
              value={form.type}
              onChange={(v) => setForm((f) => ({ ...f, type: v as DealerType }))}
              options={[
                { label: "Independent", value: "Independent" },
                { label: "Franchise", value: "Franchise" },
              ]}
            />
            <SelectField
              label="Status *"
              value={form.status}
              onChange={(v) => setForm((f) => ({ ...f, status: v as DealerStatus }))}
              options={["Active", "Pending", "Prospect", "Inactive", "Black Listed"].map((s) => ({ label: s, value: s }))}
            />
            <TextField label="Address 1" value={form.address1 || ""} onChange={(v) => setForm((f) => ({ ...f, address1: v }))} />
            <TextField label="Address 2" value={form.address2 || ""} onChange={(v) => setForm((f) => ({ ...f, address2: v }))} />
            <TextField label="City" value={form.city || ""} onChange={(v) => setForm((f) => ({ ...f, city: v }))} />
            <TextField label="ZIP" value={form.zip || ""} onChange={(v) => setForm((f) => ({ ...f, zip: v }))} />
          </div>

          {/* Contacts */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div className="text-slate-700 font-medium">Contacts</div>
              <button onClick={() => setForm((f) => ({ ...f, contacts: [...f.contacts, { name: "", phone: "" }] }))} className="text-blue-700 text-sm hover:underline">
                + Add Contact
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {form.contacts.map((c, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <div className="md:col-span-5">
                    <TextField
                      label="Name"
                      value={c.name}
                      onChange={(v) =>
                        setForm((f) => {
                          const next = [...f.contacts];
                          next[idx] = { ...next[idx], name: v };
                          return { ...f, contacts: next };
                        })
                      }
                    />
                  </div>
                  <div className="md:col-span-5">
                    <TextField
                      label="Phone"
                      value={c.phone}
                      onChange={(v) =>
                        setForm((f) => {
                          const next = [...f.contacts];
                          next[idx] = { ...next[idx], phone: v };
                          return { ...f, contacts: next };
                        })
                      }
                    />
                  </div>
                  <div className="md:col-span-2 flex items-end">
                    <button
                      onClick={() =>
                        setForm((f) => {
                          const next = f.contacts.filter((_, i) => i !== idx);
                          return { ...f, contacts: next.length ? next : [{ name: "", phone: "" }] };
                        })
                      }
                      className="w-full md:w-auto px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50"
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end gap-2">
            <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={addDealer}>
              Save Dealer
            </button>
          </div>
        </Modal>
      )}

      {/* Quick Notes Modal */}
      {scratchOpen && (
        <Modal title="Quick Notes" onClose={() => setScratchOpen(false)}>
          <p className="text-sm text-slate-600 mb-2">
            Scratchpad is private to <strong>{session?.username}</strong>. It autosaves; use <em>Clear</em> to wipe.
          </p>
          <textarea
            className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500 min-h-[200px]"
            value={scratch}
            onChange={(e) => setScratch(e.target.value)}
            placeholder="Type anything… it autosaves."
          />
          <div className="mt-3 flex items-center justify-between">
            <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setScratch("")} type="button">
              Clear
            </button>
            <button className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setScratchOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* Daily Summary Modal (reps only) */}
      {dailyOpen && isRep && (
        <Modal title="Daily Summary — Today" onClose={() => setDailyOpen(false)}>
          <div className="space-y-3">
            {todaysNotesByMe.length === 0 && <div className="text-sm text-slate-500">No notes recorded today.</div>}
            {todaysNotesByMe.map((n) => {
              const d = dealerById(n.dealerId);
              return (
                <div key={n.id} className="border rounded-lg p-3">
                  <div className="text-xs text-slate-500 mb-1">{fmtDateTime(n.tsISO)}</div>
                  <div className="text-sm font-medium text-slate-800">{d ? d.name : "(dealer removed)"}</div>
                  <div className="text-xs text-slate-500 mb-1">{d ? `${d.region}, ${d.state}` : ""}</div>
                  <div className="inline-block text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 mb-1">{n.category}</div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.text}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50"
              onClick={() => {
                navigator.clipboard.writeText(buildDailySummaryPlainText());
                showToast("Daily summary copied.", "success");
              }}
            >
              Copy All
            </button>
            <button className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={exportDailyCSV}>
              Export CSV
            </button>
            <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={() => setDailyOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

/* ------------------------------ Dealer Notes ------------------------------ */

const DealerNotesView: React.FC<{
  session: Session;
  users: User[];
  dealers: Dealer[];
  setDealers: React.Dispatch<React.SetStateAction<Dealer[]>>;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  regions: RegionsCatalog;
  setRoute: (r: RouteKey) => void;
  showToast: (m: string, k?: ToastKind) => void;
}> = ({ session, users, dealers, setDealers, notes, setNotes, tasks, setTasks, regions, setRoute, showToast }) => {
  const dealerId = loadLS<string | null>(LS_LAST_SELECTED_DEALER, null);
  const dealer = dealers.find((d) => d.id === dealerId) || null;
  const me = users.find((u) => u.username === session?.username) || null;

  // Local delete modal state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Unified Quick Notes (same as Home)
  const [scratchOpen, setScratchOpen] = useState(false);
  const sKey = quickNoteKey(session?.username);
  const [scratch, setScratch] = useState<string>(() => loadLS<string>(sKey, ""));
  useEffect(() => {
    localStorage.setItem(sKey, JSON.stringify(scratch));
  }, [sKey, scratch]);

  if (!dealer) {
    return (
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="text-slate-700 mb-3">No dealer selected.</div>
        <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={() => setRoute("dealer-search")}>
          Back to Dealer Search
        </button>
      </div>
    );
  }

  /* ------------------------ Permission helpers ------------------------ */
  const isAdminManager = session?.role === "Admin" || session?.role === "Manager";
  const isRep = session?.role === "Rep";
  const repHasCoverage =
    isRep &&
    me?.states.includes(dealer.state) &&
    (me?.regionsByState[dealer.state]?.includes(dealer.region) ?? false);
  const isOverrideToRep = isRep && dealer.assignedRepUsername === me?.username;
  const repCanAccess = isAdminManager || repHasCoverage || isOverrideToRep;

  /* -------------------------- Status / Details ------------------------- */
  const updateDealer = (patch: Partial<Dealer>) => {
    setDealers((prev) => prev.map((d) => (d.id === dealer.id ? { ...d, ...patch } : d)));
  };

  const [editDetails, setEditDetails] = useState<Dealer>({
    ...dealer,
    contacts: dealer.contacts?.length ? dealer.contacts.map((c) => ({ ...c })) : [{ name: "", phone: "" }],
  });

  useEffect(() => {
    setEditDetails({
      ...dealer,
      contacts: dealer.contacts?.length ? dealer.contacts.map((c) => ({ ...c })) : [{ name: "", phone: "" }],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerId]);

  const saveDetails = () => {
    if (!repCanAccess) return showToast("You don't have permission to edit details.", "error");
    updateDealer({
      address1: editDetails.address1?.trim(),
      address2: editDetails.address2?.trim(),
      city: editDetails.city?.trim(),
      zip: editDetails.zip?.trim(),
      state: editDetails.state,
      region: editDetails.region,
      contacts: editDetails.contacts.filter((c) => c.name || c.phone).map((c) => ({ name: c.name.trim(), phone: c.phone.trim() })),
    });
    showToast("Dealer details saved.", "success");
  };

  const changeAssignedRep = (username: string) => {
    if (!isAdminManager) return; // reps cannot reassign
    updateDealer({ assignedRepUsername: username || undefined });
    showToast("Assigned rep updated.", "success");
  };

  const changeStatus = (status: DealerStatus) => {
    if (!repCanAccess) return showToast("You don't have permission to change status.", "error");
    updateDealer({ status });
    showToast("Status updated.", "success");
  };

  const toggleSendingDeals = (val: boolean) => {
    if (!repCanAccess) return showToast("You don't have permission to update this.", "error");
    if (val) {
      updateDealer({ sendingDeals: true, noDealReasons: undefined });
    } else {
      updateDealer({ sendingDeals: false, noDealReasons: { ...dealer.noDealReasons } });
    }
  };

  const setReason = (key: keyof NonNullable<Dealer["noDealReasons"]>, v: boolean | string) => {
    if (!repCanAccess) return;
    const current = dealer.noDealReasons || {};
    updateDealer({ noDealReasons: { ...current, [key]: v as any } });
  };

  /* ------------------------------ Notes -------------------------------- */
  const dealerNotes = notes
    .filter((n) => n.dealerId === dealer.id)
    .sort((a, b) => (a.tsISO > b.tsISO ? -1 : 1));

  const [noteCategory, setNoteCategory] = useState<NoteCategory>("Visit");
  const [noteText, setNoteText] = useState("");

  const canUseManagerNote = isAdminManager;

  const addNote = () => {
    if (!repCanAccess) return showToast("You don't have access to add notes.", "error");
    if (!noteText.trim()) return showToast("Please enter a note.", "error");

    if (noteCategory === "Manager" && !canUseManagerNote) {
      return showToast("Only Managers/Admins can add Manager Notes.", "error");
    }

    const n: Note = {
      id: uid(),
      dealerId: dealer.id,
      authorUsername: session!.username,
      tsISO: new Date().toISOString(),
      category: noteCategory,
      text: noteText.trim(),
    };
    setNotes((prev) => [n, ...prev]);
    setNoteText("");

    if (noteCategory === "Visit") {
      updateDealer({ lastVisited: todayISO() });
    }

    if (noteCategory === "Manager") {
      const repUser = dealer.assignedRepUsername;
      if (repUser) {
        const t: Task = { id: uid(), dealerId: dealer.id, repUsername: repUser, text: dealer.name, createdAtISO: new Date().toISOString() };
        setTasks((prev) => [t, ...prev]);
        showToast("Task created for the assigned rep.", "success");
      }
    }

    showToast("Note added.", "success");
  };

  /* ------------------------------ Delete -------------------------------- */
  const doDeleteDealer = () => {
    // Allow delete for Admins, Managers, and Reps with access
    if (!(isAdminManager || repCanAccess)) return showToast("You don't have permission to delete this dealer.", "error");
    if (confirmText !== dealer.name) return showToast("Type the dealer name exactly to confirm.", "error");

    setDealers((prev) => prev.filter((d) => d.id !== dealer.id));
    setTasks((prev) => prev.filter((t) => t.dealerId !== dealer.id));
    setNotes((prev) => prev.filter((n) => n.dealerId !== dealer.id));
    showToast(`Dealer "${dealer.name}" deleted.`, "success");
    setDeleteOpen(false);
    setRoute("dealer-search");
  };

  /* --------------------------------- UI --------------------------------- */
  const repList = users.filter((u) => u.role === "Rep");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button className="text-blue-700 hover:underline" onClick={() => setRoute("dealer-search")}>
          ← Back to Dealer Search
        </button>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            value={dealer.status}
            onChange={(e) => changeStatus(e.target.value as DealerStatus)}
          >
            {["Active", "Pending", "Prospect", "Inactive", "Black Listed"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {(isAdminManager || repCanAccess) && (
            <button className="px-3 py-2 rounded-lg border text-red-700 border-red-600 hover:bg-red-50" onClick={() => setDeleteOpen(true)}>
              Delete Dealer
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-xl font-semibold text-slate-800">{dealer.name}</div>
            <div className="text-sm text-slate-600">
              {dealer.region}, {dealer.state} • <span className="uppercase">{dealer.type}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge(dealer.status)}`}>{dealer.status}</span>
            <div className="text-sm text-slate-600">Last visited: {dealer.lastVisited || "—"}</div>
          </div>
        </div>
      </div>

      {/* Details + Assignment + Sending Deals */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Details */}
        <div className="md:col-span-2 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-slate-800 font-semibold">Dealer Details</div>
            <div className="text-xs text-slate-500">{repCanAccess ? "Editable" : "Read-only"}</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="Address 1" value={editDetails.address1 || ""} onChange={(v) => setEditDetails((x) => ({ ...x, address1: v }))} disabled={!repCanAccess} />
            <TextField label="Address 2" value={editDetails.address2 || ""} onChange={(v) => setEditDetails((x) => ({ ...x, address2: v }))} disabled={!repCanAccess} />
            <TextField label="City" value={editDetails.city || ""} onChange={(v) => setEditDetails((x) => ({ ...x, city: v }))} disabled={!repCanAccess} />
            <TextField label="ZIP" value={editDetails.zip || ""} onChange={(v) => setEditDetails((x) => ({ ...x, zip: v }))} disabled={!repCanAccess} />
            <SelectField
              label="State"
              value={editDetails.state}
              onChange={(v) => setEditDetails((x) => ({ ...x, state: v, region: "" }))}
              options={Object.keys(regions)
                .sort()
                .map((s) => ({ label: s, value: s }))}
              disabled={!repCanAccess}
            />
            <SelectField
              label="Region"
              value={editDetails.region}
              onChange={(v) => setEditDetails((x) => ({ ...x, region: v }))}
              options={(regions[editDetails.state] || []).map((r) => ({ label: r, value: r }))}
              disabled={!repCanAccess || !editDetails.state}
            />
          </div>

          {/* Contacts */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div className="text-slate-700 font-medium">Contacts</div>
              {repCanAccess && (
                <button
                  onClick={() => setEditDetails((x) => ({ ...x, contacts: [...x.contacts, { name: "", phone: "" }] }))}
                  className="text-blue-700 text-sm hover:underline"
                >
                  + Add Contact
                </button>
              )}
            </div>
            <div className="mt-2 space-y-2">
              {editDetails.contacts.map((c, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <TextField
                      label="Name"
                      value={c.name}
                      onChange={(v) =>
                        setEditDetails((x) => {
                          const next = [...x.contacts];
                          next[idx] = { ...next[idx], name: v };
                          return { ...x, contacts: next };
                        })
                      }
                      disabled={!repCanAccess}
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <TextField
                      label="Phone"
                      value={c.phone}
                      onChange={(v) =>
                        setEditDetails((x) => {
                          const next = [...x.contacts];
                          next[idx] = { ...next[idx], phone: v };
                          return { ...x, contacts: next };
                        })
                      }
                      disabled={!repCanAccess}
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-end">
                    {repCanAccess && (
                      <button
                        onClick={() =>
                          setEditDetails((x) => {
                            const next = x.contacts.filter((_, i) => i !== idx);
                            return { ...x, contacts: next.length ? next : [{ name: "", phone: "" }] };
                          })
                        }
                        className="w-full sm:w-auto px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50"
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {repCanAccess && (
            <div className="mt-4 flex justify-end">
              <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={saveDetails}>
                Save Details
              </button>
            </div>
          )}
        </div>

        {/* Assignment & Sending */}
        <div className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
          <div>
            <div className="text-slate-800 font-semibold mb-2">Assigned Rep (override)</div>
            <SelectField
              label="Assigned Rep"
              value={dealer.assignedRepUsername || ""}
              onChange={(v) => changeAssignedRep(v)}
              options={[{ label: "— None —", value: "" }, ...users.filter((u) => u.role === "Rep").map((r) => ({ label: `${r.name} (${r.username})`, value: r.username }))]}
              disabled={!isAdminManager}
            />
          </div>

          <div className="border-t pt-4">
            <div className="text-slate-800 font-semibold mb-2">Are they sending deals?</div>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="sending" checked={dealer.sendingDeals === true} onChange={() => toggleSendingDeals(true)} disabled={!repCanAccess} />
                Yes
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="sending" checked={dealer.sendingDeals === false} onChange={() => toggleSendingDeals(false)} disabled={!repCanAccess} />
                No
              </label>
            </div>

            {dealer.sendingDeals === false && (
              <div className="mt-3 space-y-2">
                {[
                  ["funding", "Funding"],
                  ["agreement", "Dealer Agreement"],
                  ["feesRates", "Fees & Rates"],
                  ["programDiff", "Program Differences"],
                  ["eContracting", "E-contracting"],
                  ["notSigned", "Not signed up"],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={(dealer.noDealReasons as any)?.[key] || false}
                      onChange={(e) => setReason(key as any, e.target.checked)}
                      disabled={!repCanAccess}
                    />
                    {label}
                  </label>
                ))}
                <div>
                  <TextField label="Other" value={dealer.noDealReasons?.other || ""} onChange={(v) => setReason("other", v)} disabled={!repCanAccess} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes Composer */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="text-slate-800 font-semibold">Add Note</div>
          {/* Unified Quick Notes button (amber) */}
          <button className="px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow" onClick={() => setScratchOpen(true)}>
            ✎ Quick Notes
          </button>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <div className="md:col-span-1">
            <SelectField
              label="Category"
              value={noteCategory}
              onChange={(v) => setNoteCategory(v as NoteCategory)}
              options={[
                { label: "Visit", value: "Visit" },
                { label: "Problem", value: "Problem" },
                { label: "Other", value: "Other" },
                { label: "Manager Note", value: "Manager" },
              ]}
              disabled={!canUseManagerNote && noteCategory === "Manager"}
            />
            {!canUseManagerNote && noteCategory === "Manager" && <div className="text-xs text-red-600 mt-1">Only Managers/Admins can use this.</div>}
          </div>
          <div className="md:col-span-3">
            <label className="block">
              <div className="text-xs text-slate-500 mb-1">Note</div>
              <textarea
                className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 min-h-[96px]"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Write your note here…"
              />
            </label>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={addNote}>
            Add Note
          </button>
        </div>
      </div>

      {/* Notes List */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="text-slate-800 font-semibold mb-3">Notes</div>
        <div className="space-y-3">
          {dealerNotes.length === 0 && <div className="text-sm text-slate-500">No notes yet.</div>}
          {dealerNotes.map((n) => (
            <div key={n.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${noteBadge(n.category)}`}>{labelNote(n.category)}</span>
                  <span className="text-xs text-slate-500">
                    by <strong>{n.authorUsername}</strong> • {new Date(n.tsISO).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-sm text-slate-800 whitespace-pre-wrap">{n.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Unified Quick Notes Modal */}
      {scratchOpen && (
        <Modal title={`Quick Notes`} onClose={() => setScratchOpen(false)}>
          <p className="text-sm text-slate-600 mb-2">
            Scratchpad is private to <strong>{session?.username}</strong>. It autosaves; use <em>Clear</em> to wipe.
          </p>
          <textarea
            className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500 min-h-[200px]"
            value={scratch}
            onChange={(e) => setScratch(e.target.value)}
            placeholder="Type anything… it autosaves."
          />
          <div className="mt-3 flex items-center justify-between">
            <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setScratch("")} type="button">
              Clear
            </button>
            <button className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setScratchOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleteOpen && (
        <Modal title="Delete Dealer (danger)" onClose={() => setDeleteOpen(false)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              This will permanently delete <strong>{dealer.name}</strong>, its notes, and tasks. Type the dealer name to confirm.
            </p>
            <TextField label="Type dealer name to confirm" value={confirmText} onChange={setConfirmText} />
            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setDeleteOpen(false)}>
                Cancel
              </button>
              <button className="px-3 py-2 rounded-lg border border-red-600 text-red-700 hover:bg-red-50" onClick={doDeleteDealer}>
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Mobile floating Quick Notes */}
      <button
        className="fixed bottom-5 right-5 rounded-full shadow-lg px-4 py-3 text-white bg-amber-500 hover:bg-amber-600 md:hidden"
        onClick={() => setScratchOpen(true)}
        title="Quick Notes"
      >
        ✎
      </button>
    </div>
  );
};

const noteBadge = (c: NoteCategory) => {
  switch (c) {
    case "Visit":
      return "bg-green-100 text-green-700";
    case "Problem":
      return "bg-orange-100 text-orange-700";
    case "Other":
      return "bg-yellow-100 text-yellow-700";
    case "Manager":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
};
const labelNote = (c: NoteCategory) => (c === "Manager" ? "Manager Note" : c);

/* ------------------------------- Reporting -------------------------------- */


type RepFilter = "ALL" | string; // "ALL" or username

const monthsBack = (n: number) => {
  const arr: { key: string; label: string; start: Date; end: Date }[] = [];
  const today = new Date();
  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = startOfMonth(d);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    const label = start.toLocaleString(undefined, { month: "short", year: "numeric" });
    arr.push({ key, label, start, end });
  }
  return arr.reverse(); // oldest -> newest
};

const daysAgo = (iso?: string) => {
  if (!iso) return Infinity;
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
  return diff;
};

const ReportingView: React.FC<{
  dealers: Dealer[];
  users: User[];
  notes: Note[];
}> = ({ dealers, users, notes }) => {
  const reps = users.filter((u) => u.role === "Rep");
  const [repFilter, setRepFilter] = useState<RepFilter>("ALL");
  const selectedRep = reps.find((r) => r.username === repFilter) || null;

  // NEW: modal controls for “Not Visited”
  const [nvOpen, setNvOpen] = useState(false);
  const [nvSort, setNvSort] = useState<"longest" | "recent">("longest"); // longest = oldest visit first

  // Helper: does rep "cover" dealer (override OR state/region coverage)
  const repCoversDealer = (rep: User, d: Dealer) =>
    d.assignedRepUsername === rep.username ||
    (rep.states.includes(d.state) && (rep.regionsByState[d.state]?.includes(d.region) ?? false));

  // Dealers considered in current view
  const scopedDealers = useMemo(() => {
    if (repFilter === "ALL") return dealers;
    if (!selectedRep) return [];
    return dealers.filter((d) => repCoversDealer(selectedRep, d));
  }, [dealers, repFilter, selectedRep]);

  const statuses: DealerStatus[] = ["Active", "Pending", "Prospect", "Inactive", "Black Listed"];

  // Status KPIs
  const kpis = useMemo(() => {
    const total = scopedDealers.length;
    const byStatus: Record<DealerStatus, number> = {
      Active: 0,
      Pending: 0,
      Prospect: 0,
      Inactive: 0,
      "Black Listed": 0,
    };
    for (const d of scopedDealers) byStatus[d.status]++;
    return { total, byStatus };
  }, [scopedDealers]);

  // Dealers by State
  const byState = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of scopedDealers) map[d.state] = (map[d.state] || 0) + 1;
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [scopedDealers]);

  // Workload (All Reps = per rep bars; single rep = one bar)
  const repWorkload = useMemo(() => {
    if (repFilter !== "ALL" && selectedRep) {
      const count = scopedDealers.length;
      return { rows: [{ rep: selectedRep, count }], max: Math.max(count, 1) };
    }
    const rows = reps.map((r) => ({
      rep: r,
      count: dealers.filter((d) => repCoversDealer(r, d)).length,
    }));
    const max = Math.max(1, ...rows.map((r) => r.count));
    return { rows, max };
  }, [repFilter, selectedRep, scopedDealers, reps, dealers]);

  // Notes scoping (All = everyone’s notes; Rep = that rep’s notes only)
  const scopedNotes = useMemo(() => {
    if (repFilter === "ALL") return notes;
    if (!selectedRep) return [];
    return notes.filter((n) => n.authorUsername === selectedRep.username);
  }, [repFilter, selectedRep, notes]);

  // Visits last 30 days (authored)
  const visitsLast30 = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recent = scopedNotes.filter((n) => n.category === "Visit" && new Date(n.tsISO) >= cutoff);
    const byUser: Record<string, number> = {};
    for (const n of recent) byUser[n.authorUsername] = (byUser[n.authorUsername] || 0) + 1;
    const rows =
      repFilter === "ALL"
        ? Object.entries(byUser).sort((a, b) => b[1] - a[1])
        : [[selectedRep!.username, byUser[selectedRep!.username] || 0]];
    const max = Math.max(1, ...rows.map(([, v]) => v));
    return { rows, max, total: recent.length };
  }, [scopedNotes, repFilter, selectedRep]);

  // Month-to-month: last 6 months buckets from scopedNotes (Visit)
  const months = monthsBack(6); // oldest -> newest
  const monthlyVisits = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of months) map[m.key] = 0;
    for (const n of scopedNotes) {
      if (n.category !== "Visit") continue;
      const d = new Date(n.tsISO);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key in map) map[key] += 1;
    }
    return map; // key -> count
  }, [scopedNotes]);

  const thisMonthKey = months[months.length - 1].key;
  const lastMonthKey = months[months.length - 2]?.key;
  const thisMonthCount = monthlyVisits[thisMonthKey] || 0;
  const lastMonthCount = lastMonthKey ? monthlyVisits[lastMonthKey] || 0 : 0;
  const delta = thisMonthCount - lastMonthCount;

  // Dealers not visited in last 30 days — **Active only**
  const notVisited30 = useMemo(() => {
    const list = scopedDealers
      .filter((d) => d.status === "Active" && daysAgo(d.lastVisited) > 30)
      .sort((a, b) => (a.lastVisited || "0000").localeCompare(b.lastVisited || "0000"));
    return list;
  }, [scopedDealers]);

  // Modal list (sorted)
  const notVisited30Sorted = useMemo(() => {
    const arr = [...notVisited30];
    if (nvSort === "longest") {
      // Longest not visited first (biggest daysAgo desc)
      arr.sort((a, b) => daysAgo(b.lastVisited) - daysAgo(a.lastVisited));
    } else {
      // Most recently visited first (smallest daysAgo)
      arr.sort((a, b) => daysAgo(a.lastVisited) - daysAgo(b.lastVisited));
    }
    return arr;
  }, [notVisited30, nvSort]);

  const bar = (val: number, max: number) => {
    const pct = Math.round((val / Math.max(1, max)) * 100);
    return (
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div className="h-2 rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
      </div>
    );
  };

  const sectionTitle = repFilter === "ALL" ? "Overall (All Reps)" : `Rep: ${selectedRep?.name} (${selectedRep?.username})`;

  return (
    <div className="space-y-6">
      {/* Header + Rep selector */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-xl font-semibold text-slate-800">Reporting</div>
          <div className="text-sm text-slate-500">Activity, coverage, and visit cadence</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">View:</label>
          <select
            className="rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value as RepFilter)}
          >
            <option value="ALL">All Reps</option>
            {reps.map((r) => (
              <option key={r.username} value={r.username}>
                {r.name} ({r.username})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI title={`${sectionTitle} — Total Dealers`} value={kpis.total} />
        <KPI title="Active" value={kpis.byStatus.Active} />
        <KPI title="Pending" value={kpis.byStatus.Pending} />
        <KPI title="Prospect" value={kpis.byStatus.Prospect} />
      </div>

      {/* Month-to-month & 30-day activity */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card title="Visits — This Month vs Last Month">
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <div className="text-xs text-slate-500">This Month</div>
              <div className="text-2xl font-semibold text-slate-800">{thisMonthCount}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Last Month</div>
              <div className="text-2xl font-semibold text-slate-800">{lastMonthCount}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Δ Change</div>
              <div className={`text-2xl font-semibold ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Visits in Last 30 Days">
          <div className="space-y-3">
            {visitsLast30.rows.map(([user, count]) => (
              <div key={user} className="flex items-center gap-3">
                <div className="w-40 text-sm">{user}</div>
                <div className="flex-1">{bar(count, visitsLast30.max)}</div>
                <div className="w-10 text-right text-sm">{count}</div>
              </div>
            ))}
            {visitsLast30.rows.length === 0 && <div className="text-sm text-slate-500">No visit notes in last 30 days.</div>}
          </div>
        </Card>

        <Card title="Dealers Not Visited (Last 30 Days)">
          <div className="text-sm text-slate-600 mb-2">
            {notVisited30.length} Active dealer{notVisited30.length === 1 ? "" : "s"} require attention
          </div>
          <div className="max-h-56 overflow-auto divide-y">
            {notVisited30.slice(0, 12).map((d) => (
              <div key={d.id} className="py-2 text-sm flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-800">{d.name}</div>
                  <div className="text-slate-500">
                    {d.region}, {d.state}
                  </div>
                </div>
                <div className="text-xs text-slate-500">Last: {d.lastVisited || "—"}</div>
              </div>
            ))}
            {notVisited30.length === 0 && <div className="py-2 text-sm text-slate-500">All covered Active dealers visited recently. 🎉</div>}
          </div>
          {notVisited30.length > 0 && (
            <div className="mt-3 flex justify-end">
              <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setNvOpen(true)}>
                View all
              </button>
            </div>
          )}
        </Card>
      </div>

      {/* Status breakdown + by state */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Status Breakdown">
          <div className="space-y-3">
            {statuses.map((s) => (
              <div key={s} className="flex items-center gap-3">
                <div className="w-32 text-sm">{s}</div>
                <div className="flex-1">{bar(kpis.byStatus[s], Math.max(...statuses.map((x) => kpis.byStatus[x]), 1))}</div>
                <div className="w-10 text-right text-sm">{kpis.byStatus[s]}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Dealers by State">
          <div className="space-y-3">
            {byState.map(([state, count]) => (
              <div key={state} className="flex items-center gap-3">
                <div className="w-16 text-sm">{state}</div>
                <div className="flex-1">{bar(count, Math.max(...byState.map(([, c]) => c), 1))}</div>
                <div className="w-10 text-right text-sm">{count}</div>
              </div>
            ))}
            {byState.length === 0 && <div className="text-sm text-slate-500">No dealers.</div>}
          </div>
        </Card>
      </div>

      {/* Rep workload */}
      <div className="grid md:grid-cols-1 gap-4">
        <Card title={repFilter === "ALL" ? "Rep Workload (dealers covered)" : "Workload"}>
          <div className="space-y-3">
            {repWorkload.rows.map((row) => (
              <div key={row.rep.username} className="flex items-center gap-3">
                <div className="w-48 text-sm">
                  {row.rep.name} ({row.rep.username})
                </div>
                <div className="flex-1">{bar(row.count, repWorkload.max)}</div>
                <div className="w-10 text-right text-sm">{row.count}</div>
              </div>
            ))}
            {repWorkload.rows.length === 0 && <div className="text-sm text-slate-500">No reps.</div>}
          </div>
        </Card>
      </div>

      {/* Month timeline bars */}
      <Card title="Monthly Visit Notes Timeline (last 6 months)">
        <div className="space-y-3">
          {months.map((m) => {
            const val = monthlyVisits[m.key] || 0;
            const max = Math.max(1, ...months.map((mm) => monthlyVisits[mm.key] || 0));
            return (
              <div key={m.key} className="flex items-center gap-3">
                <div className="w-24 text-sm">{m.label}</div>
                <div className="flex-1">{bar(val, max)}</div>
                <div className="w-10 text-right text-sm">{val}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* MODAL: Full list of "Not Visited (Active) in Last 30 Days" */}
      {nvOpen && (
        <Modal title={`Not Visited (Active) — ${notVisited30.length} dealer${notVisited30.length === 1 ? "" : "s"}`} onClose={() => setNvOpen(false)}>
          {/* Controls */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm text-slate-600">
              Showing dealers within <span className="font-medium">{sectionTitle}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">Sort:</label>
              <select
                className="rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={nvSort}
                onChange={(e) => setNvSort(e.target.value as "longest" | "recent")}
              >
                <option value="longest">Longest Not Visited</option>
                <option value="recent">Most Recently Visited</option>
              </select>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 bg-slate-50 text-slate-600 text-xs font-medium">
              <div className="col-span-5 px-3 py-2">Dealer</div>
              <div className="col-span-3 px-3 py-2">Region / State</div>
              <div className="col-span-2 px-3 py-2 text-right">Last Visited</div>
              <div className="col-span-2 px-3 py-2 text-right">Days Ago</div>
            </div>
            <div className="max-h-[420px] overflow-auto divide-y">
              {notVisited30Sorted.map((d) => (
                <div key={d.id} className="grid grid-cols-12 text-sm">
                  <div className="col-span-5 px-3 py-2">
                    <div className="font-medium text-slate-800">{d.name}</div>
                    <div className="text-slate-500">{d.type}</div>
                  </div>
                  <div className="col-span-3 px-3 py-2 text-slate-600">
                    {d.region}, {d.state}
                  </div>
                  <div className="col-span-2 px-3 py-2 text-right text-slate-600">{d.lastVisited || "—"}</div>
                  <div className="col-span-2 px-3 py-2 text-right text-slate-800">{Number.isFinite(daysAgo(d.lastVisited)) ? daysAgo(d.lastVisited) : "—"}</div>
                </div>
              ))}
              {notVisited30Sorted.length === 0 && <div className="px-3 py-4 text-sm text-slate-500">Nothing to show.</div>}
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button className="px-4 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setNvOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};


/* --------------------------------- App ------------------------------------ */
const App: React.FC = () => {
  const { users, setUsers, dealers, setDealers, regions, setRegions, tasks, setTasks, notes, setNotes } = useData();
  const [route, setRoute] = useState<RouteKey>("login");
  const [session, setSession] = useState<Session>(null);
  const { toasts, showToast, dismiss } = useToasts();

  const can = useMemo(() => {
    const role = session?.role;
    return { reporting: role === "Admin" || role === "Manager", userMgmt: role === "Admin" };
  }, [session]);

  const handleLogin = (s: Session) => {
    setSession(s);
    setRoute("dealer-search");
  };
  const handleLogout = () => {
    setSession(null);
    setRoute("login");
    showToast("You have been logged off.", "success");
  };

  const tasksForUser = useMemo(() => {
    if (!session || session.role !== "Rep") return [];
    return tasks.filter((t) => t.repUsername === session.username);
  }, [tasks, session]);

  const handleClickTask = (t: Task) => {
    saveLS(LS_LAST_SELECTED_DEALER, t.dealerId);
    setRoute("dealer-notes");
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
    showToast("Task opened and cleared.", "success");
  };

  let body: React.ReactNode = null;
  if (route === "login") {
    body = <LoginView onLogin={handleLogin} showToast={showToast} />;
  } else {
    if (!session) {
      body = (
        <div className="min-h-screen grid place-items-center bg-slate-50">
          <div className="text-center">
            <div className="text-2xl font-semibold text-slate-700 mb-2">Session expired</div>
            <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={() => setRoute("login")}>
              Return to Login
            </button>
          </div>
        </div>
      );
    } else {
      body = (
        <div className="min-h-screen bg-slate-50">
          <TopBar
            session={session}
            route={route}
            setRoute={setRoute}
            onLogout={handleLogout}
            can={can}
            tasksForUser={tasksForUser}
            onClickTask={handleClickTask}
          />
          <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
            {route === "dealer-search" && (
              <DealerSearchView
                session={session}
                users={users}
                dealers={dealers}
                setDealers={setDealers}
                regions={regions}
                setRegions={setRegions}
                can={can}
                setRoute={setRoute}
                showToast={showToast}
                tasksForUser={tasksForUser}
                onClickTask={handleClickTask}
                notes={notes}
              />
            )}

            {route === "dealer-notes" && (
              <DealerNotesView
                session={session}
                users={users}
                dealers={dealers}
                setDealers={setDealers}
                notes={notes}
                setNotes={setNotes}
                tasks={tasks}
                setTasks={setTasks}
                regions={regions}
                setRoute={setRoute}
                showToast={showToast}
              />
            )}

            {route === "reporting" && <ReportingView dealers={dealers} users={users} notes={notes} />}

            {route === "user-management" && (
  <UserManagementView
    users={users}
    setUsers={setUsers}
    regions={regions}
    setRegions={setRegions}
    dealers={dealers}
    setDealers={setDealers}
    showToast={showToast}
  />
)}

          </main>
        </div>
      );
    }
  }

  return (
    <>
      {body}
      <ToastHost toasts={toasts} dismiss={dismiss} />
    </>
  );
};

/* ----------------------------- Shared UI Bits ----------------------------- */

const Card: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-xl border bg-white p-5 shadow-sm">
    <div className="text-slate-800 font-semibold mb-3">{title}</div>
    {children}
  </div>
);

const KPI: React.FC<{ title: string; value: number | string }> = ({ title, value }) => (
  <div className="rounded-xl border bg-white p-5 shadow-sm">
    <div className="text-slate-500 text-sm">{title}</div>
    <div className="text-2xl font-semibold text-slate-800 mt-1">{value}</div>
  </div>
);

const PlaceholderCard: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
  <div className="rounded-xl border bg-white p-6 shadow-sm">
    <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
    {description && <p className="mt-2 text-slate-600 text-sm">{description}</p>}
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="text-slate-800 font-semibold">{title}</div>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
              ✕
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
};

const TextField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({ label, value, onChange, placeholder, disabled }) => {
  return (
    <label className="block">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <input
        disabled={disabled}
        className={`w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 ${disabled ? "bg-slate-100 text-slate-400" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
};

const SelectField: React.FC<{
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  options: { label: string; value: string | number }[];
  disabled?: boolean;
}> = ({ label, value, onChange, options, disabled }) => {
  return (
    <label className="block">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <select
        disabled={disabled}
        className={`w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 ${disabled ? "bg-slate-100 text-slate-400" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={`${o.value}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
};
/* ---------------------------- User Management ----------------------------- */

const UserManagementView: React.FC<{
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  regions: RegionsCatalog;
  setRegions: React.Dispatch<React.SetStateAction<RegionsCatalog>>;
  dealers: Dealer[];
  setDealers: React.Dispatch<React.SetStateAction<Dealer[]>>;
  showToast: (m: string, k?: "success" | "error") => void;
}> = ({ users, setUsers, regions, setRegions, dealers, setDealers, showToast }) => {
  // ---------- Utils: CSV ----------
  const csvEscape = (v: unknown) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const downloadCSV = (filename: string, rows: (string | number)[][]) => {
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Users table + modal ----------
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyUser: User = { id: "", name: "", username: "", role: "Rep", states: [], regionsByState: {}, phone: "" };
  const [draft, setDraft] = useState<User>({ ...emptyUser });
  const [inviteToken, setInviteToken] = useState<string>("");

  const inviteUrl = inviteToken ? `${location.origin}/reset?token=${inviteToken}` : "";

  const openAddUser = () => {
    setEditingId(null);
    setDraft({ ...emptyUser, id: uid() });
    setInviteToken("");
    setUserModalOpen(true);
  };

  const openEditUser = (u: User) => {
    setEditingId(u.id);
    setDraft(JSON.parse(JSON.stringify(u)));
    setInviteToken("");
    setUserModalOpen(true);
  };

  const toggleStateForDraft = (st: string) => {
    setDraft((d) => {
      const present = d.states.includes(st);
      const nextStates = present ? d.states.filter((x) => x !== st) : [...d.states, st];
      const nextRegions = { ...d.regionsByState };
      if (!present) {
        if (!nextRegions[st]) nextRegions[st] = [];
      } else {
        delete nextRegions[st];
      }
      return { ...d, states: nextStates, regionsByState: nextRegions };
    });
  };
  const selectAllRegionsForState = (st: string) => setDraft((d) => ({ ...d, regionsByState: { ...d.regionsByState, [st]: [...(regions[st] || [])] } }));
  const clearRegionsForState = (st: string) => setDraft((d) => ({ ...d, regionsByState: { ...d.regionsByState, [st]: [] } }));
  const toggleRegionForDraft = (st: string, rg: string) => {
    setDraft((d) => {
      const current = d.regionsByState[st] || [];
      const has = current.includes(rg);
      const next = has ? current.filter((x) => x !== rg) : [...current, rg];
      return { ...d, regionsByState: { ...d.regionsByState, [st]: next } };
    });
  };

  const saveUser = () => {
    if (!draft.name.trim() || !draft.username.trim()) return showToast("Name and username are required.", "error");
    const usernameTaken = users.some((u) => u.username === draft.username && u.id !== draft.id);
    if (usernameTaken) return showToast("Username already exists.", "error");

    if (editingId) {
      setUsers((prev) => prev.map((u) => (u.id === editingId ? { ...draft } : u)));
      showToast("User updated.", "success");
    } else {
      setUsers((prev) => [{ ...draft }, ...prev]);
      showToast("User added.", "success");
    }
    setUserModalOpen(false);
  };

  const removeUser = (id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
    showToast("User removed.", "success");
  };

  const generateInvite = () => {
    const token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    setInviteToken(token);
    showToast("Invite link generated. Use Copy to share.", "success");
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast("Invite link copied.", "success");
    } catch {
      showToast("Unable to copy; select and copy manually.", "error");
    }
  };

  // ---------- Regions catalog & Import/Export ----------
  const [stateInput, setStateInput] = useState("");
  const [regionInput, setRegionInput] = useState("");
  const [searchRegion, setSearchRegion] = useState(""); // ← single declaration (FIXED)

  const allStates = Object.keys(regions).sort();

  const dealerCountFor = (st: string, rg: string) => dealers.filter((d) => d.state === st && d.region === rg).length;

  const createRegion = () => {
    const st = stateInput.trim().toUpperCase();
    const rg = regionInput.trim();
    if (!st || !rg) return showToast("State and region are required.", "error");
    setRegions((prev) => {
      const next = { ...prev };
      if (!next[st]) next[st] = [];
      if (!next[st].includes(rg)) next[st] = [...next[st], rg].sort();
      return next;
    });
    setStateInput("");
    setRegionInput("");
    showToast("Region added.", "success");
  };

  const deleteRegion = (st: string, rg: string) => {
    const count = dealerCountFor(st, rg);
    if (count > 0) return showToast("Cannot delete region while dealers exist there. Move them first.", "error");
    setRegions((prev) => {
      const next = { ...prev };
      next[st] = (next[st] || []).filter((x) => x !== rg);
      if (!next[st]?.length) delete next[st];
      return next;
    });
    setUsers((prev) =>
      prev.map((u) => {
        const copy = { ...u, regionsByState: { ...u.regionsByState } };
        if (copy.regionsByState[st]) copy.regionsByState[st] = copy.regionsByState[st].filter((x) => x !== rg);
        return copy;
      })
    );
    showToast("Region deleted.", "success");
  };

  // Move dealers between regions (bulk)
  const [fromState, setFromState] = useState("");
  const [fromRegion, setFromRegion] = useState("");
  const [toState, setToState] = useState("");
  const [toRegion, setToRegion] = useState("");
  const moveDealers = () => {
    if (!fromState || !fromRegion || !toState || !toRegion) return showToast("Please select both From and To state/region.", "error");
    const moving = dealers.filter((d) => d.state === fromState && d.region === fromRegion).length;
    if (moving === 0) return showToast("No dealers to move in the selected From region.", "error");
    setRegions((prev) => {
      const next = { ...prev };
      if (!next[toState]) next[toState] = [];
      if (!next[toState].includes(toRegion)) next[toState] = [...next[toState], toRegion].sort();
      return next;
    });
    setDealers((prev) =>
      prev.map((d) => (d.state === fromState && d.region === fromRegion ? { ...d, state: toState, region: toRegion } : d))
    );
    showToast(`Moved ${moving} dealer(s).`, "success");
  };

  // ---------- Regions table model ----------
  const [regionModal, setRegionModal] = useState<{ state: string; region: string } | null>(null); // (FIXED type)
  const regionRows = useMemo(() => {
    const rows: { state: string; region: string; count: number }[] = [];
    for (const st of Object.keys(regions)) for (const rg of regions[st]) rows.push({ state: st, region: rg, count: dealerCountFor(st, rg) });
    const q = searchRegion.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => `${r.state} ${r.region}`.toLowerCase().includes(q)) : rows;
    return filtered.sort((a, b) => a.state.localeCompare(b.state) || a.region.localeCompare(b.region));
  }, [regions, dealers, searchRegion]);

  const repDisplayForDealer = (d: Dealer) => {
    if (d.assignedRepUsername) {
      const u = users.find((x) => x.username === d.assignedRepUsername);
      return u ? u.name : d.assignedRepUsername;
    }
    const covering = users.filter((u) => u.role === "Rep" && u.states.includes(d.state) && (u.regionsByState[d.state]?.includes(d.region) ?? false));
    return covering.length ? covering.map((x) => x.name).join(", ") : "—";
  };

  const exportRegionDealers = (st: string, rg: string) => {
    const list = dealers.filter((d) => d.state === st && d.region === rg);
    const rows: (string | number)[][] = [
      ["Region", "Dealer", "Rep(s)", "State", "Status", "Type", "LastVisited"],
      ...list.map((d) => [rg, d.name, repDisplayForDealer(d), d.state, d.status, d.type, d.lastVisited || ""]),
    ];
    downloadCSV(`dealers_${st}_${rg}.csv`, rows);
  };

  // ---------- Global export ----------
  const exportAll = () => {
    const rows: (string | number)[][] = [["Region", "Dealer", "Rep(s)", "State"]];
    const sorted = [...dealers].sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
    for (const d of sorted) rows.push([d.region, d.name, repDisplayForDealer(d), d.state]);
    downloadCSV("regions_reps_dealers.csv", rows);
  };

  // ---------- Import (Dealers & Regions) ----------
  const parseCsv = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length === 0) return { header: [] as string[], rows: [] as string[][] };
    const split = (line: string) => {
      // simple CSV splitter that handles quotes
      const out: string[] = [];
      let cur = "", inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = !inQ;
          }
        } else if (ch === "," && !inQ) {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const header = split(lines[0]).map((h) => h.toLowerCase());
    const rows = lines.slice(1).map(split);
    return { header, rows };
  };

  const handleImportDealers = async (file: File) => {
    try {
      const { header, rows } = await parseCsv(file);
      const idx = (h: string) => header.indexOf(h);
      const rName = idx("dealer") >= 0 ? idx("dealer") : idx("name");
      const rState = idx("state");
      const rRegion = idx("region");
      const rType = idx("type");
      const rStatus = idx("status");

      if (rName < 0 || rState < 0 || rRegion < 0) {
        return showToast('Dealers CSV needs at least "Dealer/Name", "State", "Region".', "error");
      }

      const added: Dealer[] = [];
      const ensureRegion = (st: string, rg: string) =>
        setRegions((prev) => {
          const next = { ...prev };
          if (!next[st]) next[st] = [];
          if (!next[st].includes(rg)) next[st] = [...next[st], rg].sort();
          return next;
        });

      for (const row of rows) {
        const name = row[rName]?.trim();
        const state = row[rState]?.trim().toUpperCase();
        const region = row[rRegion]?.trim();
        if (!name || !state || !region) continue;

        const type = (row[rType]?.trim() as DealerType) || "Independent";
        const status = (row[rStatus]?.trim() as DealerStatus) || "Prospect";

        ensureRegion(state, region);

        added.push({
          id: uid(),
          name,
          state,
          region,
          type,
          status,
          contacts: [],
        });
      }
      if (!added.length) return showToast("No dealers parsed from file.", "error");

      setDealers((prev) => [...prev, ...added]);
      showToast(`Imported ${added.length} dealer(s).`, "success");
    } catch {
      showToast("Failed to import dealers.", "error");
    }
  };

  const handleImportRegions = async (file: File) => {
    try {
      const { header, rows } = await parseCsv(file);
      const iState = header.indexOf("state");
      const iRegion = header.indexOf("region");
      if (iState < 0 || iRegion < 0) return showToast('Regions CSV must have "State" and "Region" columns.', "error");

      let added = 0;
      setRegions((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          const st = row[iState]?.trim().toUpperCase();
          const rg = row[iRegion]?.trim();
          if (!st || !rg) continue;
          if (!next[st]) next[st] = [];
          if (!next[st].includes(rg)) {
            next[st] = [...next[st], rg].sort();
            added++;
          }
        }
        return next;
      });
      showToast(`Imported ${added} region(s).`, "success");
    } catch {
      showToast("Failed to import regions.", "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Users */}
      <Card title="Users">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm text-slate-600">Add and manage users, assign states and regions.</div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={exportAll}>
              Export CSV
            </button>
            <button className={`${brand.primary} text-white px-3 py-2 rounded-lg`} onClick={openAddUser}>
              + Add User
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="py-2 px-3 text-left">Name</th>
                <th className="py-2 px-3 text-left">Username</th>
                <th className="py-2 px-3 text-left">Phone</th>
                <th className="py-2 px-3 text-left">Role</th>
                <th className="py-2 px-3 text-left">States</th>
                <th className="py-2 px-3 text-left">Regions Assigned</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="py-2 px-3">{u.name}</td>
                  <td className="py-2 px-3">{u.username}</td>
                  <td className="py-2 px-3">{u.phone || "—"}</td>
                  <td className="py-2 px-3">{u.role}</td>
                  <td className="py-2 px-3">{u.states.join(", ") || "—"}</td>
                  <td className="py-2 px-3">
                    {u.states.length === 0 ? "—" : u.states.map((st) => `${st}: ${(u.regionsByState[st] || []).length}`).join("  •  ")}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button className="px-2 py-1 rounded border text-slate-700 hover:bg-slate-50 mr-2" onClick={() => openEditUser(u)}>
                      Edit
                    </button>
                    <button className="px-2 py-1 rounded border border-red-600 text-red-700 hover:bg-red-50" onClick={() => removeUser(u.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-slate-500" colSpan={7}>
                    No users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Regions Catalog */}
      <Card title="Regions Catalog">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="md:col-span-2 grid sm:grid-cols-2 gap-3">
            <TextField label="State (e.g., IL)" value={stateInput} onChange={setStateInput} />
            <TextField label="Region (e.g., Chicago South)" value={regionInput} onChange={setRegionInput} />
            <div className="sm:col-span-2 flex gap-2">
              <button className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={createRegion}>
                Add / Create
              </button>
              <input
                className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search regions…"
                value={searchRegion}
                onChange={(e) => setSearchRegion(e.target.value)}
              />
            </div>
          </div>

          {/* Move Dealers */}
          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium text-slate-700 mb-2">Move Dealers Between Regions (bulk)</div>
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="From State" value={fromState} onChange={setFromState} options={[{ label: "—", value: "" }, ...allStates.map((s) => ({ label: s, value: s }))]} />
              <SelectField label="From Region" value={fromRegion} onChange={setFromRegion} options={[{ label: "—", value: "" }, ...((regions[fromState] || []).map((r) => ({ label: r, value: r })))]} />
              <SelectField label="To State" value={toState} onChange={setToState} options={[{ label: "—", value: "" }, ...allStates.map((s) => ({ label: s, value: s }))]} />
              <SelectField label="To Region" value={toRegion} onChange={setToRegion} options={[{ label: "—", value: "" }, ...((regions[toState] || []).map((r) => ({ label: r, value: r })))]} />
            </div>
            <button className="mt-2 w-full px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={moveDealers}>
              Move Dealers
            </button>
          </div>
        </div>

        {/* Regions list (clickable rows) */}
        <div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="min-w-[720px] w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="py-2 px-3 text-left">State</th>
                <th className="py-2 px-3 text-left">Region</th>
                <th className="py-2 px-3 text-right">Dealers</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {regionRows.map((r) => (
                <tr key={`${r.state}-${r.region}`} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => setRegionModal({ state: r.state, region: r.region })}>
                  <td className="py-2 px-3">{r.state}</td>
                  <td className="py-2 px-3">{r.region}</td>
                  <td className="py-2 px-3 text-right">{r.count}</td>
                  <td className="py-2 px-3 text-right">
                    <button
                      className="px-2 py-1 rounded border border-red-600 text-red-700 hover:bg-red-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteRegion(r.state, r.region);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {regionRows.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-slate-500" colSpan={4}>
                    No regions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Import / Export helpers */}
      <Card title="Bulk Import">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border p-3">
            <div className="font-medium text-slate-800 mb-2">Import Dealers (CSV)</div>
            <div className="text-xs text-slate-500 mb-2">Columns: Dealer/Name, State, Region, [Type], [Status]</div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportDealers(f);
                e.currentTarget.value = "";
              }}
            />
          </div>
          <div className="rounded-lg border p-3">
            <div className="font-medium text-slate-800 mb-2">Import Regions (CSV)</div>
            <div className="text-xs text-slate-500 mb-2">Columns: State, Region</div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportRegions(f);
                e.currentTarget.value = "";
              }}
            />
          </div>
        </div>
      </Card>

      {/* Add/Edit User Modal */}
      {userModalOpen && (
        <Modal title={editingId ? "Edit User" : "Add User"} onClose={() => setUserModalOpen(false)}>
          <div className="grid md:grid-cols-2 gap-3">
            <TextField label="Full Name" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
            <TextField label="Username" value={draft.username} onChange={(v) => setDraft((d) => ({ ...d, username: v }))} />
            <SelectField
              label="Role"
              value={draft.role}
              onChange={(v) => setDraft((d) => ({ ...d, role: v as Role }))}
              options={[
                { label: "Rep", value: "Rep" },
                { label: "Manager", value: "Manager" },
                { label: "Admin", value: "Admin" },
              ]}
            />
            <TextField label="Phone" value={draft.phone || ""} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} />
          </div>

          {/* Invite link row */}
          <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-end">
            <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={generateInvite} type="button">
              Generate Invite Link
            </button>
            <input className="flex-1 rounded-lg border px-3 py-2 text-sm" value={inviteUrl} readOnly placeholder="Invite link will appear here…" />
            <button className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={copyInvite} disabled={!inviteUrl}>
              Copy
            </button>
          </div>

          {/* States selection */}
          <div className="mt-4">
            <div className="text-slate-800 font-semibold mb-2">Assign States</div>
            <div className="flex flex-wrap gap-2">
              {allStates.length === 0 && <div className="text-sm text-slate-500">No states in catalog yet.</div>}
              {allStates.map((st) => (
                <label key={st} className="inline-flex items-center gap-2 text-sm border rounded-lg px-3 py-1">
                  <input type="checkbox" checked={draft.states.includes(st)} onChange={() => toggleStateForDraft(st)} />
                  {st}
                </label>
              ))}
            </div>
          </div>

          {/* Regions per selected state */}
          {draft.states.map((st) => (
            <div key={st} className="mt-4 border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-700 font-medium">Regions in {st}</div>
                <div className="flex items-center gap-2">
                  <button className="text-blue-700 text-sm hover:underline" onClick={() => selectAllRegionsForState(st)}>
                    Select All
                  </button>
                  <button className="text-slate-600 text-sm hover:underline" onClick={() => clearRegionsForState(st)}>
                    Clear
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(regions[st] || []).length === 0 && <div className="text-sm text-slate-500">No regions yet.</div>}
                {(regions[st] || []).map((rg) => (
                  <label key={rg} className="inline-flex items-center gap-2 text-sm border rounded-lg px-3 py-1">
                    <input type="checkbox" checked={(draft.regionsByState[st] || []).includes(rg)} onChange={() => toggleRegionForDraft(st, rg)} />
                    {rg}
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div className="mt-5 flex justify-end gap-2">
            <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setUserModalOpen(false)}>
              Cancel
            </button>
            <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={saveUser}>
              {editingId ? "Save Changes" : "Add User"}
            </button>
          </div>
        </Modal>
      )}

      {/* Region Dealers Modal */}
      {regionModal && (
        <Modal title={`Dealers in ${regionModal.region}, ${regionModal.state}`} onClose={() => setRegionModal(null)}>
          <div className="mb-3 text-sm text-slate-600">
            {dealers.filter((d) => d.state === regionModal.state && d.region === regionModal.region).length} dealer(s) found
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-[700px] w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="py-2 px-3 text-left">Dealer</th>
                  <th className="py-2 px-3 text-left">Status</th>
                  <th className="py-2 px-3 text-left">Type</th>
                  <th className="py-2 px-3 text-left">Rep(s)</th>
                  <th className="py-2 px-3 text-right">Last Visited</th>
                </tr>
              </thead>
              <tbody>
                {dealers
                  .filter((d) => d.state === regionModal.state && d.region === regionModal.region)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="py-2 px-3">{d.name}</td>
                      <td className="py-2 px-3">{d.status}</td>
                      <td className="py-2 px-3">{d.type}</td>
                      <td className="py-2 px-3">{repDisplayForDealer(d)}</td>
                      <td className="py-2 px-3 text-right">{d.lastVisited || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-between">
            <button
              className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50"
              onClick={() => exportRegionDealers(regionModal.state, regionModal.region)}
            >
              Export CSV
            </button>
            <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setRegionModal(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default App;
