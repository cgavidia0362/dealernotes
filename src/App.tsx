// chore: no-op change to trigger StackBlitz git detection
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
  reportUrl?: string; // ← NEW (external report dashboard for Reps)
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
/* ----------------- Note type (extended for optimistic UI) ----------------- */
type NoteCategory = "Visit" | "Problem" | "Other" | "Manager";
type Note = {
  id: string;                 // can be temp like "temp_..."
  dealerId: string;
  authorUsername: string;
  tsISO: string;
  category: NoteCategory;
  text: string;
  pending?: boolean;          // true while saving
  failed?: boolean;           // true if last save failed
};

type InsightsReport = {
  snapshot: string[];
  themes: string[];
  positive: string[];
  concerns: string[];
  competitiveLosses: string[];
  programReception: string[];
  eContracting: string[];
  newProgram: string[];
  watchItems: string[];
};

type Task = {
  id: string;
  dealerId: string;
  repUsername: string;
  text: string; // dealer name for quick glance
  createdAtISO: string;
  completedAtISO?: string; // ← NEW (for “Complete Task”)
};

type RouteKey = "login" | "dealer-search" | "dealer-notes" | "reporting" | "user-management" | "rep-route" | "reports" | "reset" | "master-list";
/* ------------------------------- Persistence ------------------------------ */
const LS_USERS = "demo_users";
const LS_DEALERS = "demo_dealers";
const LS_REGIONS = "demo_regions";
const LS_TASKS = "demo_tasks";
const LS_NOTES = "demo_notes";
const LS_LAST_SELECTED_DEALER = "demo_last_selected_dealer";
const LS_REP_ROUTE = "demo_rep_route"; // per-user routes (local preview)
const LS_DEALER_FILTERS = "demo_dealer_filters"; // persist search filters
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

type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

