/* ============================= PART 1 / 4 ================================
   Imports, Types, Persistence, Seeders, Toasts, Auth, Shell, Dealer Search
   (With requested changes: Daily Summary 7-day + Admin/Manager scope,
    invite/password storage scaffolding, and login enhancements.)
=========================================================================== */
import { supabase } from './supabaseClient';
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

// ---- Polyfill & types for String.replaceAll (to support older TS libs) ----
declare global {
  interface String {
    replaceAll(search: string | RegExp, replacement: string): string;
  }
}
// Runtime shim (safe for modern browsers; no-op if exists)
if (!(String.prototype as any).replaceAll) {
  (String.prototype as any).replaceAll = function (search: any, replacement: any) {
    const target = String(this);
    if (search instanceof RegExp) {
      if (!search.global) search = new RegExp(search.source, search.flags + "g");
      return target.replace(search, replacement);
    }
    const s = String(search);
    const r = String(replacement);
    return target.split(s).join(r);
  };
}


/**
 * Final Stage 5B — Reporting upgrades (per-rep drilldown, month-to-month) + prior fixes
 * + Requested updates (Daily Summary 7-day scope/Admin-Manager access, auth invite/reset scaffolding)
 *
 * What's included:
 *  - Dealer Search: Region filter works globally, labeled "Region"
 *  - Unified Quick Notes on Home & Dealer Notes
 *  - Dealer Notes: Reps with access can edit details; delete dealer for Admin/Manager/Rep with access
 *  - Reporting:
 *      • Overall view (All Reps): existing KPIs + new month-to-month visits timeline
 *      • Rep selector: identical KPIs but filtered to a single rep's coverage/overrides
 *      • Visit KPIs: This Month, Last Month, Δ change
 *      • "Dealers not visited in last 30 days" list (by rep coverage)
 *  - NEW (per request):
 *      • Daily Summary toggle: Today / Yesterday / Last 7 Days; Admin/Manager can view All reps or a single rep
 *      • Auth scaffolding for invite/reset flow (localStorage tokens/passwords)
 */

 /* ----------------------------- Types & Models ----------------------------- */
type Role = "Admin" | "Manager" | "Rep";
type UserStatus = "Active" | "Inactive";

type User = {
  id: string;
  name: string;
  username: string;
  email?: string;
  role: Role;
  states: string[];
  regionsByState: Record<string, string[]>;
  phone?: string; // ← NEW
  status?: UserStatus; // ← NEW (login gating)
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
  completedAtISO?: string; // ← NEW (for “Complete Task”)
};

type RouteKey = "login" | "dealer-search" | "dealer-notes" | "reporting" | "user-management" | "rep-route" | "reset";

/* ------------------------------- Persistence ------------------------------ */
const LS_USERS = "demo_users";
const LS_DEALERS = "demo_dealers";
const LS_REGIONS = "demo_regions";
const LS_TASKS = "demo_tasks";
const LS_NOTES = "demo_notes";
const LS_LAST_SELECTED_DEALER = "demo_last_selected_dealer";
const LS_REP_ROUTE = "demo_rep_route"; // per-user routes (local preview)
// NEW: simple auth-related storage (demo-level)
const LS_INVITES = "demo_invites";     // token -> { userId, createdAtISO }
const LS_PASSWORDS = "demo_passwords"; // username -> password (demo only)

type RegionsCatalog = Record<string, string[]>;
type InviteMap = Record<string, { userId: string; createdAtISO: string }>;
type PasswordMap = Record<string, string>;

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
        status: "Active",
      },
      {
        id: uid(),
        name: "General Manager",
        username: "manager",
        role: "Manager",
        states: ["IL", "TX"],
        regionsByState: { IL: ["Chicago North", "Chicago South"], TX: ["Dallas", "Houston"] },
        status: "Active",
      },
      {
        id: uid(),
        name: "Rep One",
        username: "rep1",
        role: "Rep",
        states: ["IL", "TX"],
        regionsByState: { IL: ["Chicago South"], TX: ["Dallas"] },
        status: "Active",
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
  if (Object.keys(loadLS<InviteMap>(LS_INVITES, {})).length === 0) saveLS(LS_INVITES, {});     // NEW
  if (Object.keys(loadLS<PasswordMap>(LS_PASSWORDS, {})).length === 0) saveLS(LS_PASSWORDS, {}); // NEW
}
seedIfNeeded();

/* --------------------------------- Toasts --------------------------------- */
type ToastKind = "success" | "error" | "info";
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
  primary: "bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500",
  outline: "border border-blue-600 text-blue-600 hover:bg-blue-50",
  ghost: "text-slate-700 hover:bg-slate-100",
  pill: "rounded-full",
};

/* ------------------------------- UI Shell --------------------------------- */
// Enhanced login: supports demo creds OR user passwords saved via invite/reset.
// Also enforces user.status !== "Inactive" for LS-password users.
const LoginView: React.FC<{
  onLogin: (s: Session) => void;
  showToast: (m: string, k?: ToastKind) => void;
}> = ({ onLogin, showToast }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  
  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
  
    // Treat the "Username" box as EMAIL for now
    const email = username.trim().toLowerCase();
    if (!email || !password) {
      showToast("Enter email and password.", "error");
      return;
    }
  
    // In production, supabase.auth.signInWithPassword exists.
    // In StackBlitz (stub client), it may not exist; we'll fall back to the legacy local login below.
    const canSupabase: boolean =
      typeof (supabase as any)?.auth?.signInWithPassword === "function";
  
    if (canSupabase) {
      try {
        // 1) Real Supabase login
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
  
        const user = data.user;
        const userId = user?.id as string;
  
        // 2) Read the user's profile (username/role/status) from Supabase
        let chosenUsername = (user?.user_metadata?.username as string) || email.split("@")[0];
        let role: Role = "Rep";
        let status: UserStatus = "Active";
  
        try {
          const { data: prof } = await supabase
            .from("profiles")
            .select("username, role, status")
            .eq("id", userId)
            .maybeSingle();
  
          if (prof) {
            chosenUsername = (prof.username as string) || chosenUsername;
            role = (prof.role as Role) || role;
            status = (prof.status as UserStatus) || status;
          } else {
            // 3) If no row yet, create it (RLS policy lets users insert their own row)
            await supabase.from("profiles").upsert(
              { id: userId, email, username: chosenUsername, role, status },
              { onConflict: "id" }
            );
          }
        } catch {
          // Table might not exist yet or RLS blocked — continue with defaults
        }
  
        // 4) Block inactive users
        if (status === "Inactive") {
          showToast("Your account is inactive. Contact an administrator.", "error");
          await supabase.auth.signOut();
          return;
        }
  
        // 5) Success — enter app with role from profiles (or default)
        onLogin({ username: chosenUsername, role });
        showToast(`Welcome, ${chosenUsername}!`, "success");
        return; // end after successful Supabase path
      } catch (err: any) {
        // If Supabase rejects, fall through to local legacy login so nobody is blocked
      }
    }
  
    // === Legacy local fallback (StackBlitz preview / old demo accounts) ===
    try {
      const users = loadLS<User[]>(LS_USERS, []);
      const pwMap = loadLS<PasswordMap>(LS_PASSWORDS, {});
      const u =
        users.find(
          (x) =>
            (x.email || "").toLowerCase() === email ||
            (x.username || "").toLowerCase() === email ||
            (x.username || "").toLowerCase() === email.split("@")[0]
        ) || null;
  
      if (!u) return showToast("Invalid credentials.", "error");
      if ((u.status ?? "Active") === "Inactive") {
        return showToast("Your account is inactive. Please contact an administrator.", "error");
      }
      const storedPw = pwMap[u.username];
      if (!storedPw || storedPw !== password) return showToast("Invalid credentials.", "error");
  
      onLogin({ username: u.username, role: u.role });
      showToast(`Welcome, ${u.username}!`, "success");
    } catch {
      showToast("Invalid credentials.", "error");
    }
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
              placeholder="Enter username"
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
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="text-sm text-blue-400 hover:underline"
              onClick={async () => {
                // We treat the "Username" field as the email for now
                const email = username.trim().toLowerCase();
                if (!email || !email.includes("@")) {
                  showToast("Type your email above first.", "error");
                  return;
                }

                // In StackBlitz stub this may not exist; guard it
                const canReset =
                  typeof (supabase as any)?.auth?.resetPasswordForEmail === "function";
                if (!canReset) {
                  showToast("This works on the live site with Supabase keys.", "error");
                  return;
                }

                const redirectTo = `${window.location.origin}/auth/callback?next=/reset`;
                const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
                if (error) return showToast(error.message, "error");
                showToast("Password reset email sent.", "success");
              }}
            >
              Forgot password?
            </button>
          </div>
          <button className={`w-full ${brand.primary} text-white font-medium rounded-lg px-4 py-2 focus:outline-none focus:ring-2`} type="submit">
            Log In
          </button>
        </form>
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
              {session?.role === "Rep" && (
  <Tab
    label="Rep Route"
    active={route === "rep-route"}
    onClick={() => setRoute("rep-route")}
  />
)}
              <Tab label="Reporting" active={route === "reporting"} onClick={() => setRoute("reporting")} disabled={!can.reporting} />
              <Tab label="User Management" active={route === "user-management"} onClick={() => setRoute("user-management")} disabled={!can.userMgmt} />
            </nav>
          )}
        </div>
        {session ? (
          <div className="flex items-center gap-2">
            {/* Show ONLY incomplete tasks as chips */}
            {tasksForUser
              .filter((t) => !t.completedAtISO)
              .slice(0, 3)
              .map((t) => (
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
            {session?.role === "Rep" && (
  <MobileTab
    label="Route"
    active={route === "rep-route"}
    onClick={() => setRoute("rep-route")}
  />
)}
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

  // --- paging + searching flags ---
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const isSearching = Boolean(q || fRep || fState || fRegion || fType || fStatus);
  
  // reset to page 1 whenever search/filters change
  useEffect(() => {
    setPage(1);
  }, [q, fRep, fState, fRegion, fType, fStatus]);
  

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddDealerForm>(defaultAddDealerForm());

  // Quick Notes
  const [scratchOpen, setScratchOpen] = useState(false);
  const sKey = quickNoteKey(session?.username);
  const [scratch, setScratch] = useState<string>(() => loadLS<string>(sKey, ""));
  useEffect(() => {
    localStorage.setItem(sKey, JSON.stringify(scratch));
  }, [sKey, scratch]);

  // Daily Summary (now for Rep + Admin/Manager) with range toggle
  const role = session?.role;
  const isRep = role === "Rep";
  const isAdminManager = role === "Admin" || role === "Manager";

  const [dailyOpen, setDailyOpen] = useState(false);
  const [summaryRange, setSummaryRange] = useState<"today" | "yesterday" | "7d">("today"); // ← add "yesterday"
  const [summaryRep, setSummaryRep] = useState<string>("ALL"); // Admin/Manager only: "ALL" or username

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

  // Default (no search/filters): show only the 10 most recently visited
const recentTop10 = useMemo(() => {
  return [...dealers]
    .sort((a, b) => {
      const ta = a.lastVisited ? Date.parse(a.lastVisited) : 0;
      const tb = b.lastVisited ? Date.parse(b.lastVisited) : 0;
      if (tb !== ta) return tb - ta; // newest first
      return a.name.localeCompare(b.name); // tie-breaker
    })
    .slice(0, 10);
}, [dealers]);

// Pagination for search results
const totalPages = isSearching ? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)) : 1;

const paged = useMemo(() => {
  if (!isSearching) return recentTop10;
  const start = (page - 1) * PAGE_SIZE;
  return filtered.slice(start, start + PAGE_SIZE);
}, [isSearching, filtered, page, recentTop10]);

  // Typeahead (mobile only): show top 6 matches under the search input
  const suggestions = useMemo(() => filtered.slice(0, 6), [filtered]);

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

  const addDealer = async () => {
    const err = validateForm();
    if (err) return showToast(err, "error");
  
    // If a Rep is adding, force-assign to them
    const assignedRep =
      session?.role === "Rep" ? session.username : form.assignedRepUsername || "";
  
    // keep your regions catalog in sync for filters
    ensureRegionInCatalog(form.state, form.region);
  
    try {
      // 1) Insert into Supabase (shared DB)
      const payload = {
        name: form.name.trim(),
        state: form.state,
        region: form.region,
        type: form.type,         // "Franchise" | "Independent"
        status: form.status,     // "Active" | "Pending" | "Prospect" | "Inactive" | "Black Listed"
        address1: form.address1?.trim() || null,
        address2: form.address2?.trim() || null,
        city: form.city?.trim() || null,
        zip: form.zip?.trim() || null,
        contacts: form.contacts
          .filter((c) => c.name || c.phone)
          .map((c) => ({ name: c.name.trim(), phone: c.phone.trim() })),
        assigned_rep_username: assignedRep || null,
        last_visited: null,
        sending_deals: null,
        no_deal_reasons: null,
      };
  
      const { data, error } = await supabase
        .from("dealers")
        .insert([payload])
        .select(
          "id,name,state,region,type,status,address1,address2,city,zip,contacts,assigned_rep_username,last_visited,sending_deals,no_deal_reasons"
        )
        .single();
  
      if (error) throw error;
  
      // 2) Reflect the saved row in the UI (using Supabase's UUID id)
      const row = data as any;
      const newDealer: Dealer = {
        id: row.id,
        name: row.name,
        state: row.state,
        region: row.region,
        type: row.type,
        status: row.status,
        address1: row.address1 || "",
        address2: row.address2 || "",
        city: row.city || "",
        zip: row.zip || "",
        contacts: Array.isArray(row.contacts) ? row.contacts : [],
        assignedRepUsername: row.assigned_rep_username || undefined,
        lastVisited: row.last_visited ? String(row.last_visited) : undefined,
        sendingDeals: typeof row.sending_deals === "boolean" ? row.sending_deals : undefined,
        noDealReasons: row.no_deal_reasons || undefined,
      };
  
      setDealers((prev) => [newDealer, ...prev]);
      showToast(`Dealer "${newDealer.name}" added.`, "success");
      setAddOpen(false);
      resetForm();
    } catch (e: any) {
      showToast(e?.message || "Failed to add dealer.", "error");
    }
  };  

  const canSeeReporting = can.reporting && (session?.role === "Admin" || session?.role === "Manager");
  const canSeeUserMgmt = can.userMgmt && session?.role === "Admin";

  // ===== Daily Summary helpers =====
  const isToday = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };
  const isYesterday = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return (
      d.getFullYear() === y.getFullYear() &&
      d.getMonth() === y.getMonth() &&
      d.getDate() === y.getDate()
    );
  };
  const isWithin7Days = (iso: string) => {
    const ts = new Date(iso).getTime();
    const now = Date.now();
    const seven = 7 * 24 * 60 * 60 * 1000;
    return now - ts <= seven && ts <= now;
  };
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString();
  const dealerById = (id: string) => dealers.find((d) => d.id === id);
  const snippet = (s: string, len = 48) => (s.length > len ? s.slice(0, len) + "…" : s);

  // Scoped summary notes per role/range/rep
  const summaryNotes = useMemo(() => {
    let scoped = notes.slice();
    // Role scoping
    if (isRep) {
      scoped = scoped.filter((n) => n.authorUsername === session!.username);
    } else if (isAdminManager) {
      if (summaryRep !== "ALL") scoped = scoped.filter((n) => n.authorUsername === summaryRep);
      // else: all reps
    }
    // Range scoping
    if (summaryRange === "today") {
      scoped = scoped.filter((n) => isToday(n.tsISO));
    } else if (summaryRange === "yesterday") {
      scoped = scoped.filter((n) => isYesterday(n.tsISO));
    } else {
      scoped = scoped.filter((n) => isWithin7Days(n.tsISO));
    }
    // Sort recent first
    return scoped.sort((a, b) => (a.tsISO > b.tsISO ? -1 : 1));
  }, [notes, isRep, isAdminManager, session, summaryRep, summaryRange]);

  const buildSummaryPlainText = () => {
    if (summaryNotes.length === 0) return "No notes in selected range.";
    const lines = summaryNotes.map((n) => {
      const d = dealerById(n.dealerId);
      const where = d ? `${d.name} — ${d.region}, ${d.state}` : `(dealer removed)`;
      return `• ${fmtDateTime(n.tsISO)} | ${where} | ${n.category} | by ${n.authorUsername}: ${n.text}`;
    });
    return lines.join("\n");
  };

  // CSV export for summary (respects role/range/rep)
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
  const exportSummaryCSV = () => {
    const rows: (string | number)[][] = [["Time", "Dealer", "Region", "State", "Category", "Author", "Note"]];
    summaryNotes.forEach((n) => {
      const d = dealerById(n.dealerId);
      rows.push([
        new Date(n.tsISO).toLocaleString(),
        d?.name || "",
        d?.region || "",
        d?.state || "",
        n.category,
        n.authorUsername,
        n.text || "",
      ]);
    });
    const today = new Date().toISOString().slice(0, 10);
    const scope =
      isRep ? session?.username :
      summaryRep === "ALL" ? "all" : summaryRep;
    downloadCSV(`daily_summary_${summaryRange}_${today}_${scope}.csv`, rows);
  };

  return (
    <div className="space-y-4 pb-16 md:pb-0">{/* pb for mobile FAB clearance */}
      {/* Top actions row */}
      <div className="flex items-center gap-2 justify-center md:justify-start">
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

        {/* Daily Summary — now for Rep + Admin/Manager with range & rep controls */}
        {(isRep || isAdminManager) && (
          <button
            onClick={() => setDailyOpen(true)}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white shadow"
            title="Show notes summary"
          >
            📄 Daily Summary
          </button>
        )}

        {/* Unified Quick Notes button — hidden on mobile, keep on desktop */}
        <button
          onClick={() => setScratchOpen(true)}
          className={`hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow`}
          title="Open Quick Notes"
        >
          ✎ Quick Notes
        </button>
      </div>

{/* Filters (note: override-only removed) */}
<div className="rounded-xl border bg-white p-4 shadow-sm relative">
  {/* Desktop search (above filters) */}
<div className="hidden md:block mb-3">
  <div className="relative">
    <input
      className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
      placeholder="Search dealers, city, state, region…"
      value={q}
      onChange={(e) => setQ(e.target.value)}
    />
  </div>
</div>
<div className="grid grid-cols-1 md:grid-cols-5 gap-3">
    {/* Search with mobile typeahead container */}
    <div className="md:col-span-2 relative md:hidden">
      <input
        className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Search dealers, city, state, region…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {/* Mobile suggestions dropdown */}
      {q.trim().length > 0 && suggestions.length > 0 && (
        <div className="md:hidden absolute left-0 right-0 mt-1 z-20 rounded-xl border bg-white shadow max-h-64 overflow-y-auto">
          {suggestions.map((d) => (
            <button
              key={d.id}
              className="w-full text-left px-3 py-2 hover:bg-blue-50"
              onClick={() => goToDealer(d.id)}
            >
              <div className="font-medium text-slate-800">{d.name}</div>
              <div className="text-xs text-slate-500">
                {d.region}, {d.state}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>

    {/* Rep filter */}
    <div className={`${isRep ? "hidden md:block" : ""}`}>
      <SelectField
        label="Rep"
        value={fRep}
        onChange={(v) => setFRep(v)}
        options={[
          { label: "All", value: "" },
          ...repOptions.map((r) => ({
            label: `${r.name} (${r.username})`,
            value: r.username,
          })),
        ]}
      />
    </div>

    {/* State filter */}
    <SelectField
      label="State"
      value={fState}
      onChange={(v) => {
        setFState(v);
        if (v && !(regions[v] || []).includes(fRegion)) setFRegion("");
      }}
      options={[
        { label: "All", value: "" },
        ...stateOptions.map((st) => ({ label: st, value: st })),
      ]}
    />

    {/* Region filter */}
    <SelectField
      label="Region"
      value={fRegion}
      onChange={(v) => setFRegion(v)}
      options={[
        { label: "All", value: "" },
        ...(fState
          ? (regions[fState] || []).map((rg) => ({ label: rg, value: rg }))
          : allRegions.map((rg) => ({ label: rg, value: rg }))),
      ]}
    />

    {/* Type filter */}
    <SelectField
      label="Type"
      value={fType}
      onChange={(v) => setFType(v)}
      options={[
        { label: "All", value: "" },
        { label: "Franchise", value: "Franchise" },
        { label: "Independent", value: "Independent" },
      ]}
    />

    {/* Status filter */}
    <SelectField
      label="Status"
      value={fStatus}
      onChange={(v) => setFStatus(v)}
      options={[
        { label: "All", value: "" },
        ...["Active", "Pending", "Prospect", "Inactive", "Black Listed"].map(
          (s) => ({ label: s, value: s })
        ),
      ]}
    />
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
      {tasksForUser.filter((t) => !t.completedAtISO).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tasksForUser.filter((t) => !t.completedAtISO).map((t) => (
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
      <div className="rounded-xl border bg-white p-0 shadow-sm overflow-x-auto md:overflow-visible">
        <table className="min-w-[700px] md:min-w-[900px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="py-1.5 px-2 md:py-2 md:px-3 text-left">Dealer</th>
              <th className="py-1.5 px-2 md:py-2 md:px-3 text-left">Rep</th>
              <th className="py-1.5 px-2 md:py-2 md:px-3 text-left">Region</th>
              <th className="py-1.5 px-2 md:py-2 md:px-3 text-left hidden md:table-cell">State</th>
              <th className="py-1.5 px-2 md:py-2 md:px-3 text-left hidden md:table-cell">Type</th>
              <th className="py-1.5 px-2 md:py-2 md:px-3 text-left hidden md:table-cell">Status</th>
              <th className="py-1.5 px-2 md:py-2 md:px-3 text-right">Last Visited</th>
            </tr>
          </thead>

          <tbody>
          {paged.map((d) => {
              const hasOverride = Boolean(d.assignedRepUsername);
              return (
                <tr
                  key={d.id}
                  className="border-t hover:bg-blue-50/40 cursor-pointer odd:bg-slate-50 even:bg-white md:odd:bg-white md:even:bg-white"
                  onClick={() => goToDealer(d.id)}
                >
                  <td className="py-1.5 px-2 md:py-2 md:px-3 font-medium text-slate-800">{d.name}</td>

                  <td className="py-1.5 px-2 md:py-2 md:px-3">
                    <div className="flex items-center gap-2">
                      <span>{repNameForDealer(d)}</span>
                      {hasOverride && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">override</span>
                      )}
                    </div>
                  </td>

                  <td className="py-1.5 px-2 md:py-2 md:px-3">{d.region}</td>
                  <td className="py-1.5 px-2 md:py-2 md:px-3 hidden md:table-cell">{d.state}</td>
                  <td className="py-1.5 px-2 md:py-2 md:px-3 hidden md:table-cell">{d.type}</td>

                  <td className="py-1.5 px-2 md:py-2 md:px-3 hidden md:table-cell">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge(d.status)}`}>{d.status}</span>
                  </td>

                  <td className="py-1.5 px-2 md:py-2 md:px-3 text-right">{d.lastVisited || "—"}</td>
                </tr>
              );
            })}

{isSearching && filtered.length === 0 && (
  <tr>
    <td colSpan={7} className="py-6 text-center text-slate-500">
      No dealers match your search.
    </td>
  </tr>
)}

{!isSearching && recentTop10.length === 0 && (
  <tr>
    <td colSpan={7} className="py-6 text-center text-slate-500">
      No recently visited dealers yet.
    </td>
  </tr>
)}
          </tbody>
        </table>
        {isSearching && totalPages > 1 && (
  <div className="mt-3 flex items-center justify-between">
    <div className="text-sm text-slate-600">
      Page {page} of {totalPages}
    </div>
    <div className="flex items-center gap-2">
      <button
        className="px-3 py-2 rounded-lg border border-slate-300 disabled:opacity-50"
        onClick={() => setPage((p) => Math.max(1, p - 1))}
        disabled={page <= 1}
      >
        Previous
      </button>
      <button
        className="px-3 py-2 rounded-lg border border-slate-300 disabled:opacity-50"
        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        disabled={page >= totalPages}
      >
        Next
      </button>
    </div>
  </div>
)}
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

      {/* Daily Summary Modal (Rep + Admin/Manager) */}
      {dailyOpen && (isRep || isAdminManager) && (
        <Modal title="Daily Summary" onClose={() => setDailyOpen(false)}>
          {/* Controls */}
          <div className="flex flex-col md:flex-row md:items-end gap-3 mb-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">Range:</label>
              <SelectField
  label="Range"
  value={summaryRange}
  onChange={(v) => setSummaryRange(v as "today" | "yesterday" | "7d")}
  options={[
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "Last 7 Days", value: "7d" },
  ]}
/>
            </div>
            {isAdminManager && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600">Rep:</label>
                <SelectField
  label="Rep"
  value={summaryRep}
  onChange={(v) => setSummaryRep(v)}
  options={[
    { label: "All Reps", value: "ALL" },
    ...repOptions.map((r) => ({
      label: `${r.name} (${r.username})`,
      value: r.username,
    })),
  ]}
/>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  navigator.clipboard.writeText(buildSummaryPlainText());
                  showToast("Summary copied.", "success");
                }}
              >
                Copy All
              </button>
              <button className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={exportSummaryCSV}>
                Export CSV
              </button>
            </div>
          </div>

          {/* List */}
          <div className="space-y-3">
            {summaryNotes.length === 0 && <div className="text-sm text-slate-500">No notes in selected range.</div>}
            {summaryNotes.map((n) => {
              const d = dealerById(n.dealerId);
              return (
                <div key={n.id} className="border rounded-lg p-3">
                  <div className="text-xs text-slate-500 mb-1">{fmtDateTime(n.tsISO)}</div>
                  <div className="text-sm font-medium text-slate-800">{d ? d.name : "(dealer removed)"}</div>
                  <div className="text-xs text-slate-500 mb-1">{d ? `${d.region}, ${d.state}` : ""}</div>
                  <div className="inline-block text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 mb-1">{n.category}</div>
                  <div className="text-[11px] text-slate-500 mb-1">by {n.authorUsername}</div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.text}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-end">
            <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={() => setDailyOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* Mobile floating Quick Notes (also added to Home) */}
      <button
        className="fixed bottom-5 right-5 rounded-full shadow-lg px-4 py-3 text-white bg-amber-500 hover:bg-amber-600 md:hidden"
        onClick={() => setScratchOpen(true)}
        title="Quick Notes"
      >
        ✎
      </button>

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
    </div>
  );
};
/* ============================= PART 2 / 4 ================================
   Dealer Notes (status/details, notes, delete) + Reporting header/types
   Changes included here:
   - Manager-task “Complete Task” flow (sticky until completed)
   - Notes search bar (filters before pagination)
=========================================================================== */

/* ------------------------------ Dealer Notes ------------------------------ */
// Local-safe helpers (avoid ReferenceError if globals aren't present)
const labelNoteLocal = (c: NoteCategory) => {
  switch (c) {
    case "Visit":
      return "Visit";
    case "Problem":
      return "Problem";
    case "Manager":
      return "Manager Note";
    default:
      return "Other";
  }
};

const noteBadgeLocal = (c: NoteCategory) => {
  switch (c) {
    case "Visit":
      return "bg-green-100 text-green-700";
    case "Problem":
      return "bg-amber-100 text-amber-700";
    case "Manager":
      return "bg-purple-100 text-purple-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

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

  // Quick Notes (same scratch key as home)
  const [scratchOpen, setScratchOpen] = useState(false);
  const sKey = quickNoteKey(session?.username);
  const [scratch, setScratch] = useState<string>(() => loadLS<string>(sKey, ""));
  useEffect(() => {
    localStorage.setItem(sKey, JSON.stringify(scratch));
  }, [sKey, scratch]);

  // If no dealer selected, bail early with a safe card
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

  /* ------------------------ Permissions (DEFENSIVE) ------------------------ */
  const role = session?.role ?? "";
  const isAdminManager = role === "Admin" || role === "Manager";
  const isRep = role === "Rep";

  const assignedToMe = isRep && dealer.assignedRepUsername === session?.username;
  const coversState = isRep && !!me?.states?.includes?.(dealer.state);
  const coversRegion =
    isRep &&
    !!me?.regionsByState?.[dealer.state] &&
    !!me?.regionsByState?.[dealer.state]?.includes?.(dealer.region);

  const repHasCoverage = isRep && coversState && coversRegion;
  const repCanAccess = Boolean(isAdminManager || assignedToMe || repHasCoverage);

  /* -------------------------- Status / Details ------------------------- */
  const updateDealer = async (patch: Partial<Dealer>) => {
    // 1) Optimistic UI: update the on-screen dealer immediately
    setDealers((prev) => prev.map((d) => (d.id === dealer.id ? { ...d, ...patch } : d)));
  
    // 2) Only write to Supabase if this dealer has a real UUID
    const isUUID = /^[0-9a-fA-F-]{36}$/.test(dealer.id);
    if (!isUUID) {
      showToast("This dealer isn't synced yet. Add new dealers to sync with Supabase.", "error");
      return;
    }
  
    // 3) Map our patch keys to DB column names
    const dbPatch: any = {};
    if ("name" in patch) dbPatch.name = patch.name;
    if ("state" in patch) dbPatch.state = patch.state;
    if ("region" in patch) dbPatch.region = patch.region;
    if ("type" in patch) dbPatch.type = patch.type;
    if ("status" in patch) dbPatch.status = patch.status;
    if ("address1" in patch) dbPatch.address1 = patch.address1 ?? null;
    if ("address2" in patch) dbPatch.address2 = patch.address2 ?? null;
    if ("city" in patch) dbPatch.city = patch.city ?? null;
    if ("zip" in patch) dbPatch.zip = patch.zip ?? null;
    if ("contacts" in patch) dbPatch.contacts = patch.contacts ?? [];
    if ("assignedRepUsername" in patch)
      dbPatch.assigned_rep_username = patch.assignedRepUsername || null;
    if ("lastVisited" in patch) dbPatch.last_visited = patch.lastVisited || null;
    if ("sendingDeals" in patch) dbPatch.sending_deals = patch.sendingDeals ?? null;
    if ("noDealReasons" in patch) dbPatch.no_deal_reasons = patch.noDealReasons ?? null;
  
    // 4) Persist to Supabase
    try {
      const { error } = await supabase.from("dealers").update(dbPatch).eq("id", dealer.id);
      if (error) throw error;
    } catch (e: any) {
      showToast(e?.message || "Saved locally, but failed to save dealer to Supabase.", "error");
    }
  };  

  const [editDetails, setEditDetails] = useState<Dealer>({
    ...dealer,
    contacts: dealer.contacts?.length ? dealer.contacts.map((c) => ({ ...c })) : [{ name: "", phone: "" }],
  });
// allow anyone to edit the dealer name
const [nameDraft, setNameDraft] = useState(dealer.name);

// keep the input in sync if the dealer changes
useEffect(() => {
  setNameDraft(dealer.name);
}, [dealer.name]);

// --- Edit mode + who is allowed to edit ---
// Only Admin/Manager OR the owning rep (assigned to this dealer) may edit
const [isEditing, setIsEditing] = useState(false);
const canEditOwner = repCanAccess;

// Only enable inputs when we're in edit mode AND the viewer is allowed
const canEditSection = isEditing && repCanAccess;

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
      contacts: (editDetails.contacts || [])
        .filter((c) => c?.name || c?.phone)
        .map((c) => ({ name: (c.name || "").trim(), phone: (c.phone || "").trim() })),
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
// Save the dealer name (no role gate)
// Friendly "Rep: ..." display for this dealer (override → coverage)
const assignedRepDisplay = useMemo(() => {
  // 1) Prefer explicit override
  if (dealer.assignedRepUsername) {
    const u = users.find((u) => u.username === dealer.assignedRepUsername);
    return u?.name || dealer.assignedRepUsername;
  }
  // 2) Otherwise, show any rep(s) who cover this dealer's state+region
  const covering = users.filter(
    (u) =>
      u.role === "Rep" &&
      (u.states?.includes?.(dealer.state) ?? false) &&
      (u.regionsByState?.[dealer.state]?.includes?.(dealer.region) ?? false)
  );
  if (covering.length > 0) {
    return covering.map((u) => u.name || u.username).join(", ");
  }
  return "";
}, [dealer.assignedRepUsername, dealer.state, dealer.region, users]);

const saveName = () => {
  const newName = (nameDraft || "").trim();
  if (!newName) return showToast("Dealer name is required.", "error");
  if (newName === dealer.name) return showToast("No changes to save.", "info");
  updateDealer({ name: newName });
  showToast(`Dealer name updated to "${newName}".`, "success");
};

  const toggleSendingDeals = (val: boolean) => {
    if (!repCanAccess) return showToast("You don't have permission to update this.", "error");
    if (val) {
      updateDealer({ sendingDeals: true, noDealReasons: undefined });
    } else {
      updateDealer({ sendingDeals: false, noDealReasons: { ...(dealer.noDealReasons || {}) } });
    }
  };

  const setReason = (key: keyof NonNullable <Dealer["noDealReasons"]>, v: boolean | string) => {
    if (!repCanAccess) return;
    const current = dealer.noDealReasons || {};
    updateDealer({ noDealReasons: { ...current, [key]: v as any } });
  };
// Save everything and exit edit mode (single success toast)
const saveAllAndClose = () => {
  if (!repCanAccess) return showToast("You don't have permission to edit.", "error");

  const newName = (nameDraft || "").trim();
  if (!newName) return showToast("Dealer name is required.", "error");
// normalize types for TS: use undefined (not null)
const sending: boolean | undefined =
  typeof dealer.sendingDeals === "boolean" ? dealer.sendingDeals : undefined;

const reasons /*: Dealer["noDealReasons"] | undefined*/ =
  dealer.noDealReasons && Object.keys(dealer.noDealReasons as any).length
    ? dealer.noDealReasons
    : undefined;
  updateDealer({
    name: newName,
    address1: editDetails.address1?.trim(),
    address2: editDetails.address2?.trim(),
    city:     editDetails.city?.trim(),
    zip:      editDetails.zip?.trim(),
    state:    editDetails.state,
    region:   editDetails.region,
    contacts: (editDetails.contacts || [])
      .filter((c) => c?.name || c?.phone)
      .map((c) => ({ name: (c.name || "").trim(), phone: (c.phone || "").trim() })),

    // also persist current sending status & reasons
    sendingDeals: sending,
    noDealReasons: reasons,    
  });

  showToast("Dealer saved.", "success");
  setIsEditing(false);
};

  /* ------------------------------- Notes -------------------------------- */
  // SUPER-SAFE useMemo: never index undefined
  const dealerNotesAll = useMemo(() => {
    try {
      return notes
        .filter((n) => n?.dealerId === dealer.id)
        .sort((a, b) => (a.tsISO > b.tsISO ? -1 : 1));
    } catch {
      return [];
    }
  }, [notes, dealer.id]);

  // NEW: notes search query (filters BEFORE pagination)
  const [noteSearch, setNoteSearch] = useState("");
  const dealerNotes = useMemo(() => {
    const q = noteSearch.trim().toLowerCase();
    if (!q) return dealerNotesAll;
    return dealerNotesAll.filter((n) => {
      const d = `${n.text} ${n.category} ${n.authorUsername}`.toLowerCase();
      return d.includes(q);
    });
  }, [dealerNotesAll, noteSearch]);

  // Pagination (10 per page) — runs on filtered notes
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(dealerNotes.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount, noteSearch]); // reset if search shrinks pages

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return dealerNotes.slice(start, start + PAGE_SIZE);
  }, [dealerNotes, page]);

  const [noteCategory, setNoteCategory] = useState<NoteCategory>("Visit");
  const [noteText, setNoteText] = useState("");

  const canUseManagerNote = isAdminManager;
// Load notes for this dealer from Supabase whenever the dealer changes
useEffect(() => {
  (async () => {
    const { data, error } = await supabase
      .from('dealer_notes')
      .select('id,dealer_id,author_username,created_at,category,text')
      .eq('dealer_id', dealer.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    // Convert DB rows → our Note shape
    const mapped: Note[] = (data || []).map((r: any) => ({
      id: String(r.id),
      dealerId: r.dealer_id,
      authorUsername: r.author_username,
      tsISO: new Date(r.created_at).toISOString(),
      category: r.category,
      text: r.text,
    }));

    // Replace any existing notes for THIS dealer with the fresh list
    setNotes(prev => {
      const others = prev.filter(n => n.dealerId !== dealer.id);
      return [...others, ...mapped];
    });
  })();
}, [dealer.id]);
const addNote = async () => {
  if (!repCanAccess) return showToast("You don't have access to add notes.", "error");
  const text = (noteText || "").trim();
  if (!text) return showToast("Please enter a note.", "error");

  // Get the currently logged-in auth user (has the real auth.uid())
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) {
    return showToast("You're not signed in. Please log in again.", "error");
  }
  const authUserId = authData.user.id;

  try {
    // 1) Insert the note (RLS expects user_id = auth.uid())
    const payload = {
      dealer_id: dealer.id,
      user_id: authUserId,                           // ✅ important: NOT session!.id
      author_username: session?.username || "",
      category: noteCategory,
      text: text,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("dealer_notes")
      .insert([payload])
      .select("id,dealer_id,author_username,created_at,category,text")
      .single();

    if (error) throw error;

    // 2) Show it immediately
    const row: any = data;
    const inserted: Note = {
      id: String(row.id),
      dealerId: row.dealer_id,
      authorUsername: row.author_username,
      tsISO: new Date(row.created_at).toISOString(),
      category: row.category as NoteCategory,
      text: row.text,
    };
    setNotes(prev => [inserted, ...prev]);
    setNoteText("");

    // 3) Manager-note behavior: also create a Task for the rep
    if (noteCategory === "Manager" && canUseManagerNote) {
      const repUser = dealer.assignedRepUsername || session!.username;
      if (repUser) {
        const t: Task = {
          id: uid(),
          dealerId: dealer.id,
          repUsername: repUser,
          text: dealer.name,
          createdAtISO: new Date().toISOString(),
        };

        // Optimistic UI
        setTasks((prev) => [t, ...prev]);

        // Persist in Supabase
        const { error: taskErr } = await supabase.from("dealer_tasks").insert({
          id: t.id,
          dealer_id: t.dealerId,
          rep_username: t.repUsername,
          text: t.text,
          created_at: t.createdAtISO,
        });

        if (taskErr) {
          setTasks((prev) => prev.filter((x) => x.id !== t.id));
          showToast(taskErr.message || "Could not create task", "error");
        } else {
          showToast("Task created for the rep.", "success");
        }
      }
    }

    // 4) All good
    showToast("Note added.", "success");
  } catch (e: any) {
    showToast(e?.message || "Failed to add note.", "error");
  }
};

  // Helper: check if there is an incomplete task tied to this dealer for the current rep
  const myOpenTaskForDealer = useMemo(() => {
    if (!isRep) return null;
    return tasks.find((t) => t.dealerId === dealer.id && t.repUsername === session?.username && !t.completedAtISO) || null;
  }, [tasks, dealer.id, isRep, session]);

  const completeMyTask = async () => {
    if (!myOpenTaskForDealer) return;
    const when = new Date().toISOString();
  
    // Optimistic UI
    setTasks(prev =>
      prev.map(t => t.id === myOpenTaskForDealer.id ? { ...t, completedAtISO: when } : t)
    );
  
    const { error } = await supabase
      .from('dealer_tasks')
      .update({ completed_at: when })
      .eq('id', myOpenTaskForDealer.id);
  
    if (error) {
      // roll back if DB failed
      setTasks(prev =>
        prev.map(t => t.id === myOpenTaskForDealer.id ? { ...t, completedAtISO: undefined } : t)
      );
      showToast(error.message || 'Could not complete task', 'error');
    } else {
      showToast('Task completed.', 'success');
    }
  };  
  /* ------------------------------ Delete -------------------------------- */
 // Delete from Supabase first (if this has a real DB id), then clean up locally
const doDeleteDealer = async () => {
  if (!(isAdminManager || repCanAccess))
    return showToast("You don't have permission to delete this dealer.", "error");
  if (confirmText !== dealer.name)
    return showToast("Type the dealer name exactly to confirm.", "error");

  // Try server delete when this dealer has a Supabase UUID
  const isUUID = /^[0-9a-fA-F-]{36}$/.test(dealer.id);
  if (isUUID) {
    try {
      const { error } = await supabase.from("dealers").delete().eq("id", dealer.id);
      if (error) throw error;
    } catch (e: any) {
      // We still remove locally so UI is consistent, but let the user know
      showToast(e?.message || "Removed locally, but failed to delete in Supabase.", "error");
    }
  }

  // Local clean-up so the screen updates immediately
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
          <SelectField
            label="Status"
            value={dealer.status}
            onChange={(v) => changeStatus(v as DealerStatus)}
            options={[
              { label: "Active", value: "Active" },
              { label: "Pending", value: "Pending" },
              { label: "Prospect", value: "Prospect" },
              { label: "Inactive", value: "Inactive" },
              { label: "Black Listed", value: "Black Listed" },
            ]}
          />
        </div>
      </div>

 {/* Summary */}
<div className="rounded-xl border bg-white p-5 shadow-sm">
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      {/* Name: input only while editing; otherwise plain text */}
      {canEditSection ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            className="border rounded-lg px-3 py-2 text-slate-800 w-full sm:w-auto"
            placeholder="Dealer name"
          />
        </div>
      ) : (
        <div className="text-xl font-semibold text-slate-800">{dealer.name}</div>
      )}

      <div className="text-sm text-slate-600">
        {dealer.region}, {dealer.state} • <span className="uppercase">{dealer.type}</span>
        <div className="mt-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 text-indigo-700 px-2 py-0.5 text-xs font-medium">
            Rep:
            <span className="font-semibold">
              {assignedRepDisplay || "— None —"}
            </span>
          </span>
        </div>
      </div>
    </div>

    {/* Right: status, last-visited, and actions */}
    <div className="flex items-center gap-3">
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge(dealer.status)}`}>
        {dealer.status}
      </span>
      <div className="text-sm text-slate-600">Last visited: {dealer.lastVisited || "-"}</div>

      {/* Actions: Edit (if allowed) or Save/Cancel while editing */}
      {!isEditing && repCanAccess && (
        <button
          onClick={() => setIsEditing(true)}
          className={`${brand.primary} text-white px-4 py-2 rounded-lg`}
        >
          Edit
        </button>
      )}

      {isEditing && (
        <>
          <button
  onClick={saveAllAndClose}
  className={`${brand.primary} text-white px-4 py-2 rounded-lg`}
>
  Save
</button>
          <button
            onClick={() => {
              setNameDraft(dealer.name);
              setEditDetails({
                ...dealer,
                contacts: dealer.contacts?.length
                  ? dealer.contacts.map((c) => ({ ...c }))
                  : [{ name: "", phone: "" }],
              });
              setIsEditing(false);
            }}
            className="px-4 py-2 rounded-lg border border-slate-300"
          >
            Cancel
          </button>
        </>
      )}
    </div>
  </div>
</div>

{/* Details + Assignment + Sending */}
<div className="grid md:grid-cols-3 gap-4">
        {/* Details */}
        <div className="md:col-span-2 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-slate-800 font-semibold">Dealer Details</div>
            <div className="text-xs text-slate-500">
  {repCanAccess ? (isEditing ? "Editing" : "Read-only (click Edit)") : "Read-only"}
</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="Address 1" value={editDetails.address1 || ""} onChange={(v) => setEditDetails((x) => ({ ...x, address1: v }))} disabled={!canEditSection} />
            <TextField label="Address 2" value={editDetails.address2 || ""} onChange={(v) => setEditDetails((x) => ({ ...x, address2: v }))} disabled={!canEditSection} />
            <TextField label="City" value={editDetails.city || ""} onChange={(v) => setEditDetails((x) => ({ ...x, city: v }))} disabled={!canEditSection} />
            <TextField label="ZIP" value={editDetails.zip || ""} onChange={(v) => setEditDetails((x) => ({ ...x, zip: v }))} disabled={!canEditSection} />
            <SelectField
              label="State"
              value={editDetails.state}
              onChange={(v) => setEditDetails((x) => ({ ...x, state: v, region: "" }))}
              options={Object.keys(regions || {})
                .sort()
                .map((s) => ({ label: s, value: s }))}
                disabled={!canEditSection}
            />
            <SelectField
              label="Region"
              value={editDetails.region}
              onChange={(v) => setEditDetails((x) => ({ ...x, region: v }))}
              options={((regions || {})[editDetails.state] || []).map((r) => ({ label: r, value: r }))}
              disabled={!repCanAccess || !editDetails.state}
            />
          </div>

          {/* Contacts */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div className="text-slate-700 font-medium">Contacts</div>
              {canEditSection && (
                <button
                  onClick={() => setEditDetails((x) => ({ ...x, contacts: [...(x.contacts || []), { name: "", phone: "" }] }))}
                  className="text-blue-700 text-sm hover:underline"
                >
                  + Add Contact
                </button>
              )}
            </div>
            <div className="mt-2 space-y-2">
              {(editDetails.contacts || []).map((c, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <TextField
                      label="Name"
                      value={c?.name || ""}
                      onChange={(v) =>
                        setEditDetails((x) => {
                          const next = [...(x.contacts || [])];
                          next[idx] = { ...(next[idx] || { name: "", phone: "" }), name: v };
                          return { ...x, contacts: next };
                        })
                      }
                      disabled={!canEditSection}
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <TextField
                      label="Phone"
                      value={c?.phone || ""}
                      onChange={(v) =>
                        setEditDetails((x) => {
                          const next = [...(x.contacts || [])];
                          next[idx] = { ...(next[idx] || { name: "", phone: "" }), phone: v };
                          return { ...x, contacts: next };
                        })
                      }
                      disabled={!canEditSection}
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-end">
                  {canEditSection && (
                      <button
                        onClick={() =>
                          setEditDetails((x) => {
                            const next = (x.contacts || []).filter((_, i) => i !== idx);
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
        </div>

        {/* Assignment & Sending */}
        <div className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
        {isAdminManager && (
  <div>
    <div className="text-slate-800 font-semibold mb-2">Assigned Rep (override)</div>
    <SelectField
      label="Assigned Rep"
      value={dealer.assignedRepUsername || ""}
      onChange={(v) => changeAssignedRep(v)}
      options={[{ label: "— None —", value: "" }, ...users.filter((u) => u.role === "Rep").map((r) => ({ label: `${r.name} (${r.username})`, value: r.username }))]}
    />
  </div>
)}

          <div className="border-t pt-4">
            <div className="text-slate-800 font-semibold mb-2">Are they sending deals?</div>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="sending" checked={dealer.sendingDeals === true} onChange={() => toggleSendingDeals(true)} disabled={!canEditSection} />
                Yes
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="sending" checked={dealer.sendingDeals === false} onChange={() => toggleSendingDeals(false)} disabled={!canEditSection}/>
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
                      checked={Boolean((dealer.noDealReasons as any)?.[key])}
                      onChange={(e) => setReason(key as any, e.target.checked)}
                      disabled={!canEditSection}
                    />
                    {label}
                  </label>
                ))}
                <div>
                  <TextField label="Other" value={dealer.noDealReasons?.other || ""} onChange={(v) => setReason("other", v)} disabled={!canEditSection}/>
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
          {/* Quick Notes button (desktop only — mobile uses FAB) */}
          <button className="hidden md:inline-flex px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow" onClick={() => setScratchOpen(true)}>
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
        <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={addNote} disabled={!repCanAccess}>
            Add Note
          </button>
        </div>
      </div>

      {/* Notes List with search + pagination */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
          <div className="text-slate-800 font-semibold">Notes</div>
          <input
            className="w-full md:w-72 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search notes (text/category/author)…"
            value={noteSearch}
            onChange={(e) => {
              setNoteSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {paged.length === 0 && <div className="text-sm text-slate-500">No notes{noteSearch.trim() ? " match your search." : " yet."}</div>}

        <div className="space-y-3">
          {paged.map((n) => {
            // If this is a Manager note and the current user is the assigned rep with an open task, show Complete button
            const showComplete =
              n.category === "Manager" &&
              isRep &&
              dealer.assignedRepUsername === session?.username &&
              !!myOpenTaskForDealer;

            return (
              <div key={n.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${noteBadgeLocal(n.category)}`}>{labelNoteLocal(n.category)}</span>
                    <span className="text-xs text-slate-500">
                      by <strong>{n.authorUsername}</strong> • {new Date(n.tsISO).toLocaleString()}
                    </span>
                  </div>
                  {showComplete && (
                    <button
                      className="px-2 py-1 rounded border border-green-600 text-green-700 hover:bg-green-50 text-xs"
                      onClick={completeMyTask}
                      title="Mark this manager task as completed"
                    >
                      Complete Task
                    </button>
                  )}
                </div>
                <div className="mt-2 text-sm text-slate-800 whitespace-pre-wrap">{n.text}</div>
              </div>
            );
          })}
        </div>

        {/* Pagination controls */}
        {pageCount > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              className="px-3 py-1.5 rounded border text-slate-700 hover:bg-slate-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Prev
            </button>
            {Array.from({ length: pageCount }).map((_, i) => {
              const p = i + 1;
              const isCurrent = p === page;
              return (
                <button
                  key={p}
                  className={`px-3 py-1.5 rounded border ${isCurrent ? "bg-blue-600 text-white border-blue-600" : "text-slate-700 hover:bg-slate-50"}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              );
            })}
            <button
              className="px-3 py-1.5 rounded border text-slate-700 hover:bg-slate-50"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page === pageCount}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Delete button moved to bottom (smaller, red) */}
      {(isAdminManager || repCanAccess) && (
        <div className="flex justify-end">
          <button
            className="px-3 py-2 rounded-lg border border-red-600 text-red-700 hover:bg-red-50"
            onClick={() => setDeleteOpen(true)}
          >
            Delete Dealer
          </button>
        </div>
      )}

      {/* Quick Notes FAB (mobile) */}
      <button
        className="fixed bottom-5 right-5 rounded-full shadow-lg px-4 py-3 text-white bg-amber-500 hover:bg-amber-600 md:hidden"
        onClick={() => setScratchOpen(true)}
        title="Quick Notes"
      >
        ✎
      </button>

      {/* Quick Notes Modal */}
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

      {/* Delete confirm modal */}
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
    </div>
  );
};

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

/* ============================= PART 3 / 4 ================================
   Reporting view (unchanged logic, kept intact per your request)
=========================================================================== */

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
  const [sendNoOpen, setSendNoOpen] = useState(false);
  const [sendNoSearch, setSendNoSearch] = useState("");
  // NEW: Dealer List modal
  const [dlOpen, setDlOpen] = useState(false);
  const [nvSort, setNvSort] = useState<"longest" | "recent">("longest"); // longest = oldest visit first

  // Helper: does rep "cover" dealer (override OR state/region coverage)
  const repCoversDealer = (rep: User, d: Dealer) =>
    d.assignedRepUsername === rep.username ||
    (rep.states.includes(d.state) && (rep.regionsByState[d.state]?.includes(d.region) ?? false));

  // Helper: pick the rep for a dealer (prefer explicit override; otherwise first covering rep)
  const getRepForDealer = (d: Dealer): User | null => {
    if (d.assignedRepUsername) {
      const u = reps.find((r) => r.username === d.assignedRepUsername);
      if (u) return u;
    }
    return reps.find((r) => repCoversDealer(r, d)) || null;
  };

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

  // Notes scoped by selected rep (authored)
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
    const rows: [string, number][] =
    repFilter === "ALL"
      ? Object.entries(byUser)
      : [[selectedRep!.username, (byUser[selectedRep!.username] || 0)] as [string, number]];
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
      if (key in map) map[key]++;
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
  // Sending Deals — stats for current scope (All reps or the selected rep)
  const sendingStats = useMemo(() => {
    type RepRow = { username: string; name: string; yes: number; no: number; unknown: number };
    const byRep: Record<string, RepRow> = {};
    const reasonsCount: Record<
      "funding" | "agreement" | "feesRates" | "programDiff" | "eContracting" | "notSigned" | "other",
      number
    > = {
      funding: 0,
      agreement: 0,
      feesRates: 0,
      programDiff: 0,
      eContracting: 0,
      notSigned: 0,
      other: 0,
    };

    let yes = 0;
    let no = 0;
    let unknown = 0;

    for (const d of scopedDealers) {
      const rep = getRepForDealer(d); // prefer override; else first covering rep
      const key = rep?.username || "__unassigned__";
      if (!byRep[key]) {
        byRep[key] = {
          username: rep?.username || "__unassigned__",
          name: rep?.name || rep?.username || "— Unassigned —",
          yes: 0,
          no: 0,
          unknown: 0,
        };
      }

      if (d.sendingDeals === true) {
        yes++;
        byRep[key].yes++;
      } else if (d.sendingDeals === false) {
        no++;
        byRep[key].no++;

        const r = d.noDealReasons || {};
        if (r.funding) reasonsCount.funding++;
        if (r.agreement) reasonsCount.agreement++;
        if (r.feesRates) reasonsCount.feesRates++;
        if (r.programDiff) reasonsCount.programDiff++;
        if (r.eContracting) reasonsCount.eContracting++;
        if (r.notSigned) reasonsCount.notSigned++;
        if ((r.other || "").trim()) reasonsCount.other++;
      } else {
        unknown++;
        byRep[key].unknown++;
      }
    }

    const byRepRows = Object.values(byRep).sort((a, b) => a.name.localeCompare(b.name));
    return { total: scopedDealers.length, yes, no, unknown, byRepRows, reasonsCount };
  }, [scopedDealers, users]);

  // Export the scoped "Sending Deals" view to CSV (all dealers in scope with status+reasons)
  const exportSendingDealsCSV = () => {
    const rows: (string | number)[][] = [["Dealer", "State", "Region", "Rep", "Sending Deals", "Reasons"]];
    for (const d of scopedDealers) {
      const rep = getRepForDealer(d);
      const repName = rep?.name || rep?.username || "";
      const sd = d.sendingDeals === true ? "Yes" : d.sendingDeals === false ? "No" : "—";

      const r = d.noDealReasons || {};
      const reasons: string[] = [];
      if (r.funding) reasons.push("Funding");
      if (r.agreement) reasons.push("Agreement");
      if (r.feesRates) reasons.push("Fees/Rates");
      if (r.programDiff) reasons.push("Program Difference");
      if (r.eContracting) reasons.push("E-Contracting");
      if (r.notSigned) reasons.push("Not Signed");
      if ((r.other || "").trim()) reasons.push(`Other: ${(r.other || "").replaceAll(",", " ")}`);

      rows.push([
        d.name,
        d.state,
        d.region,
        repName,
        sd,
        reasons.join("; "),
      ]);
    }

    // Create and download CSV (self-contained)
    const csv = rows
      .map(r => r.map(v => String(v).replaceAll('"','""')).map(v => `"${v}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sending_deals_${repFilter === "ALL" ? "all_reps" : (selectedRep?.username || "rep")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export "Not Visited (Active) in Last 30 Days" to CSV
  const exportNotVisitedCSV = () => {
    const header = ["Dealer", "Region", "State", "Last Visited", "Days Ago"];
    const lines = [header.join(",")];
    for (const d of notVisited30Sorted) {
      const row = [
        d.name.replaceAll(",", " "),
        d.region.replaceAll(",", " "),
        d.state.replaceAll(",", " "),
        d.lastVisited || "",
        String(daysAgo(d.lastVisited)),
      ];
      lines.push(row.join(","));
    }
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `not_visited_30_${repFilter === "ALL" ? "all_reps" : (selectedRep?.username || "rep")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  // Dealers NOT sending — rows honoring current Rep filter
  type SendNoRow = { dealer: string; state: string; region: string; rep: string; reasons: string };
  const sendingNoRows: SendNoRow[] = useMemo(() => {
    const rows: SendNoRow[] = [];
    for (const d of scopedDealers) {
      if (d.sendingDeals === false) {
        const rep = repFilter === "ALL" ? getRepForDealer(d) : selectedRep;
        const r = d.noDealReasons || {};
        const reasons: string[] = [];
        if (r.funding) reasons.push("Funding");
        if (r.agreement) reasons.push("Agreement");
        if (r.feesRates) reasons.push("Fees/Rates");
        if (r.programDiff) reasons.push("Program Difference");
        if (r.eContracting) reasons.push("E-Contracting");
        if (r.notSigned) reasons.push("Not Signed");
        if ((r.other || "").trim()) reasons.push(`Other: ${(r.other || "").trim()}`);
        rows.push({
          dealer: d.name,
          state: d.state,
          region: d.region,
          rep: rep ? (rep.name || rep.username) : "",
          reasons: reasons.join("; "),
        });
      }
    }
    rows.sort(
      (a, b) =>
        (a.region || "").localeCompare(b.region || "") ||
        (a.dealer || "").localeCompare(b.dealer || "")
    );
    return rows;
  }, [scopedDealers, repFilter, selectedRep, users]);

  const sendingNoFiltered = useMemo(() => {
    const q = sendNoSearch.trim().toLowerCase();
    if (!q) return sendingNoRows;
    return sendingNoRows.filter((r) =>
      r.dealer.toLowerCase().includes(q) ||
      r.region.toLowerCase().includes(q) ||
      r.state.toLowerCase().includes(q) ||
      r.rep.toLowerCase().includes(q) ||
      r.reasons.toLowerCase().includes(q)
    );
  }, [sendingNoRows, sendNoSearch]);

  const exportSendingNoCSV = () => {
    const header = ["Dealer", "State", "Region", "Rep", "Reasons"];
    const rows = [header, ...sendingNoFiltered.map(r => [r.dealer, r.state, r.region, r.rep, r.reasons])];
    const csv = rows
      .map(r => r.map(v => String(v).replaceAll('"','""')).map(v => `"${v}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `not_sending_${repFilter === "ALL" ? "all_reps" : (selectedRep?.username || "rep")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Dealer List (Region, Dealer, Rep, State, Last Visited) honoring current Rep filter
  type DealerListRow = { region: string; dealer: string; rep: string; state: string; lastVisited: string };
  const dealerListRows: DealerListRow[] = useMemo(() => {
    const base = repFilter === "ALL" ? dealers : scopedDealers;
    const rows = base.map((d) => {
      const repUser = repFilter === "ALL" ? getRepForDealer(d) : selectedRep;
      return {
        region: d.region,
        dealer: d.name,
        rep: repUser ? `${repUser.name} (${repUser.username})` : "",
        state: d.state,
        lastVisited: d.lastVisited || "",
      };
    });
    // Stable sort: Region ASC, then Dealer ASC
    rows.sort((a, b) => (a.region || "").localeCompare(b.region || "") || (a.dealer || "").localeCompare(b.dealer || ""));
    return rows;
  }, [dealers, scopedDealers, repFilter, selectedRep]);

  const exportDealerListCSV = () => {
    const header = ["Region", "Dealer", "Rep", "State", "Last Visited"];
    const lines = [header.join(",")];
    for (const r of dealerListRows) {
      const row = [
        r.region?.replaceAll(",", " "),
        r.dealer?.replaceAll(",", " "),
        r.rep?.replaceAll(",", " "),
        r.state?.replaceAll(",", " "),
        r.lastVisited ?? "",
      ];
      lines.push(row.join(","));
    }
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dealer_list_${repFilter === "ALL" ? "all_reps" : (selectedRep?.username || "rep")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bar = (val: number, max: number) => {
    const pct = Math.round((val / Math.max(1, max)) * 100);
    return (
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div className="h-2 rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
      </div>
    );
  };

  const sectionTitle =
    repFilter === "ALL" ? "Overall (All Reps)" : `Rep: ${selectedRep?.name} (${selectedRep?.username})`;

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
          <SelectField
            label="Rep"
            value={repFilter}
            onChange={(v) => setRepFilter((v || "ALL") as RepFilter)}
            options={[
              { label: "All Reps", value: "ALL" },
              ...reps.map((r) => ({
                label: `${r.name} (${r.username})`,
                value: r.username,
              })),
            ]}
          />
          <button
            type="button"
            onClick={() => setDlOpen(true)}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs sm:text-sm"
          >
            Dealer List
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI title={`${sectionTitle} — Total Dealers`} value={kpis.total} />
        <KPI title="Active" value={kpis.byStatus.Active} />
        <KPI title="Pending" value={kpis.byStatus.Pending} />
        <KPI title="Prospect" value={kpis.byStatus.Prospect} />
        <KPI title="Inactive" value={kpis.byStatus.Inactive} />
        <KPI title="Black Listed" value={kpis.byStatus["Black Listed"]} />
      </div>
      {/* Sending Deals */}
      <Card
        title="Sending Deals"
        subtitle={repFilter === "ALL" ? "All reps" : `Rep: ${selectedRep?.name || selectedRep?.username || ""}`}
      >
        <div className="grid md:grid-cols-3 gap-4">
          {/* Counts */}
          <div className="rounded-lg border p-3">
            <div className="text-slate-500 text-xs uppercase tracking-wide">Totals in view</div>
            <div className="mt-2 space-y-1 text-slate-800">
              <div className="flex justify-between">
                <span>Yes</span>
                <span className="font-semibold">{sendingStats.yes}</span>
              </div>
              <div className="flex justify-between">
                <span>No</span>
                <span className="font-semibold">{sendingStats.no}</span>
              </div>
              <div className="flex justify-between">
                <span>Unknown</span>
                <span className="font-semibold">{sendingStats.unknown}</span>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">Total dealers: {sendingStats.total}</div>
            <div className="mt-3">
              <button
                type="button"
                onClick={exportSendingDealsCSV}
                className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs sm:text-sm"
              >
                Export CSV
              </button>
            </div>
          </div>

          {/* Drill-down */}
          <div className="rounded-lg border p-3">
            <div className="text-slate-500 text-xs uppercase tracking-wide">Details</div>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setSendNoOpen(true)}
                disabled={sendingStats?.no === 0}
                className={`px-3 py-2 rounded-lg text-xs sm:text-sm ${sendingStats?.no === 0 ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-indigo-600 text-white"}`}
              >
                View dealers (No)
              </button>
              <div className="text-xs text-slate-500 mt-2">
                Shows only dealers marked <b>No</b> in the current filter.
              </div>
            </div>
          </div>

          {/* Reasons (for No) */}
          <div className="rounded-lg border p-3">
            <div className="text-slate-500 text-xs uppercase tracking-wide">Reasons (No)</div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between"><span>Funding</span><span className="font-semibold">{sendingStats.reasonsCount.funding}</span></div>
              <div className="flex justify-between"><span>Agreement</span><span className="font-semibold">{sendingStats.reasonsCount.agreement}</span></div>
              <div className="flex justify-between"><span>Fees / Rates</span><span className="font-semibold">{sendingStats.reasonsCount.feesRates}</span></div>
              <div className="flex justify-between"><span>Program Difference</span><span className="font-semibold">{sendingStats.reasonsCount.programDiff}</span></div>
              <div className="flex justify-between"><span>E-Contracting</span><span className="font-semibold">{sendingStats.reasonsCount.eContracting}</span></div>
              <div className="flex justify-between"><span>Not Signed</span><span className="font-semibold">{sendingStats.reasonsCount.notSigned}</span></div>
              <div className="flex justify-between"><span>Other</span><span className="font-semibold">{sendingStats.reasonsCount.other}</span></div>
            </div>
          </div>
        </div>
      </Card>

      {/* Trends */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Visits — Last 6 Months">
          <div className="space-y-2">
            {months.map((m) => (
              <div key={m.key} className="flex items-center gap-3">
                <div className="w-28 text-sm">
                  {m.label}
                </div>
                <div className="flex-1">{bar(monthlyVisits[m.key] || 0, Math.max(...Object.values(monthlyVisits), 1))}</div>
                <div className="w-10 text-right text-sm">{monthlyVisits[m.key] || 0}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4">
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
            {visitsLast30.rows.length === 0 && (
              <div className="text-sm text-slate-500">No visit notes in last 30 days.</div>
            )}
          </div>
        </Card>

        <Card title="Dealers Not Visited (Last 30 Days)">
          <div className="text-sm text-slate-600 mb-2">
            {notVisited30.length} Active dealer{notVisited30.length === 1 ? "" : "s"} require attention
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNvOpen(true)}
              className="px-3 py-2 rounded-lg bg-orange-600 text-white text-xs sm:text-sm"
            >
              View List
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                exportNotVisitedCSV();
              }}
              className="px-3 py-2 rounded-lg bg-slate-700 text-white text-xs sm:text-sm"
            >
              Export CSV
            </button>
          </div>
        </Card>

        <Card title="Dealers by Status">
          <div className="space-y-3">
            {statuses.map((s) => (
              <div key={s} className="flex items-center gap-3">
                <div className="w-32 text-sm">{s}</div>
                <div className="flex-1">
                  {bar(kpis.byStatus[s], Math.max(...statuses.map((x) => kpis.byStatus[x]), 1))}
                </div>
                <div className="w-10 text-right text-sm">{kpis.byStatus[s]}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Dealers by State">
          <div className="space-y-3">
            {Object.entries(
              scopedDealers.reduce<Record<string, number>>((acc, d) => {
                acc[d.state] = (acc[d.state] || 0) + 1;
                return acc;
              }, {})
            )
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([state, count]) => (
                <div key={state} className="flex items-center gap-3">
                  <div className="w-16 text-sm">{state}</div>
                  <div className="flex-1">
                    {bar(
                      count,
                      Math.max(
                        ...Object.values(
                          scopedDealers.reduce<Record<string, number>>((acc, d) => {
                            acc[d.state] = (acc[d.state] || 0) + 1;
                            return acc;
                          }, {})
                        ),
                        1
                      )
                    )}
                  </div>
                  <div className="w-10 text-right text-sm">{count}</div>
                </div>
              ))}
            {scopedDealers.length === 0 && <div className="text-sm text-slate-500">No dealers.</div>}
          </div>
        </Card>
      </div>

      {/* Rep workload */}
      <div className="grid md:grid-cols-1 gap-4">
        <Card title={repFilter === "ALL" ? "Rep Workload (dealers covered)" : "Workload"}>
          <div className="space-y-3">
            {(repFilter === "ALL"
              ? reps.map((r) => ({
                  rep: r,
                  count: dealers.filter((d) => repCoversDealer(r, d)).length,
                }))
              : [{ rep: selectedRep!, count: scopedDealers.length }]
            )
              .sort((a, b) => b.count - a.count)
              .map((row) => (
                <div key={row.rep.username} className="flex items-center gap-3">
                  <div className="w-40 text-sm">{`${row.rep.name} (${row.rep.username})`}</div>
                  <div className="flex-1">{bar(row.count, Math.max(...reps.map((r) => dealers.filter((d) => repCoversDealer(r, d)).length), 1))}</div>
                  <div className="w-10 text-right text-sm">{row.count}</div>
                </div>
              ))}
          </div>
        </Card>
      </div>

      {/* MODAL: Full list of "Not Visited (Active) in Last 30 Days" */}
      {nvOpen && (
        <Modal
          title={`Not Visited (Active) — ${notVisited30.length} dealer${notVisited30.length === 1 ? "" : "s"}`}
          onClose={() => setNvOpen(false)}
        >
          {/* Controls */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm text-slate-600">
              Showing dealers within <span className="font-medium">{sectionTitle}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">Sort:</label>
              <SelectField
                label="Sort"
                value={nvSort}
                onChange={(v) => setNvSort(v as "longest" | "recent")}
                options={[
                  { label: "Longest Not Visited", value: "longest" },
                  { label: "Most Recently Visited", value: "recent" },
                ]}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  exportNotVisitedCSV();
                }}
                className="px-3 py-2 rounded-lg bg-slate-700 text-white text-xs sm:text-sm"
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 bg-slate-50 text-slate-600 text-xs font-medium">
              <div className="col-span-5 px-3 py-2">Dealer</div>
              <div className="col-span-3 px-3 py-2">Region</div>
              <div className="col-span-2 px-3 py-2">State</div>
              <div className="col-span-2 px-3 py-2">Last Visited</div>
            </div>
            <div className="max-h-96 overflow-auto divide-y">
              {notVisited30Sorted.map((d) => (
                <div key={d.id} className="grid grid-cols-12 text-sm">
                  <div className="col-span-5 px-3 py-2">{d.name}</div>
                  <div className="col-span-3 px-3 py-2">{d.region}</div>
                  <div className="col-span-2 px-3 py-2">{d.state}</div>
                  <div className="col-span-2 px-3 py-2">
                    {d.lastVisited ? new Date(d.lastVisited).toLocaleDateString() : "—"}
                  </div>
                </div>
              ))}
              {notVisited30Sorted.length === 0 && (
                <div className="px-3 py-3 text-sm text-slate-500">Nothing to show.</div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Dealer List modal */}
      {dlOpen && (
        <Modal
          title={`Dealer List — ${repFilter === "ALL" ? "All Reps" : (selectedRep?.name || selectedRep?.username || "Rep")}`}
          onClose={() => setDlOpen(false)}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm text-slate-600">
              Showing dealers within <span className="font-medium">{sectionTitle}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  exportDealerListCSV();
                }}
                className="px-3 py-2 rounded-lg bg-slate-700 text-white text-xs sm:text-sm"
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 bg-slate-50 text-slate-600 text-xs font-medium">
              <div className="col-span-2 px-3 py-2">Region</div>
              <div className="col-span-4 px-3 py-2">Dealer</div>
              <div className="col-span-3 px-3 py-2">Rep</div>
              <div className="col-span-1 px-3 py-2">State</div>
              <div className="col-span-2 px-3 py-2">Last Visited</div>
            </div>
            <div className="max-h-96 overflow-auto divide-y">
              {dealerListRows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-12 text-sm">
                  <div className="col-span-2 px-3 py-2">{r.region || "—"}</div>
                  <div className="col-span-4 px-3 py-2">{r.dealer || "—"}</div>
                  <div className="col-span-3 px-3 py-2">{r.rep || "—"}</div>
                  <div className="col-span-1 px-3 py-2">{r.state || "—"}</div>
                  <div className="col-span-2 px-3 py-2">
                    {r.lastVisited ? new Date(r.lastVisited).toLocaleDateString() : "—"}
                  </div>
                </div>
              ))}
              {dealerListRows.length === 0 && (
                <div className="px-3 py-3 text-sm text-slate-500">No dealers to display.</div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

/* ============================= PART 4 / 4 ================================
   App shell, shared UI, and User Management
   Changes included here:
   - “Export All Notes (CSV)” button in User Management (full dealer-notes export)
   - Invite link now points to a working Reset modal route (/reset?token=...)
     (modal is auto-shown when URL path is /reset; uses token->user mapping)
   - Invite link ONLY in Edit User (not in Add User)
   - Reset modal pre-fills (read-only): Full Name, Username, Phone; only New Password editable
   - Status control Active/Inactive in Edit User; deactivation prevents login by
     moving password out of the active store; reactivation restores it
=========================================================================== */

/* --------------------------------- App ------------------------------------ */
const App: React.FC = () => {
  const { users, setUsers, dealers, setDealers, regions, setRegions, tasks, setTasks, notes, setNotes } = useData();
  const [route, setRoute] = useState<RouteKey>("login");
  const [session, setSession] = useState<Session>(null);
  const { toasts, showToast, dismiss } = useToasts();

  // RESET INVITE: show modal if visiting /reset
  const [resetOpen, setResetOpen] = useState(false);
  const [resetToken, setResetToken] = useState<string>("");

  useEffect(() => {
    if (window.location.pathname === "/reset") {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("token") || "";
      setResetToken(t);
      setResetOpen(true);
    }
  }, []);
// --- Supabase invite/recovery reset detection (TOP-LEVEL) ---
// These states are the "light switches" we flip when a Supabase link is used.
// (It's okay if your editor warns they're unused right now. In Step 2 we'll use them.)
const [showForceReset, setShowForceReset] = useState(false);
const [newPass, setNewPass] = useState('');
const [newPass2, setNewPass2] = useState('');

// Make sure we only open the modal once per page load.
const openedResetRef = useRef(false);
const openResetOnce = () => {
  if (openedResetRef.current) return;
  openedResetRef.current = true;
  setShowForceReset(true);
};
// who is resetting (derived from Supabase -> match to our app user)
const [resetUser, setResetUser] = useState<User | null>(null);
const [resetUsername, setResetUsername] = useState('');
const [resetEmail, setResetEmail] = useState('');

// Read auth params from BOTH the hash (#...) and the query (?...) and return tokens too
const parseAuthParams = () => {
  const url = new URL(window.location.href);

  const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const hash = new URLSearchParams(rawHash || '');
  const search = url.searchParams;

  const type = (hash.get('type') || search.get('type') || '').toLowerCase();
  const access_token =
    hash.get('access_token') || search.get('access_token') || '';
  const refresh_token =
    hash.get('refresh_token') || search.get('refresh_token') || '';
  const next = (search.get('next') || '').toLowerCase();

  const hasAccessToken = !!access_token;
  const shouldOpen =
    type === 'recovery' || type === 'invite' || hasAccessToken || next === '/reset';

  return { shouldOpen, type, access_token, refresh_token };
};
// If the URL carries tokens, adopt that session so we're acting as the invited user
const adoptSessionFromUrl = async () => {
  try {
    const { access_token, refresh_token } = parseAuthParams();
    if (!access_token) return;

    await supabase.auth.setSession({
      access_token,
      refresh_token: refresh_token || ''
    });

    console.debug('[auth] adopted session from URL tokens');
  } catch (err) {
    console.debug('[auth] setSession failed', err);
  }
};
// A) Run once on page load
useEffect(() => {
  (async () => {
    console.debug('[boot]', { hash: window.location.hash, search: window.location.search });

    const { shouldOpen } = parseAuthParams();
    if (shouldOpen) {
      // 1) switch to the invited user's session (even if admin is logged in)
      await adoptSessionFromUrl();

      // 2) now open the modal
      openResetOnce();

      // 3) give Supabase a moment, then clean the URL (remove tokens & next)
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.hash = '';
        if ((url.searchParams.get('next') || '').toLowerCase() === '/reset') {
          url.searchParams.delete('next');
        }
        window.history.replaceState({}, '', url.toString());
      }, 800);
    }
  })();
}, []);

// B) Safety-net: listen to Supabase auth events
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      console.debug('[auth] PASSWORD_RECOVERY');
      openResetOnce();
    } else if (event === 'SIGNED_IN') {
      const { shouldOpen } = parseAuthParams();
      if (shouldOpen) {
        console.debug('[auth] SIGNED_IN + shouldOpen');
        openResetOnce();
      }
    }
  });
  return () => subscription.unsubscribe();
}, []);

// C) Extra safety: if the URL hash changes after load
// C) Extra safety: if the URL hash changes after load, adopt session then open modal
useEffect(() => {
  const onHash = async () => {
    const { shouldOpen } = parseAuthParams();
    if (shouldOpen) {
      // 1) switch to the invited user's session (even if someone else is logged in)
      await adoptSessionFromUrl();

      // 2) open the reset modal
      openResetOnce();

      // 3) clean the URL after a moment (removes tokens and next=/reset)
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.hash = '';
        if ((url.searchParams.get('next') || '').toLowerCase() === '/reset') {
          url.searchParams.delete('next');
        }
        window.history.replaceState({}, '', url.toString());
      }, 800);
    }
  };

  window.addEventListener('hashchange', onHash as any, { passive: true } as any);
  return () => window.removeEventListener('hashchange', onHash as any);
}, []);
// Robust helper: read authed email from the invite/recovery sign-in
const getEmailFromAuth = async (): Promise<string> => {
  try {
    const { data } = await supabase.auth.getUser(); // capital U
    const e = (data?.user?.email || '').toLowerCase();
    if (e) return e;
  } catch (err) {
    console.debug('[auth] getUser() failed', err);
  }
  try {
    const { data } = await supabase.auth.getSession();
    const e = (data?.session?.user?.email || '').toLowerCase();
    if (e) return e;
  } catch (err) {
    console.debug('[auth] getSession() failed', err);
  }
  return '';
};

// When the reset modal opens, read Supabase user -> map to our app user
useEffect(() => {
  if (!showForceReset) return;

  (async () => {
    try {
      await adoptSessionFromUrl(); // NEW: ensure we are the invited user before reading getUser()
      console.debug('[auth] tokens parsed', parseAuthParams());
      console.debug('[after adopt] getUser()', await supabase.auth.getUser());
      console.debug('[after adopt] getSession()', await supabase.auth.getSession());
      
      // 1) Read email robustly (from adopted session)
      const emailLower = await getEmailFromAuth();
      setResetEmail(emailLower);
  
      // 2) Pull the admin-picked username from user_metadata if present
      const { data: uinfo } = await supabase.auth.getUser();
      const metaUsername = String(uinfo?.user?.user_metadata?.username || '').trim();
  
      // 3) Fallback username = local part of email (before '@')
      const local = emailLower.split('@')[0] || '';
  
      // 4) Try to match an app user from memory (optional)
      let u =
        (Array.isArray(users) &&
          (users.find(x => (x?.email || '').toLowerCase() === emailLower) ||
           users.find(x => (x?.username || '').toLowerCase() === emailLower) ||
           users.find(x => (x?.username || '').toLowerCase() === local))) ||
        null;
  
      // 5) Optional DB fallback (only if you actually have a 'users' table)
      if (!u && emailLower) {
        try {
          const r = await supabase
            .from('users') // change if your table differs, or remove if not used
            .select('id, username, email')
            .or(`email.eq.${emailLower},username.eq.${local}`)
            .single();
          if (!r.error && r.data) u = r.data as any;
        } catch { /* ignore */ }
      }
  
      // 6) Prefer metadata → else matched user → else local/email
      const chosenUsername = metaUsername || (u?.username || '') || local || emailLower;
      console.debug('[reset-modal chosen]', { emailLower, metaUsername, chosenUsername, matchedUser: u });

      setResetUser(u);
      setResetUsername(chosenUsername);  

      // Helpful debug if you need it:
      console.debug('[reset-modal]', { emailLower, metaUsername, chosenUsername, matchedUser: u });
    } catch {
      setResetUser(null);
      setResetUsername('');
    }
  })();
}, [showForceReset, users]);

// --- end top-level detection ---
// === Step 5B: Load rep coverage from Supabase after login ===
useEffect(() => {
  // If nobody is logged in yet, do nothing
  if (!session) return;

  (async () => {
    try {
      // 1) Load basic user profiles
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, username, email, role, status')          // ← no name, no phone
.order('username', { ascending: true });              // ← sort by username, not name

      if (pErr) throw pErr;
      const idToUsername = new Map<string, string>();
      for (const p of (profiles || []) as any[]) {
        idToUsername.set(String(p.id), String(p.username));
      }      
      // 2) Load coverage rows: one row per (username, state, region?)
      //    If region is NULL, it means "all regions in that state".
      const { data: coverage, error: cErr } = await supabase
      .from('rep_coverage')
      .select('user_id, state, region');    

      if (cErr) throw cErr;

      // 3) Build states[] and regionsByState{} for each user
      //    We'll collect coverage into maps first, then turn into arrays.
      const covByUser = new Map<
        string,
        { states: Set<string>; map: Record<string, Set<string>> }
      >();

      for (const row of coverage || []) {
        const u = idToUsername.get(String((row as any).user_id)) || '';
        const st = (row as any).state as string;
        const rg = ((row as any).region as string | null) ?? null;

        if (!u || !st) continue;

        if (!covByUser.has(u)) {
          covByUser.set(u, { states: new Set<string>(), map: {} });
        }
        const entry = covByUser.get(u)!;
        entry.states.add(st);

        // NULL region = "all regions in that state"
        if (rg == null || rg === '') {
          entry.map[st] = new Set<string>(regions[st] || []);
        } else {
          if (!entry.map[st]) entry.map[st] = new Set<string>();
          entry.map[st]!.add(rg);
        }
      }

      // 4) Merge profiles + coverage into your app's User[] shape
      const mergedUsers: User[] = (profiles || []).map((p: any) => {
        const cv =
          covByUser.get(p.username) ||
          ({ states: new Set<string>(), map: {} } as {
            states: Set<string>;
            map: Record<string, Set<string>>;
          });

        const statesArr = Array.from(cv.states).sort();
        const rbs: Record<string, string[]> = {};
        for (const st of Object.keys(cv.map)) {
          rbs[st] = Array.from(cv.map[st]).sort();
        }

        return {
          id: String(p.id),
          username: String(p.username),
          name: String(p.name || p.username || ''),
          email: p.email || undefined,
          role: (p.role || 'Rep') as Role,
          states: statesArr,
          regionsByState: rbs,
          phone: p.phone || undefined,
          status: (p.status || 'Active') as UserStatus,
        } as User;
      });

      setUsers(mergedUsers);

      // 5) Keep the status radio buttons in sync with Supabase
      console.debug('[5B] Loaded profiles + coverage', { mergedUsers, coverage });
    } catch (e: any) {
      console.error('[5B] load coverage failed', e);
      showToast(e?.message || 'Failed to load rep coverage', 'error');
    }
  })();
}, [session, regions]);

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
    return tasks.filter((t) => t.repUsername === session.username && !t.completedAtISO);
  }, [tasks, session]);
  // === Step 3A: Load live users from Supabase profiles (read-only) ===
  // We merge profiles (role/status/email) into our local users list.
  useEffect(() => {
    // Only try after someone is logged in (so RLS knows who we are).
    if (!session) return;

    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, email, username, role, status");

        if (error) throw error;

        setUsers((prev) => {
          const byUsername = new Map(prev.map((u) => [u.username.toLowerCase(), u]));
          const next = [...prev];

          for (const p of data || []) {
            const pEmail = (p as any).email as string | null;
            const pUsername =
              ((p as any).username as string | undefined) ||
              (pEmail ? pEmail.split("@")[0] : "");

            const key = (pUsername || "").toLowerCase();
            const existing = byUsername.get(key);

            if (existing) {
// NEW: carry over the real Supabase UUID so saves can target the row
if ((p as any).id) (existing as any).id = (p as any).id as string;
              existing.email = pEmail || existing.email;
              existing.role = ((p as any).role || existing.role) as Role;
              existing.status = ((p as any).status || existing.status) as UserStatus;
            } else {
              // Add a minimal new user record so the table can display it
              next.push({
                id: ((p as any).id as string) || uid(),
                name: pUsername || pEmail || "User",
                username: pUsername || (pEmail ? pEmail.split("@")[0] : "user"),
                email: pEmail || undefined,
                role: (((p as any).role as Role) ?? "Rep") as Role,
                states: [],
                regionsByState: {},
                phone: "",
                status: (((p as any).status as UserStatus) ?? "Active") as UserStatus,
              });
            }
          }
          return next;
        });
    
      } catch (err) {
        console.debug("[profiles] load failed", err);
      }
    })();
  }, [session]); // runs after login; refresh page to re-sync
  // === Step 4G: Load tasks from Supabase ===
useEffect(() => {
  if (!session) return;

  const isAdminManager = session.role === 'Admin' || session.role === 'Manager';

  (async () => {
    const base = supabase
      .from('dealer_tasks')
      .select('id,dealer_id,rep_username,text,created_at,completed_at')
      .order('created_at', { ascending: false });

    const { data, error } = isAdminManager
      ? await base
      : await base.eq('rep_username', session.username);

    if (error) {
      showToast(error.message || 'Failed to load tasks', 'error');
      return;
    }

    setTasks(
      (data || []).map((r: any) => ({
        id: r.id,
        dealerId: r.dealer_id,
        repUsername: r.rep_username,
        text: r.text,
        createdAtISO: r.created_at,
        completedAtISO: r.completed_at || undefined,
      }))
    );
  })();
}, [session]);
    // === Step 4B: Load dealers from Supabase after login (shared across devices) ===
    useEffect(() => {
      if (!session) return;
  
      (async () => {
        try {
          const { data, error } = await supabase
            .from("dealers")
            .select(
              "id,name,state,region,type,status,address1,address2,city,zip,contacts,no_deal_reasons,assigned_rep_username,last_visited,sending_deals"
            );
  
          if (error) throw error;
  
          const fromDb: Dealer[] = (data || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            state: r.state,
            region: r.region,
            type: r.type,
            status: r.status,
            address1: r.address1 || "",
            address2: r.address2 || "",
            city: r.city || "",
            zip: r.zip || "",
            contacts: Array.isArray(r.contacts) ? r.contacts : [],
            assignedRepUsername: r.assigned_rep_username || undefined,
            lastVisited: r.last_visited ? String(r.last_visited) : undefined, // keep YYYY-MM-DD
            sendingDeals: typeof r.sending_deals === "boolean" ? r.sending_deals : undefined,
            noDealReasons: r.no_deal_reasons || undefined,
          }));
  
          // Replace local dealers with the shared list
          setDealers(fromDb);
  
          // Rebuild regions catalog from DB (state -> unique regions)
          const rebuilt: RegionsCatalog = {};
          for (const d of fromDb) {
            if (!rebuilt[d.state]) rebuilt[d.state] = [];
            if (!rebuilt[d.state].includes(d.region)) rebuilt[d.state].push(d.region);
          }
          for (const st of Object.keys(rebuilt)) rebuilt[st].sort();
          setRegions(rebuilt);
        } catch (err) {
          console.debug("[dealers] load failed", err);
        }
      })();
    }, [session]);  
  const handleClickTask = (t: Task) => {
    saveLS(LS_LAST_SELECTED_DEALER, t.dealerId);
    setRoute("dealer-notes");
    // NOTE: keep the alert until user completes inside Dealer Notes (do NOT auto-remove here)
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
{route === "rep-route" && (
  <RepRouteView
    session={session}
    users={users}
    dealers={dealers}
    notes={notes}
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
                notes={notes}
                showToast={showToast}
              />
            )}
          </main>
        </div>
      );
    }
  }
// Save Password for Supabase invite/recovery + activate local user + log them in
const handleSaveNewPassword = async () => {
  try {
    // 1) Basic validation
    if (!newPass || newPass.length < 8) {
      showToast('Password must be at least 8 characters.', 'error');
      return;
    }
    if (newPass !== newPass2) {
      showToast('Passwords do not match.', 'error');
      return;
    }

    // 2) Update password in Supabase (token already signed-in from invite/recovery)
    const { error } = await supabase.auth.updateUser({ password: newPass });
    if (error) throw error;

   // 3) Identify which app user this is (no extra network call needed)
const emailLower = (resetEmail || '').toLowerCase();
const local = emailLower.split('@')[0] || '';
const candidates = [resetUsername.toLowerCase(), emailLower, local].filter(Boolean);

// 4) Find the user in your in-memory list by any of the candidates
const u =
  (Array.isArray(users) &&
    users.find((x: any) => {
      const uname = (x?.username || '').toLowerCase();
      const em = (x?.email || '').toLowerCase();
      return candidates.includes(uname) || candidates.includes(em);
    })) ||
  null;

    // 5) If we can’t map them, still finish gracefully (they can log in manually)
    if (!u) {
      showToast('Password set. Please log in with your username.', 'success');
      setShowForceReset(false);
      setNewPass('');
      setNewPass2('');
      setRoute('login');
      return;
    }

    // 6) Store password locally so your Login screen accepts it (username → password)
    //    These helpers/constants already exist in your app; if TS complains, keep the casts.
    const pwMap = loadLS<PasswordMap>(LS_PASSWORDS, {});
    pwMap[u.username] = newPass;                       // original case
    pwMap[u.username.toLowerCase()] = newPass;         // case-insensitive login
    saveLS(LS_PASSWORDS, pwMap);    

    // 7) Mark the user Active in your local list and ensure email is saved
    //    If your status field is named differently (e.g., is_active), tweak here.
    setUsers((prev: any[]) =>
      prev.map((x: any) =>
        x.id === u.id
          ? {
              ...x,
              status: 'Active' as UserStatus,
              email: x.email || resetEmail,
            }
          : x
      )
    );

    // 8) Close modal, clear fields, create a session, and route to Home
    setShowForceReset(false);
    setNewPass('');
    setNewPass2('');

    setSession({ username: u.username, role: u.role });
    setRoute('dealer-search'); // your Home screen

    showToast('Password set. You are logged in.', 'success');
  } catch (e: any) {
    showToast(e?.message || 'Failed to set password', 'error');
  }
};
  return (
    <>
      {body}
      <ToastHost toasts={toasts} dismiss={dismiss} />
      {showForceReset && (
  <Modal title="Set Your Password" onClose={() => setShowForceReset(false)}>
    <div className="grid gap-3">
      <p className="text-sm text-slate-500">
        Welcome! Please create your password to finish setting up your account.
      </p>
{/* Read-only identity fields */}
<TextField
  label="Username"
  value={resetUsername || '(loading…)'}
  onChange={() => {}}
  disabled
/>
<TextField
  label="Email"
  value={resetEmail || ''}
  onChange={() => {}}
  disabled
/>

      <TextField
        label="New Password"
        type="password"
        value={newPass}
        onChange={(v) => setNewPass(v)}
      />

      <TextField
        label="Confirm Password"
        type="password"
        value={newPass2}
        onChange={(v) => setNewPass2(v)}
      />

      <div className="flex gap-2 justify-end">
        <button
          className="px-3 py-2 rounded-lg border"
          onClick={() => setShowForceReset(false)}
        >
          Cancel
        </button>
        <button
          className="px-3 py-2 rounded-lg bg-blue-600 text-white"
          onClick={handleSaveNewPassword}
        >
          Save Password
        </button>
      </div>
    </div>
  </Modal>
)}
      {resetOpen && (
        <ResetInviteModal
          token={resetToken}
          onClose={() => setResetOpen(false)}
          users={users}
          setUsers={setUsers}
          showToast={showToast}
        />
      )}
    </>
  );
};

/* ----------------------------- Shared UI Bits ----------------------------- */

const Card: React.FC<{ title: string; subtitle?: string; children?: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div className="rounded-xl border bg-white p-3 md:p-5 shadow-sm">
    <div className="mb-2 md:mb-3">
      <div className="text-slate-800 font-semibold">{title}</div>
      {subtitle && <div className="text-slate-500 text-xs md:text-sm mt-0.5">{subtitle}</div>}
    </div>
    {children}
  </div>
);

const KPI: React.FC<{ title: string; value: number | string }> = ({ title, value }) => (
  <div className="rounded-xl border bg-white p-3 md:p-5 shadow-sm">
    <div className="text-slate-500 text-[11px] md:text-sm tracking-wide uppercase">{title}</div>
    <div className="mt-1 text-[22px] md:text-2xl leading-tight font-semibold text-slate-800">{value}</div>
  </div>
);

const PlaceholderCard: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
  <div className="rounded-xl border bg-white p-6 shadow-sm">
    <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
    {description && <p className="mt-2 text-slate-600 text-sm">{description}</p>}
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Container: bottom sheet on phones, centered dialog on desktop */}
      <div className="absolute inset-0 flex items-end md:items-center justify-center p-0 md:p-4">
        {/* Panel */}
        <div className="w-full md:max-w-4xl bg-white shadow-xl md:rounded-2xl overflow-hidden flex flex-col h-[92vh] md:h-auto md:max-h-[90vh]">
          {/* Sticky header with close button */}
          <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white z-10">
            <div className="text-slate-800 font-semibold truncate">{title}</div>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-700 px-2 py-1 rounded"
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* Scrollable content area (phone-safe) */}
          <div className="p-4 overflow-y-auto overscroll-contain flex-1">
            {children}
          </div>

          {/* Optional footer shadow on iOS when content stops behind home bar (visual nicety) */}
          <div className="md:hidden pointer-events-none h-3 bg-gradient-to-t from-white to-transparent" />
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
  type?: string;
}> = ({ label, value, onChange, placeholder, disabled, type }) => {
  return (
    <label className="block">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <input
        disabled={disabled}
        type={type || "text"}
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
  // Mobile popover state
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  // Close on outside click / ESC
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // label text for current value
  const current =
    options.find((o) => String(o.value) === String(value))?.label ?? "";

  return (
    <label className="block">
      <div className="text-xs text-slate-500 mb-1">{label}</div>

      {/* Desktop / tablets: keep native select */}
      <select
        disabled={disabled}
        className={`hidden md:block w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 ${
          disabled ? "bg-slate-100 text-slate-400" : ""
        }`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={`${o.value}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Mobile: custom popover anchored to the field */}
      <div ref={wrapRef} className="relative md:hidden">
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((s) => !s)}
          className={`w-full rounded-lg border px-3 py-2 text-left outline-none focus:ring-2 focus:ring-blue-500 ${
            disabled ? "bg-slate-100 text-slate-400" : "bg-white"
          }`}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={current ? "text-slate-800" : "text-slate-400"}>
            {current || "Select…"}
          </span>
        </button>

        {open && !disabled && (
          <div
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-xl border bg-white shadow-lg max-h-64 overflow-y-auto"
          >
            {options.map((o) => {
              const selected = String(o.value) === String(value);
              return (
                <button
                  key={`${o.value}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(String(o.value));
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-base ${
                    selected
                      ? "bg-blue-50 text-blue-700"
                      : "hover:bg-slate-50 text-slate-800"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </label>
  );
};

/* ---------------------------- Reset Invite Modal -------------------------- */
/**
 * New behavior:
 * - Read token -> invite map (LS_INVITES) to find the target user
 * - Prefill read-only: Full Name, Username, Phone
 * - Only allow setting New Password (+ confirm)
 * - On save: store to LS_PASSWORDS[username] = new password
 *            remove token from LS_INVITES
 *            mark user Active (via status map) so they can log in
 */
const LS_DISABLED_PASSWORDS = "demo_passwords_disabled"; // username -> password (when Inactive)
const LS_USER_STATUS = "demo_user_status"; // username -> "Active" | "Inactive"

const ResetInviteModal: React.FC<{
  token: string;
  onClose: () => void;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  showToast: (m: string, k?: ToastKind) => void;
}> = ({ token, onClose, users, setUsers, showToast }) => {
  const invites = loadLS<InviteMap>(LS_INVITES, {});
  const pw = loadLS<PasswordMap>(LS_PASSWORDS, {});
  const statusMap = loadLS<Record<string, "Active" | "Inactive">>(LS_USER_STATUS, {});

  const invite = token ? invites[token] : undefined;
  const user = invite ? users.find((u) => u.id === invite.userId) || null : null;

  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");

  const doReset = () => {
    if (!token || !invite || !user) return showToast("Invalid or expired invite link.", "error");
    if (!pwd) return showToast("Please enter a new password.", "error");
    if (pwd !== confirm) return showToast("Passwords do not match.", "error");

    // Set password (replaces any previous)
    const nextPw: PasswordMap = { ...pw, [user.username]: pwd };
    saveLS(LS_PASSWORDS, nextPw);

    // Mark Active (and ensure any disabled pw copy is removed)
    const disabledMap = loadLS<Record<string, string>>(LS_DISABLED_PASSWORDS, {});
    if (disabledMap[user.username]) {
      delete disabledMap[user.username];
      saveLS(LS_DISABLED_PASSWORDS, disabledMap);
    }
    const nextStatus = { ...statusMap, [user.username]: "Active" as const };
    saveLS(LS_USER_STATUS, nextStatus);

    // Remove invite token (one-time use)
    const nextInv = { ...invites };
    delete nextInv[token];
    saveLS(LS_INVITES, nextInv);

    showToast("Password set. You can now log in.", "success");
    onClose();
  };

  return (
    <Modal title="Create Your Account" onClose={onClose}>
      {!user ? (
        <div className="text-sm text-red-600">This invite link is invalid or has expired.</div>
      ) : (
        <div className="space-y-3">
          {/* NOTE: per request, no token text shown */}
          <div className="grid md:grid-cols-2 gap-3">
            <TextField label="Full Name" value={user.name} onChange={() => {}} disabled />
            <TextField label="Username" value={user.username} onChange={() => {}} disabled />
            <TextField label="Phone" value={user.phone || ""} onChange={() => {}} disabled />
            <TextField label="New Password" type="password" value={pwd} onChange={setPwd} />
            <TextField label="Confirm New Password" type="password" value={confirm} onChange={setConfirm} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={onClose}>
              Cancel
            </button>
            <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={doReset}>
              Create Account
            </button>
          </div>
          <div className="text-xs text-slate-500">
            After setting your password, return to the login screen to sign in.
          </div>
        </div>
      )}
    </Modal>
  );
};
/* ------------------------------- Rep Route -------------------------------- */

const RepRouteView: React.FC<{
  session: Session;
  users: User[];
  dealers: Dealer[];
  notes: Note[];
  setRoute: (r: RouteKey) => void;
  showToast: (m: string, k?: ToastKind) => void;
}> = ({ session, users, dealers, notes, setRoute, showToast }) => {
  const me = users.find((u) => u.username === session?.username) || null;
  const isRep = session?.role === "Rep";

  // Gate: reps only (Managers/Admins shouldn't land here)
  if (!isRep) {
    return (
      <div className="p-6 text-center text-slate-600">
        This page is only for reps.
      </div>
    );
  }

  const routeKeyForUser = (username?: string | null) =>
    `${LS_REP_ROUTE}_${username || "anon"}`;

  type RouteStop = { dealerId: string; position: number };
  type RouteByDate = Record<string, RouteStop[]>;

  const [dateStr, setDateStr] = useState<string>(todayISO());
  const [routeByDate, setRouteByDate] = useState<RouteByDate>(() =>
    loadLS<RouteByDate>(routeKeyForUser(session?.username), {})
  );

  // Persist whenever it changes
  useEffect(() => {
    saveLS(routeKeyForUser(session?.username), routeByDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeByDate]);

  // Build accessible dealers for this rep (assignment OR coverage)
  const accessibleDealers = useMemo(() => {
    if (!me) return [] as Dealer[];
    const can = (d: Dealer) => {
      const assigned = d.assignedRepUsername === me.username;
      const coversState = !!me.states?.includes?.(d.state);
      const coversRegion =
        !!me.regionsByState?.[d.state]?.includes?.(d.region);
      return assigned || (coversState && coversRegion);
    };
    return dealers.filter(can);
  }, [dealers, me]);

  // Filters
  const unique = (arr: (string | undefined)[]) =>
    Array.from(new Set(arr.filter(Boolean) as string[])).sort();

  const states = useMemo(() => unique(accessibleDealers.map(d => d.state)), [accessibleDealers]);
  const regions = useMemo(() => unique(accessibleDealers.map(d => d.region)), [accessibleDealers]);
  const cities = useMemo(() => unique(accessibleDealers.map(d => d.city)), [accessibleDealers]);

  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");

  const route: RouteStop[] = routeByDate[dateStr] || [];
  const routeIds = new Set(route.map(r => r.dealerId));

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return accessibleDealers.filter(d => {
      if (routeIds.has(d.id)) return false; // hide ones already in route
      if (state && d.state !== state) return false;
      if (region && d.region !== region) return false;
      if (city && d.city !== city) return false;
      if (!query) return true;
      const hay = `${d.name} ${d.city || ""} ${d.state} ${d.region}`.toLowerCase();
      return hay.includes(query);
    }).slice(0, 50);
  }, [q, state, region, city, accessibleDealers, routeIds]);

  const sortedRoute = useMemo(() => {
    return [...route]
      .map(r => ({ ...r, dealer: dealers.find(d => d.id === r.dealerId) }))
      .filter((r): r is RouteStop & { dealer: Dealer } => !!r.dealer)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
  }, [route, dealers]);

  const addDealer = (d: Dealer) => {
    setRouteByDate(prev => {
      const current = prev[dateStr] || [];
      if (current.some(r => r.dealerId === d.id)) return prev;
      const nextPos = current.length ? Math.max(...current.map(r => r.position || 0)) + 1 : 1;
      const next = [...current, { dealerId: d.id, position: nextPos }];
      return { ...prev, [dateStr]: next };
    });
    showToast("Added to route.", "success");
  };

  const removeDealer = (dealerId: string) => {
    setRouteByDate(prev => {
      const next = (prev[dateStr] || []).filter(r => r.dealerId !== dealerId);
      return { ...prev, [dateStr]: next };
    });
    showToast("Removed from route.", "success");
  };

  const move = (dealerId: string, dir: "up" | "down") => {
    setRouteByDate(prev => {
      const arr = [...(prev[dateStr] || [])].sort((a,b)=>(a.position||0)-(b.position||0));
      const idx = arr.findIndex(r => r.dealerId === dealerId);
      if (idx < 0) return prev;
      const swapIdx = dir === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= arr.length) return prev;
      const a = arr[idx], b = arr[swapIdx];
      const tmp = a.position; a.position = b.position; b.position = tmp;
      return { ...prev, [dateStr]: arr };
    });
  };

  const clearDay = () => {
    const current = routeByDate[dateStr] || [];
    if (!current.length) return;
    if (!confirm("Clear all stops for this day?")) return;
    setRouteByDate(prev => ({ ...prev, [dateStr]: [] }));
  };

  const exportCSV = () => {
    const sorted = [...sortedRoute];
    const rows: (string | number)[][] = [["Dealer","Address1","Address2","City","State","Zip","Region"]];
    for (const r of sorted) {
      const d = r.dealer;
      rows.push([d.name || "", d.address1 || "", d.address2 || "", d.city || "", d.state || "", d.zip || "", d.region || ""]);
    }
    const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rep-route-${dateStr}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const copyAll = async () => {
    const lines = sortedRoute.map(r => {
      const d = r.dealer;
      const addr = [d.address1, d.address2, d.city, d.state, d.zip].filter(Boolean).join(", ");
      return `${d.name} — ${addr}`;
    });
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("Addresses copied.", "success");
  };

  const mapUrl = (d: Dealer) => {
    const addr = [d.address1, d.city, d.state, d.zip].filter(Boolean).join(" ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  };

  const viewDealer = (dealerId: string) => {
    saveLS(LS_LAST_SELECTED_DEALER, dealerId);
    setRoute("dealer-notes");
  };
  // === Daily Summary state/helpers (same as Home) ===
const isAdminManager = session?.role === "Admin" || session?.role === "Manager";
const [dailyOpen, setDailyOpen] = useState(false);
const [summaryRange, setSummaryRange] = useState<"today"|"yesterday"|"7d">("today");
const [summaryRep, setSummaryRep] = useState<string>("ALL");
const repOptions = useMemo(
  () => users.filter(u => u.role === "Rep").map(r => ({ label: `${r.name} (${r.username})`, value: r.username })),
  [users]
);

// tiny helpers
const isToday = (iso: string) => {
  const d = new Date(iso), now = new Date();
  return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth() && d.getDate()===now.getDate();
};
const isYesterday = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1);
  return d.getFullYear()===y.getFullYear() && d.getMonth()===y.getMonth() && d.getDate()===y.getDate();
};
const isWithin7Days = (iso: string) => {
  const ts = new Date(iso).getTime(), now = Date.now(), seven = 7*24*60*60*1000;
  return now - ts <= seven && ts <= now;
};
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString();
const dealerById = (id: string) => dealers.find(d => d.id === id);

// scoped notes (role + range + optional rep for managers)
const summaryNotes = useMemo(() => {
  let scoped = notes.slice();
  const isRep = session?.role === "Rep";
  if (isRep) {
    scoped = scoped.filter(n => n.authorUsername === session!.username);
  } else if (isAdminManager) {
    if (summaryRep !== "ALL") scoped = scoped.filter(n => n.authorUsername === summaryRep);
  }
  if (summaryRange === "today") scoped = scoped.filter(n => isToday(n.tsISO));
  else if (summaryRange === "yesterday") scoped = scoped.filter(n => isYesterday(n.tsISO));
  else scoped = scoped.filter(n => isWithin7Days(n.tsISO));
  return scoped.sort((a,b)=> (a.tsISO > b.tsISO ? -1 : 1));
}, [notes, session, isAdminManager, summaryRep, summaryRange]);

const buildSummaryPlainText = () => {
  if (summaryNotes.length === 0) return "No notes in selected range.";
  const lines = summaryNotes.map(n => {
    const d = dealerById(n.dealerId);
    const where = d ? `${d.name} — ${d.region}, ${d.state}` : "(dealer removed)";
    return `• ${fmtDateTime(n.tsISO)} | ${where} | ${n.category} | by ${n.authorUsername}: ${n.text}`;
  });
  return lines.join("\n");
};
const csvEscape = (v: unknown) => {
  const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
};
const downloadCSV = (filename: string, rows: (string|number)[][]) => {
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
};
const exportSummaryCSV = () => {
  const rows: (string|number)[][] = [["Time","Dealer","Region","State","Category","Author","Note"]];
  summaryNotes.forEach(n => {
    const d = dealerById(n.dealerId);
    rows.push([ new Date(n.tsISO).toLocaleString(), d?.name||"", d?.region||"", d?.state||"", n.category, n.authorUsername, n.text||"" ]);
  });
  const today = new Date().toISOString().slice(0,10);
  const scope = session?.role === "Rep" ? session?.username : (summaryRep === "ALL" ? "all" : summaryRep);
  downloadCSV(`daily_summary_${summaryRange}_${today}_${scope}.csv`, rows);
};

// compact button classes (mobile-friendly)
const actionBtn = "px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg border text-sm md:text-base whitespace-nowrap";
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Dealer Notes</div>
          <h1 className="text-2xl md:text-3xl font-bold">Rep Route</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="border rounded-lg px-3 py-2"
            title="Pick a day"
          />
          <button className="px-3 py-2 rounded-lg border" onClick={clearDay}>Clear Day</button>
          <button className="px-3 py-2 rounded-lg border" onClick={exportCSV}>Export CSV</button>
          <button className="px-3 py-2 rounded-lg border" onClick={copyAll}>Copy All</button>
          {/* Daily Summary — same look/behavior as Home */}
<button
  onClick={() => setDailyOpen(true)}
  className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white shadow"
  title="Show notes summary"
>
  📄 Daily Summary
</button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Find your dealers</h2>
          <span className="text-sm text-slate-500">Results: {filtered.length}</span>
        </div>

        <div className="grid md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <input
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              placeholder="Search dealers (name, city, region)…"
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
          <select className="border rounded-lg px-3 py-2" value={state} onChange={e=>setState(e.target.value)}>
            <option value="">All States</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="border rounded-lg px-3 py-2" value={region} onChange={e=>setRegion(e.target.value)}>
            <option value="">All Regions</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="border rounded-lg px-3 py-2" value={city} onChange={e=>setCity(e.target.value)}>
            <option value="">All Cities</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Search Results */}
        <div className="mt-4 max-h-72 overflow-auto divide-y">
          {filtered.length === 0 ? (
            <div className="p-4 text-slate-500">No results. Try different filters.</div>
          ) : filtered.map(d => (
            <div key={d.id} className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-sm text-slate-600">{[d.address1, d.address2, d.city, d.state, d.zip].filter(Boolean).join(", ")}</div>
                <div className="mt-1 text-xs text-slate-500">{d.region} • {d.state}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={()=>addDealer(d)}>Add</button>
                <button className="px-3 py-2 rounded-lg border" onClick={()=>viewDealer(d.id)}>View</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Route List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Route for {dateStr}</h2>
          <span className="text-sm text-slate-500">{sortedRoute.length} stop(s)</span>
        </div>

        {sortedRoute.length === 0 ? (
          <div className="p-6 text-center text-slate-500">No dealers in the route yet. Add some from above.</div>
        ) : (
          <div className="space-y-2">
            {sortedRoute.map((r, idx) => (
             <div key={r.dealerId} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div>
                  <div className="font-semibold">{idx+1}. {r.dealer.name}</div>
                  <div className="text-sm text-slate-600">
                    {[r.dealer.address1, r.dealer.address2, r.dealer.city, r.dealer.state, r.dealer.zip].filter(Boolean).join(", ")}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{r.dealer.region}</div>
                </div>
                <div className="flex flex-wrap gap-2 w-full md:w-auto md:justify-end">
                <a href={mapUrl(r.dealer)} target="_blank" rel="noreferrer" className={actionBtn}>Maps</a>
<button className={actionBtn} onClick={()=>viewDealer(r.dealer.id)}>View</button>
<button className={actionBtn} onClick={()=>move(r.dealerId, "up")}>&uarr;</button>
<button className={actionBtn} onClick={()=>move(r.dealerId, "down")}>&darr;</button>
<button className={actionBtn} onClick={()=>removeDealer(r.dealerId)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Daily Summary Modal (Rep + Admin/Manager) */}
{dailyOpen && (
  <Modal title="Daily Summary" onClose={() => setDailyOpen(false)}>
    {/* Controls */}
    <div className="flex flex-col md:flex-row md:items-end gap-3 mb-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-600">Range:</label>
        <SelectField
          label="Range"
          value={summaryRange}
          onChange={(v) => setSummaryRange(v as "today" | "yesterday" | "7d")}
          options={[
            { label: "Today", value: "today" },
            { label: "Yesterday", value: "yesterday" },
            { label: "Last 7 Days", value: "7d" },
          ]}
        />
      </div>

      {isAdminManager && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600">Rep:</label>
          <SelectField
            label="Rep"
            value={summaryRep}
            onChange={(v) => setSummaryRep(v)}
            options={[{ label: "All Reps", value: "ALL" }, ...repOptions]}
          />
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50"
          onClick={() => {
            navigator.clipboard.writeText(buildSummaryPlainText());
            showToast("Summary copied.", "success");
          }}
        >
          Copy All
        </button>
        <button
          className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50"
          onClick={exportSummaryCSV}
        >
          Export CSV
        </button>
      </div>
    </div>

    {/* List */}
    <div className="space-y-3">
      {summaryNotes.length === 0 && (
        <div className="text-sm text-slate-500">No notes in selected range.</div>
      )}
      {summaryNotes.map((n) => {
        const d = dealerById(n.dealerId);
        return (
          <div key={n.id} className="border rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">{fmtDateTime(n.tsISO)}</div>
            <div className="text-sm font-medium text-slate-800">{d ? d.name : "(dealer removed)"}</div>
            <div className="text-xs text-slate-500 mb-1">{d ? `${d.region}, ${d.state}` : ""}</div>
            <div className="inline-block text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 mb-1">
              {n.category}
            </div>
            <div className="text-[11px] text-slate-500 mb-1">by {n.authorUsername}</div>
            <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.text}</div>
          </div>
        );
      })}
    </div>

    <div className="mt-4 flex items-center justify-end">
      <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={() => setDailyOpen(false)}>
        Close
      </button>
    </div>
  </Modal>
)}
    </div>
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
  notes: Note[];
  showToast: (m: string, k?: "success" | "error") => void;
}> = ({ users, setUsers, regions, setRegions, dealers, setDealers, notes, showToast }) => {
  // ---------- Utils: CSV ----------
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

  // ---------- Status & auth side-maps ----------
  const [statusMap, setStatusMap] = useState<Record<string, "Active" | "Inactive">>(() => loadLS(LS_USER_STATUS, {}));
  useEffect(() => saveLS(LS_USER_STATUS, statusMap), [statusMap]);
// Keep the edit modal radios in sync with what we loaded into users
useEffect(() => {
  if (!users || users.length === 0) return;
  setStatusMap((prev) => {
    const next = { ...prev };
    for (const u of users) {
      if (u?.username) {
        // use the status we merged into users (from Supabase profiles)
        next[u.username] = ((u.status as UserStatus) ?? "Active") as UserStatus;
      }
    }
    return next;
  });
}, [users]);
  const getStatus = (u: User): UserStatus => (statusMap[u.username] || u.status || "Inactive") as UserStatus;

  // ---------- Users table + modal ----------
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyUser: User = { id: "", name: "", username: "", email: "", role: "Rep", states: [], regionsByState: {}, phone: "" };
  const [draft, setDraft] = useState<User>({ ...emptyUser });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Import preview state
const [importPreview, setImportPreview] = useState<{
  fileName: string;
  rows: {
    name: string; state: string; region?: string | null; type?: string; status?: string;
    address1?: string | null; address2?: string | null; city?: string | null; zip?: string | null;
    _isUpdate?: boolean;
  }[];
  issues: { row: number; message: string }[];
  stats: { total: number; valid: number; invalid: number; willInsert: number; willUpdate: number; duplicateRows: number };
} | null>(null);
const [importPreviewOpen, setImportPreviewOpen] = useState(false);
const [importMode, setImportMode] = useState<'all' | 'new' | 'updates'>('all');
  // Invite state (only for Edit)
  const [inviteToken, setInviteToken] = useState<string>("");
  const inviteUrl = inviteToken
  ? (inviteToken.startsWith('http') ? inviteToken : `${location.origin}/reset?token=${inviteToken}`)
  : "";
// -------- Force-Reset (opens after auth/callback?next=/reset) --------
const [showForceReset, setShowForceReset] = useState(false);
const [newPass, setNewPass] = useState('');
const [newPass2, setNewPass2] = useState('');

// 1) Open reset modal if Supabase put "type=recovery|invite|signup" in the hash
useEffect(() => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const type = params.get('type');

  if (type === 'recovery' || type === 'invite' || type === 'signup') {
    setShowForceReset(true);

    // Optional: clean the hash so refresh doesn't re-open it
    const clean = new URL(window.location.href);
    clean.hash = '';
    window.history.replaceState({}, '', clean.toString());
  }
}, []);

// 2) Also listen to Supabase auth events in case the library clears the hash too fast
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      setShowForceReset(true);
    } else if (event === 'SIGNED_IN') {
      // Fallback: if we landed with a recovery hash and it just got processed
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      if (params.get('type') === 'recovery') setShowForceReset(true);
    }
  });

  return () => subscription.unsubscribe();
}, []);

  const openAddUser = () => {
    setEditingId(null);
    setDraft({ ...emptyUser, id: uid() });
    setInviteToken("");
    setUserModalOpen(true);
  };

  const openEditUser = (u: User) => {
    setEditingId(u.id);
    setDraft({
      ...JSON.parse(JSON.stringify(u)),
      // if the user already has email use it; else if username looks like email, use that
      email: (u as any).email ?? (u.username?.includes('@') ? u.username : ''),
    });  
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

 // REPLACE the entire saveUser function with this
const saveUser = async () => {
  // 0) Basic validation
  if (!draft.name.trim() || !draft.username.trim()) {
    return showToast("Name and username are required.", "error");
  }
  const usernameTaken = users.some((u) => u.username === draft.username && u.id !== draft.id);
  if (usernameTaken) return showToast("Username already exists.", "error");

  // Status from the radios (statusMap) or draft, default Active
  const chosenStatus: UserStatus =
    (statusMap[draft.username] as UserStatus) ||
    ((draft as any).status as UserStatus) ||
    "Active";

  // If Email is empty and username is an email, use it
  const emailForProfile = (draft.email || (draft.username.includes("@") ? draft.username : "")).trim();

  // 1) Update the on-screen list immediately so UI reflects the change
  if (editingId) {
    setUsers((prev) => prev.map((u) => (u.id === editingId ? { ...draft, status: chosenStatus } : u)));
    setStatusMap((m) => ({ ...m, [draft.username]: chosenStatus }));
    setUserModalOpen(false);
  } else {
    setUsers((prev) => [{ ...draft, status: chosenStatus }, ...prev]);
    setStatusMap((m) => ({ ...m, [draft.username]: "Inactive" }));
    setUserModalOpen(false);
  }

  // 2) Persist to Supabase
  try {
    const isUUID = /^[0-9a-fA-F-]{36}$/.test(editingId || "");
    let targetUserId: string | null = isUUID ? editingId! : null;

    // 2a) Update basic profile fields (username/email/role/status)
    if (emailForProfile) {
      if (isUUID) {
        const { error } = await supabase
          .from("profiles")
          .update({
            username: draft.username,
            email: emailForProfile || null,
            role: draft.role,
            status: chosenStatus,
          })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        // Fallback: update by email and learn their id
        const { data, error } = await supabase
          .from("profiles")
          .update({
            username: draft.username,
            email: emailForProfile || null,
            role: draft.role,
            status: chosenStatus,
          })
          .eq("email", emailForProfile)
          .select("id")
          .single();
        if (error) throw error;
        targetUserId = (data as any)?.id ?? null;
      }
    }

    // 2b) Save Rep coverage (state+region) if we know their real user id
    if (targetUserId) {
      // Remove old coverage rows
      const { error: delErr } = await supabase.from("rep_coverage").delete().eq("user_id", targetUserId);
      if (delErr) throw delErr;

      // Build rows from the modal selections
      const rows: { user_id: string; state: string; region: string }[] = [];
      for (const st of draft.states || []) {
        const rgs = draft.regionsByState?.[st] || [];
        for (const rg of rgs) {
          rows.push({ user_id: targetUserId, state: st, region: rg });
        }
      }

      if (rows.length) {
        const { error: upErr } = await supabase
          .from("rep_coverage")
          .upsert(rows, { onConflict: "user_id,state,region" });
        if (upErr) throw upErr;
      }
    }
  } catch (err: any) {
    console.error(err);
    showToast(err?.message || "Failed to save to server.", "error");
  }
};
  // ---- NEW: Remove confirmation modal ----
  const [confirmRemove, setConfirmRemove] = useState<User | null>(null);

  // Was: removeUser(id) -> now internal “performRemove” used after confirm
  const performRemove = async (id: string) => {
    const u = users.find((x) => x.id === id);

    // 1) Try server-side delete if this is a real Supabase auth UUID
    const isUUID = /^[0-9a-fA-F-]{36}$/.test(id);
    if (isUUID) {
      try {
        const r = await fetch('/api/admin-delete-user', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const json = (await r.json().catch(() => ({} as any))) as any;
        if (!r.ok) throw new Error(json?.error || 'Failed to delete on server');
      } catch (e: any) {
        // We still remove locally so UI is consistent, but let admin know
        showToast(e?.message || 'Removed locally, but server delete failed', 'error');
      }
    }

    // 2) Local clean-up (your original logic)
    if (u) {
      const pwMap = loadLS<PasswordMap>(LS_PASSWORDS, {});
      const disabledMap = loadLS<Record<string, string>>(LS_DISABLED_PASSWORDS, {});
      delete pwMap[u.username];
      delete disabledMap[u.username];
      saveLS(LS_PASSWORDS, pwMap);
      saveLS(LS_DISABLED_PASSWORDS, disabledMap);
      setStatusMap((m) => {
        const n = { ...m };
        delete n[u.username];
        return n;
      });
    }
    setUsers((prev) => prev.filter((x) => x.id !== id));
    showToast('User removed.', 'success');
  };

// Only in EDIT: Generate + Copy invite link via serverless API
const generateInvite = async () => {
  try {
    // get email from the new Email field; fall back to username only if it looks like an email
    const emailFromForm = (draft?.email || '').trim();
    const fallback = (draft?.username || '').trim();
    const email = emailFromForm || (fallback.includes('@') ? fallback : '');

    if (!email || !email.includes('@')) {
      showToast('Please enter a valid Email for this user.', 'error');
      return;
    }

   // Call the API route
const r = await fetch('/api/generate-invite', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email,
    metadata: { username: (draft.username || '').trim() }, // pass the admin-picked username
  }),
});

const json = (await r.json().catch(() => ({} as any))) as any;
if (!r.ok) throw new Error(json?.error || 'Failed to generate link');

// Support multiple Supabase response shapes just in case
const link: string | undefined =
  json?.link ??
  json?.data?.properties?.action_link ??
  json?.data?.action_link ??
  undefined;

    if (link) {
      // store full link; the inviteUrl getter above will use it directly
      setInviteToken(link);

      try {
        await navigator.clipboard.writeText(link);
        showToast('Invite link copied to clipboard.', 'success');
      } catch {
        showToast('Invite created (copy failed). Link shown below.', 'success');
      }
    } else {
      showToast('Invite created but link missing.', 'error');
    }
  } catch (e: any) {
    showToast(e?.message || 'Invite failed', 'error');
  }
};

const copyInvite = async () => {
  if (!inviteUrl) return;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    showToast('Invite link copied.', 'success');
  } catch {
    showToast('Unable to copy; select and copy manually.', 'error');
  }
};
  // Activate/Deactivate: move password in/out of active store to block/allow login
  const setStatusForUser = (u: User, status: "Active" | "Inactive") => {
    const pwMap = loadLS<PasswordMap>(LS_PASSWORDS, {});
    const disabledMap = loadLS<Record<string, string>>(LS_DISABLED_PASSWORDS, {});
    if (status === "Inactive") {
      if (pwMap[u.username]) {
        // move active pw -> disabled bucket
        disabledMap[u.username] = pwMap[u.username];
        delete pwMap[u.username];
        saveLS(LS_PASSWORDS, pwMap);
        saveLS(LS_DISABLED_PASSWORDS, disabledMap);
      }
    } else {
      // Active: if has disabled pw, restore it
      if (disabledMap[u.username]) {
        pwMap[u.username] = disabledMap[u.username];
        delete disabledMap[u.username];
        saveLS(LS_PASSWORDS, pwMap);
        saveLS(LS_DISABLED_PASSWORDS, disabledMap);
      }
    }
    setStatusMap((m) => ({ ...m, [u.username]: status }));
    showToast(`Status set to ${status} for ${u.name}.`, "success");
  };

  // ---------- Regions catalog & Import/Export ----------
  const [stateInput, setStateInput] = useState("");
  const [regionInput, setRegionInput] = useState("");
  const [searchRegion, setSearchRegion] = useState("");

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
  const [regionModal, setRegionModal] = useState<{ state: string; region: string } | null>(null);
  const regionRows = useMemo(() => {
    const rows: { state: string; region: string; count: number }[] = [];
    for (const st of Object.keys(regions)) for (const rg of regions[st]) rows.push({ state: st, region: rg, count: dealerCountFor(st, rg) });
    const q = searchRegion.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => `${r.state} ${r.region}`.toLowerCase().includes(q)) : rows;
    return filtered.sort((a, b) => a.state.localeCompare(b.state) || a.region.localeCompare(b.region));
  }, [regions, dealers, searchRegion]);

  // ---- NEW: pagination for Regions (mobile + desktop)
  const REGIONS_PAGE_SIZE = 10;
  const [regionsPage, setRegionsPage] = useState(1);
  const totalRegionPages = Math.max(1, Math.ceil(regionRows.length / REGIONS_PAGE_SIZE));
  const regionPageRows = useMemo(() => {
    const start = (regionsPage - 1) * REGIONS_PAGE_SIZE;
    return regionRows.slice(start, start + REGIONS_PAGE_SIZE);
  }, [regionRows, regionsPage]);
  useEffect(() => setRegionsPage(1), [searchRegion, regions]); // reset when list changes

  // Display helper (unchanged)
  const repDisplayForDealer = (d: Dealer) => {
    if (d.assignedRepUsername) {
      const u = users.find((x) => x.username === d.assignedRepUsername);
      return u ? u.name : d.assignedRepUsername;
    }
    const covering = users.filter((u) => u.role === "Rep" && u.states.includes(d.state) && (u.regionsByState[d.state]?.includes(d.region) ?? false));
    return covering.length ? covering.map((x) => x.name).join(", ") : "—";
  };

  // Exports (unchanged)
  const exportRegionDealers = (st: string, rg: string) => {
    const rows: (string | number)[][] = [["Dealer", "Rep", "Region", "State", "Type", "Status", "Last Visited"]];
    dealers
      .filter((d) => d.state === st && d.region === rg)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((d) => rows.push([d.name, repDisplayForDealer(d), d.region, d.state, d.type, d.status, d.lastVisited || ""]));
    downloadCSV(`dealers_${st}_${rg}.csv`, rows);
  };
  const exportAll = () => {
    const rows: (string | number)[][] = [["Dealer", "Rep", "Region", "State", "Type", "Status", "Last Visited"]];
    dealers
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((d) => rows.push([d.name, repDisplayForDealer(d), d.region, d.state, d.type, d.status, d.lastVisited || ""]));
    downloadCSV("dealers_all.csv", rows);
  };
  const exportAllNotes = () => {
    const rows: (string | number)[][] = [["Time", "Dealer", "Region", "State", "Category", "Author", "Note"]];
    notes
      .slice()
      .sort((a, b) => (a.tsISO > b.tsISO ? -1 : 1))
      .forEach((n) => {
        const d = dealers.find((x) => x.id === n.dealerId);
        rows.push([new Date(n.tsISO).toLocaleString(), d?.name || "", d?.region || "", d?.state || "", n.category, n.authorUsername, n.text || ""]);
      });
    downloadCSV("all_notes.csv", rows);
  };
// Import Dealers (CSV) -> PARSE & PREVIEW first, then confirm to upsert
const handleImportDealers = async (file?: File | null) => {
  try {
    if (!file) {
      showToast("Please choose a CSV file.", "error");
      return;
    }

    // Read full file text
    let text = await file.text();
    // Remove BOM if present
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    // --- Minimal RFC-4180 CSV parser (handles quotes and commas) ---
    const parseCSV = (src: string): string[][] => {
      const rows: string[][] = [];
      let row: string[] = [];
      let field = "";
      let i = 0;
      let inQuotes = false;

      while (i < src.length) {
        const ch = src[i];

        if (inQuotes) {
          if (ch === '"') {
            const next = src[i + 1];
            if (next === '"') {
              // Escaped quote
              field += '"';
              i += 2;
              continue;
            } else {
              inQuotes = false;
              i += 1;
              continue;
            }
          } else {
            field += ch;
            i += 1;
            continue;
          }
        } else {
          if (ch === '"') { inQuotes = true; i += 1; continue; }
          if (ch === ',')  { row.push(field); field = ""; i += 1; continue; }
          if (ch === '\r') { i += 1; continue; }
          if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ""; i += 1; continue; }
          field += ch; i += 1; continue;
        }
      }
      // flush last field/row
      row.push(field);
      rows.push(row);
      return rows
        .map(r => r.map(c => c.replace(/^\s+|\s+$/g, ""))) // trim
        .filter(r => r.some(c => c.length > 0));           // drop empty rows
    };

    const rows = parseCSV(text);
    if (!rows.length) {
      showToast("CSV is empty.", "error");
      return;
    }

    // Normalize helpers
    const titleCase = (s: string) =>
      (s || "")
        .toLowerCase()
        .replace(/(^|\s|\-|\/)\S/g, (m) => m.toUpperCase());

    const normType = (s: string) => {
      const v = (s || "").trim().toLowerCase();
      if (v.startsWith("fran")) return "Franchise";
      if (v.startsWith("ind"))  return "Independent";
      return "Independent"; // default
    };

    const normStatus = (s: string) => {
      const v = (s || "").trim().toLowerCase();
      if (!v) return "Active";
      if (["active","a"].includes(v)) return "Active";
      if (["pending","pend"].includes(v)) return "Pending";
      if (["prospect","prospective","new","lead"].includes(v)) return "Prospect";
      if (["inactive","in-active","disabled"].includes(v)) return "Inactive";
      if (["blacklisted","black list","black-list","black listed","blacklist","blocked"].includes(v)) return "Black Listed";
      return "Active";
    };

    const header = rows[0].map(h => h.replace(/^\"|\"$/g, ""));
    const lower = header.map(h => h.toLowerCase());

    const idx = (...names: string[]) => {
      const candidates = names.map(n => n.toLowerCase());
      for (let j = 0; j < lower.length; j++) {
        if (candidates.includes(lower[j])) return j;
      }
      return -1;
    };

    // Required: Dealer + State
    const iDealer = idx("dealer","name","dealer name");
    const iState  = idx("state","st");
    if (iDealer < 0 || iState < 0) {
      showToast("CSV must include at least Dealer and State columns.", "error");
      return;
    }

    // Optional fields
    const iRegion   = idx("region","area");
    const iType     = idx("type");
    const iStatus   = idx("status");
    const iAddress  = idx("address"); // single Address -> address1
    const iAddress1 = idx("address1","addr1","street","street1");
    const iAddress2 = idx("address2","addr2","street2");
    const iCity     = idx("city","town");
    const iZip      = idx("zip","zip code","zipcode","postal","postal code");

    const existingKeys = new Set(dealers.map(d => `${d.name.trim().toLowerCase()}|${d.state.trim().toUpperCase()}`));

    type UpsertRow = {
      name: string; state: string; region?: string | null; type?: string; status?: string;
      address1?: string | null; address2?: string | null; city?: string | null; zip?: string | null;
      _isUpdate?: boolean; // preview only
    };

    const valid: UpsertRow[] = [];
    const issues: { row: number; message: string }[] = [];
    const seen = new Set<string>(); // intra-file dupes (name|state)

    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      // skip blank lines
      if (!cols || cols.every(c => !c || !c.trim())) continue;

      const nameRaw  = (cols[iDealer]  || "").trim();
      const stateRaw = (cols[iState]   || "").trim();
      const region   = iRegion   >= 0 ? titleCase(cols[iRegion]   || "") : "";
      const type     = iType     >= 0 ? normType(cols[iType]      || "") : undefined;
      const status   = iStatus   >= 0 ? normStatus(cols[iStatus]  || "") : undefined;
      const address1 = iAddress1 >= 0 ? (cols[iAddress1] || "").trim()
                        : (iAddress >= 0 ? (cols[iAddress] || "").trim() : "");
      const address2 = iAddress2 >= 0 ? (cols[iAddress2] || "").trim() : "";
      const city     = iCity     >= 0 ? titleCase(cols[iCity]     || "") : "";
      const zip      = iZip      >= 0 ? (cols[iZip]      || "").trim() : "";

      const name  = nameRaw;
      const state = stateRaw.toUpperCase();

      const rowNo = r + 1; // 1-based with header

      if (!name || !state) {
        issues.push({ row: rowNo, message: "Missing Dealer or State" });
        continue;
      }
      if (!/^[A-Z]{2}$/.test(state)) {
        issues.push({ row: rowNo, message: `Bad state code "${stateRaw}"` });
        continue;
      }

      const key = `${name.trim().toLowerCase()}|${state}`;
      if (seen.has(key)) {
        issues.push({ row: rowNo, message: "Duplicate in file (same Dealer+State as a previous row)" });
        continue;
      }
      seen.add(key);

      valid.push({
        name,
        state,
        region: region || null,
        type: type || "Independent",
        status: status || "Active",
        address1: address1 ? address1 : null,
        address2: address2 ? address2 : null,
        city: city ? city : null,
        zip: zip ? zip : null,
        _isUpdate: existingKeys.has(key)
      });
    }

    const willUpdate = valid.filter(v => v._isUpdate).length;
    const willInsert = valid.length - willUpdate;

    setImportPreview({
      fileName: file.name,
      rows: valid,
      issues,
      stats: {
        total: rows.length - 1,
        valid: valid.length,
        invalid: issues.length,
        willInsert,
        willUpdate,
        duplicateRows: issues.filter(i => /Duplicate in file/.test(i.message)).length
      }
    });
    setImportPreviewOpen(true);
    showToast(`Parsed ${rows.length - 1} row(s): ${valid.length} valid, ${issues.length} with issues.`, "success");
  } catch (e: any) {
    showToast(e?.message || "Import failed", "error");
  }
};

// After preview, call this to upsert (respects importMode)
const confirmImportDealers = async () => {
  try {
    if (!importPreview || !importPreview.rows.length) {
      showToast("Nothing to import.", "error");
      return;
    }
    const existingKeys = new Set(dealers.map(d => `${d.name.trim().toLowerCase()}|${d.state.trim().toUpperCase()}`));
    let rowsToImport = importPreview.rows;
    if (importMode === 'new') rowsToImport = rowsToImport.filter(r => !existingKeys.has(`${r.name.trim().toLowerCase()}|${r.state}`));
    if (importMode === 'updates') rowsToImport = rowsToImport.filter(r =>  existingKeys.has(`${r.name.trim().toLowerCase()}|${r.state}`));

    if (!rowsToImport.length) {
      showToast("Your current filter leaves 0 rows to import.", "error");
      return;
    }

    // Remove preview-only flag
    const payload = rowsToImport.map(({ _isUpdate, ...rest }) => rest);

    const { error } = await supabase
      .from("dealers")
      .upsert(payload, { onConflict: "name,state", ignoreDuplicates: false });

    if (error) throw error;

    // Refresh from Supabase
    const { data, error: selErr } = await supabase
      .from("dealers")
      .select("id,name,state,region,type,status,address1,address2,city,zip,contacts,assigned_rep_username,last_visited,sending_deals,no_deal_reasons")
      .order("name");

    if (selErr) throw selErr;

    const fromDb: Dealer[] = (data || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      state: r.state,
      region: r.region,
      type: r.type,
      status: r.status,
      address1: r.address1 || "",
      address2: r.address2 || "",
      city: r.city || "",
      zip: r.zip || "",
      contacts: Array.isArray(r.contacts) ? r.contacts : [],
      assignedRepUsername: r.assigned_rep_username || undefined,
      lastVisited: r.last_visited ? String(r.last_visited) : undefined,
      sendingDeals: typeof r.sending_deals === "boolean" ? r.sending_deals : undefined,
      noDealReasons: r.no_deal_reasons || undefined,
    }));

    setDealers(fromDb);
    setImportPreviewOpen(false);
    setImportPreview(null);
    showToast(`Imported ${payload.length} dealer(s).`, "success");
  } catch (e: any) {
    showToast(e?.message || "Import failed", "error");
  }
};
  return (
    <div className="space-y-4">
      {/* Users */}
      <Card title="Users">
        <div className="mb-3">
          <button className={`${brand.primary} text-white px-3 py-2 rounded-lg`} onClick={openAddUser}>
            ➕ Add User
          </button>
        </div>

        <div className="overflow-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-left py-2 px-3 font-medium">Username</th>
                <th className="text-left py-2 px-3 font-medium">Phone</th>
                <th className="text-left py-2 px-3 font-medium">Role</th>
                <th className="text-left py-2 px-3 font-medium">States</th>
                <th className="text-left py-2 px-3 font-medium">Regions by State</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t odd:bg-slate-50 even:bg-white md:odd:bg-white md:even:bg-white">
                  <td className="py-1.5 px-2 md:py-2 md:px-3">{u.name}</td>
                  <td className="py-1.5 px-2 md:py-2 md:px-3">{u.username}</td>
                  <td className="py-1.5 px-2 md:py-2 md:px-3">{u.phone || "—"}</td>
                  <td className="py-1.5 px-2 md:py-2 md:px-3">{u.role}</td>
                  <td className="py-1.5 px-2 md:py-2 md:px-3">{u.states.join(", ") || "—"}</td>
                  <td className="py-1.5 px-2 md:py-2 md:px-3">
                    {u.states.length === 0 ? "—" : u.states.map((st) => `${st}: ${(u.regionsByState[st] || []).length}`).join("  •  ")}
                  </td>
                  <td className="py-1.5 px-2 md:py-2 md:px-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        getStatus(u) === "Active" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {getStatus(u)}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 md:py-2 md:px-3 text-right">
                    <button className="px-2 py-1 rounded border text-slate-700 hover:bg-slate-50 mr-2" onClick={() => openEditUser(u)}>
                      Edit
                    </button>
                    <button
                      className="px-2 py-1 rounded border border-red-600 text-red-700 hover:bg-red-50"
                      onClick={() => setConfirmRemove(u)} // NEW confirm
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-slate-500" colSpan={8}>
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
            <TextField label="State (e.g. IL)" value={stateInput} onChange={setStateInput} />
            <TextField label="Region (e.g. Chicago South)" value={regionInput} onChange={setRegionInput} />

            {/* NEW: desktop button above the search bar */}
            <div className="hidden md:block sm:col-span-2">
              <button className="px-3 py-1.5 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={createRegion}>
                Add / Create
              </button>
            </div>

            {/* Mobile: keep button; search moved to Regions card */}
<div className="sm:col-span-2">
  <button
    className="md:hidden px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50"
    onClick={createRegion}
  >
    Add / Create
  </button>
</div>

            </div>
        
          {/* Move Dealers Between Regions (bulk) */}
          <div className="rounded-xl border p-3 bg-white">
            <div className="font-semibold text-slate-800 mb-2">Move Dealers Between Regions (bulk)</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <SelectField label="From State" value={fromState} onChange={setFromState} options={allStates.map((s) => ({ label: s, value: s }))} />
              <SelectField
                label="From Region"
                value={fromRegion}
                onChange={setFromRegion}
                options={(regions[fromState] || []).map((r) => ({ label: r, value: r }))}
              />
              <SelectField label="To State" value={toState} onChange={setToState} options={allStates.map((s) => ({ label: s, value: s }))} />
              <SelectField
                label="To Region"
                value={toRegion}
                onChange={setToRegion}
                options={(regions[toState] || []).map((r) => ({ label: r, value: r }))}
              />
            </div>
            <button className="mt-3 w-full px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={moveDealers}>
              Move Dealers
            </button>
          </div>
        </div>
      </Card>

      {/* Regions list (clickable rows) with pagination */}
<Card title="Regions">
  {/* Search moved here (desktop + mobile) */}
  <div className="mb-3">
    <input
      className="w-full md:w-72 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
      placeholder="Search regions…"
      value={searchRegion}
      onChange={(e) => setSearchRegion(e.target.value)}
    />
  </div>

  <div className="overflow-auto rounded-lg border bg-white">
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-600">
        <tr>
          <th className="text-left py-2 px-3 font-medium">State</th>
          <th className="text-left py-2 px-3 font-medium">Region</th>
          <th className="text-right py-2 px-3 font-medium">Dealers</th>
          <th className="text-right py-2 px-3 font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {regionPageRows.map((r) => (
          <tr
            key={`${r.state}-${r.region}`}
            className="border-t odd:bg-slate-50 even:bg-white md:odd:bg-white md:even:bg-white"
          >
            <td className="py-1.5 px-2 md:py-2 md:px-3">{r.state}</td>
            <td className="py-1.5 px-2 md:py-2 md:px-3">{r.region}</td>
            <td className="py-1.5 px-2 md:py-2 md:px-3 text-right">{r.count}</td>
            <td className="py-1.5 px-2 md:py-2 md:px-3 text-right">
              <button
                className="px-2 py-1 rounded border text-slate-700 hover:bg-slate-50 mr-2"
                onClick={() => setRegionModal({ state: r.state, region: r.region })}
              >
                View
              </button>
              <button
                className="px-2 py-1 rounded border border-red-600 text-red-700 hover:bg-red-50"
                onClick={() => deleteRegion(r.state, r.region)}
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
        {regionPageRows.length === 0 && (
          <tr>
            <td className="py-6 text-center text-slate-500" colSpan={4}>
              No regions.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>

        {/* NEW: pagination controls */}
        {totalRegionPages > 1 && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {Array.from({ length: totalRegionPages }).map((_, i) => {
              const n = i + 1;
              const active = n === regionsPage;
              return (
                <button
                  key={n}
                  className={`min-w-[36px] px-2 py-1 rounded border text-sm ${
                    active ? "bg-blue-600 text-white border-blue-600" : "text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => setRegionsPage(n)}
                >
                  {n}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Export quick actions (unchanged) */}
      <div className="flex flex-wrap gap-2">
        <button className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={exportAll}>
          Export All Dealers
        </button>
        <button className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={exportAllNotes}>
          Export All Notes
        </button>
        <span className="relative inline-block">
  {/* Hidden file input used by the Import button */}
  <input
    ref={fileInputRef}
    type="file"
    accept=".csv,text/csv"
    className="hidden"
    onChange={(e) => {
      const f = e.target.files?.[0];
      if (f) handleImportDealers(f);   // parse -> preview modal
      e.currentTarget.value = "";      // lets you re-select the same file later
    }}
  />
  <button
    className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50"
    onClick={() => fileInputRef.current?.click()}
  >
    Import Dealers (CSV)
  </button>
</span>
      </div>
      {importPreviewOpen && importPreview && (
  <Modal title={`Import Preview — ${importPreview.fileName}`} onClose={() => { setImportPreviewOpen(false); setImportPreview(null); }}>
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border p-3 bg-white">
          <div className="font-medium text-slate-700 mb-1">Summary</div>
          <div>Total rows (excluding header): <b>{importPreview.stats.total}</b></div>
          <div>Valid rows: <b>{importPreview.stats.valid}</b></div>
          <div>Issues: <b>{importPreview.issues.length}</b> {importPreview.issues.length ? `(including ${importPreview.stats.duplicateRows} duplicate-in-file)` : ''}</div>
          <div className="mt-2">Will insert: <b>{importPreview.stats.willInsert}</b> • Will update: <b>{importPreview.stats.willUpdate}</b></div>
        </div>
        <div className="rounded-lg border p-3 bg-white">
          <div className="font-medium text-slate-700 mb-1">Import Mode</div>
          <div className="flex gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" name="importMode" checked={importMode==='all'} onChange={() => setImportMode('all')} />
              Import all valid rows
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" name="importMode" checked={importMode==='new'} onChange={() => setImportMode('new')} />
              Only NEW (skip updates)
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" name="importMode" checked={importMode==='updates'} onChange={() => setImportMode('updates')} />
              Only UPDATES (skip new)
            </label>
          </div>
        </div>
      </div>

      {/* Preview table */}
      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left py-2 px-3 font-medium">Action</th>
              <th className="text-left py-2 px-3 font-medium">Dealer</th>
              <th className="text-left py-2 px-3 font-medium">State</th>
              <th className="text-left py-2 px-3 font-medium">Region</th>
              <th className="text-left py-2 px-3 font-medium">City</th>
              <th className="text-left py-2 px-3 font-medium">Address</th>
<th className="text-left py-2 px-3 font-medium">Zip</th>
              <th className="text-left py-2 px-3 font-medium">Type</th>
              <th className="text-left py-2 px-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const existing = new Set(dealers.map(d => `${d.name.trim().toLowerCase()}|${d.state.trim().toUpperCase()}`));
              let rows = importPreview.rows;
              if (importMode === 'new') rows = rows.filter(r => !existing.has(`${r.name.trim().toLowerCase()}|${r.state}`));
              if (importMode === 'updates') rows = rows.filter(r =>  existing.has(`${r.name.trim().toLowerCase()}|${r.state}`));
              const sample = rows.slice(0, 20);
              return (
                <>
                  {sample.map((r, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="py-1.5 px-3">{existing.has(`${r.name.trim().toLowerCase()}|${r.state}`) ? 'Update' : 'Insert'}</td>
                      <td className="py-1.5 px-3">{r.name}</td>
                      <td className="py-1.5 px-3">{r.state}</td>
                      <td className="py-1.5 px-3">{r.region || '—'}</td>
                      <td className="py-1.5 px-3">{r.city || '—'}</td>
                      <td className="py-1.5 px-3">
  {([r.address1, r.address2].filter(Boolean).join(" ") || "—")}
</td>
<td className="py-1.5 px-3">{r.zip || "—"}</td>
                      <td className="py-1.5 px-3">{r.type}</td>
                      <td className="py-1.5 px-3">{r.status}</td>
                    </tr>
                  ))}
                  {rows.length > 20 && (
                    <tr className="border-t">
                      <td colSpan={9} className="py-2 px-3 text-slate-500">…and {rows.length - 20} more row(s)</td>
                    </tr>
                  )}
                  {rows.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={9} className="py-2 px-3 text-slate-500">No rows match the current import mode.</td>
                    </tr>
                  )}
                </>
              );
            })()}
          </tbody>
        </table>
      </div>

      {/* Issues */}
      {importPreview.issues.length > 0 && (
        <div className="rounded-lg border p-3 bg-amber-50 text-amber-800">
          <div className="font-medium mb-1">Found {importPreview.issues.length} issue(s). These rows will not be imported:</div>
          <ul className="list-disc pl-5 text-sm max-h-40 overflow-auto">
            {importPreview.issues.slice(0, 30).map((iss, i) => (
              <li key={i}>Row {iss.row}: {iss.message}</li>
            ))}
            {importPreview.issues.length > 30 && <li>…and {importPreview.issues.length - 30} more</li>}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <button className="px-3 py-2 rounded-lg border" onClick={() => { setImportPreviewOpen(false); setImportPreview(null); }}>
          Cancel
        </button>
        <button
          className="px-3 py-2 rounded-lg bg-blue-600 text-white"
          onClick={confirmImportDealers}
        >
          {(() => {
            const existing = new Set(dealers.map(d => `${d.name.trim().toLowerCase()}|${d.state.trim().toUpperCase()}`));
            let rows = importPreview.rows;
            if (importMode === 'new') rows = rows.filter(r => !existing.has(`${r.name.trim().toLowerCase()}|${r.state}`));
            if (importMode === 'updates') rows = rows.filter(r =>  existing.has(`${r.name.trim().toLowerCase()}|${r.state}`));
            return `Import ${rows.length} row(s)`;
          })()}
        </button>
      </div>
    </div>
  </Modal>
)}

      {/* Add/Edit User Modal */}
      {userModalOpen && (
        <Modal title={editingId ? "Edit User" : "Add User"} onClose={() => setUserModalOpen(false)}>
          <div className="grid md:grid-cols-2 gap-3">
            <TextField label="Full Name" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
            <TextField label="Username" value={draft.username} onChange={(v) => setDraft((d) => ({ ...d, username: v }))} />
            <TextField
  label="Email"
  value={draft.email || ''}
  onChange={(v) => setDraft((d) => ({ ...d, email: v }))}
/>
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
{/* Coverage (State → Regions) — compact, two-field UI */}
{(() => {
  // Pick which state we’re editing right now:
  const st =
    ((draft as any)._activeState as string) ||
    (draft.states[0] as string | undefined) ||
    (Object.keys(regions)[0] as string | undefined) ||
    "";

  // helper for All/None buttons
  const stateIsSelected = st && draft.states.includes(st);

  return (
    <div className="mt-4">
      <div className="text-sm font-semibold text-slate-700 mb-2">
        Coverage (State → Regions)
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {/* Left: State */}
        <div>
          <label className="text-sm font-medium">State</label>
          <select
            className="w-full rounded-lg border p-2 mt-1"
            value={st}
            onChange={(e) => {
              const v = e.target.value;
              setDraft((d) => {
                const next: any = { ...d, _activeState: v };
                // ensure the chosen state is tracked
                if (v && !next.states.includes(v)) {
                  next.states = [...next.states, v];
                  if (!next.regionsByState[v]) next.regionsByState[v] = [];
                }
                return next;
              });
            }}
          >
            {Object.keys(regions).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="mt-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!st && draft.states.includes(st)}
                onChange={() => st && toggleStateForDraft(st)}
              />
              Assign this entire state
            </label>
          </div>
        </div>

        {/* Right: Regions for selected state */}
        <div>
          <label className="text-sm font-medium">
            Regions in {st || "—"}
          </label>

          <div className="mt-2 flex gap-2 text-xs">
            <button
              type="button"
              className="px-2 py-1 rounded border"
              onClick={() => st && selectAllRegionsForState(st)}
              disabled={!stateIsSelected}
            >
              All
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded border"
              onClick={() => st && clearRegionsForState(st)}
              disabled={!stateIsSelected}
            >
              None
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-3">
            {(regions[st] || []).length === 0 && (
              <div className="text-xs text-slate-500">No regions for this state.</div>
            )}
            {(regions[st] || []).map((rg: string) => {
              const selected = (draft.regionsByState[st] || []).includes(rg);
              return (
                <label key={rg} className="inline-flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    disabled={!stateIsSelected}
                    checked={selected}
                    onChange={() => toggleRegionForDraft(st, rg)}
                  />
                  {rg}
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
})()}
          {/* Invite link row — ONLY visible when editing an existing user */}
          {editingId && (
            <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-end">
              <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={generateInvite} type="button">
                Generate Invite Link
              </button>
              <input className="flex-1 rounded-lg border px-3 py-2 text-sm" value={inviteUrl} readOnly placeholder="Invite link will appear here…" />
              <button className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50" onClick={copyInvite} disabled={!inviteUrl}>
                Copy
              </button>
            </div>
          )}

          {/* Status control (only in Edit) */}
          {editingId && (
            <div className="mt-4">
              <div className="text-slate-800 font-semibold mb-2">Account Status</div>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="acct_status"
                    checked={(statusMap[draft.username] || "Inactive") === "Active"}
                    onChange={() => setStatusForUser(draft, "Active")}
                  />
                  Active
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="acct_status"
                    checked={(statusMap[draft.username] || "Inactive") === "Inactive"}
                    onChange={() => setStatusForUser(draft, "Inactive")}
                  />
                  Inactive
                </label>
                <div className="text-xs text-slate-500">Inactive users cannot log in until reactivated.</div>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setUserModalOpen(false)}>
              Cancel
            </button>
            <button className={`${brand.primary} text-white px-4 py-2 rounded-lg`} onClick={saveUser}>
              Save
            </button>
          </div>
        </Modal>
      )}

      {/* NEW: Confirm Remove User */}
      {confirmRemove && (
        <Modal title="Confirm Deletion" onClose={() => setConfirmRemove(null)}>
          <div className="text-slate-700">
            Are you sure you want to permanently remove <span className="font-semibold">{confirmRemove.name}</span>?
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50" onClick={() => setConfirmRemove(null)}>
              Cancel
            </button>
            <button
              className="px-3 py-2 rounded-lg border border-red-600 text-red-700 hover:bg-red-50"
              onClick={() => {
                performRemove(confirmRemove.id);
                setConfirmRemove(null);
              }}
            >
              Yes, delete user
            </button>
          </div>
        </Modal>
      )}

      {/* Region Details Modal */}
      {regionModal && (
        <Modal title={`${regionModal.region} — ${regionModal.state}`} onClose={() => setRegionModal(null)}>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50"
              onClick={() => exportRegionDealers(regionModal.state, regionModal.region)}
            >
              Export Dealers in Region
            </button>
          </div>
          <div className="rounded-lg border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">Dealer</th>
                  <th className="text-left py-2 px-3 font-medium">Rep</th>
                  <th className="text-left py-2 px-3 font-medium">Region</th>
                  <th className="text-left py-2 px-3 font-medium">State</th>
                  <th className="text-left py-2 px-3 font-medium">Type</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                  <th className="text-left py-2 px-3 font-medium">Last Visited</th>
                </tr>
              </thead>
              <tbody>
                {dealers
                  .filter((d) => d.state === regionModal.state && d.region === regionModal.region)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="py-1.5 px-2 md:py-2 md:px-3">{d.name}</td>
                      <td className="py-1.5 px-2 md:py-2 md:px-3">{repDisplayForDealer(d)}</td>
                      <td className="py-1.5 px-2 md:py-2 md:px-3">{d.region}</td>
                      <td className="py-1.5 px-2 md:py-2 md:px-3">{d.state}</td>
                      <td className="py-1.5 px-2 md:py-2 md:px-3">{d.type}</td>
                      <td className="py-1.5 px-2 md:py-2 md:px-3">{d.status}</td>
                      <td className="py-1.5 px-2 md:py-2 md:px-3">{d.lastVisited || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default App;