const useToasts = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, number>>({});

  const uid = () => Math.random().toString(36).slice(2);

  const showToast = (message: string, kind: ToastKind = "success") => {
    const id = uid();
    setToasts((p) => [{ id, kind, message }, ...p]);
    const timeout = window.setTimeout(() => dismiss(id), 3500);
    timers.current[id] = timeout as unknown as number;
  };

  const showActionToast = (t: Omit<Toast, "id">) => {
    const id = uid();
    setToasts((p) => [{ id, ...t }, ...p]);
    const timeout = window.setTimeout(() => dismiss(id), 8000);
    timers.current[id] = timeout as unknown as number;
    return id;
  };

  const dismiss = (id: string) => {
    setToasts((p) => p.filter((t) => t.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  };

  return { toasts, showToast, showActionToast, dismiss };
};

const ToastHost: React.FC<{ toasts: Toast[]; dismiss: (id: string) => void }> = ({ toasts, dismiss }) => (
  <div className="fixed top-4 right-4 z-50 space-y-2">
    {toasts.map((t) => (
      <div
        key={t.id}
        className={`min-w-[260px] max-w-sm rounded-lg shadow-lg p-3 text-sm text-white flex items-start gap-2 ${
          t.kind === "success" ? "bg-green-600" : t.kind === "info" ? "bg-slate-700" : "bg-red-600"
        }`}
      >
        <div className="flex-1 whitespace-pre-wrap">{t.message}</div>
        {t.actionLabel && (
          <button
            className="underline text-xs ml-2"
            onClick={() => { dismiss(t.id); t.onAction?.(); }}
          >
            {t.actionLabel}
          </button>
        )}
        {t.secondaryLabel && (
          <button
            className="underline text-xs ml-2"
            onClick={() => { dismiss(t.id); t.onSecondary?.(); }}
          >
            {t.secondaryLabel}
          </button>
        )}
        <button className="opacity-90 hover:opacity-100" title="Close" onClick={() => dismiss(t.id)}>✕</button>
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
  const [notes, setNotes] = useState<Note[]>([]); // Empty - notes load on-demand per feature

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
  btnPrimary:
    "inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500",
  btnSecondary:
    "inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  btnAccent:
    "inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white",
  btnGhost:
    "inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800",
  pageTitle: "text-xl font-semibold text-slate-800",
  pageSub: "text-sm text-slate-500",
  th: "py-2.5 px-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500",
  td: "py-2.5 px-3",
};

const isUserActive = (u: User) => (u.status ?? "Active") !== "Inactive";

const assignableUsers = (list: User[], includeUsername?: string) =>
  list.filter((u) => isUserActive(u) || (!!includeUsername && u.username === includeUsername));

const INSIGHT_SECTIONS: { key: keyof InsightsReport; title: string; accent: string }[] = [
  { key: "snapshot", title: "Snapshot", accent: "border-l-slate-500" },
  { key: "themes", title: "What dealers are talking about", accent: "border-l-slate-400" },
  { key: "positive", title: "Positive", accent: "border-l-green-500" },
  { key: "concerns", title: "Concerns", accent: "border-l-amber-500" },
  { key: "competitiveLosses", title: "Competitive losses", accent: "border-l-red-500" },
  { key: "programReception", title: "Program reception", accent: "border-l-blue-500" },
  { key: "eContracting", title: "eContracting", accent: "border-l-blue-500" },
  { key: "newProgram", title: "New program", accent: "border-l-blue-500" },
  { key: "watchItems", title: "Watch items", accent: "border-l-slate-400" },
];

function InsightReportView({ report }: { report: InsightsReport }) {
  return (
    <div className="space-y-2 min-w-0">
      {INSIGHT_SECTIONS.map((s) => (
        <div
          key={s.key}
          className={`rounded-lg border border-slate-200 border-l-4 ${s.accent} bg-white px-3 py-2 min-w-0`}
        >
          <div className="text-sm font-semibold text-slate-800">{s.title}</div>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            {(report[s.key] || []).map((item, i) => (
              <li
                key={i}
                className={`text-sm break-words ${
                  item.toLowerCase().includes("nothing notable") ? "text-slate-400" : "text-slate-700"
                }`}
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function formatInsightsPlainText(
  report: InsightsReport,
  rangeLabel: string,
  noteCount: number,
  truncated: boolean
) {
  const lines = [
    `Market Insights — ${rangeLabel} (all reps)`,
    truncated
      ? `${noteCount} most recent notes analyzed (range was capped)`
      : `${noteCount} notes`,
    "",
  ];
  for (const s of INSIGHT_SECTIONS) {
    lines.push(s.title);
    const items = report[s.key] || [];
    for (const item of items) lines.push(`• ${item}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

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
}> = ({ session, route, setRoute, onLogout, tasksForUser, onClickTask }) => {
  const [tasksOpen, setTasksOpen] = useState(false);
  const openTasks = tasksForUser.filter((t) => !t.completedAtISO);

  return (
    <header className="w-full bg-white border-b sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3 md:py-0 md:h-14 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-blue-600 grid place-items-center text-white font-bold shrink-0">DN</div>
          <div className="text-slate-800 font-semibold">Dealer Notes</div>
          {session && (
            <nav className="ml-4 hidden md:flex items-stretch gap-0 h-14">
              <Tab label="Dealer Search" active={route === "dealer-search"} onClick={() => setRoute("dealer-search")} />
              <Tab label="Rep Route" active={route === "rep-route"} onClick={() => setRoute("rep-route")} />
              {session?.role === "Rep" && (
                <Tab label="Reports" active={route === "reports"} onClick={() => setRoute("reports")} />
              )}
              {(session?.role === "Admin" || session?.role === "Manager") && (
                <Tab label="Reporting" active={route === "reporting"} onClick={() => setRoute("reporting")} />
              )}
              {session?.role === "Admin" && (
                <Tab label="User Management" active={route === "user-management"} onClick={() => setRoute("user-management")} />
              )}
              {session?.role === "Admin" && (
                <Tab label="Master List" active={route === "master-list"} onClick={() => setRoute("master-list")} />
              )}
            </nav>
          )}
        </div>
        {session ? (
          <div className="flex items-center gap-3">
            {openTasks.length > 0 && (
              <div className="relative hidden md:block">
                <button
                  type="button"
                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-700 border border-red-100 hover:bg-red-100"
                  onClick={() => setTasksOpen((o) => !o)}
                >
                  {openTasks.length} {openTasks.length === 1 ? "task" : "tasks"}
                </button>
                {tasksOpen && (
                  <div className="absolute right-0 mt-1 w-64 rounded-lg border bg-white shadow-lg z-50 py-1">
                    {openTasks.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          setTasksOpen(false);
                          onClickTask(t);
                        }}
                      >
                        {t.text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="text-sm text-slate-600 hidden sm:block">
              <span className="font-medium text-slate-800">{session.username}</span>
              <span className="text-slate-400"> · </span>
              <span>{session.role}</span>
            </div>
            <button className={`hidden sm:inline-flex ${brand.btnGhost}`} onClick={onLogout} type="button">
              Log Off
            </button>
          </div>
        ) : (
          <div />
        )}
      </div>

      {session && (
        <div className="md:hidden border-t">
          <div className="flex items-center justify-between gap-2 px-3 pt-2">
            <div className="text-xs text-slate-500 truncate min-w-0">
              <span className="font-medium text-slate-700">{session.username}</span>
              {" · "}
              {session.role}
            </div>
            <button
              className="shrink-0 px-3 py-2 text-sm font-medium text-blue-600"
              onClick={onLogout}
              type="button"
            >
              Log Off
            </button>
          </div>
          <div className="flex flex-wrap gap-1 px-2 pb-2">
            <MobileTab label="Search" active={route === "dealer-search"} onClick={() => setRoute("dealer-search")} />
            <MobileTab label="Route" active={route === "rep-route"} onClick={() => setRoute("rep-route")} />
            {session?.role === "Rep" && (
              <MobileTab label="Reports" active={route === "reports"} onClick={() => setRoute("reports")} />
            )}
            {(session?.role === "Admin" || session?.role === "Manager") && (
              <MobileTab label="Reporting" active={route === "reporting"} onClick={() => setRoute("reporting")} />
            )}
          </div>
        </div>
      )}
    </header>
  );
};

const Tab: React.FC<{ label: string; active?: boolean; onClick?: () => void; disabled?: boolean }> = ({ label, active, onClick, disabled }) => (
  <button
    className={`px-3 h-14 text-sm font-medium border-b-2 ${
      disabled
        ? "text-slate-300 cursor-not-allowed border-transparent"
        : active
          ? "text-slate-900 border-blue-600"
          : "text-slate-500 border-transparent hover:text-slate-800"
    }`}
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    type="button"
  >
    {label}
  </button>
);

const MobileTab: React.FC<{ label: string; active?: boolean; onClick?: () => void; disabled?: boolean }> = ({ label, active, onClick, disabled }) => (
  <button
    className={`min-w-[30%] flex-1 py-2.5 px-2 text-sm font-medium rounded-lg ${
      disabled ? "text-slate-300" : active ? "bg-blue-50 text-blue-700" : "text-slate-600"
    }`}
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    type="button"
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
  can: _can,
  setRoute,
  showToast,
  tasksForUser,
  onClickTask,
  notes,
}) => {
  // Load persisted filters from localStorage
  const savedFilters = loadLS<{q?: string; fRep?: string; fState?: string; fRegion?: string; fType?: string; fStatus?: string}>(LS_DEALER_FILTERS, {});
  
  const [q, setQ] = useState(savedFilters.q || "");
  const [fRep, setFRep] = useState<string>(savedFilters.fRep || "");
  const [fState, setFState] = useState<string>(savedFilters.fState || "");
  const [fRegion, setFRegion] = useState<string>(savedFilters.fRegion || "");
  const [fType, setFType] = useState<string>(savedFilters.fType || "");
  const [fStatus, setFStatus] = useState<string>(savedFilters.fStatus || "");
  const [filtersOpen, setFiltersOpen] = useState(() =>
    Boolean(savedFilters.fRep || savedFilters.fState || savedFilters.fRegion || savedFilters.fType || savedFilters.fStatus)
  );

  // Save filters to localStorage whenever they change
  useEffect(() => {
    saveLS(LS_DEALER_FILTERS, { q, fRep, fState, fRegion, fType, fStatus });
  }, [q, fRep, fState, fRegion, fType, fStatus]);

  // --- paging + searching flags ---
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const isSearching = Boolean(q || fRep || fState || fRegion || fType || fStatus);
  const activeFilterCount = [fRep, fState, fRegion, fType, fStatus].filter(Boolean).length;
  
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
  const [summaryRange, setSummaryRange] = useState<"today" | "yesterday" | "7d">("today");
  const [summaryRep, setSummaryRep] = useState<string>(
    session?.role === "Admin" ? "ALL" : (session?.username || "ALL")
  );
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [summaryTab, setSummaryTab] = useState<"insights" | "notes">("notes");
  const isCustomRange = Boolean(startDate && endDate);
  const todayYmd = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const applyDatePreset = (preset: "today" | "yesterday" | "7d") => {
    setSummaryRange(preset);
    setStartDate("");
    setEndDate("");
  };
  const applyCustomRange = () => {
    const t = todayYmd();
    setStartDate((s) => s || t);
    setEndDate((e) => e || t);
  };
// Data fetched from Supabase for the Daily Summary (Home)
const [homeSummaryNotes, setHomeSummaryNotes] = useState<Note[]>([]);
const [loadingHomeSummary, setLoadingHomeSummary] = useState(false);
const [homeRangeLabel, setHomeRangeLabel] = useState<string>("");
const [homeRangeStartISO, setHomeRangeStartISO] = useState<string>("");
const [homeRangeEndISO, setHomeRangeEndISO] = useState<string>("");
const [insights, setInsights] = useState<InsightsReport | null>(null);
const [insightsMeta, setInsightsMeta] = useState<{ noteCount: number; truncated: boolean } | null>(null);
const [loadingInsights, setLoadingInsights] = useState(false);
const [insightsError, setInsightsError] = useState<string>("");
// Fetch Daily Summary notes from Supabase whenever the modal opens or filters change
useEffect(() => {
  if (!dailyOpen) return;

  // Refresh dealers list to ensure we have current names (in case any were renamed)
  const refreshDealers = async () => {
    const { data, error } = await supabase
      .from("dealers")
      .select("id, name, state, region, city, address1, type, status, contacts, assigned_rep_username, last_visited, sending_deals, no_deal_reasons");
    if (!error && data) {
      setDealers(data.map((d: any) => ({
        id: d.id,
        name: d.name,
        state: d.state,
        region: d.region,
        city: d.city,
        address1: d.address1,
        type: d.type,
        status: d.status,
        contacts: d.contacts || [],
        assignedRepUsername: d.assigned_rep_username,
        lastVisited: d.last_visited,
        sendingDeals: d.sending_deals,
        noDealReasons: d.no_deal_reasons,
      })));
    }
  };
  refreshDealers();

  // Compute [start, endExclusive] in LOCAL timezone (not UTC) to match user's clock
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0); // Local midnight

  let start = new Date(startOfToday);              // inclusive
  let endExclusive = new Date(startOfToday);       // exclusive
  endExclusive.setDate(endExclusive.getDate() + 1); // tomorrow 00:00 local
  let labelText = "";

  // Custom from/to (inclusive) takes over presets
  if (startDate && endDate) {
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
    start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
    endExclusive = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
    labelText = `${startDate} – ${endDate}`;
  } else if (summaryRange === "yesterday") {
    start = new Date(startOfToday);
    start.setDate(start.getDate() - 1);           // yesterday 00:00 local
    endExclusive = new Date(startOfToday);        // today 00:00 local
    const y = start.getFullYear();
    const m = String(start.getMonth() + 1).padStart(2, '0');
    const d = String(start.getDate()).padStart(2, '0');
    labelText = `${y}-${m}-${d}`;
  } else if (summaryRange === "7d") {
    start = new Date(startOfToday);
    start.setDate(start.getDate() - 6);           // last 7 days inclusive
    endExclusive = new Date(startOfToday);
    endExclusive.setDate(endExclusive.getDate() + 1); // tomorrow
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    labelText = `${fmt(start)} – ${fmt(new Date(startOfToday))}`;
  } else {
    // "today"
    const y = start.getFullYear();
    const m = String(start.getMonth() + 1).padStart(2, '0');
    const d = String(start.getDate()).padStart(2, '0');
    labelText = `${y}-${m}-${d}`;
  }

  setHomeRangeLabel(labelText);

  const startISO = start.toISOString();
  const endISO = endExclusive.toISOString();
  setHomeRangeStartISO(startISO);
  setHomeRangeEndISO(endISO);

  // Build query
  setLoadingHomeSummary(true);
  let q = supabase
    .from("dealer_notes")
    .select("id,dealer_id,author_username,created_at,category,text")
    .gte("created_at", startISO)
    .lt("created_at", endISO)
    .order("created_at", { ascending: false });

  // Reps see their own (RLS also applies). Admin/Manager can filter by rep.
  if (isRep) {
    q = q.eq("author_username", session!.username);
  } else if (isAdminManager && summaryRep !== "ALL") {
    q = q.eq("author_username", summaryRep);
  }

  (async () => {
    const { data, error } = await q;
    if (error) {
      console.error("Daily Summary fetch failed:", error);
      setHomeSummaryNotes([]);
    } else {
      const mapped: Note[] = (data || []).map((r: any) => ({
        id: String(r.id),
        dealerId: r.dealer_id,
        authorUsername: r.author_username,
        tsISO: new Date(r.created_at).toISOString(),
        category: r.category,
        text: r.text,
      }));
      setHomeSummaryNotes(mapped);
    }
    setLoadingHomeSummary(false);
  })();
}, [dailyOpen, summaryRange, summaryRep, startDate, endDate, isRep, isAdminManager, session?.username]);

useEffect(() => {
  if (!dailyOpen) return;
  if (session?.role === "Admin") setSummaryRep("ALL");
}, [dailyOpen, session?.role]);

useEffect(() => {
  setInsights(null);
  setInsightsMeta(null);
  setInsightsError("");
}, [summaryRange, startDate, endDate]);

// Fetch missing dealers for Daily Summary notes (handles renamed dealers)
useEffect(() => {
  if (!dailyOpen || homeSummaryNotes.length === 0) return;
  
  (async () => {
    // Find dealer IDs that are in notes but not in dealers list
    const missingDealerIds = new Set<string>();
    for (const note of homeSummaryNotes) {
      if (note.dealerId && !dealers.find(d => d.id === note.dealerId)) {
        missingDealerIds.add(note.dealerId);
      }
    }
    
    if (missingDealerIds.size === 0) return; // All dealers found
    
    // Fetch missing dealers from database
    const { data, error } = await supabase
      .from("dealers")
      .select("id, name, state, region, city, address1, type, status, contacts")
      .in("id", Array.from(missingDealerIds));
    
    if (!error && data && data.length > 0) {
      // Add fetched dealers to the list
      const newDealers = data.map((d: any) => ({
        id: d.id,
        name: d.name,
        state: d.state,
        region: d.region,
        city: d.city || "",
        address1: d.address1 || "",
        type: d.type || ("Independent" as DealerType),
        status: d.status || ("Active" as DealerStatus),
        contacts: d.contacts || [],
      }));
      setDealers([...dealers, ...newDealers]);
    }
  })();
}, [dailyOpen, homeSummaryNotes, dealers]);

// Copy Home summary (uses fetched homeSummaryNotes)
const copyHomeDailySummary = async () => {
  const lines = homeSummaryNotes
    .map((n) => {
      const d = dealers.find((x) => x.id === n.dealerId);
      const when = (n.tsISO || "").slice(0, 16).replace("T", " "); // YYYY-MM-DD HH:MM
      return `• ${d?.name ?? "Unknown"} (${d?.region ?? ""}, ${d?.state ?? ""}) — ${n.category} by ${n.authorUsername} at ${when}\n  ${n.text}`;
    })
    .join("\n\n");

  await navigator.clipboard.writeText(lines || `No notes for ${homeRangeLabel}.`);
  showToast("Summary copied.", "success");
};

// Export Home summary to CSV (uses fetched homeSummaryNotes)
const exportHomeDailySummaryCSV = () => {
  const rows: (string | number)[][] = [["When","Dealer","Region","State","Category","Author","Note"]];
  for (const n of homeSummaryNotes) {
    const d = dealers.find((x) => x.id === n.dealerId);
    rows.push([
      (n.tsISO || "").replace("T", " ").slice(0, 16),
      d?.name || "",
      d?.region || "",
      d?.state || "",
      n.category || "",
      n.authorUsername || "",
      (n.text || "").replace(/\n/g, " "),
    ]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `daily-summary-home-${homeRangeLabel.replace(/[^0-9A-Za-z-]/g,"_")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const generateHomeInsights = async () => {
  if (session?.role !== "Admin") return;
  if (!homeRangeStartISO || !homeRangeEndISO) {
    showToast("Pick a date range first.", "error");
    return;
  }
  setLoadingInsights(true);
  setInsightsError("");
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) {
      showToast("Please log in again.", "error");
      return;
    }
    const resp = await fetch("/api/ai-insights", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startISO: homeRangeStartISO,
        endISO: homeRangeEndISO,
        rangeLabel: homeRangeLabel,
      }),
    });
    const json = await resp.json().catch(() => ({} as any));
    if (!resp.ok) {
      const msg = json?.error || `Insights failed (HTTP ${resp.status})`;
      setInsightsError(msg);
      showToast(msg, "error");
      return;
    }
    if (!json.report || !json.noteCount) {
      setInsights(null);
      setInsightsMeta({ noteCount: 0, truncated: false });
      const msg = json?.message || "No notes in selected range.";
      setInsightsError(msg);
      showToast(msg, "error");
      return;
    }
    setInsights(json.report as InsightsReport);
    setInsightsMeta({ noteCount: Number(json.noteCount) || 0, truncated: !!json.truncated });
    setSummaryTab("insights");
  } catch (e: any) {
    const msg = e?.message || "Insights failed.";
    setInsightsError(msg);
    showToast(msg, "error");
  } finally {
    setLoadingInsights(false);
  }
};

const copyHomeInsights = async () => {
  if (!insights || !insightsMeta) return;
  await navigator.clipboard.writeText(
    formatInsightsPlainText(insights, homeRangeLabel, insightsMeta.noteCount, insightsMeta.truncated)
  );
  showToast("Insights copied.", "success");
};

  // helpers
  const rolePickerUsers = users.filter((u) => u.role === "Rep" || u.role === "Manager" || u.role === "Admin");
  const repOptions = assignableUsers(rolePickerUsers, fRep);

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
    // Helper: Check if Rep covers this dealer (either explicit assignment OR territory)
    const repCoversDealer = (d: Dealer): boolean => {
      if (!isRep || !session) return true; // Admins/Managers see everything
      const me = users.find(u => u.username === session.username);
      if (!me) return false;
      // Rep sees ALL dealers in any state they cover, regardless of assignment
      if (me.states.includes(d.state)) return true;
      return false;
    };
    
    return dealers
      .filter((d) => {
        // CHANGE 1: Reps only see dealers they cover (assignment OR territory)
        if (!repCoversDealer(d)) return false;
        
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
  }, [dealers, q, fRep, fState, fRegion, fType, fStatus, users, isRep, session]);

  // Default (no search/filters): show only the 10 most recently visited
  const recentTop10 = useMemo(() => {
    return [...dealers]
      .filter((d) => {
        if (!isRep || !session) return true; // Admins/Managers see everything
        const me = users.find(u => u.username === session.username);
        if (!me) return false;
        // Rep sees ALL dealers in any state they cover, regardless of assignment
        if (me.states.includes(d.state)) return true;
        return false;
      })
    .sort((a, b) => {
      // CHANGE 2: Dealers with no lastVisited (new dealers) float to top
      const ta = a.lastVisited ? Date.parse(a.lastVisited) : Infinity;
      const tb = b.lastVisited ? Date.parse(b.lastVisited) : Infinity;
      if (tb !== ta) return tb - ta; // newest first (Infinity beats timestamps)
      return a.name.localeCompare(b.name); // tie-breaker
    })
    .slice(0, 10);
}, [dealers, isRep, session, users]);

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
  const isAdmin = session?.role === "Admin";
  const showInsightsSplit = isAdmin && (loadingInsights || !!insights || !!insightsError);
  const summaryNoteCards = (
    <div className="space-y-3 min-w-0">
      {loadingHomeSummary && <div className="text-sm text-slate-500">Loading…</div>}
      {!loadingHomeSummary && homeSummaryNotes.length === 0 && (
        <div className="text-sm text-slate-500">No notes in selected range.</div>
      )}
      {!loadingHomeSummary &&
        homeSummaryNotes.map((n) => {
          const d = dealerById(n.dealerId);
          return (
            <div key={n.id} className="border rounded-lg p-3 min-w-0">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="text-sm font-medium text-slate-800 break-words min-w-0">
                  {d ? d.name : "(dealer removed)"}
                </div>
                <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {n.category}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {fmtDateTime(n.tsISO)}
                {n.authorUsername ? ` · ${n.authorUsername}` : ""}
                {d ? ` · ${d.region}, ${d.state}` : ""}
              </div>
              <div className="text-sm text-slate-800 whitespace-pre-wrap break-words mt-2">{n.text}</div>
            </div>
          );
        })}
    </div>
  );
  const notesPaneActions = (
    <div className="grid grid-cols-2 gap-2 mb-3">
      <button
        className="px-3 py-2 rounded-lg border text-slate-700 hover:bg-slate-50 text-sm"
        onClick={copyHomeDailySummary}
        type="button"
      >
        Copy All
      </button>
      <button
        className="px-3 py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50 text-sm"
        onClick={exportHomeDailySummaryCSV}
        type="button"
      >
        Export CSV
      </button>
    </div>
  );
  const insightsBody = (
    <div className="min-w-0">
      {loadingInsights && (
        <div className="text-sm text-slate-500">Reading notes and generating the report…</div>
      )}
      {!loadingInsights && insightsError && !insights && (
        <div className="text-sm text-slate-600 break-words">{insightsError}</div>
      )}
      {!loadingInsights && insightsMeta?.truncated && (
        <div className="text-xs text-amber-700 mb-2">
          Range was large — analyzed the most recent {insightsMeta.noteCount} notes.
        </div>
      )}
      {!loadingInsights && insights && <InsightReportView report={insights} />}
      {!loadingInsights && !insights && !insightsError && (
        <div className="text-sm text-slate-500">
          Pick a date range, then generate a market report from every rep’s notes. Nothing runs until you click.
        </div>
      )}
    </div>
  );
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
    <div className="space-y-4 pb-24 md:pb-0">{/* pb for mobile FAB clearance */}
      {/* Mobile actions */}
      <div className="grid grid-cols-2 gap-2 md:hidden">
        <button
          onClick={() => {
            setForm((f) => ({ ...f, assignedRepUsername: session?.username || "" }));
            setAddOpen(true);
          }}
          className={`${brand.primary} text-white px-3 py-2.5 rounded-lg text-sm font-medium`}
          type="button"
        >
          Add Dealer
        </button>
        {(isRep || isAdminManager) && (
          <button
            onClick={() => {
              if (session?.role === "Admin") setSummaryRep("ALL");
              setDailyOpen(true);
            }}
            className="px-3 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
            title="Show notes summary"
            type="button"
          >
            Daily Summary
          </button>
        )}
      </div>

      {/* Desktop header */}
      <div className="hidden md:flex items-end justify-between gap-3">
        <div>
          <div className={brand.pageTitle}>Dealers</div>
          <div className={brand.pageSub}>Search, filter, and open a dealer</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setForm((f) => ({ ...f, assignedRepUsername: session?.username || "" }));
              setAddOpen(true);
            }}
            className={brand.btnPrimary}
            type="button"
          >
            Add Dealer
          </button>
          {(isRep || isAdminManager) && (
            <button
              onClick={() => {
                if (session?.role === "Admin") setSummaryRep("ALL");
                setDailyOpen(true);
              }}
              className={brand.btnAccent}
              title="Show notes summary"
              type="button"
            >
              Daily Summary
            </button>
          )}
          <button
            onClick={() => setScratchOpen(true)}
            className={brand.btnSecondary}
            title="Open Quick Notes"
            type="button"
          >
            Quick Notes
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="rounded-xl border bg-white p-4 shadow-sm relative">
        <div className="hidden md:block mb-3">
          <input
            className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search dealers, city, state, region…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="relative md:hidden mb-3">
          <input
            className="w-full rounded-lg border px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search dealers, city, state, region…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q.trim().length > 0 && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 z-20 rounded-xl border bg-white shadow max-h-64 overflow-y-auto">
              {suggestions.map((d) => (
                <button
                  key={d.id}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50"
                  onClick={() => goToDealer(d.id)}
                  type="button"
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

        <button
          type="button"
          className="md:hidden w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm font-medium text-slate-700"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <span>{activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}</span>
          <span className="text-slate-400">{filtersOpen ? "Hide" : "Show"}</span>
        </button>

        <div className={`${filtersOpen ? "grid mt-3" : "hidden"} md:grid md:mt-0 grid-cols-1 md:grid-cols-5 gap-3`}>
          {!isRep && (
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
          )}
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
          <SelectField
            label="Status"
            value={fStatus}
            onChange={(v) => setFStatus(v)}
            options={[
              { label: "All", value: "" },
              ...["Active", "Pending", "Prospect", "Inactive", "Black Listed"].map((s) => ({
                label: s,
                value: s,
              })),
            ]}
          />
        </div>

        <div className={`${filtersOpen ? "flex" : "hidden"} md:flex mt-3 items-center gap-3`}>
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
            type="button"
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

      {/* Results */}
      <div className="md:hidden space-y-2">
        {paged.map((d) => (
          <button
            key={d.id}
            type="button"
            className="w-full text-left rounded-xl border bg-white p-3 shadow-sm"
            onClick={() => goToDealer(d.id)}
          >
            <div className="font-medium text-slate-800 break-words">{d.name}</div>
            <div className="text-xs text-slate-500 mt-1">
              {repNameForDealer(d)}
              {d.region || d.state ? ` · ${d.region}${d.region && d.state ? ", " : ""}${d.state}` : ""}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Last visited: {d.lastVisited || "—"}</div>
          </button>
        ))}
        {isSearching && filtered.length === 0 && (
          <div className="rounded-xl border bg-white p-6 text-center text-slate-500 text-sm">
            No dealers match your search.
          </div>
        )}
        {!isSearching && recentTop10.length === 0 && (
          <div className="rounded-xl border bg-white p-6 text-center text-slate-500 text-sm">
            No recently visited dealers yet.
          </div>
        )}
      </div>

      <div className="hidden md:block rounded-xl border bg-white p-0 shadow-sm overflow-x-auto md:overflow-visible">
        <table className="min-w-[700px] md:min-w-[900px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className={brand.th}>Dealer</th>
              <th className={brand.th}>Rep</th>
              <th className={brand.th}>Region</th>
              <th className={`${brand.th} hidden md:table-cell`}>State</th>
              <th className={`${brand.th} hidden md:table-cell`}>Type</th>
              <th className={`${brand.th} hidden md:table-cell`}>Status</th>
              <th className={`${brand.th} text-right`}>Last Visited</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((d) => (
              <tr
                key={d.id}
                className="border-t hover:bg-slate-50 cursor-pointer"
                onClick={() => goToDealer(d.id)}
              >
                <td className={`${brand.td} font-medium text-slate-800`}>{d.name}</td>
                <td className={brand.td}>{repNameForDealer(d)}</td>
                <td className={brand.td}>{d.region}</td>
                <td className={`${brand.td} hidden md:table-cell`}>{d.state}</td>
                <td className={`${brand.td} hidden md:table-cell`}>{d.type}</td>
                <td className={`${brand.td} hidden md:table-cell`}>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge(d.status)}`}>{d.status}</span>
                </td>
                <td className={`${brand.td} text-right`}>{d.lastVisited || "—"}</td>
              </tr>
            ))}
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
      </div>

      {isSearching && totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-slate-600">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded-lg border border-slate-300 disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              type="button"
            >
              Previous
            </button>
            <button
              className="px-3 py-2 rounded-lg border border-slate-300 disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      )}

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
                ...assignableUsers(rolePickerUsers, form.assignedRepUsername).map((r) => ({ label: `${r.name} (${r.username})`, value: r.username })),
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
        <Modal title="Daily Summary" wide onClose={() => setDailyOpen(false)}>
          <div className="flex flex-col gap-3 min-w-0 min-h-0 md:flex-1">
            {/* Filters */}
            <div className="shrink-0 space-y-3 min-w-0">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "today", label: "Today" },
                    { id: "yesterday", label: "Yesterday" },
                    { id: "7d", label: "Last 7 Days" },
                  ] as const
                ).map((p) => {
                  const active = !isCustomRange && summaryRange === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyDatePreset(p.id)}
                      className={`px-3 py-1.5 rounded-full text-sm border ${
                        active
                          ? "bg-slate-800 text-white border-slate-800"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={applyCustomRange}
                  className={`px-3 py-1.5 rounded-full text-sm border ${
                    isCustomRange
                      ? "bg-slate-800 text-white border-slate-800"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  Custom
                </button>
              </div>

              {isCustomRange && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                  <label className="block min-w-0">
                    <div className="text-xs text-slate-500 mb-1">From</div>
                    <input
                      type="date"
                      className="w-full min-w-0 border rounded-lg px-2 py-2 text-sm"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      max={endDate || todayYmd()}
                    />
                  </label>
                  <label className="block min-w-0">
                    <div className="text-xs text-slate-500 mb-1">To</div>
                    <input
                      type="date"
                      className="w-full min-w-0 border rounded-lg px-2 py-2 text-sm"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate}
                      max={todayYmd()}
                    />
                  </label>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
                {(session?.role === "Admin" || session?.role === "Manager") && (
                  <label className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-slate-600 shrink-0">Rep</span>
                    <select
                      className="border rounded-lg px-2 py-2 text-sm w-full sm:w-auto min-w-0"
                      value={summaryRep}
                      onChange={(e) => setSummaryRep(e.target.value)}
                    >
                      <option value="ALL">All</option>
                      {assignableUsers(users || [], summaryRep === "ALL" ? undefined : summaryRep)
                        .map((u) => u.username)
                        .filter((u, i, arr) => arr.indexOf(u) === i)
                        .sort()
                        .map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <div className="text-xs text-slate-500 sm:ml-auto">
                  Showing {homeRangeLabel}
                  {isAdminManager && summaryRep !== "ALL" ? ` · ${summaryRep}` : ""}
                  {isAdmin ? " · insights use all reps" : ""}
                </div>
              </div>

              {isAdmin && (
                <button
                  className={`${showInsightsSplit ? "md:hidden" : ""} w-full md:w-auto px-3 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60`}
                  onClick={generateHomeInsights}
                  disabled={loadingInsights}
                  title="Analyzes all reps in this date range. Runs only when you click."
                  type="button"
                >
                  {loadingInsights ? "Generating…" : "Generate Insights"}
                </button>
              )}
            </div>

            {isAdmin && (
              <div className="md:hidden shrink-0 grid grid-cols-2 gap-1 p-0.5 rounded-lg border bg-slate-100">
                <button
                  type="button"
                  onClick={() => setSummaryTab("insights")}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                    summaryTab === "insights" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  }`}
                >
                  Insights
                </button>
                <button
                  type="button"
                  onClick={() => setSummaryTab("notes")}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                    summaryTab === "notes" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  }`}
                >
                  Notes
                </button>
              </div>
            )}

            <div
              className={`min-w-0 min-h-0 ${
                isAdmin && showInsightsSplit
                  ? "flex-1 md:grid md:grid-cols-2 md:gap-3 md:overflow-hidden"
                  : "flex-1 overflow-auto"
              }`}
            >
              {isAdmin && (
                <div
                  className={`${
                    summaryTab === "insights" ? "flex" : "hidden"
                  } ${showInsightsSplit ? "md:flex" : "md:hidden"} flex-col min-w-0 min-h-0 overflow-auto border rounded-xl p-3 bg-slate-50 mb-3 md:mb-0`}
                >
                  <div className="shrink-0 flex flex-col gap-2 mb-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800">Market Insights</div>
                      <div className="text-xs text-slate-500 break-words">
                        {homeRangeLabel} · all reps
                        {insightsMeta ? ` · ${insightsMeta.noteCount} notes` : ""}
                      </div>
                    </div>
                    <div className="hidden md:flex flex-wrap gap-2 shrink-0">
                      {insights && (
                        <button
                          className="px-3 py-1.5 rounded-lg border text-slate-700 hover:bg-white text-sm"
                          onClick={copyHomeInsights}
                          type="button"
                        >
                          Copy insights
                        </button>
                      )}
                      <button
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm disabled:opacity-60"
                        onClick={generateHomeInsights}
                        disabled={loadingInsights}
                        type="button"
                      >
                        {loadingInsights ? "Generating…" : "Generate Insights"}
                      </button>
                    </div>
                    {insights && (
                      <button
                        className="md:hidden px-3 py-1.5 rounded-lg border text-slate-700 hover:bg-white text-sm self-start"
                        onClick={copyHomeInsights}
                        type="button"
                      >
                        Copy insights
                      </button>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 min-w-0">{insightsBody}</div>
                </div>
              )}

              <div
                className={`${
                  isAdmin ? (summaryTab === "notes" ? "flex" : "hidden") + " md:flex" : "flex"
                } flex-col min-w-0 min-h-0 overflow-auto border rounded-xl p-3`}
              >
                <div className="text-sm font-semibold text-slate-800 mb-2">Notes</div>
                {notesPaneActions}
                {summaryNoteCards}
              </div>
            </div>

            <div className="shrink-0 flex items-center justify-end pt-1">
              <button
                className={`${brand.primary} text-white px-4 py-2 rounded-lg`}
                onClick={() => setDailyOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
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
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  regions: RegionsCatalog;
  setRoute: (r: RouteKey) => void;
  showToast: (m: string, k?: ToastKind) => void;
  showActionToast: (t: Omit<Toast, "id">) => string;
}> = ({ session, users, dealers, setDealers, tasks, setTasks, regions, setRoute, showToast, showActionToast }) => {
  const dealerId = loadLS<string | null>(LS_LAST_SELECTED_DEALER, null);
  const dealer = dealers.find((d) => d.id === dealerId) || null;
  const me = users.find((u) => u.username === session?.username) || null;

  // Local notes state - only for this dealer
  const [localNotes, setLocalNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

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

  // Reps can access any dealer in states they cover (state-level access, not region-specific)
  const repHasCoverage = isRep && coversState;
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
      return localNotes
        .sort((a, b) => (a.tsISO > b.tsISO ? -1 : 1));
    } catch {
      return [];
    }
  }, [localNotes]);

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
  const [isSavingNote, setIsSavingNote] = useState(false);

  const canUseManagerNote = isAdminManager;
// Load notes for this dealer from Supabase whenever the dealer changes
useEffect(() => {
  if (!dealer) return;
  
  setLoadingNotes(true);
  (async () => {
    const { data, error } = await supabase
      .from('dealer_notes')
      .select('id,dealer_id,author_username,created_at,category,text')
      .eq('dealer_id', dealer.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      setLoadingNotes(false);
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

    // Set local notes (don't accumulate in global state)
    setLocalNotes(mapped);
    setLoadingNotes(false);
  })();
}, [dealer?.id]);
const addNote = async () => {
  if (!repCanAccess) return showToast("You don't have access to add notes.", "error");
  if (isSavingNote) return;
  
  const text = (noteText || "").trim();
  if (!text) return showToast("Please enter a note.", "error");

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return showToast("You're not signed in.", "error");
  const authUserId = authData.user.id;

  setIsSavingNote(true);
  
  const saveStartTime = Date.now(); // Track when save started

  const tempId = `${session?.username || "unknown"}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const optimistic: Note = {
    id: tempId,
    dealerId: dealer.id,
    authorUsername: session?.username || "",
    tsISO: new Date().toISOString(),
    category: noteCategory,
    text,
    pending: true,
  };

  setLocalNotes(prev => [optimistic, ...prev]);
  setNoteText("");

  const saveOnce = async () => {
    const payload = {
      dealer_id: dealer.id,
      user_id: authUserId,
      author_username: optimistic.authorUsername,
      category: noteCategory,
      text,
      created_at: optimistic.tsISO,
      client_id: tempId,
    };

    const doSave = async () => {
      // Step 1: upsert the note
      const { error: upsertErr } = await supabase
        .from("dealer_notes")
        .upsert(payload, { onConflict: "client_id" });
      if (upsertErr) throw upsertErr;

      // Step 2: fetch it back using client_id to get the real id
      const { data, error: fetchErr } = await supabase
        .from("dealer_notes")
        .select("id,dealer_id,author_username,created_at,category,text")
        .eq("client_id", tempId)
        .single();
      if (fetchErr) throw fetchErr;
      return data;
    };

    const saveWithTimeout = Promise.race([
      doSave(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 10000)
      ),
    ]);

    const data = (await saveWithTimeout) as any;

    const saved: Note = {
      id: String(data.id),
      dealerId: data.dealer_id,
      authorUsername: data.author_username,
      tsISO: new Date(data.created_at).toISOString(),
      category: data.category as NoteCategory,
      text: data.text,
      pending: false,
    };
    setLocalNotes(prev => prev.map(n => (n.id === tempId ? saved : n)));
    showToast("Note saved successfully!", "success");
  };

  try {
    await saveOnce();
  } catch (e: any) {
    const saveEndTime = Date.now();
    const saveDuration = saveEndTime - saveStartTime;
    
    // ============ DETAILED ERROR LOGGING ============
    console.group("🔴 NOTE SAVE ERROR - DETAILED DIAGNOSTICS");
    console.log("⏱️ TIMING:");
    console.log("  - Started at:", new Date(saveStartTime).toISOString());
    console.log("  - Failed at:", new Date(saveEndTime).toISOString());
    console.log("  - Duration:", saveDuration, "ms", `(${(saveDuration / 1000).toFixed(1)}s)`);
    console.log("");
    console.log("❌ ERROR DETAILS:");
    console.log("  - Error type:", e?.constructor?.name || "Unknown");
    console.log("  - Error message:", e?.message || "No message");
    console.log("  - Full error object:", JSON.stringify(e, null, 2));
    console.log("");
    console.log("📝 CONTEXT:");
    console.log("  - Username:", session?.username);
    console.log("  - Dealer:", dealer.name);
    console.log("  - Dealer ID:", dealer.id);
    console.log("  - Note category:", noteCategory);
    console.log("  - Note length:", text.length, "chars");
    console.log("  - Client ID:", tempId);
    console.log("");
    console.log("🌐 NETWORK:");
    console.log("  - Online status:", navigator.onLine ? "ONLINE" : "OFFLINE");
    console.log("  - Connection type:", (navigator as any).connection?.effectiveType || "Unknown");
    console.log("  - Downlink speed:", (navigator as any).connection?.downlink || "Unknown", "Mbps");
    console.groupEnd();
    
    // Check if note actually saved despite the error
    setTimeout(async () => {
      try {
        const { data: verifyData } = await supabase
          .from("dealer_notes")
          .select("id")
          .eq("client_id", tempId)
          .maybeSingle();
        
        console.log("🔍 VERIFICATION CHECK:", verifyData ? "✅ NOTE EXISTS IN DATABASE (false positive timeout)" : "❌ NOTE DOES NOT EXIST (real failure)");
      } catch (verifyErr) {
        console.log("🔍 VERIFICATION CHECK: Could not verify (network issue)");
      }
    }, 1000);
    // ============ END DETAILED LOGGING ============
    
    setLocalNotes(prev => prev.map(n => (n.id === tempId ? { ...n, pending: false, failed: true } : n)));

    const errorMsg = e.message?.includes("timeout")
      ? "Save timed out - check your connection and retry"
      : "Failed to save note - please retry";

    showActionToast({
      kind: "error",
      message: errorMsg,
      actionLabel: "Retry",
      onAction: async () => {
        setIsSavingNote(true);
        setLocalNotes(prev => prev.map(n => (n.id === tempId ? { ...n, pending: true, failed: false } : n)));
        try {
          await saveOnce();
        } catch {
          setLocalNotes(prev => prev.map(n => (n.id === tempId ? { ...n, pending: false, failed: true } : n)));
          showToast("Still failed. Check your internet connection.", "error");
        } finally {
          setIsSavingNote(false);
        }
      },
      secondaryLabel: "Undo",
      onSecondary: () => {
        setLocalNotes(prev => prev.filter(n => n.id !== tempId));
        setIsSavingNote(false);
      },
    });
  } finally {
    setIsSavingNote(false);
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

  /* ---------------------------- Delete Note ----------------------------- */
  const deleteNote = async (noteId: string, noteAuthor: string) => {
    // Permission check: Managers/Admins can delete any note, Reps can only delete their own
    const canDelete = isAdminManager || (isRep && noteAuthor === session?.username);
    
    if (!canDelete) {
      return showToast("You don't have permission to delete this note.", "error");
    }

    // Confirmation
    if (!window.confirm("Delete this note? This cannot be undone.")) {
      return;
    }

    // Optimistic UI - remove from local state immediately
    setLocalNotes(prev => prev.filter(n => n.id !== noteId));

    // Delete from Supabase
    const { error } = await supabase
      .from('dealer_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      console.error("Failed to delete note:", error);
      showToast("Failed to delete note. Please try again.", "error");
      // Note: We don't restore the note to local state since it's gone from UI
      // User can refresh to see it again if delete failed
    } else {
      showToast("Note deleted successfully.", "success");
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
  // Note: localNotes cleanup not needed - we're navigating away

  showToast(`Dealer "${dealer.name}" deleted.`, "success");
  setDeleteOpen(false);
  setRoute("dealer-search");
};

  /* --------------------------------- UI --------------------------------- */
  const repList = users.filter((u) => u.role === "Rep");

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      <div className="space-y-2">
        <button className="text-blue-700 hover:underline" onClick={() => setRoute("dealer-search")} type="button">
          ← Back to Dealer Search
        </button>
        <div className="w-full">
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

    {/* Right side — stacks on mobile, inline on desktop */}
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">

      {/* Status badge + last visited */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge(dealer.status)}`}>
          {dealer.status}
        </span>
        <span className="text-sm text-slate-600">Last visited: {dealer.lastVisited || "—"}</span>
      </div>

{/* Dealer Database button + Edit/Save/Cancel */}
<div className="grid grid-cols-2 gap-2 w-full md:flex md:w-auto md:items-center">
        
<a href="https://datatportal.vercel.app/dealer-report.html"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium md:py-2"
      >
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16M9 11h6M9 15h6" />
          </svg>
          Dealer Database
          <svg className="w-3 h-3 flex-shrink-0 hidden md:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>

        {!isEditing && repCanAccess && (
          <button
            onClick={() => setIsEditing(true)}
            className={`${brand.primary} text-white px-4 py-2.5 md:py-2 rounded-lg`}
            type="button"
          >
            Edit
          </button>
        )}

        {isEditing && (
          <>
            <button
              onClick={saveAllAndClose}
              className={`${brand.primary} text-white px-4 py-2.5 md:py-2 rounded-lg`}
              type="button"
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
              className="px-4 py-2.5 md:py-2 rounded-lg border border-slate-300 col-span-2 md:col-span-1"
              type="button"
            >
              Cancel
            </button>
          </>
        )}
      </div>
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
    <div className="text-slate-800 font-semibold mb-2">Assigned Rep</div>
    <SelectField
      label="Assigned Rep"
      value={dealer.assignedRepUsername || ""}
      onChange={(v) => changeAssignedRep(v)}
      options={[{ label: "— None —", value: "" }, ...assignableUsers(users.filter((u) => u.role === "Rep" || u.role === "Manager"), dealer.assignedRepUsername).map((r) => ({ label: `${r.name} (${r.username})`, value: r.username }))]}
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
          <button className={`hidden md:inline-flex ${brand.btnSecondary}`} onClick={() => setScratchOpen(true)} type="button">
            Quick Notes
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
          <button 
            className={`${brand.primary} text-white px-4 py-2.5 md:py-2 rounded-lg flex items-center justify-center gap-2 w-full md:w-auto ${isSavingNote ? 'opacity-50 cursor-not-allowed' : ''}`} 
            onClick={addNote} 
            disabled={!repCanAccess || isSavingNote}
            type="button"
          >
            {isSavingNote ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : (
              'Add Note'
            )}
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

        {loadingNotes && <div className="text-sm text-slate-500">Loading notes...</div>}
        {!loadingNotes && paged.length === 0 && <div className="text-sm text-slate-500">No notes{noteSearch.trim() ? " match your search." : " yet."}</div>}

        <div className="space-y-3">
          {paged.map((n) => {
            // If this is a Manager note and the current user is the assigned rep with an open task, show Complete button
            const showComplete =
              n.category === "Manager" &&
              isRep &&
              dealer.assignedRepUsername === session?.username &&
              !!myOpenTaskForDealer;

            // Show delete button if: (1) Manager/Admin can delete any note, (2) Rep can delete their own notes
            const canDeleteNote = isAdminManager || (isRep && n.authorUsername === session?.username);

            return (
              <div key={n.id} className="border rounded-lg p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${noteBadgeLocal(n.category)}`}>{labelNoteLocal(n.category)}</span>
                    <span className="text-xs text-slate-500">
                      by <strong>{n.authorUsername}</strong> • {new Date(n.tsISO).toLocaleString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
                    {showComplete && (
                      <button
                        className="px-3 py-2 sm:px-2 sm:py-1 rounded-lg sm:rounded border border-green-600 text-green-700 hover:bg-green-50 text-xs"
                        onClick={completeMyTask}
                        title="Mark this manager task as completed"
                        type="button"
                      >
                        Complete Task
                      </button>
                    )}
                    {canDeleteNote && (
                      <button
                        className={`px-3 py-2 sm:px-2 sm:py-1 rounded-lg sm:rounded border border-red-600 text-red-700 hover:bg-red-50 text-xs ${showComplete ? "" : "col-span-2 sm:col-span-1"}`}
                        onClick={() => deleteNote(n.id, n.authorUsername)}
                        title="Delete this note"
                        type="button"
                      >
                        Delete
                      </button>
                    )}
                  </div>
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

/* ============================= Rep Reports View ================================
   External report dashboard access for Reps
================================================================================= */

const RepReportsView: React.FC<{
  session: User;
  dealers: Dealer[];
  users: User[];
}> = ({ session, dealers, users }) => {
  const reportUrl = session.reportUrl;
  const hasReport = reportUrl && reportUrl.trim().length > 0;

  // Filter dealers that belong to this rep (explicit assignment OR territory)
  const myDealers = dealers.filter((d) => {
    // Option 1: Explicit assignment
    if (d.assignedRepUsername === session.username) return true;
    
    // Option 2: Territory coverage
    if (session.states.includes(d.state) && (session.regionsByState[d.state]?.includes(d.region) ?? false)) {
      return true;
    }
    
    return false;
  });

  // Export dealers to CSV
  const exportDealers = () => {
    // Sort by most recent visit (same as home screen)
    const sorted = [...myDealers].sort((a, b) => {
      const ta = a.lastVisited ? Date.parse(a.lastVisited) : Infinity;
      const tb = b.lastVisited ? Date.parse(b.lastVisited) : Infinity;
      if (tb !== ta) return tb - ta;
      return a.name.localeCompare(b.name);
    });

    // Create CSV content
    const headers = ['Dealer Name', 'State', 'Region', 'Type', 'Status', 'Last Visited'];
    const rows = sorted.map(d => [
      d.name,
      d.state,
      d.region,
      d.type,
      d.status,
      d.lastVisited || 'Never'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `my-dealers-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg shadow-lg p-4 sm:p-6 text-white">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 sm:w-8 sm:h-8 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">My Reports</h2>
            <p className="text-blue-100 text-xs sm:text-sm">Access your performance dashboards and analytics</p>
          </div>
        </div>
      </div>

      {/* Report Card or Empty State */}
      {hasReport ? (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-4 sm:p-6">
            <div className="border-2 border-blue-100 rounded-lg p-4 sm:p-6 bg-gradient-to-br from-white to-blue-50 hover:shadow-lg transition-shadow">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex items-start gap-3 sm:gap-4 flex-1">
                  <div className="bg-blue-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
                    <svg className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-lg sm:text-xl font-semibold text-slate-800 mb-2">📊 Performance Dashboard</h4>
                    <p className="text-slate-600 text-sm mb-3 sm:mb-4">
                      View your monthly metrics, territory performance, and dealer activity analytics.
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Updated daily</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-stretch sm:items-end gap-2">
                  <a 
                    href={reportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg text-sm sm:text-base"
                  >
                    Open Report
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <p className="text-xs text-slate-500 text-center sm:text-right">Opens in new tab</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-4 sm:p-6">
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 sm:p-8 bg-slate-50 text-center">
              <svg className="w-12 h-12 sm:w-16 sm:h-16 text-slate-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h4 className="text-base sm:text-lg font-semibold text-slate-700 mb-2">No Report Available</h4>
              <p className="text-slate-500 text-sm max-w-md mx-auto px-4">
                Your performance dashboard hasn't been assigned yet. Please contact your manager or admin to set up your report access.
              </p>
              <div className="mt-6">
                <button 
                  className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-sm font-medium cursor-not-allowed" 
                  disabled
                >
                  Report Not Configured
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* List of Dealers Export */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="p-4 sm:p-6">
          <div className="border-2 border-green-100 rounded-lg p-4 sm:p-6 bg-gradient-to-br from-white to-green-50 hover:shadow-lg transition-shadow">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-start gap-3 sm:gap-4 flex-1">
                <div className="bg-green-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
                  <svg className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-lg sm:text-xl font-semibold text-slate-800 mb-2">📋 List of Dealers</h4>
                  <p className="text-slate-600 text-sm mb-3 sm:mb-4">
                    Export a complete list of all dealers in your territory, including last visit dates.
                  </p>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span>{myDealers.length} dealer{myDealers.length !== 1 ? 's' : ''} in your territory</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-stretch sm:items-end gap-2">
                <button
                  onClick={exportDealers}
                  className="inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors shadow-md hover:shadow-lg text-sm sm:text-base"
                >
                  Export to CSV
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </button>
                <p className="text-xs text-slate-500 text-center sm:text-right">Downloads as CSV file</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Net Check Calculator */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="p-4 sm:p-6">
          <div className="border-2 border-purple-100 rounded-lg p-4 sm:p-6 bg-gradient-to-br from-white to-purple-50 hover:shadow-lg transition-shadow">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-start gap-3 sm:gap-4 flex-1">
                <div className="bg-purple-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
                  <svg className="w-6 h-6 sm:w-8 sm:h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-lg sm:text-xl font-semibold text-slate-800 mb-2">🧮 Net Check Calculator</h4>
                  <p className="text-slate-600 text-sm mb-3 sm:mb-4">
                    Calculate dealer net checks, commissions, and payouts with our interactive calculator tool.
                  </p>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    <span>Opens in new window</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-stretch sm:items-end gap-2">
                <a
                  href="https://cgavidia0362.github.io/dealercalculator/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors shadow-md hover:shadow-lg text-sm sm:text-base"
                >
                  Open Calculator
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <p className="text-xs text-slate-500 text-center sm:text-right">Opens in new tab</p>
                </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dealer Database */}
      <div className="bg-white rounded-lg shadow-sm border">
   <div className="p-4 sm:p-6">
     <div className="border-2 border-teal-100 rounded-lg p-4 sm:p-6 bg-gradient-to-br from-white to-teal-50 hover:shadow-lg transition-shadow">
       <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
         <div className="flex items-start gap-3 sm:gap-4 flex-1">
           <div className="bg-teal-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
             <svg className="w-6 h-6 sm:w-8 sm:h-8 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16M9 11h6M9 15h6" />
             </svg>
           </div>
           <div className="flex-1 min-w-0">
           <h4 className="text-lg sm:text-xl font-semibold text-slate-800 mb-2">🗄️ Dealer Database</h4>
             <p className="text-slate-600 text-sm mb-3 sm:mb-4">
               Access the full dealer database for reference, lookup, and research.
             </p>
             <div className="flex items-center gap-2 text-xs text-slate-500">
               <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
               </svg>
               <span>Opens in new tab</span>
             </div>
           </div>
         </div>
         <div className="flex flex-col items-stretch sm:items-end gap-2">
           
         <a href="https://datatportal.vercel.app/dealer-report.html"
             target="_blank"
             rel="noopener noreferrer"
             className="inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors shadow-md hover:shadow-lg text-sm sm:text-base"
           >
             Open Database
             <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
             </svg>
           </a>
           <p className="text-xs text-slate-500 text-center sm:text-right">Opens in new tab</p>
           </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================= PART 3 / 4 ================================
   Reporting view (unchanged logic, kept intact per your request)
=========================================================================== */

const ReportingView: React.FC<{
  dealers: Dealer[];
  users: User[];
  notes: Note[];
  session: { username: string; role: Role } | null;
}> = ({ dealers, users, notes, session }) => {
  const reps = users.filter((u) => u.role === "Rep" && isUserActive(u));
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
      const u = users.find((r) => r.username === d.assignedRepUsername);
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
  // --- Reporting data source: pull Visit notes from Supabase for the last 6 months ---
const [reportNotes, setReportNotes] = useState<Note[]>([]);
const [reportLoading, setReportLoading] = useState(false);
const [reportError, setReportError] = useState<string | null>(null);

useEffect(() => {
  let isCancelled = false;

  (async () => {
    try {
      setReportLoading(true);
      setReportError(null);

      // First day of current month minus 5 months → covers 6 calendar months
      const now = new Date();
      const since = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const sinceISO = since.toISOString();

      // Base query: last 6 months of Visit notes (small projection only)
      let q = supabase
        .from("dealer_notes")
        .select("id,dealer_id,author_username,created_at,category,text", { count: "exact" })
        .eq("category", "Visit")
        .gte("created_at", sinceISO);

      // (Optional) if a specific rep is selected, filter server-side
      if (repFilter !== "ALL" && selectedRep) {
        q = q.eq("author_username", selectedRep.username);
      }

      const { data, error } = await q;
      if (error) throw error;

      if (!isCancelled) {
        const mapped: Note[] =
          (data || []).map((r: any) => ({
            id: r.id,
            dealerId: r.dealer_id,
            authorUsername: r.author_username,
            tsISO: r.created_at,
            category: r.category,
            text: r.text ?? ""
          }));
        setReportNotes(mapped);
      }
    } catch (e: any) {
      if (!isCancelled) setReportError(e.message || String(e));
    } finally {
      if (!isCancelled) setReportLoading(false);
    }
  })();

  return () => { isCancelled = true; };
  // re-fetch if the selected rep changes (admins/managers)
}, [repFilter, selectedRep]);

 // Notes scoped by selected rep (authored)
// Prefer freshly-fetched reportNotes; fall back to existing notes while loading.
const scopedNotes = useMemo(() => {
  const source = reportNotes.length ? reportNotes : notes;
  if (repFilter === "ALL") return source;
  if (!selectedRep) return [];
  return source.filter((n) => n.authorUsername === selectedRep.username);
}, [repFilter, selectedRep, reportNotes, notes]);

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

 // Month-to-month: last 6m (keys must match the reducer below)
const months = useMemo(() => {
  // Oldest -> newest, first of each month
  const arr: { date: Date; label: string; key: string }[] = [];
  const base = new Date();
  // normalize to the first of this month to avoid DST/clock drift issues
  base.setDate(1);
  base.setHours(0, 0, 0, 0);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; // ← key shape we’ll use below
    const label = d.toLocaleString("default", { month: "short" });
    arr.push({ date: d, label, key });
  }
  return arr;
}, []);

// Reduce scoped visit notes into monthly counts keyed exactly like months[].key
const monthlyVisits = useMemo(() => {
  const map: Record<string, number> = {};
  for (const n of scopedNotes) {
    if (n.category !== "Visit") continue;
    const d = new Date(n.tsISO);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map[key] = (map[key] || 0) + 1;
  }
  return map; // key => count
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
          <div className={brand.pageTitle}>Reporting</div>
          <div className={brand.pageSub}>Activity, coverage, and visit cadence</div>
        </div>
        <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
          <div className="w-full md:w-auto">
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
          </div>
          <button
            type="button"
            onClick={() => setDlOpen(true)}
            className="px-3 py-2.5 rounded-lg bg-blue-600 text-white text-sm w-full md:w-auto md:py-2"
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
{/* My Report Dashboard - for Managers/Admins */}
{session && (session.role === "Manager" || session.role === "Admin") && (() => {
  const currentUser = users.find(u => u.username === session.username);
  const hasReport = !!currentUser?.reportUrl;
  
  return (
    <div className="bg-white rounded-lg border p-6 mt-6">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <h3 className="text-lg font-semibold text-slate-800">My Report Dashboard</h3>
      </div>

      {hasReport ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Access your personal analytics and performance dashboard.
          </p>
          <button
            onClick={() => window.open(currentUser.reportUrl, '_blank')}
            className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 font-medium"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open Report Dashboard
          </button>
        </div>
      ) : (
        <div className="text-center py-8">
          <svg className="w-16 h-16 text-slate-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h4 className="text-lg font-semibold text-slate-700 mb-2">No Report Dashboard Configured</h4>
          <p className="text-slate-500 text-sm">Contact your administrator to set up your report dashboard access.</p>
        </div>
      )}
    </div>
  );
})()}

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
          <div className="mb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
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
                className="px-3 py-2.5 md:py-2 rounded-lg bg-slate-700 text-white text-sm w-full md:w-auto"
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="md:hidden space-y-2 max-h-96 overflow-auto">
            {dealerListRows.map((r, idx) => (
              <div key={idx} className="rounded-xl border bg-white p-3">
                <div className="font-medium text-slate-800 break-words">{r.dealer || "—"}</div>
                <div className="text-xs text-slate-500 mt-1">{r.rep || "—"}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {[r.region, r.state].filter(Boolean).join(", ") || "—"}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Last visited: {r.lastVisited ? new Date(r.lastVisited).toLocaleDateString() : "—"}
                </div>
              </div>
            ))}
            {dealerListRows.length === 0 && (
              <div className="px-3 py-3 text-sm text-slate-500">No dealers to display.</div>
            )}
          </div>

          <div className="hidden md:block border rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 bg-slate-50 text-slate-500 text-xs font-medium uppercase tracking-wide">
              <div className="col-span-2 px-3 py-2.5">Region</div>
              <div className="col-span-4 px-3 py-2.5">Dealer</div>
              <div className="col-span-3 px-3 py-2.5">Rep</div>
              <div className="col-span-1 px-3 py-2.5">State</div>
              <div className="col-span-2 px-3 py-2.5">Last Visited</div>
            </div>
            <div className="max-h-96 overflow-auto divide-y">
              {dealerListRows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-12 text-sm hover:bg-slate-50">
                  <div className="col-span-2 px-3 py-2.5">{r.region || "—"}</div>
                  <div className="col-span-4 px-3 py-2.5">{r.dealer || "—"}</div>
                  <div className="col-span-3 px-3 py-2.5">{r.rep || "—"}</div>
                  <div className="col-span-1 px-3 py-2.5">{r.state || "—"}</div>
                  <div className="col-span-2 px-3 py-2.5">
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
/* ---------------------------- User Management ----------------------------- */


function UserManagementView(
  {
    users, setUsers, regions, setRegions, dealers, setDealers, notes, showToast
  }: {
    users: User[];
    setUsers: React.Dispatch<React.SetStateAction<User[]>>;
    regions: RegionsCatalog;
    setRegions: React.Dispatch<React.SetStateAction<RegionsCatalog>>;
    dealers: Dealer[];
    setDealers: React.Dispatch<React.SetStateAction<Dealer[]>>;
    notes: Note[];
    showToast: (m: string, k?: "success" | "error") => void;
  }
) {
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

// ---- Export Everything (ZIP) ----
const [exportingAll, setExportingAll] = useState(false);

async function exportEverythingZip() {
  try {
    setExportingAll(true);
    // get current Supabase access token so the API knows who we are
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) {
      showToast("Please log in again.", "error");
      setExportingAll(false);
      return;
    }

    const resp = await fetch("/api/export-everything", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      let msg = "Export failed.";
      try { const j = await resp.json(); if (j?.error) msg = j.error; } catch {}
      showToast(msg, "error");
      setExportingAll(false);
      return;
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.download = `dealernotes-export_${stamp}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Export ready.", "success");
  } catch (e: any) {
    showToast(e?.message || "Export failed.", "error");
  } finally {
    setExportingAll(false);
  }
}

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
  const emptyUser: User = { id: "", name: "", username: "", email: "", role: "Rep", states: [], regionsByState: {}, phone: "", reportUrl: "" };
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
          name: draft.name,
          report_url: draft.reportUrl || null,
        })
        .eq("id", editingId);        
        if (error) throw error;
      } else {
   // Fallback: update by email and learn their id (tolerant of 0 rows)
const { data, error, status } = await supabase
.from("profiles")
.update({
  username: draft.username,
  email: emailForProfile || null,
  role: draft.role,
  status: chosenStatus,
  name: draft.name,
  report_url: draft.reportUrl || null,
})
.eq("email", emailForProfile)
.select("id")
.maybeSingle();

if (error) {
// If PostgREST hints multiple rows, tell the admin (shouldn’t happen after uniqueness)
showToast(error.message || "Profile update failed (email not unique?)", "error");
} else if (!data) {
// 0 rows updated: likely the invited user hasn’t created a profile yet
// That’s OK. We’ll skip coverage for now; it will be saved after first login.
showToast("User invited. Profile will appear after first login.", "success");
targetUserId = null;
} else {
targetUserId = (data as any)?.id ?? null;
}
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
// Build regions for a state from both the catalog and existing dealers
const getRegionsForState = (s: string): string[] => {
  const st = (s || "").trim().toUpperCase();
  if (!st) return [];
  const fromCatalog = (regions[st] || []);
  const fromDealers = Array.from(
    new Set(
      dealers
        .filter((d) => (d.state || "").toUpperCase() === st && !!d.region)
        .map((d) => d.region!)
    )
  );
  return Array.from(new Set([...fromCatalog, ...fromDealers]))
    .filter(Boolean)
    .sort();
};

  const dealerCountFor = (st: string, rg: string) => dealers.filter((d) => d.state === st && d.region === rg).length;

  const createRegion = async () => {
    const st = stateInput.trim().toUpperCase();
    const rg = regionInput.trim();
    if (!st || !rg) return showToast("State and region are required.", "error");
  
    try {
      // 1) Save to Supabase so it survives refresh/login
      const { error } = await supabase
        .from("regions_catalog")
        .upsert({ state: st, region: rg }, { onConflict: "state,region" });
      if (error) throw error;
  
      // 2) Reflect immediately in UI
      setRegions((prev) => {
        const next = { ...prev };
        if (!next[st]) next[st] = [];
        if (!next[st].includes(rg)) next[st] = [...next[st], rg].sort();
        return next;
      });
  
      setStateInput("");
      setRegionInput("");
      showToast("Region added & saved.", "success");
    } catch (e: any) {
      showToast(e?.message || "Failed to save region.", "error");
    }
  };
// Persisted delete: remove region from Supabase + update UI
const deleteRegion = async (st: string, rg: string) => {
  const count = dealerCountFor(st, rg);
  if (count > 0) {
    return showToast(
      "Cannot delete region while dealers exist there. Move them first.",
      "error"
    );
  }

  try {
    // 1) Delete from Supabase so it survives refresh/login
    const { error } = await supabase
      .from("regions_catalog")
      .delete()
      .eq("state", st)
      .eq("region", rg);
    if (error) throw error;

    // 2) Update UI list of regions
    setRegions((prev) => {
      const next = { ...prev };
      next[st] = (next[st] || []).filter((x) => x !== rg);
      if (!next[st]?.length) delete next[st];
      return next;
    });

    // 3) Also remove from users' coverage so views stay consistent
    setUsers((prev) =>
      prev.map((u) => {
        const copy = { ...u, regionsByState: { ...u.regionsByState } };
        if (copy.regionsByState[st]) {
          copy.regionsByState[st] = copy.regionsByState[st].filter((x) => x !== rg);
        }
        return copy;
      })
    );

    showToast("Region deleted.", "success");
  } catch (e: any) {
    showToast(e?.message || "Failed to delete region.", "error");
  }
};

/* Move dealers between regions (bulk) */
const [fromState, setFromState] = useState("");
const [fromRegion, setFromRegion] = useState("");
const [toState, setToState] = useState("");
const [toRegion, setToRegion] = useState("");

// Click handler for the "Move Dealers" button
const moveDealers = async () => {
  // 0) Guard: make sure all 4 picks are set
  if (!fromState || !fromRegion || !toState || !toRegion) {
    showToast("Please select both From and To state/region", "error");
    return;
  }

  try {
    // 1) Update matching dealers in Supabase
    // NOTE: this updates *all* dealers in the source state+region
    const { data, error } = await supabase
      .from("dealers")
      .update({ state: toState, region: toRegion })
      .eq("state", fromState)
      .eq("region", fromRegion)
      .select("id"); // return the ids we changed

    if (error) throw error;

    const movedIds = (data ?? []).map((r: any) => String(r.id));

    // 2) Mirror the changes in local React state, so the UI reflects immediately
    if (movedIds.length > 0) {
      setDealers(prev =>
        prev.map(d => (movedIds.includes(d.id) ? { ...d, state: toState, region: toRegion } : d))
      );
    }

    // 3) Make sure the destination (toState/toRegion) exists in the Regions catalog
    setRegions(prev => {
      const next = { ...prev };
      if (!next[toState]) next[toState] = [];
      if (!next[toState].includes(toRegion)) next[toState] = [...next[toState], toRegion].sort();
      return next;
    });

    // Optional: if you also want to auto-clean the source region when empty,
    // you could re-query counts here, but it's fine to leave as-is.

    showToast(`Moved ${movedIds.length} dealer(s) to ${toRegion}, ${toState}.`, "success");
  } catch (e: any) {
    showToast(e?.message || "Move failed.", "error");
  }
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
        region: region || "Unknown",
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
      lastVisited: r.last_visited ? String(r.last_visited) : undefined, // keep YYYY-MM-DD
      sendingDeals: typeof r.sending_deals === "boolean" ? r.sending_deals : undefined,
      noDealReasons: r.no_deal_reasons || undefined,
      cifNumber: r.cif_number || undefined,
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
          <button className={`${brand.primary} text-white px-3 py-2.5 rounded-lg w-full md:w-auto md:px-3 md:py-2 md:text-sm`} onClick={openAddUser} type="button">
            Add User
          </button>
        </div>

        <div className="md:hidden space-y-2">
          {users.map((u) => (
            <div key={u.id} className="rounded-xl border bg-white p-3">
              <div className="font-medium text-slate-800 break-words">{u.name?.trim() || u.username}</div>
              <div className="text-xs text-slate-500 mt-0.5">{u.username}</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-slate-600">{u.role}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    getStatus(u) === "Active" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {getStatus(u)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button className="px-3 py-2.5 rounded-lg border text-slate-700 text-sm" onClick={() => openEditUser(u)} type="button">
                  Edit
                </button>
                <button
                  className="px-3 py-2.5 rounded-lg border border-red-600 text-red-700 text-sm"
                  onClick={() => setConfirmRemove(u)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="rounded-xl border bg-white p-6 text-center text-slate-500 text-sm">No users.</div>
          )}
        </div>

        <div className="hidden md:block overflow-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={brand.th}>Name</th>
                <th className={brand.th}>Username</th>
                <th className={brand.th}>Phone</th>
                <th className={brand.th}>Role</th>
                <th className={brand.th}>States</th>
                <th className={brand.th}>Regions by State</th>
                <th className={brand.th}>Status</th>
                <th className={`${brand.th} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t hover:bg-slate-50">
                  <td className={brand.td}>{u.name?.trim() || u.username}</td>
                  <td className={brand.td}>{u.username}</td>
                  <td className={brand.td}>{u.phone || "—"}</td>
                  <td className={brand.td}>{u.role}</td>
                  <td className={brand.td}>{u.states.join(", ") || "—"}</td>
                  <td className={brand.td}>
                    {u.states.length === 0 ? "—" : u.states.map((st) => `${st}: ${(u.regionsByState[st] || []).length}`).join("  •  ")}
                  </td>
                  <td className={brand.td}>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        getStatus(u) === "Active" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {getStatus(u)}
                    </span>
                  </td>
                  <td className={`${brand.td} text-right`}>
                    <button className={`${brand.btnSecondary} mr-2`} onClick={() => openEditUser(u)} type="button">
                      Edit
                    </button>
                    <button
                      className="inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => setConfirmRemove(u)}
                      type="button"
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
              <button className={brand.btnSecondary} onClick={createRegion} type="button">
                Add / Create
              </button>
            </div>

            {/* Mobile: keep button; search moved to Regions card */}
<div className="sm:col-span-2">
  <button
    className="md:hidden w-full px-3 py-2.5 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50"
    onClick={createRegion}
    type="button"
  >
    Add / Create
  </button>
</div>
            </div>

            {/* Move Dealers Between Regions (bulk) */}
<div className="rounded-xl border p-4">
  <div className="font-semibold text-slate-800">Move Dealers Between Regions (bulk)</div>

  <div className="grid grid-cols-2 gap-3 mt-3">
    <SelectField
      label="From State"
      value={fromState}
      onChange={setFromState}
      options={allStates.map((s) => ({ label: s, value: s }))}
    />
    <SelectField
      label="To State"
      value={toState}
      onChange={setToState}
      options={allStates.map((s) => ({ label: s, value: s }))}
    />
    <SelectField
      label="From Region"
      value={fromRegion}
      onChange={(v: any) => setFromRegion(v?.value ?? v ?? "")}
      options={getRegionsForState(fromState).map((r) => ({ label: r, value: r }))}
    />
    <SelectField
      label="To Region"
      value={toRegion}
      onChange={(v: any) => setToRegion(v?.value ?? v ?? "")}
      options={getRegionsForState(toState).map((r) => ({ label: r, value: r }))}
    />
  </div>

  <button
    type="button"
    className="mt-4 w-full md:w-auto px-3 py-2.5 md:py-2 rounded-xl border text-blue-700 border-blue-600 hover:bg-blue-50 disabled:opacity-60"
    onClick={moveDealers}
    disabled={!fromState || !fromRegion || !toState || !toRegion}
  >
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

  <div className="md:hidden space-y-2">
    {regionPageRows.map((r) => (
      <div key={`${r.state}-${r.region}`} className="rounded-xl border bg-white p-3">
        <div className="font-medium text-slate-800 break-words">{r.region}</div>
        <div className="text-xs text-slate-500 mt-0.5">{r.state} · {r.count} dealer{r.count === 1 ? "" : "s"}</div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            className="px-3 py-2.5 rounded-lg border text-slate-700 text-sm"
            onClick={() => setRegionModal({ state: r.state, region: r.region })}
            type="button"
          >
            View
          </button>
          <button
            className="px-3 py-2.5 rounded-lg border border-red-600 text-red-700 text-sm"
            onClick={() => deleteRegion(r.state, r.region)}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>
    ))}
    {regionPageRows.length === 0 && (
      <div className="rounded-xl border bg-white p-6 text-center text-slate-500 text-sm">No regions.</div>
    )}
  </div>

  <div className="hidden md:block overflow-auto rounded-lg border bg-white">
    <table className="w-full text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th className={brand.th}>State</th>
          <th className={brand.th}>Region</th>
          <th className={`${brand.th} text-right`}>Dealers</th>
          <th className={`${brand.th} text-right`}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {regionPageRows.map((r) => (
          <tr
            key={`${r.state}-${r.region}`}
            className="border-t hover:bg-slate-50"
          >
            <td className={brand.td}>{r.state}</td>
            <td className={brand.td}>{r.region}</td>
            <td className={`${brand.td} text-right`}>{r.count}</td>
            <td className={`${brand.td} text-right`}>
              <button
                className={`${brand.btnSecondary} mr-2`}
                onClick={() => setRegionModal({ state: r.state, region: r.region })}
                type="button"
              >
                View
              </button>
              <button
                className="inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-700 hover:bg-red-50"
                onClick={() => deleteRegion(r.state, r.region)}
                type="button"
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

     {/* Export quick actions */}
     <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-2">
     <button
  className="px-3 py-2.5 md:py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50 disabled:opacity-60 w-full md:w-auto"
  onClick={exportEverythingZip}
  disabled={exportingAll}
  type="button"
  title="Download all tables (CSV) inside one .zip"
>
  {exportingAll ? "Exporting…" : "Export Everything"}
</button>
<span className="relative block md:inline-block">
  {/* Hidden file input used by the Import button */}
  <input
    ref={fileInputRef}
    type="file"
    accept=".csv,text/csv"
    className="hidden"
    onChange={(e) => {
      const f = e.target.files?.[0];
      if (f) handleImportDealers(f); // parse -> preview modal
      e.currentTarget.value = "";    // lets you re-select the same file later
    }}
  />
  <button
    className="px-3 py-2.5 md:py-2 rounded-lg border text-blue-700 border-blue-600 hover:bg-blue-50 w-full md:w-auto"
    onClick={() => fileInputRef.current?.click()}
    type="button"
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

          {/* Report Dashboard Configuration — ONLY for Reps when editing */}
          {editingId && (draft.role === "Rep" || draft.role === "Manager" || draft.role === "Admin") && (
            <div className="mt-6 border-t pt-6">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <h4 className="font-semibold text-slate-800">Report Dashboard Configuration</h4>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                Configure external reporting dashboard access for this rep. The URL will be displayed on their Reports tab.
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Report Dashboard URL
                  <span className="text-slate-500 font-normal ml-1">(Reps only)</span>
                </label>
                
                <div className="flex flex-col sm:flex-row gap-2 mb-3">
                  <input 
                    type="url" 
                    placeholder="https://powerbi.com/dashboards/rep-example" 
                    value={draft.reportUrl || ""}
                    onChange={(e) => setDraft((d) => ({ ...d, reportUrl: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      if (draft.reportUrl && draft.reportUrl.trim()) {
                        window.open(draft.reportUrl, '_blank');
                      } else {
                        alert('Please enter a URL first');
                      }
                    }}
                    className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Test Link
                  </button>
                </div>

                <div className="flex items-start gap-2 text-xs text-slate-600 bg-white rounded p-3 border">
                  <svg className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <strong>Note:</strong> This URL will appear on the rep's Reports tab. Make sure it's the correct dashboard link for this user. The link will open in a new browser tab.
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4">
                  <button 
                    type="button"
                    onClick={() => {
                      if (confirm('Are you sure you want to clear this report URL? The rep will no longer have access to their dashboard.')) {
                        setDraft((d) => ({ ...d, reportUrl: "" }));
                      }
                    }}
                    className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm font-medium"
                  >
                    Clear URL
                  </button>
                </div>
              </div>
            </div>
          )}

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
}


/* --------------------------------- App ------------------------------------ */
const App: React.FC = () => {
  const { users, setUsers, dealers, setDealers, regions, setRegions, tasks, setTasks, notes, setNotes } = useData();
  const [route, setRoute] = useState<RouteKey>("login");
  const [session, setSession] = useState<Session>(null);
  const { toasts, showToast, showActionToast, dismiss } = useToasts();

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
        .select('id, username, email, role, status, name, phone, report_url')
.order('username', { ascending: true });

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
          reportUrl: p.report_url || undefined,
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
   // Sync "lastVisited" for each dealer from notes with category Visit/Visited
const syncLastVisitedFromNotes = async () => {
  try {
    // 1) Pull the latest visited timestamp per dealer from Supabase notes
    //    (accepts both "Visit" and "Visited" just in case)
    const { data, error } = await supabase
      .from("dealer_notes")
      .select("dealer_id, category, created_at")
      .in("category", ["Visit", "Visited"])
      .order("created_at", { ascending: false }); // newest first
    if (error) throw error;

    // Build a map dealer_id -> latest ISO date (YYYY-MM-DD)
    const latest: Record<string, string> = {};
    for (const row of data || []) {
      const id = String((row as any).dealer_id);
      const ts = new Date((row as any).created_at).toISOString().slice(0, 10);
      if (!latest[id]) latest[id] = ts; // first seen is newest due to order desc
    }

    // 2) Update local UI dealers immediately
    setDealers((prev) =>
      prev.map((d) => (latest[d.id] ? { ...d, lastVisited: latest[d.id] } : d))
    );

    // 3) Persist back to dealers table so list loads fast next time
    const updates = Object.entries(latest).map(([dealerId, ymd]) => ({
      id: dealerId,
      last_visited: ymd,
    }));
    for (const u of updates) {
      await supabase
        .from("dealers")
        .update({ last_visited: u.last_visited })
        .eq("id", u.id);
    }
  } catch (e) {
    console.debug("syncLastVisitedFromNotes failed", e);
  }
};

    useEffect(() => {
      if (!session) return;
  
      (async () => {
        try {
          let allDealers: any[] = [];
let from = 0;
const batchSize = 1000;
while (true) {
  const { data: batch, error: batchError } = await supabase
    .from("dealers")
    .select("id,name,state,region,type,status,address1,address2,city,zip,contacts,no_deal_reasons,assigned_rep_username,last_visited,sending_deals,cif_number")
    .range(from, from + batchSize - 1);
  if (batchError) throw batchError;
  if (!batch || batch.length === 0) break;
  allDealers = [...allDealers, ...batch];
  if (batch.length < batchSize) break;
  from += batchSize;
}
const data = allDealers;
const error = null;
  
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
            cifNumber: r.cif_number || undefined,
          }));
  
          // Replace local dealers with the shared list
          setDealers(fromDb);
  
          // Rebuild regions from dealers (existing behavior)
const rebuilt: RegionsCatalog = {};
for (const d of fromDb) {
  if (!rebuilt[d.state]) rebuilt[d.state] = [];
  if (!rebuilt[d.state].includes(d.region)) rebuilt[d.state].push(d.region);
}
for (const st of Object.keys(rebuilt)) rebuilt[st].sort();

// NEW: also load curated regions from regions_catalog and MERGE
const { data: cat, error: catErr } = await supabase
  .from("regions_catalog")
  .select("state,region");
if (catErr) throw catErr;

const fromCatalog: RegionsCatalog = {};
for (const row of cat || []) {
  const st = String((row as any).state || "").toUpperCase();
  const rg = String((row as any).region || "");
  if (!st || !rg) continue;
  if (!fromCatalog[st]) fromCatalog[st] = [];
  if (!fromCatalog[st].includes(rg)) fromCatalog[st].push(rg);
}
for (const st of Object.keys(fromCatalog)) fromCatalog[st].sort();

// Merge both so manual entries survive refresh even if no dealers there yet
const merged: RegionsCatalog = {};
const allKeys = new Set([...Object.keys(fromCatalog), ...Object.keys(rebuilt)]);
for (const st of allKeys) {
  merged[st] = Array.from(new Set([...(fromCatalog[st] || []), ...(rebuilt[st] || [])])).sort();
}
setRegions(merged);
await syncLastVisitedFromNotes();
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
                tasks={tasks}
                setTasks={setTasks}
                regions={regions}
                setRoute={setRoute}
                showToast={showToast}
                showActionToast={showActionToast}
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
          {route === "reports" && session && (() => {
  const currentUser = users.find(u => u.username === session.username);
  return currentUser ? <RepReportsView session={currentUser} dealers={dealers} users={users} /> : null;
})()}
           {route === "reporting" && <ReportingView dealers={dealers} users={users} notes={notes} session={session} />}
            
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
            {route === "master-list" && (
  <DealerMasterListView
    dealers={dealers}
    setDealers={setDealers}
    users={users}
    regions={regions}
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
{/* Trouble helper: resend a secure reset email */}
<div className="rounded-lg border p-3 bg-slate-50 text-slate-700">
  <div className="text-xs mb-2">
    Having trouble? We can resend a secure reset link to your email.
  </div>
  <button
    type="button"
    className="px-3 py-1.5 rounded-lg border hover:bg-white"
    onClick={async () => {
      let email = (resetEmail || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        const typed = window.prompt("Type your email to resend the secure reset link:");
        if (!typed) return;
        email = typed.trim().toLowerCase();
      }
      try {
        const redirectTo = `${window.location.origin}/auth/callback?next=/reset`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        showToast("Secure reset email sent.", "success");
      } catch (e: any) {
        showToast(e?.message || "Could not send reset email.", "error");
      }
    }}
  >
    Resend secure reset email
  </button>
</div>
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

const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ title, onClose, children, wide }) => {
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
      <div className="absolute inset-0 flex items-end md:items-center justify-center p-0 md:p-4 min-w-0">
        {/* Panel */}
        <div
          className={`w-full max-w-full bg-white shadow-xl md:rounded-2xl overflow-hidden flex flex-col h-[92vh] min-w-0 ${
            wide ? "md:max-w-6xl md:h-[90vh] md:max-h-[90vh]" : "md:max-w-4xl md:h-auto md:max-h-[90vh]"
          }`}
        >
          {/* Sticky header with close button */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 bg-white z-10">
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

          {/* Scrollable content area (phone-safe). Wide: desktop panes scroll, not the whole page. */}
          <div
            className={`p-4 flex-1 min-h-0 min-w-0 overflow-x-hidden overscroll-contain ${
              wide ? "overflow-y-auto md:overflow-hidden md:flex md:flex-col" : "overflow-y-auto"
            }`}
          >
            {children}
          </div>

          {/* Optional footer shadow on iOS when content stops behind home bar (visual nicety) */}
          <div className="md:hidden pointer-events-none h-3 bg-gradient-to-t from-white to-transparent shrink-0" />
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

type RepRouteViewProps = {
  session: Session;
  users: User[];
  dealers: Dealer[];
  notes: Note[];
  setRoute: (r: RouteKey) => void;
  showToast: (m: string, k?: ToastKind) => void;
};

const RepRouteView: React.FC<RepRouteViewProps> = (props) => {
  const { session, users, dealers, notes, setRoute, showToast } = props;

  // find current profile
  const me = users.find((u) => u.username === session?.username) || null;
  const isRep = session?.role === "Rep";
  const isAdminManager = session?.role === "Admin" || session?.role === "Manager";

  // LS key helper
  const routeKeyForUser = (username?: string | null) => `${LS_REP_ROUTE}_${username || "anon"}`;

  // types
  type RouteStop = { dealerId: string; position: number };
  type RouteByDate = Record<string, RouteStop[]>;
  
  type RoutePreset = {
    id: string;
    rep_username: string;
    name: string;
    dealer_ids: string[];
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
  };

  // state
  const [dateStr, setDateStr] = useState<string>(todayISO());
  const [routeByDate, setRouteByDate] = useState<RouteByDate>({});
  
  // Preset state
  const [presets, setPresets] = useState<RoutePreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<RoutePreset | null>(null);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");

  // load today’s route from Supabase
  useEffect(() => {
    if (!me?.id) return;
    let isCancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("dealer_routes")
        .select("dealer_id, position")
        .eq("user_id", me.id)
        .eq("date", dateStr)
        .order("position", { ascending: true });

      if (error) {
        console.error("load route error:", error);
        return;
      }
      if (isCancelled) return;

      const rows: RouteStop[] = (data ?? []).map((r: any) => ({
        dealerId: r.dealer_id,
        position: r.position ?? 1,
      }));
      setRouteByDate((prev) => ({ ...prev, [dateStr]: rows }));
    })();

    return () => {
      isCancelled = true;
    };
  }, [dateStr, me?.id]);

  // Load presets from Supabase
  useEffect(() => {
    if (!me?.username) return;
    let isCancelled = false;

    (async () => {
      setPresetsLoading(true);
      const { data, error } = await supabase
        .from("route_presets")
        .select("*")
        .eq("rep_username", me.username)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("load presets error:", error);
        setPresetsLoading(false);
        return;
      }
      if (isCancelled) return;

      const mapped: RoutePreset[] = (data || []).map((r: any) => ({
        id: r.id,
        rep_username: r.rep_username,
        name: r.name,
        dealer_ids: r.dealer_ids || [],
        created_at: r.created_at,
        updated_at: r.updated_at,
        last_used_at: r.last_used_at,
      }));
      setPresets(mapped);
      setPresetsLoading(false);
    })();

    return () => {
      isCancelled = true;
    };
  }, [me?.username]);

    // which dealers can this user see?
    const accessibleDealers = useMemo(() => {
      if (isAdminManager) return dealers; // Admins/Managers see all dealers, same as rest of the app
      if (!me) return [] as Dealer[];
      const can = (d: Dealer) => {
        const assigned = d.assignedRepUsername === me.username;
        const coversState = !!me.states?.includes?.(d.state);
        const coversRegion = !!me.regionsByState?.[d.state]?.includes?.(d.region);
        return assigned || (coversState && coversRegion);
      };
      return dealers.filter(can);
    }, [dealers, me, isAdminManager]);

  // filters
  const unique = (arr: (string | undefined)[]) =>
    Array.from(new Set(arr.filter(Boolean) as string[])).sort();

  const states = useMemo(() => unique(accessibleDealers.map((d) => d.state)), [accessibleDealers]);
  const regions = useMemo(() => unique(accessibleDealers.map((d) => d.region)), [accessibleDealers]);
  const cities = useMemo(() => unique(accessibleDealers.map((d) => d.city)), [accessibleDealers]);

  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [openSug, setOpenSug] = useState(false);
  // current route (for selected date)
  const route: RouteStop[] = routeByDate[dateStr] || [];
  const routeIds = new Set(route.map((r) => r.dealerId));

  // filtered search results
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return accessibleDealers.filter((d) => {
      if (state && d.state !== state) return false;
      if (region && d.region !== region) return false;
      if (city && d.city !== city) return false;
      if (qq.length < 2) return false;
      const hay = `${d.name} ${d.city} ${d.region}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [accessibleDealers, q, state, region, city]);
  const mobileSuggestions = useMemo(() => filtered.slice(0, 8), [filtered]);

  // helpers
  const saveLS = (k: string, v: any) => localStorage.setItem(k, JSON.stringify(v));
  const loadLS = <T,>(k: string, fallback: T): T => {
    try {
      const s = localStorage.getItem(k);
      return s ? (JSON.parse(s) as T) : fallback;
    } catch {
      return fallback;
    }
  };

  // persist route map per-user
  useEffect(() => {
    saveLS(routeKeyForUser(session?.username), routeByDate);
  }, [routeByDate, session?.username]);

  // Bulk-add all currently filtered/searched dealers
  const addAllFiltered = async () => {
    const toAdd = filtered.filter((d) => !routeIds.has(d.id));
    for (const d of toAdd) {
      await addDealer(d);
    }
    showToast(`Added ${toAdd.length} dealer(s) to route.`, "success");
  };

  // add dealer to today’s route (local + supabase)
  const addDealer = async (d: Dealer) => {
    setRouteByDate((prev) => {
      const current = prev[dateStr] || [];
      if (current.some((r) => r.dealerId === d.id)) return prev;
      const nextPos = current.length ? Math.max(...current.map((r) => r.position || 0)) + 1 : 1;
      const next = [...current, { dealerId: d.id, position: nextPos }];
      return { ...prev, [dateStr]: next };
    });

    // upsert (ignore conflict via UNIQUE)
    const { error } = await supabase
      .from("dealer_routes")
      .upsert(
        {
          user_id: me!.id,
          dealer_id: d.id,
          date: dateStr,
          position: (routeByDate[dateStr]?.length || 0) + 1,
        },
        { onConflict: "user_id,date,dealer_id" }
      );

    if (error) {
      console.error("add route upsert error:", error);
      showToast("Saved locally, but sync failed. Try again.", "error");
      return;
    }

    showToast("Added to route.", "success");
  };

  // remove dealer
  const removeDealer = async (dealerId: string) => {
    setRouteByDate((prev) => {
      const next = (prev[dateStr] || []).filter((r) => r.dealerId !== dealerId);
      return { ...prev, [dateStr]: next };
    });

    const { error } = await supabase
      .from("dealer_routes")
      .delete()
      .eq("user_id", me!.id)
      .eq("date", dateStr)
      .eq("dealer_id", dealerId);

    if (error) {
      console.error("remove route error:", error);
      showToast("Removed locally, but sync failed.", "error");
      return;
    }
    showToast("Removed from route.", "success");
  };

  // move up/down
  const move = async (dealerId: string, dir: "up" | "down") => {
    setRouteByDate((prev) => {
      const curr = [...(prev[dateStr] || [])];
      const i = curr.findIndex((r) => r.dealerId === dealerId);
      if (i < 0) return prev;
      const j = dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= curr.length) return prev;
      [curr[i], curr[j]] = [curr[j], curr[i]];
      // re-number positions 1..N
      const renum = curr.map((r, idx) => ({ dealerId: r.dealerId, position: idx + 1 }));
      return { ...prev, [dateStr]: renum };
    });

    // best-effort position sync
    const curr = routeByDate[dateStr] || [];
    const idx = curr.findIndex((r) => r.dealerId === dealerId);
    const targetIndex = dir === "up" ? idx - 1 : idx + 1;
    const pair = [curr[idx]?.dealerId, curr[targetIndex]?.dealerId].filter(Boolean) as string[];
    for (let k = 0; k < pair.length; k++) {
      const id = pair[k];
      // new position equals its new index + 1 after swap
      const newPos = dir === "up" ? (id === dealerId ? idx : targetIndex) : (id === dealerId ? idx + 2 : idx + 1);
      await supabase
        .from("dealer_routes")
        .update({ position: newPos })
        .eq("user_id", me!.id)
        .eq("date", dateStr)
        .eq("dealer_id", id);
    }
  };

  // clear the whole day
  const clearDay = async () => {
    const current = routeByDate[dateStr] || [];
    if (!current.length) return;
    if (!confirm("Clear all stops for this day?")) return;

    setRouteByDate((prev) => ({ ...prev, [dateStr]: [] }));

    const { error } = await supabase
      .from("dealer_routes")
      .delete()
      .eq("user_id", me!.id)
      .eq("date", dateStr);

    if (error) {
      console.error("clear day error:", error);
      showToast("Cleared locally, but sync failed.", "error");
      return;
    }
  };

  // === PRESET FUNCTIONS ===
  
  // Save current route as a new preset
  const savePreset = async () => {
    if (!presetName.trim()) {
      showToast("Please enter a preset name", "error");
      return;
    }
    
    const currentRoute = routeByDate[dateStr] || [];
    if (currentRoute.length === 0) {
      showToast("Add some dealers to your route first", "error");
      return;
    }

    const dealerIds = currentRoute
      .sort((a, b) => a.position - b.position)
      .map(r => r.dealerId);

    const { data, error } = await supabase
      .from("route_presets")
      .insert({
        rep_username: me!.username,
        name: presetName.trim(),
        dealer_ids: dealerIds,
      })
      .select()
      .single();

    if (error) {
      console.error("save preset error:", error);
      showToast(error.message.includes("unique") ? "A preset with that name already exists" : "Failed to save preset", "error");
      return;
    }

    const newPreset: RoutePreset = {
      id: data.id,
      rep_username: data.rep_username,
      name: data.name,
      dealer_ids: data.dealer_ids,
      created_at: data.created_at,
      updated_at: data.updated_at,
      last_used_at: data.last_used_at,
    };

    setPresets(prev => [newPreset, ...prev]);
    showToast(`Preset "${presetName}" saved!`, "success");
    setSaveModalOpen(false);
    setPresetName("");
  };

  // Load a preset into current route (adds to end)
  const loadPresetIntoRoute = async (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    // Add dealers to end of current route
    const currentRoute = routeByDate[dateStr] || [];
    const maxPosition = currentRoute.length > 0 
      ? Math.max(...currentRoute.map(r => r.position))
      : 0;

    const newStops: RouteStop[] = preset.dealer_ids.map((dealerId, index) => ({
      dealerId,
      position: maxPosition + index + 1,
    }));

    // Update local state
    setRouteByDate(prev => ({
      ...prev,
      [dateStr]: [...currentRoute, ...newStops],
    }));

    // Save to Supabase
    const inserts = newStops.map(stop => ({
      user_id: me!.id,
      date: dateStr,
      dealer_id: stop.dealerId,
      position: stop.position,
    }));

    const { error } = await supabase
      .from("dealer_routes")
      .upsert(inserts, { onConflict: "user_id,date,dealer_id" });

    if (error) {
      console.error("load preset error:", error);
      showToast("Failed to load preset", "error");
      return;
    }

    // Update last_used_at
    await supabase
      .from("route_presets")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", presetId);

    showToast(`Preset "${preset.name}" loaded! ${newStops.length} dealers added.`, "success");
    setLoadModalOpen(false);
    setSelectedPresetId("");
  };

  // Update an existing preset
  const updatePreset = async (presetId: string, updates: { name?: string; dealer_ids?: string[] }) => {
    const { error } = await supabase
      .from("route_presets")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", presetId);

    if (error) {
      console.error("update preset error:", error);
      showToast("Failed to update preset", "error");
      return;
    }

    setPresets(prev => prev.map(p => p.id === presetId ? { ...p, ...updates, updated_at: new Date().toISOString() } : p));
    showToast("Preset updated!", "success");
  };

  // Delete a preset
  const deletePreset = async (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    if (!confirm(`Delete preset "${preset.name}"?`)) return;

    const { error } = await supabase
      .from("route_presets")
      .delete()
      .eq("id", presetId);

    if (error) {
      console.error("delete preset error:", error);
      showToast("Failed to delete preset", "error");
      return;
    }

    setPresets(prev => prev.filter(p => p.id !== presetId));
    showToast(`Preset "${preset.name}" deleted`, "success");
  };

  // Duplicate a preset
  const duplicatePreset = async (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    const newName = `${preset.name} (Copy)`;

    const { data, error } = await supabase
      .from("route_presets")
      .insert({
        rep_username: me!.username,
        name: newName,
        dealer_ids: preset.dealer_ids,
      })
      .select()
      .single();

    if (error) {
      console.error("duplicate preset error:", error);
      showToast("Failed to duplicate preset", "error");
      return;
    }

    const newPreset: RoutePreset = {
      id: data.id,
      rep_username: data.rep_username,
      name: data.name,
      dealer_ids: data.dealer_ids,
      created_at: data.created_at,
      updated_at: data.updated_at,
      last_used_at: data.last_used_at,
    };

    setPresets(prev => [newPreset, ...prev]);
    showToast(`Preset duplicated as "${newName}"`, "success");
  };

  // export + copy helpers (addresses only)
  const exportCSV = () => {
    const sorted = [...(routeByDate[dateStr] || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const rows: (string | number)[][] = [["Dealer", "Address1", "Address2", "City", "State", "Zip", "Region"]];
    for (const r of sorted) {
      const d = dealers.find((x) => x.id === r.dealerId);
      rows.push([
        d?.name || "",
        d?.address1 || "",
        d?.address2 || "",
        d?.city || "",
        d?.state || "",
        d?.zip || "",
        d?.region || "",
      ]);
    }
    const csv = rows.map((row) => row.map((v) => `${String(v).replace(/"/g, '""')}`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rep-route-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const copyAll = async () => {
    const sorted = [...(routeByDate[dateStr] || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const lines = sorted
      .map((r) => {
        const d = dealers.find((x) => x.id === r.dealerId);
        return [d?.name, d?.address1, d?.address2, d?.city, d?.state, d?.zip]
        .filter(Boolean)
        .join(", ");
      })
      .join("\n");
    await navigator.clipboard.writeText(lines);
    showToast("Route (name + address) copied.", "success");
  };

  // navigation to a dealer’s notes page
  // Build a Google Maps URL for a dealer address
  const mapUrl = (d: Dealer) => {
    const q = [d.name, d.address1, d.address2, d.city, d.state, d.zip]
      .filter(Boolean)
      .join(", ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  };
  
  // Build a single multi-stop Google Maps directions link for the whole route
  const allStopsMapUrl = () => {
    const sorted = [...(routeByDate[dateStr] || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const addresses = sorted
      .map((r) => {
        const d = dealers.find((x) => x.id === r.dealerId);
        if (!d) return null;
        return [d.address1, d.city, d.state, d.zip].filter(Boolean).join(", ");
      })
      .filter(Boolean) as string[];
    if (addresses.length === 0) return "#";
    return `https://www.google.com/maps/dir/${addresses.map((a) => encodeURIComponent(a)).join("/")}`;
  };

  const viewDealer = (dealerId: string) => {
    saveLS(LS_LAST_SELECTED_DEALER, dealerId);
    setRoute("dealer-notes");
  };

  // action button class (mobile-friendly)
  const actionBtn = "px-3 py-2.5 md:px-3 md:py-2 rounded-lg border text-sm md:text-base text-center";

  // --- render ---
  const sortedRoute = [...route].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Drag-and-drop reordering
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const reorderByDrag = async (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex) return;
    const curr = [...sortedRoute];
    const [moved] = curr.splice(dragIndex, 1);
    curr.splice(dropIndex, 0, moved);
    const renum = curr.map((r, idx) => ({ dealerId: r.dealerId, position: idx + 1 }));
    setRouteByDate((prev) => ({ ...prev, [dateStr]: renum }));
    setDragIndex(null);
    // Sync new positions to Supabase
    for (const r of renum) {
      await supabase
        .from("dealer_routes")
        .update({ position: r.position })
        .eq("user_id", me!.id)
        .eq("date", dateStr)
        .eq("dealer_id", r.dealerId);
    }
  };

  // Daily Summary modal state
  const [dailyOpen, setDailyOpen] = useState(false);

  // Precompute daily notes for this rep + date
  const todaysDealerIds = new Set(sortedRoute.map((r) => r.dealerId));
  // Summary range (like Home): today / yesterday / last 7 days (relative to dateStr)
const [summaryRange, setSummaryRange] = useState<"today" | "yesterday" | "7">("today");

// Compute start/end labels (string-based so we can compare with YYYY-MM-DD)
const { startStr, endStr, rangeLabel } = useMemo(() => {
  const addDaysStr = (isoDate: string, delta: number) => {
    const d = new Date(`${isoDate}T00:00:00`);
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  };

  if (summaryRange === "yesterday") {
    const y = addDaysStr(dateStr, -1);
    return { startStr: y, endStr: y, rangeLabel: y };
  }

  if (summaryRange === "7") {
    const start = addDaysStr(dateStr, -6); // inclusive 7 days, end = dateStr
    return { startStr: start, endStr: dateStr, rangeLabel: `${start} – ${dateStr}` };
  }

  // today
  return { startStr: dateStr, endStr: dateStr, rangeLabel: dateStr };
}, [dateStr, summaryRange]);

  const todaysNotes = useMemo(
    () =>
      notes.filter((n) => {
        const d = dealers.find((x) => x.id === n.dealerId);
        if (!d) return false;
        if (!todaysDealerIds.has(n.dealerId)) return false;
// in selected range (string compare works for YYYY-MM-DD)
const day = (n.tsISO || "").slice(0, 10);
return day >= startStr && day <= endStr;
      }),
    [notes, dealers, sortedRoute, dateStr]
  );
// Copy today's notes (same behavior as Home)
const copyDailySummary = async () => {
  const lines = todaysNotes
    .map(n => {
      const d = dealers.find(x => x.id === n.dealerId);
      const when = (n.tsISO || "").slice(11, 16); // HH:MM
      return `• ${d?.name ?? "Unknown"} (${d?.region ?? ""}, ${d?.state ?? ""}) — ${n.category} by ${n.authorUsername}${when ? ` at ${when}` : ""}\n  ${n.text}`;
    })
    .join("\n\n");

  await navigator.clipboard.writeText(lines || `No notes for ${dateStr}.`);
  showToast("Summary copied.", "success");
};

// Export today's notes to CSV (same behavior as Home)
const exportDailySummaryCSV = () => {
  const rows: (string | number)[][] = [
    ["Date","Dealer","Region","State","Category","Author","Note"]
  ];
  for (const n of todaysNotes) {
    const d = dealers.find(x => x.id === n.dealerId);
    rows.push([
      dateStr,
      d?.name || "",
      d?.region || "",
      d?.state || "",
      n.category || "",
      n.authorUsername || "",
      (n.text || "").replace(/\n/g, " ")
    ]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `daily-summary-${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Dealer Notes</div>
          <h1 className="text-2xl md:text-xl font-bold md:font-semibold text-slate-800">Rep Route</h1>
        </div>

        {/* Mobile toolbar */}
        <div className="md:hidden space-y-2">
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="w-full min-w-0 border rounded-lg px-3 py-2.5"
            title="Pick a day"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDailyOpen(true)}
              className="px-3 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
              type="button"
            >
              Daily Summary
            </button>
            <a
              href={allStopsMapUrl()}
              target="_blank"
              rel="noreferrer"
              className={`px-3 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium text-center ${
                sortedRoute.length === 0 ? "opacity-40 pointer-events-none" : ""
              }`}
            >
              Open in Maps
            </a>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="px-3 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium"
              onClick={() => {
                setSaveModalOpen(true);
                setPresetName("");
              }}
              type="button"
            >
              Save Preset
            </button>
            <button
              className="px-3 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium"
              onClick={() => {
                setLoadModalOpen(true);
                setSelectedPresetId("");
              }}
              type="button"
            >
              Load Preset
            </button>
            <button
              className="px-3 py-2.5 rounded-lg bg-slate-700 text-white text-sm font-medium"
              onClick={() => setManageModalOpen(true)}
              type="button"
            >
              Manage
            </button>
            <button className="px-3 py-2.5 rounded-lg border text-sm font-medium" onClick={clearDay} type="button">
              Clear Day
            </button>
            <button className="px-3 py-2.5 rounded-lg border text-sm font-medium" onClick={exportCSV} type="button">
              Export CSV
            </button>
            <button className="px-3 py-2.5 rounded-lg border text-sm font-medium" onClick={copyAll} type="button">
              Copy All
            </button>
          </div>
        </div>

        {/* Desktop toolbar */}
        <div className="hidden md:block space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Date</label>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm"
                title="Pick a day"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDailyOpen(true)}
                className={brand.btnAccent}
                title="Show notes summary"
                type="button"
              >
                Daily Summary
              </button>
              <a
                href={allStopsMapUrl()}
                target="_blank"
                rel="noreferrer"
                className={`${brand.btnPrimary} ${sortedRoute.length === 0 ? "opacity-40 pointer-events-none" : ""}`}
              >
                Open in Maps
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={brand.btnSecondary}
              onClick={() => {
                setSaveModalOpen(true);
                setPresetName("");
              }}
              title="Save current route as preset"
              type="button"
            >
              Save Preset
            </button>
            <button
              className={brand.btnSecondary}
              onClick={() => {
                setLoadModalOpen(true);
                setSelectedPresetId("");
              }}
              title="Load a saved preset"
              type="button"
            >
              Load Preset
            </button>
            <button
              className={brand.btnSecondary}
              onClick={() => setManageModalOpen(true)}
              title="Manage presets"
              type="button"
            >
              Manage
            </button>
            <button className={brand.btnGhost} onClick={clearDay} type="button">
              Clear Day
            </button>
            <button className={brand.btnGhost} onClick={exportCSV} type="button">
              Export CSV
            </button>
            <button className={brand.btnGhost} onClick={copyAll} type="button">
              Copy All
            </button>
          </div>
        </div>
      </div>

    {/* Search & Filters */}
<div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
<div className="flex flex-col md:flex-row md:items-center md:justify-between mb-3 gap-2">
    <h2 className="text-lg font-semibold">Find your dealers</h2>
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <span className="text-sm text-slate-500">
        {q.trim().length < 2 ? "Type at least 2 letters" : `Results: ${filtered.length}`}
      </span>
      {filtered.length > 0 && (
        <button
          className="text-sm px-3 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 w-full sm:w-auto md:py-2"
          onClick={addAllFiltered}
          type="button"
        >
          Add all {filtered.length} to route
        </button>
      )}
    </div>
  </div>

  <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
    <div className="relative md:col-span-1">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpenSug(true); }}
        onFocus={() => setOpenSug(true)}
        onBlur={() => setTimeout(() => setOpenSug(false), 150)}
        placeholder="Search dealers (name, city, region)…"
        className="w-full min-w-0 border rounded-lg px-3 py-2.5 md:py-2"
      />
      {openSug && q.trim().length >= 2 && mobileSuggestions.length > 0 && (
        <div className="md:hidden absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-auto bg-white border rounded-lg shadow">
          {mobileSuggestions.map((d) => (
            <button
              key={d.id}
              className="w-full text-left px-3 py-2.5 hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { addDealer(d); setOpenSug(false); }}
              type="button"
            >
              <div className="font-medium">{d.name}</div>
              <div className="text-xs text-slate-500">
                {[d.city, d.state].filter(Boolean).join(", ")}
                {d.region ? ` · ${d.region}` : ""}
              </div>
              {d.lastVisited && (
                <div className="text-[11px] text-slate-400">Last Visited: {d.lastVisited}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>

    <select
      className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm md:rounded-full md:py-1.5 md:w-auto"
      value={state}
      onChange={(e) => setState(e.target.value)}
    >
      <option value="">All States</option>
      {states.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>

    <select
      className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm md:rounded-full md:py-1.5 md:w-auto"
      value={region}
      onChange={(e) => setRegion(e.target.value)}
    >
      <option value="">All Regions</option>
      {regions.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>

    <select
      className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm md:rounded-full md:py-1.5 md:w-auto"
      value={city}
      onChange={(e) => setCity(e.target.value)}
    >
      <option value="">All Cities</option>
      {cities.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  </div>

  {/* empty state */}
  {filtered.length === 0 && (
    <div className="p-6 text-center text-slate-500">
      {q.trim().length < 2
        ? "Start typing to search (min 2 letters)."
        : "No results. Try different filters."}
    </div>
  )}

  {/* Search Results */}
  <div className="space-y-2">
    {filtered.map((d) => {
      const inRoute = routeIds.has(d.id);
      return (
        <div key={d.id} className="flex items-start justify-between gap-3 bg-white rounded-xl border p-3 min-w-0">
          <div className="min-w-0">
            <div className="font-semibold break-words">{d.name}</div>
            <div className="text-sm text-slate-600 break-words">
              {[d.address1, d.address2, d.city, d.state, d.zip].filter(Boolean).join(", ")}
            </div>
            <div className="text-xs text-slate-500">{d.region}</div>
            <div className="text-xs text-slate-500">Last Visited: {d.lastVisited || "—"}</div>
          </div>
          <button className={`${actionBtn} shrink-0`} disabled={inRoute} onClick={() => addDealer(d)} type="button">
            {inRoute ? "Added" : "Add"}
          </button>
        </div>
      );
    })}
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
{sortedRoute.map((r, idx) => {
              const d = dealers.find((x) => x.id === r.dealerId);
              return (
                <div
                  key={r.dealerId}
                  draggable
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => reorderByDrag(idx)}
                  onDragEnd={() => setDragIndex(null)}
                  className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3 cursor-move ${dragIndex === idx ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-slate-400 select-none mt-1" title="Drag to reorder">⠿</span>
                    <div>
                      <div className="font-semibold">{idx + 1}. {d?.name || "(dealer removed)"}</div>
                      <div className="text-sm text-slate-600">
                        {[d?.address1, d?.address2, d?.city, d?.state, d?.zip].filter(Boolean).join(", ")}
                      </div>
                      <div className="text-xs text-slate-500">{d?.region || ""}</div>
                      <div className="text-xs text-slate-500">Last Visited: {d?.lastVisited || "—"}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 w-full md:flex md:flex-wrap md:w-auto md:ml-auto md:justify-end">
                    <button className={`${actionBtn} md:hidden`} onClick={() => move(r.dealerId, "up")} disabled={idx === 0} type="button">Up</button>
                    <button className={`${actionBtn} md:hidden`} onClick={() => move(r.dealerId, "down")} disabled={idx === sortedRoute.length - 1} type="button">Down</button>
                    <a
                    href={d ? mapUrl(d) : "#"}
                      target="_blank"
                      rel="noreferrer"
                      className={`${actionBtn} text-center`}
                    >
                      Maps
                    </a>
                    <button className={actionBtn} onClick={() => viewDealer(r.dealerId)} type="button">View</button>
                    <button className={`${actionBtn} col-span-2 md:col-span-1`} onClick={() => removeDealer(r.dealerId)} type="button">Remove</button>
                  </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Daily Summary modal */}
      {dailyOpen && (
        <Modal title="Daily Summary" onClose={() => setDailyOpen(false)}>
          <div className="space-y-4">
            {/* Bar: date + actions (Copy / Export) */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-sm text-slate-600">
                  Showing notes for <span className="font-semibold">{rangeLabel}</span>
                </div>
      
                {/* Range selector (same behavior as Home) */}
                <select
                  className="border rounded-lg px-2 py-1 text-sm"
                  value={summaryRange}
                  onChange={(e) => setSummaryRange(e.target.value as "today" | "yesterday" | "7")}
                  title="Choose range"
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="7">Last 7 days</option>
                </select>
              </div>
      
              <div className="flex items-center gap-2">
                <button className="px-3 py-2 rounded-lg border" onClick={copyDailySummary}>
                  Copy
                </button>
                <button className="px-3 py-2 rounded-lg border" onClick={exportDailySummaryCSV}>
                  Export CSV
                </button>
              </div>
            </div>
      
            {/* Notes list */}
            <div className="divide-y">
              {todaysNotes.length === 0 && (
                <div className="p-4 text-center text-slate-500">No notes for today.</div>
              )}
      
              {todaysNotes.map((n) => {
                const d = dealers.find((x) => x.id === n.dealerId);
                const dealerDisplay = d ? d.name : "(dealer removed)";
                const regionDisplay = d ? `${d.region}, ${d.state}` : "";
                
                return (
                  <div key={`${n.dealerId}-${n.tsISO}`} className="py-3">
                    <div className="font-semibold">{dealerDisplay}</div>
                    {regionDisplay && <div className="text-xs text-slate-500 mb-1">{regionDisplay}</div>}
                    <div className="inline-block text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 mb-1">
                      {n.category}
                    </div>
                    <div className="text-[11px] text-slate-500 mb-1">
                      by {n.authorUsername} {(n.tsISO || "").slice(11, 16)}
                    </div>
                    <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.text}</div>
                  </div>
                );
              })}
            </div>
      
       {/* Close */}
       <div className="mt-4 flex items-center justify-end">
        <button
          className={`${brand.primary} text-white px-4 py-2 rounded-lg`}
          onClick={() => setDailyOpen(false)}
        >
          Close
        </button>
      </div>
    </div> {/* end modal inner container */}
    </Modal>
      )}

      {/* === PRESET MODALS === */}
      
      {/* Save Preset Modal */}
      {saveModalOpen && (
        <Modal title="Save Route as Preset" onClose={() => {
          setSaveModalOpen(false);
          setPresetName("");
        }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Preset Name</label>
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="e.g., Monday North Loop"
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                onKeyPress={(e) => e.key === "Enter" && savePreset()}
              />
            </div>
            <div className="bg-slate-50 border rounded-lg p-3">
              <div className="text-sm text-slate-700 mb-2">This preset will include:</div>
              <ul className="text-sm text-slate-600 space-y-1">
                <li>• {sortedRoute.length} dealers in current order</li>
                {sortedRoute.slice(0, 3).map((r, idx) => {
                  const d = dealers.find(x => x.id === r.dealerId);
                  return <li key={r.dealerId}>• {d?.name || "Unknown"}</li>;
                })}
                {sortedRoute.length > 3 && <li>• ... and {sortedRoute.length - 3} more</li>}
              </ul>
            </div>
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={() => {
                setSaveModalOpen(false);
                setPresetName("");
              }}
              className="px-4 py-2 border rounded-lg text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={savePreset}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Save Preset
            </button>
          </div>
        </Modal>
      )}

      {/* Load Preset Modal */}
      {loadModalOpen && (
        <Modal title="Load Route Preset" onClose={() => {
          setLoadModalOpen(false);
          setSelectedPresetId("");
        }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Choose a Preset</label>
              <select
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a preset...</option>
                {presets.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.dealer_ids.length} dealers)
                  </option>
                ))}
              </select>
            </div>

            {selectedPresetId && (() => {
              const preset = presets.find(p => p.id === selectedPresetId);
              if (!preset) return null;
              
              return (
                <div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="flex-1">
                        <div className="font-medium text-slate-800 mb-1">Preview: {preset.name}</div>
                        <div className="text-sm text-slate-600 mb-3">
                          These {preset.dealer_ids.length} dealers will be added to the end of your current route:
                        </div>
                        <ol className="text-sm text-slate-700 space-y-1 list-decimal list-inside">
                          {preset.dealer_ids.slice(0, 5).map(dealerId => {
                            const d = dealers.find(x => x.id === dealerId);
                            return <li key={dealerId}>{d?.name || "Unknown Dealer"}</li>;
                          })}
                          {preset.dealer_ids.length > 5 && (
                            <li>... and {preset.dealer_ids.length - 5} more</li>
                          )}
                        </ol>
                      </div>
                    </div>
                  </div>

                  {sortedRoute.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-3">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div className="flex-1 text-sm">
                          <div className="font-medium text-slate-800 mb-1">
                            You currently have {sortedRoute.length} dealer{sortedRoute.length !== 1 ? 's' : ''} in your route
                          </div>
                          <div className="text-slate-600">
                            Loading this preset will add {preset.dealer_ids.length} more, giving you a total of {sortedRoute.length + preset.dealer_ids.length} dealers.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={() => {
                setLoadModalOpen(false);
                setSelectedPresetId("");
              }}
              className="px-4 py-2 border rounded-lg text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={() => loadPresetIntoRoute(selectedPresetId)}
              disabled={!selectedPresetId}
              className={`px-4 py-2 rounded-lg font-medium ${
                selectedPresetId
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
            >
              Load Preset
            </button>
          </div>
        </Modal>
      )}

      {/* Manage Presets Modal */}
      {manageModalOpen && (
        <Modal 
          title={`Manage Route Presets${editingPreset ? ` - Editing: ${editingPreset.name}` : ""}`}
          onClose={() => {
            setManageModalOpen(false);
            setEditingPreset(null);
          }}
        >
          {!editingPreset ? (
            /* List View */
            <div className="space-y-4">
              <div className="text-sm text-slate-600">
                View, edit, duplicate, or delete your saved route presets
              </div>

              {presetsLoading ? (
                <div className="text-center py-8 text-slate-500">Loading presets...</div>
              ) : presets.length === 0 ? (
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <svg className="w-16 h-16 text-slate-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <h4 className="text-lg font-semibold text-slate-700 mb-2">No Presets Yet</h4>
                  <p className="text-slate-500 text-sm">Build a route and click "Save Preset" to get started</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {presets.map(preset => (
                    <div key={preset.id} className="border rounded-lg p-4 hover:bg-slate-50">
                      <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <h4 className="font-semibold text-slate-800">{preset.name}</h4>
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                              {preset.dealer_ids.length} dealers
                            </span>
                          </div>
                          <div className="text-sm text-slate-500 mt-1">
                            Created: {new Date(preset.created_at).toLocaleDateString()}
                            {preset.last_used_at && ` • Last used: ${new Date(preset.last_used_at).toLocaleDateString()}`}
                          </div>
                          <div className="text-xs text-slate-400 mt-2">
                            {preset.dealer_ids.slice(0, 3).map(dealerId => {
                              const d = dealers.find(x => x.id === dealerId);
                              return d?.name;
                            }).filter(Boolean).join(" → ")}
                            {preset.dealer_ids.length > 3 && ` → ... (+${preset.dealer_ids.length - 3} more)`}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setEditingPreset(preset)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => duplicatePreset(preset.id)}
                            className="p-2 text-green-600 hover:bg-green-50 rounded"
                            title="Duplicate"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              loadPresetIntoRoute(preset.id);
                              setManageModalOpen(false);
                            }}
                            className="px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => deletePreset(preset.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded"
                            title="Delete"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Edit View */
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Preset Name</label>
                <input
                  type="text"
                  value={editingPreset.name}
                  onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-slate-700">
                    Dealers in this Preset ({editingPreset.dealer_ids.length})
                  </label>
                </div>

                <div className="space-y-2 max-h-80 overflow-y-auto border rounded-lg p-3">
                  {editingPreset.dealer_ids.map((dealerId, index) => {
                    const d = dealers.find(x => x.id === dealerId);
                    return (
                      <div key={dealerId} className="flex items-center gap-3 p-3 border rounded hover:bg-slate-50">
                        <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold text-sm">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-800 text-sm">{d?.name || "Unknown"}</div>
                          <div className="text-xs text-slate-500">{d?.city}, {d?.state}</div>
                        </div>
                        <div className="flex gap-1">
                          {index > 0 && (
                            <button
                              onClick={() => {
                                const ids = [...editingPreset.dealer_ids];
                                [ids[index], ids[index - 1]] = [ids[index - 1], ids[index]];
                                setEditingPreset({ ...editingPreset, dealer_ids: ids });
                              }}
                              className="p-1 text-slate-400 hover:text-slate-600"
                              title="Move up"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                              </svg>
                            </button>
                          )}
                          {index < editingPreset.dealer_ids.length - 1 && (
                            <button
                              onClick={() => {
                                const ids = [...editingPreset.dealer_ids];
                                [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
                                setEditingPreset({ ...editingPreset, dealer_ids: ids });
                              }}
                              className="p-1 text-slate-400 hover:text-slate-600"
                              title="Move down"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (editingPreset.dealer_ids.length === 1) {
                                showToast("Preset must have at least 1 dealer", "error");
                                return;
                              }
                              setEditingPreset({
                                ...editingPreset,
                                dealer_ids: editingPreset.dealer_ids.filter(id => id !== dealerId)
                              });
                            }}
                            className="p-1 text-red-400 hover:text-red-600"
                            title="Remove"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t">
                <button
                  onClick={() => setEditingPreset(null)}
                  className="px-4 py-2 border rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    updatePreset(editingPreset.id, {
                      name: editingPreset.name,
                      dealer_ids: editingPreset.dealer_ids
                    });
                    setEditingPreset(null);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};

const DealerMasterListView: React.FC<{
  dealers: Dealer[];
  setDealers: React.Dispatch<React.SetStateAction<Dealer[]>>;
  users: User[];
  regions: RegionsCatalog;
  showToast: (m: string, k?: ToastKind) => void;
}> = ({ dealers, setDealers, users, regions, showToast }) => {
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [fState, setFState] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<any>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Upload preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<{
    id: string;
    name: string;
    changes: { field: string; old: string; new: string }[];
    hasChanges: boolean;
    notFound: boolean;
  }[]>([]);
  const [previewStats, setPreviewStats] = useState({ total: 0, withChanges: 0, noChanges: 0, notFound: 0 });
  const [importing, setImporting] = useState(false);

  const stateOptions = useMemo(() => Array.from(new Set(dealers.map(d => d.state))).sort(), [dealers]);
  const allUsers = useMemo(
    () => assignableUsers(users, editDraft.assignedRepUsername),
    [users, editDraft.assignedRepUsername]
  );

  const filtered = useMemo(() => {
    const sq = q.trim().toLowerCase();
    return dealers.filter(d => {
      if (fState && d.state !== fState) return false;
      if (fStatus && d.status !== fStatus) return false;
      if (fType && d.type !== fType) return false;
      if (sq) {
        const hay = [
          d.name, d.state, d.region, d.city || "",
          (d as any).cifNumber || "",
          d.assignedRepUsername || ""
        ].join(" ").toLowerCase();
        if (!hay.includes(sq)) return false;
      }
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [dealers, q, fState, fStatus, fType]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => setPage(1), [q, fState, fStatus, fType]);

  const startEdit = (d: Dealer) => {
    setEditingId(d.id);
    setEditDraft({
      name: d.name,
      state: d.state,
      region: d.region,
      type: d.type,
      status: d.status,
      address1: d.address1 || "",
      city: d.city || "",
      zip: d.zip || "",
      assignedRepUsername: d.assignedRepUsername || "",
      cifNumber: (d as any).cifNumber || "",
    });
  };

  const saveEdit = async (dealerId: string) => {
    try {
      const patch = {
        name: editDraft.name?.trim(),
        state: editDraft.state,
        region: editDraft.region,
        type: editDraft.type,
        status: editDraft.status,
        address1: editDraft.address1?.trim() || null,
        city: editDraft.city?.trim() || null,
        zip: editDraft.zip?.trim() || null,
        assigned_rep_username: editDraft.assignedRepUsername || null,
        cif_number: editDraft.cifNumber?.trim() || null,
      };
      const { error } = await supabase.from("dealers").update(patch).eq("id", dealerId);
      if (error) throw error;
      setDealers(prev => prev.map(d => d.id === dealerId ? {
        ...d,
        name: patch.name,
        state: patch.state,
        region: patch.region,
        type: patch.type as DealerType,
        status: patch.status as DealerStatus,
        address1: patch.address1 || "",
        city: patch.city || "",
        zip: patch.zip || "",
        assignedRepUsername: patch.assigned_rep_username || undefined,
        cifNumber: patch.cif_number || "",
      } as any : d));
      showToast("Dealer updated.", "success");
      setEditingId(null);
    } catch (e: any) {
      showToast(e?.message || "Failed to save.", "error");
    }
  };

  const exportCSV = () => {
    const rows: (string | number)[][] = [[
      "DN ID", "CIF Number", "Dealer Name", "Rep", "State", "Region",
      "Type", "Status", "Address", "City", "ZIP"
    ]];
    for (const d of filtered) {
      const rep = users.find(u => u.username === d.assignedRepUsername);
      rows.push([
        d.id,
        (d as any).cifNumber || "",
        d.name,
        rep ? rep.name : "",
        d.state,
        d.region,
        d.type,
        d.status,
        d.address1 || "",
        d.city || "",
        d.zip || "",
      ]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dealer-master-list-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Parse CSV and build preview
  const handleUpload = async (file: File) => {
    try {
      let text = await file.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

      // Parse CSV properly (handles quoted fields)
      const parseCSV = (src: string): string[][] => {
        const rows: string[][] = [];
        let row: string[] = [];
        let field = "";
        let inQuotes = false;
        let i = 0;
        while (i < src.length) {
          const ch = src[i];
          if (inQuotes) {
            if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 2; continue; }
            if (ch === '"') { inQuotes = false; i++; continue; }
            field += ch; i++; continue;
          }
          if (ch === '"') { inQuotes = true; i++; continue; }
          if (ch === ',') { row.push(field); field = ""; i++; continue; }
          if (ch === '\r') { i++; continue; }
          if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
          field += ch; i++;
        }
        row.push(field);
        rows.push(row);
        return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c));
      };

      const parsed = parseCSV(text);
      if (parsed.length < 2) { showToast("CSV appears empty.", "error"); return; }

      const header = parsed[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));

      // Map column indices
      const iId     = header.findIndex(h => h === "dnid" || h === "id");
      const iCif    = header.findIndex(h => h.includes("cif"));
      const iName   = header.findIndex(h => h.includes("dealer") || h === "name");
      const iRep    = header.findIndex(h => h === "rep");
      const iState  = header.findIndex(h => h === "state" || h === "st");
      const iRegion = header.findIndex(h => h === "region" || h === "area");
      const iType   = header.findIndex(h => h === "type");
      const iStatus = header.findIndex(h => h === "status");
      const iAddr   = header.findIndex(h => h.includes("address") || h === "addr");
      const iCity   = header.findIndex(h => h === "city");
      const iZip    = header.findIndex(h => h === "zip" || h.includes("postal"));

      if (iId < 0) { showToast("CSV must have a DN ID column.", "error"); return; }

      // Build dealer lookup by ID
      const dealerById = new Map(dealers.map(d => [d.id, d]));

      // Helper: find rep username by name
      const findRepUsername = (repName: string): string => {
        if (!repName) return "";
        const lower = repName.trim().toLowerCase();
        const match = users.find(u =>
          u.name.toLowerCase() === lower ||
          u.username.toLowerCase() === lower
        );
        return match?.username || "";
      };

      const rows: typeof previewRows = [];
      let withChanges = 0;
      let noChanges = 0;
      let notFound = 0;

      for (let i = 1; i < parsed.length; i++) {
        const cols = parsed[i];
        const id = cols[iId] || "";
        if (!id) continue;

        const existing = dealerById.get(id);
        if (!existing) {
          notFound++;
          rows.push({ id, name: cols[iName] || id, changes: [], hasChanges: false, notFound: true });
          continue;
        }

        const csvCif    = iCif    >= 0 ? cols[iCif]    || "" : "";
        const csvName   = iName   >= 0 ? cols[iName]   || "" : "";
        const csvState  = iState  >= 0 ? cols[iState]  || "" : "";
        const csvRegion = iRegion >= 0 ? cols[iRegion] || "" : "";
        const csvType   = iType   >= 0 ? cols[iType]   || "" : "";
        const csvStatus = iStatus >= 0 ? cols[iStatus] || "" : "";
        const csvAddr   = iAddr   >= 0 ? cols[iAddr]   || "" : "";
        const csvCity   = iCity   >= 0 ? cols[iCity]   || "" : "";
        const csvZip    = iZip    >= 0 ? cols[iZip]    || "" : "";
        const csvRepName = iRep   >= 0 ? cols[iRep]    || "" : "";
        const csvRepUsername = findRepUsername(csvRepName);

        const changes: { field: string; old: string; new: string }[] = [];

        const check = (field: string, oldVal: string, newVal: string) => {
          if (!newVal) return; // skip blanks — don't overwrite with empty
          const resolvedNew = newVal.trim().toLowerCase() === "none" ? "" : newVal;
          if (oldVal.trim().toLowerCase() !== resolvedNew.trim().toLowerCase()) {
            changes.push({ field, old: oldVal || "—", new: resolvedNew });
          }
        };

        check("CIF Number",  (existing as any).cifNumber || "", csvCif);
        check("Dealer Name", existing.name,                     csvName);
        check("State",       existing.state,                    csvState);
        check("Region",      existing.region,                   csvRegion);
        check("Type",        existing.type,                     csvType);
        check("Status",      existing.status,                   csvStatus);
        check("Address",     existing.address1 || "",           csvAddr);
        check("City",        existing.city || "",               csvCity);
        check("ZIP",         existing.zip || "",                csvZip);
        if (csvRepUsername) {
          check("Rep", existing.assignedRepUsername || "", csvRepUsername);
        }

        if (changes.length > 0) {
          withChanges++;
          rows.push({ id, name: existing.name, changes, hasChanges: true, notFound: false });
        } else {
          noChanges++;
          rows.push({ id, name: existing.name, changes: [], hasChanges: false, notFound: false });
        }
      }

      setPreviewRows(rows);
      setPreviewStats({ total: parsed.length - 1, withChanges, noChanges, notFound });
      setPreviewOpen(true);
    } catch (e: any) {
      showToast(e?.message || "Failed to parse CSV.", "error");
    }
  };

  // Confirm and apply all changes
  const confirmImport = async () => {
    setImporting(true);
    try {
      const rowsWithChanges = previewRows.filter(r => r.hasChanges && !r.notFound);
      let successCount = 0;

      for (const row of rowsWithChanges) {
        const existing = dealers.find(d => d.id === row.id);
        if (!existing) continue;

        // Build patch from changes
        const patch: any = {};
        for (const change of row.changes) {
          switch (change.field) {
            case "CIF Number":  patch.cif_number = change.new; break;
            case "Dealer Name": patch.name = change.new; break;
            case "State":       patch.state = change.new; break;
            case "Region":      patch.region = change.new; break;
            case "Type":        patch.type = change.new; break;
            case "Status":      patch.status = change.new; break;
            case "Address":     patch.address1 = change.new; break;
            case "City":        patch.city = change.new; break;
            case "ZIP":         patch.zip = change.new; break;
            case "Rep": {
              patch.assigned_rep_username = change.new || null;
              break;
            }
          }
        }

        const { error } = await supabase.from("dealers").update(patch).eq("id", row.id);
        if (!error) {
          // Update local state
          setDealers(prev => prev.map(d => {
            if (d.id !== row.id) return d;
            return {
              ...d,
              ...(patch.name && { name: patch.name }),
              ...(patch.state && { state: patch.state }),
              ...(patch.region && { region: patch.region }),
              ...(patch.type && { type: patch.type as DealerType }),
              ...(patch.status && { status: patch.status as DealerStatus }),
              ...(patch.address1 !== undefined && { address1: patch.address1 }),
              ...(patch.city !== undefined && { city: patch.city }),
              ...(patch.zip !== undefined && { zip: patch.zip }),
              ...("assigned_rep_username" in patch && { assignedRepUsername: patch.assigned_rep_username || undefined }),
              ...(patch.cif_number !== undefined && { cifNumber: patch.cif_number } as any),
            };
          }));
          successCount++;
        }
      }

      showToast(`Updated ${successCount} dealer(s) successfully.`, "success");
      setPreviewOpen(false);
      setPreviewRows([]);
    } catch (e: any) {
      showToast(e?.message || "Import failed.", "error");
    } finally {
      setImporting(false);
    }
  };

  const shortId = (id: string) => id.slice(0, 8) + "…";
  const regionOptions = (state: string) => (regions[state] || []);

  // Preview rows — only show ones with changes or not found (skip no-changes for clarity)
  const previewWithChanges = previewRows.filter(r => r.hasChanges);
  const previewNotFound = previewRows.filter(r => r.notFound);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className={brand.pageTitle}>Dealer Master List</div>
          <div className={brand.pageSub}>{filtered.length.toLocaleString()} of {dealers.length.toLocaleString()} dealers</div>
        </div>
        <div className="grid grid-cols-2 gap-2 w-full md:flex md:w-auto md:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.currentTarget.value = ""; }}
          />
          <button
            className="px-3 py-2.5 rounded-lg border border-amber-600 text-amber-700 hover:bg-amber-50 text-sm font-medium md:border-slate-300 md:text-slate-700 md:hover:bg-slate-50 md:py-2"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            Upload CSV
          </button>
          <button
            className="px-3 py-2.5 rounded-lg border border-green-600 text-green-700 hover:bg-green-50 text-sm font-medium md:border-slate-300 md:text-slate-700 md:hover:bg-slate-50 md:py-2"
            onClick={exportCSV}
            type="button"
          >
            Export
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <input
          className="w-full rounded-lg border px-3 py-2.5 md:py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          placeholder="Search name, rep, state, region, CIF…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button
          type="button"
          className="md:hidden w-full mt-3 flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm font-medium text-slate-700"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <span>{[fState, fStatus, fType].filter(Boolean).length > 0 ? `Filters (${[fState, fStatus, fType].filter(Boolean).length})` : "Filters"}</span>
          <span className="text-slate-400">{filtersOpen ? "Hide" : "Show"}</span>
        </button>
        <div className={`${filtersOpen ? "grid mt-3" : "hidden"} md:grid md:mt-3 grid-cols-1 md:grid-cols-4 gap-3`}>
          <SelectField label="State" value={fState} onChange={setFState} options={[{ label: "All States", value: "" }, ...stateOptions.map(s => ({ label: s, value: s }))]} />
          <SelectField label="Status" value={fStatus} onChange={setFStatus} options={[{ label: "All Statuses", value: "" }, ...["Active","Pending","Prospect","Inactive","Black Listed"].map(s => ({ label: s, value: s }))]} />
          <SelectField label="Type" value={fType} onChange={setFType} options={[{ label: "All Types", value: "" }, { label: "Independent", value: "Independent" }, { label: "Franchise", value: "Franchise" }]} />
          <button className="text-sm text-blue-700 hover:underline whitespace-nowrap self-end pb-2 text-left" onClick={() => { setQ(""); setFState(""); setFStatus(""); setFType(""); }} type="button">Clear</button>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {paged.map(d => {
          const isEditing = editingId === d.id;
          const repName = users.find(u => u.username === d.assignedRepUsername)?.name || "—";

          if (isEditing) {
            return (
              <div key={d.id} className="rounded-xl border bg-blue-50 p-3 space-y-2">
                <input className="w-full rounded-lg border px-3 py-2 text-sm" value={editDraft.name} onChange={e => setEditDraft((p: any) => ({ ...p, name: e.target.value }))} placeholder="Dealer name" />
                <input className="w-full rounded-lg border px-3 py-2 text-sm" value={editDraft.cifNumber} onChange={e => setEditDraft((p: any) => ({ ...p, cifNumber: e.target.value }))} placeholder="CIF #" />
                <select className="w-full rounded-lg border px-3 py-2 text-sm" value={editDraft.assignedRepUsername} onChange={e => setEditDraft((p: any) => ({ ...p, assignedRepUsername: e.target.value }))}>
                  <option value="">— None —</option>
                  {allUsers.map(u => <option key={u.username} value={u.username}>{u.name} ({u.username})</option>)}
                </select>
                <select className="w-full rounded-lg border px-3 py-2 text-sm" value={editDraft.state} onChange={e => setEditDraft((p: any) => ({ ...p, state: e.target.value, region: "" }))}>
                  {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="w-full rounded-lg border px-3 py-2 text-sm" value={editDraft.region} onChange={e => setEditDraft((p: any) => ({ ...p, region: e.target.value }))}>
                  <option value="">— Select region —</option>
                  {regionOptions(editDraft.state).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="w-full rounded-lg border px-3 py-2 text-sm" value={editDraft.type} onChange={e => setEditDraft((p: any) => ({ ...p, type: e.target.value }))}>
                  <option value="Independent">Independent</option>
                  <option value="Franchise">Franchise</option>
                </select>
                <select className="w-full rounded-lg border px-3 py-2 text-sm" value={editDraft.status} onChange={e => setEditDraft((p: any) => ({ ...p, status: e.target.value }))}>
                  {["Active","Pending","Prospect","Inactive","Black Listed"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input className="w-full rounded-lg border px-3 py-2 text-sm" value={editDraft.address1} onChange={e => setEditDraft((p: any) => ({ ...p, address1: e.target.value }))} placeholder="Address" />
                <input className="w-full rounded-lg border px-3 py-2 text-sm" value={editDraft.city} onChange={e => setEditDraft((p: any) => ({ ...p, city: e.target.value }))} placeholder="City" />
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button className="px-3 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium" onClick={() => saveEdit(d.id)} type="button">Save</button>
                  <button className="px-3 py-2.5 rounded-lg border text-sm" onClick={() => setEditingId(null)} type="button">Cancel</button>
                </div>
              </div>
            );
          }

          return (
            <div key={d.id} className="rounded-xl border bg-white p-3">
              <div className="font-medium text-slate-800 break-words">{d.name}</div>
              <div className="text-xs text-slate-500 mt-1">CIF: {(d as any).cifNumber || "—"}</div>
              <div className="text-xs text-slate-500 mt-0.5">{repName} · {d.state || "—"}</div>
              <div className="mt-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(d.status)}`}>{d.status}</span>
              </div>
              <button
                className="mt-3 w-full px-3 py-2.5 rounded-lg border text-slate-700 text-sm"
                onClick={() => startEdit(d)}
                type="button"
              >
                Edit
              </button>
            </div>
          );
        })}
        {paged.length === 0 && (
          <div className="rounded-xl border bg-white p-6 text-center text-slate-500 text-sm">No dealers match your search.</div>
        )}
      </div>

      {/* Table */}
      <div className="hidden md:block rounded-xl border bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: "1100px" }}>
          <thead className="bg-slate-50">
            <tr>
              <th className={brand.th}>DN ID</th>
              <th className={brand.th}>CIF #</th>
              <th className={brand.th}>Dealer Name</th>
              <th className={brand.th}>Rep</th>
              <th className={brand.th}>State</th>
              <th className={brand.th}>Region</th>
              <th className={brand.th}>Type</th>
              <th className={brand.th}>Status</th>
              <th className={brand.th}>Address</th>
              <th className={brand.th}>City</th>
              <th className={brand.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map(d => {
              const isEditing = editingId === d.id;
              const repName = users.find(u => u.username === d.assignedRepUsername)?.name || "—";

              if (isEditing) {
                return (
                  <tr key={d.id} className="border-t bg-blue-50">
                    <td className="py-2 px-3 text-xs text-slate-400 font-mono">{shortId(d.id)}</td>
                    <td className="py-2 px-3">
                      <input className="w-24 rounded border px-2 py-1 text-xs" value={editDraft.cifNumber} onChange={e => setEditDraft((p: any) => ({ ...p, cifNumber: e.target.value }))} />
                    </td>
                    <td className="py-2 px-3">
                      <input className="w-36 rounded border px-2 py-1 text-xs" value={editDraft.name} onChange={e => setEditDraft((p: any) => ({ ...p, name: e.target.value }))} />
                    </td>
                    <td className="py-2 px-3">
                      <select className="rounded border px-2 py-1 text-xs" value={editDraft.assignedRepUsername} onChange={e => setEditDraft((p: any) => ({ ...p, assignedRepUsername: e.target.value }))}>
                        <option value="">— None —</option>
                        {allUsers.map(u => <option key={u.username} value={u.username}>{u.name} ({u.username})</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select className="rounded border px-2 py-1 text-xs" value={editDraft.state} onChange={e => setEditDraft((p: any) => ({ ...p, state: e.target.value, region: "" }))}>
                        {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select className="rounded border px-2 py-1 text-xs" value={editDraft.region} onChange={e => setEditDraft((p: any) => ({ ...p, region: e.target.value }))}>
                        <option value="">— Select —</option>
                        {regionOptions(editDraft.state).map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select className="rounded border px-2 py-1 text-xs" value={editDraft.type} onChange={e => setEditDraft((p: any) => ({ ...p, type: e.target.value }))}>
                        <option value="Independent">Independent</option>
                        <option value="Franchise">Franchise</option>
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select className="rounded border px-2 py-1 text-xs" value={editDraft.status} onChange={e => setEditDraft((p: any) => ({ ...p, status: e.target.value }))}>
                        {["Active","Pending","Prospect","Inactive","Black Listed"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input className="w-36 rounded border px-2 py-1 text-xs" value={editDraft.address1} onChange={e => setEditDraft((p: any) => ({ ...p, address1: e.target.value }))} />
                    </td>
                    <td className="py-2 px-3">
                      <input className="w-28 rounded border px-2 py-1 text-xs" value={editDraft.city} onChange={e => setEditDraft((p: any) => ({ ...p, city: e.target.value }))} />
                    </td>
                    <td className={brand.td}>
                      <div className="flex items-center gap-2">
                        <button className={brand.btnPrimary} onClick={() => saveEdit(d.id)} type="button">Save</button>
                        <button className={brand.btnGhost} onClick={() => setEditingId(null)} type="button">Cancel</button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={d.id} className="border-t hover:bg-slate-50">
                  <td className={`${brand.td} text-xs text-slate-400 font-mono`}>{shortId(d.id)}</td>
                  <td className={`${brand.td} text-slate-600`}>{(d as any).cifNumber || <span className="text-slate-300">—</span>}</td>
                  <td className={`${brand.td} font-medium text-slate-800`}>{d.name}</td>
                  <td className={`${brand.td} text-slate-600`}>{repName}</td>
                  <td className={brand.td}>{d.state}</td>
                  <td className={brand.td}>{d.region}</td>
                  <td className={brand.td}>{d.type}</td>
                  <td className={brand.td}>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(d.status)}`}>{d.status}</span>
                  </td>
                  <td className={`${brand.td} text-slate-600`}>{d.address1 || "—"}</td>
                  <td className={`${brand.td} text-slate-600`}>{d.city || "—"}</td>
                  <td className={brand.td}>
                    <button className={brand.btnSecondary} onClick={() => startEdit(d)} type="button">Edit</button>
                  </td>
                </tr>
              );
            })}
            {paged.length === 0 && (
              <tr><td colSpan={11} className="py-8 text-center text-slate-500">No dealers match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-slate-500">Page {page} of {totalPages}</div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2.5 md:py-1.5 rounded-lg border text-slate-700 disabled:opacity-40" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} type="button">Previous</button>
            <button className="px-3 py-2.5 md:py-1.5 rounded-lg border text-slate-700 disabled:opacity-40" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} type="button">Next</button>
          </div>
        </div>
      )}

      {/* Upload Preview Modal */}
      {previewOpen && (
        <Modal title="Upload Preview — Review Changes" onClose={() => { setPreviewOpen(false); setPreviewRows([]); }}>
          <div className="space-y-4">

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3 bg-slate-50">
                <div className="text-xs text-slate-500 uppercase tracking-wide">Total in CSV</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{previewStats.total}</div>
              </div>
              <div className="rounded-lg border p-3 bg-blue-50">
                <div className="text-xs text-blue-600 uppercase tracking-wide">Will Update</div>
                <div className="text-2xl font-semibold text-blue-700 mt-1">{previewStats.withChanges}</div>
              </div>
              <div className="rounded-lg border p-3 bg-green-50">
                <div className="text-xs text-green-600 uppercase tracking-wide">No Changes</div>
                <div className="text-2xl font-semibold text-green-700 mt-1">{previewStats.noChanges}</div>
              </div>
              <div className="rounded-lg border p-3 bg-red-50">
                <div className="text-xs text-red-600 uppercase tracking-wide">Not Found</div>
                <div className="text-2xl font-semibold text-red-700 mt-1">{previewStats.notFound}</div>
              </div>
            </div>

            {/* Changes list */}
            {previewWithChanges.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2">
                  Dealers that will be updated ({previewWithChanges.length})
                </div>
                <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                  {previewWithChanges.map((row, idx) => (
                    <div key={row.id} className={`p-3 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50"} border-b last:border-b-0`}>
                      <div className="font-medium text-slate-800 text-sm mb-1">{row.name}</div>
                      <div className="space-y-1">
                        {row.changes.map(c => (
                          <div key={c.field} className="flex items-center gap-2 text-xs">
                            <span className="text-slate-500 w-24 flex-shrink-0">{c.field}:</span>
                            <span className="text-red-600 line-through">{c.old}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-green-700 font-medium">{c.new}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Not found list */}
            {previewNotFound.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-red-700 mb-2">
                  DN IDs not found in database ({previewNotFound.length}) — these will be skipped
                </div>
                <div className="border border-red-200 rounded-lg p-3 bg-red-50 max-h-32 overflow-y-auto">
                  {previewNotFound.map(r => (
                    <div key={r.id} className="text-xs text-red-700 font-mono">{r.id} — {r.name}</div>
                  ))}
                </div>
              </div>
            )}

            {previewWithChanges.length === 0 && previewNotFound.length === 0 && (
              <div className="text-sm text-slate-500 text-center py-4">
                No changes detected — all dealers are already up to date.
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <button
                className="px-4 py-2 rounded-lg border text-slate-700 hover:bg-slate-50"
                onClick={() => { setPreviewOpen(false); setPreviewRows([]); }}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                className={`px-4 py-2 rounded-lg bg-blue-600 text-white font-medium ${importing || previewWithChanges.length === 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-700"}`}
                onClick={confirmImport}
                disabled={importing || previewWithChanges.length === 0}
              >
                {importing ? "Updating…" : `Apply ${previewWithChanges.length} Update(s)`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
export default App;