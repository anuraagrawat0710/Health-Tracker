import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase } from "../lib/supabaseClient";
import Shell from "../components/Shell";
import "./dashboard.css";

const todayISO = () => new Date().toISOString().slice(0, 10);

// Health checkups now run twice a year on fixed calendar halves:
// H1 = Jan–Jun, H2 = Jul–Dec. A period is identified by the ISO date of
// its first day (e.g. "2026-01-01" or "2026-07-01") — this is exactly
// what gets stored in log_month, so no database schema change is needed,
// only fewer, wider periods.
const periodStartFromDate = (isoDate) => {
  const year = isoDate.slice(0, 4);
  const month = Number(isoDate.slice(5, 7));
  return month <= 6 ? `${year}-01-01` : `${year}-07-01`;
};
const currentPeriod = () => periodStartFromDate(todayISO());
const periodLabel = (firstDay) => {
  const year = firstDay.slice(0, 4);
  const half = firstDay.slice(5, 7);
  return half === "01" ? `Jan–Jun ${year}` : `Jul–Dec ${year}`;
};
const nextPeriod = (firstDay) => {
  const year = Number(firstDay.slice(0, 4));
  const half = firstDay.slice(5, 7);
  return half === "01" ? `${year}-07-01` : `${year + 1}-01-01`;
};
const prevPeriod = (firstDay) => {
  const year = Number(firstDay.slice(0, 4));
  const half = firstDay.slice(5, 7);
  return half === "07" ? `${year}-01-01` : `${year - 1}-07-01`;
};

// Ranges for the participation chart, same shape as the user dashboard's
// score trend toggle. "week" and "month" show one bar per day; "year"
// buckets into one bar per month (365 daily bars would be unreadable).
const PARTICIPATION_RANGES = {
  week: { days: 7, bucket: "day" },
  month: { days: 30, bucket: "day" },
  year: { days: 365, bucket: "month" },
};

// Turns an array of flat objects into CSV lines (header row + data rows).
// Values containing a comma, quote, or newline get quoted and any internal
// quotes are escaped, per standard CSV rules.
function rowsToCSVLines(rows) {
  if (!rows || rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const escapeCell = (val) => {
    const str = val == null ? "" : String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(",")),
  ];
}

function triggerCSVDownload(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Single-table CSV export — used for the employees overview table.
function downloadCSV(filename, rows) {
  const lines = rowsToCSVLines(rows);
  if (lines.length === 0) return;
  triggerCSVDownload(filename, lines.join("\n"));
}

// Combines multiple labeled tables into ONE CSV file, each preceded by a
// title row and separated by a blank line. Used so a single employee
// export always includes both daily logs and half-yearly checkups
// together, rather than requiring two separate downloads.
function downloadMultiSectionCSV(filename, sections) {
  const blocks = sections
    .filter((s) => s.rows && s.rows.length > 0)
    .map((s) => [s.title, ...rowsToCSVLines(s.rows)].join("\n"));
  if (blocks.length === 0) return;
  triggerCSVDownload(filename, blocks.join("\n\n"));
}

export default function OwnerDashboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(null); // { profile, daily, monthly, summary } | null
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDate, setDetailDate] = useState(todayISO());
  const [detailPeriod, setDetailPeriod] = useState(currentPeriod());
  const [exporting, setExporting] = useState(false);
  const [exportMode, setExportMode] = useState("full"); // 'full' | 'range'
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState(todayISO());
  const [participationHistory, setParticipationHistory] = useState([]);
  const [participationLoading, setParticipationLoading] = useState(true);
  const [participationRange, setParticipationRange] = useState("week");
  const [sendingReminder, setSendingReminder] = useState(false);
  const [sendingThanks, setSendingThanks] = useState(false);
  const [employeeCategory, setEmployeeCategory] = useState(null);
  const [showEmployeeList, setShowEmployeeList] = useState(false);
  const [mailNotice, setMailNotice] = useState(null); // { type: 'ok'|'error', text } | null

  // Builds participation history for the selected range. "day" bucketing
  // gives one bar per calendar day (week/month view); "month" bucketing
  // averages logged-vs-not across each calendar month (year view), using
  // each month's actual day count rather than assuming totalEmployees
  // stayed constant over the whole span.
  async function loadParticipationHistory(totalEmployees, range) {
    setParticipationLoading(true);
    const { days, bucket } = PARTICIPATION_RANGES[range];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutoffISO = cutoff.toISOString().slice(0, 10);

    const { data } = await supabase
      .from("daily_logs")
      .select("user_id, log_date")
      .gte("log_date", cutoffISO)
      .lte("log_date", todayISO());

    const loggedByDate = {};
    (data || []).forEach((r) => {
      if (!loggedByDate[r.log_date]) loggedByDate[r.log_date] = new Set();
      loggedByDate[r.log_date].add(r.user_id);
    });

    if (bucket === "day") {
      const result = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().slice(0, 10);
        const participated = loggedByDate[iso] ? loggedByDate[iso].size : 0;
        result.push({
          label: iso.slice(5),
          Logged: participated,
          "Not logged": Math.max(totalEmployees - participated, 0),
        });
      }
      setParticipationHistory(result);
      setParticipationLoading(false);
      return;
    }

    // Monthly buckets: average the daily participation rate across each
    // month, so a partial current month isn't skewed by unfilled future days.
    const monthBuckets = {};
    Object.entries(loggedByDate).forEach(([iso, userSet]) => {
      const key = iso.slice(0, 7);
      if (!monthBuckets[key]) monthBuckets[key] = [];
      monthBuckets[key].push(userSet.size);
    });
    const sortedKeys = Object.keys(monthBuckets).sort();
    const result = sortedKeys.map((key) => {
      const vals = monthBuckets[key];
      const avgLogged =
        Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
      return {
        label: key,
        Logged: avgLogged,
        "Not logged": Math.max(
          Math.round((totalEmployees - avgLogged) * 10) / 10,
          0,
        ),
      };
    });
    setParticipationHistory(result);
    setParticipationLoading(false);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: profiles }, { data: daily }, { data: monthly }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, role")
            .eq("role", "user"),
          supabase
            .from("daily_logs")
            .select("user_id, daily_score")
            .eq("log_date", todayISO()),
          supabase
            .from("monthly_summary")
            .select("user_id, monthly_score, risk_category")
            .eq("log_month", currentPeriod()),
        ]);

      const dailyMap = Object.fromEntries(
        (daily || []).map((d) => [d.user_id, d.daily_score]),
      );
      const monthlyMap = Object.fromEntries(
        (monthly || []).map((m) => [m.user_id, m]),
      );

      const merged = (profiles || []).map((p) => ({
        ...p,
        today_score: dailyMap[p.id] ?? null,
        monthly_score: monthlyMap[p.id]?.monthly_score ?? null,
        risk: monthlyMap[p.id]?.risk_category ?? null,
      }));
      setRows(merged);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (!loading) loadParticipationHistory(rows.length, participationRange);
  }, [participationRange, loading, rows.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesQuery =
        !q ||
        (r.full_name || "").toLowerCase().includes(q) ||
        (r.email || "").toLowerCase().includes(q);
      const matchesCategory = !employeeCategory || r.risk === employeeCategory;
      return matchesQuery && matchesCategory;
    });
  }, [rows, query, employeeCategory]);

  const todayParticipation = useMemo(() => {
    const logged = rows.filter((r) => r.today_score != null);
    const notLogged = rows.filter((r) => r.today_score == null);
    return { logged, notLogged };
  }, [rows]);

  // Shared sender for both the reminder and thanks emails. Calls the
  // send-participation-email Edge Function, which does the actual sending
  // server-side (keeps the email provider's API key off the client).
  async function sendParticipationEmail(type, recipients, setSending) {
    if (!recipients.length) return;
    setSending(true);
    setMailNotice(null);
    const { data, error } = await supabase.functions.invoke(
      "send-participation-email",
      {
        body: {
          type,
          recipients: recipients.map((r) => ({
            email: r.email,
            full_name: r.full_name,
          })),
        },
      },
    );
    setSending(false);
    if (error) {
      setMailNotice({
        type: "error",
        text: `Failed to send: ${error.message}`,
      });
      return;
    }
    const failedCount = data?.failed?.length || 0;
    setMailNotice({
      type: failedCount ? "error" : "ok",
      text: failedCount
        ? `Sent ${data.sent}, failed ${failedCount}.`
        : `Sent to ${data.sent} ${data.sent === 1 ? "person" : "people"}.`,
    });
  }

  const sendReminders = () =>
    sendParticipationEmail(
      "reminder",
      todayParticipation.notLogged,
      setSendingReminder,
    );

  const sendThanks = () =>
    sendParticipationEmail(
      "thanks",
      todayParticipation.logged,
      setSendingThanks,
    );

  const stats = useMemo(() => {
    const loggedToday = rows.filter((r) => r.today_score != null).length;
    const atRisk = rows.filter(
      (r) => r.risk === "High Risk" || r.risk === "Critical",
    ).length;
    const avgMonthly = rows.filter((r) => r.monthly_score != null);
    const avg = avgMonthly.length
      ? Math.round(
          (avgMonthly.reduce((a, r) => a + Number(r.monthly_score), 0) /
            avgMonthly.length) *
            10,
        ) / 10
      : null;
    return { total: rows.length, loggedToday, atRisk, avg };
  }, [rows]);

  // Count of employees in each risk_category bucket, for the 4 category
  // boxes below "Today's participation". Employees with no checkup yet
  // (risk === null) aren't counted in any box.
  const riskCounts = useMemo(() => {
    const counts = { Healthy: 0, Moderate: 0, Critical: 0, "High Risk": 0 };
    rows.forEach((r) => {
      if (r.risk && Object.prototype.hasOwnProperty.call(counts, r.risk)) {
        counts[r.risk] += 1;
      }
    });
    return counts;
  }, [rows]);

  // Clicking a category box filters the "Employees" table below to that
  // category; clicking the same box again clears the filter.
  function toggleEmployeeCategory(category) {
    setEmployeeCategory((prev) => (prev === category ? null : category));
    setShowEmployeeList(true);
  }

  // Exports the currently filtered/searched employee overview table as a
  // single CSV — same rows the owner is currently looking at.
  function exportEmployeesCSV() {
    const data = filtered.map((r) => ({
      name: r.full_name || "",
      email: r.email,
      today_score: r.today_score ?? "",
      checkup_score: r.monthly_score ?? "",
      risk_category: r.risk ?? "",
    }));
    downloadCSV(`employees-overview-${todayISO()}.csv`, data);
  }

  // Exports one employee's daily logs AND half-yearly checkups together in
  // a single CSV, either across their full history or restricted to a
  // chosen date range (checkups are included if their period overlaps the
  // range at all, since a checkup period is wider than a single day).
  async function exportEmployeeHistory(profile) {
    setExporting(true);

    let dailyQuery = supabase
      .from("daily_logs")
      .select(
        "log_date, steps, exercise_minutes, water_l, sleep_hours, daily_score",
      )
      .eq("user_id", profile.id)
      .order("log_date", { ascending: true });
    let monthlyQuery = supabase
      .from("monthly_logs")
      .select(
        "log_month, bmi, systolic_bp, diastolic_bp, sugar, cholesterol, wellness_activity, health_check",
      )
      .eq("user_id", profile.id)
      .order("log_month", { ascending: true });

    const useRange = exportMode === "range" && exportFrom && exportTo;
    if (useRange) {
      dailyQuery = dailyQuery
        .gte("log_date", exportFrom)
        .lte("log_date", exportTo);
      monthlyQuery = monthlyQuery
        .gte("log_month", periodStartFromDate(exportFrom))
        .lte("log_month", periodStartFromDate(exportTo));
    }

    const [
      { data: daily, error: dailyErr },
      { data: monthly, error: monthlyErr },
    ] = await Promise.all([dailyQuery, monthlyQuery]);
    setExporting(false);
    if (dailyErr || monthlyErr) return;

    const safeName = (profile.full_name || profile.email).replace(
      /[^\w-]+/g,
      "_",
    );
    const rangeTag = useRange
      ? `_${exportFrom}_to_${exportTo}`
      : "_full-history";
    const checkupRows = (monthly || []).map((row) => ({
      period: periodLabel(row.log_month),
      ...row,
    }));

    downloadMultiSectionCSV(`${safeName}${rangeTag}.csv`, [
      { title: "Daily Logs", rows: daily || [] },
      { title: "Half-Yearly Checkups", rows: checkupRows },
    ]);
  }

  // Fetch daily log for the currently selected date, for the employee in detail view.
  async function loadDetailDaily(profileId, date) {
    const { data } = await supabase
      .from("daily_logs")
      .select("*")
      .eq("user_id", profileId)
      .eq("log_date", date)
      .maybeSingle();
    setDetail((prev) => (prev ? { ...prev, daily: data } : prev));
  }

  // Fetch checkup log + summary for the currently selected period, for the employee in detail view.
  async function loadDetailMonthly(profileId, periodFirstDay) {
    const [{ data: monthly }, { data: summary }] = await Promise.all([
      supabase
        .from("monthly_logs")
        .select("*")
        .eq("user_id", profileId)
        .eq("log_month", periodFirstDay)
        .maybeSingle(),
      supabase
        .from("monthly_summary")
        .select("*")
        .eq("user_id", profileId)
        .eq("log_month", periodFirstDay)
        .maybeSingle(),
    ]);
    setDetail((prev) => (prev ? { ...prev, monthly, summary } : prev));
  }

  async function openDetail(profile) {
    const initDate = todayISO();
    const initPeriod = currentPeriod();
    setDetailDate(initDate);
    setDetailPeriod(initPeriod);
    setExportMode("full");
    setExportFrom("");
    setExportTo(todayISO());
    setDetailLoading(true);
    setDetail({ profile, daily: null, monthly: null, summary: null });

    const [{ data: daily }, { data: monthly }, { data: summary }] =
      await Promise.all([
        supabase
          .from("daily_logs")
          .select("*")
          .eq("user_id", profile.id)
          .eq("log_date", initDate)
          .maybeSingle(),
        supabase
          .from("monthly_logs")
          .select("*")
          .eq("user_id", profile.id)
          .eq("log_month", initPeriod)
          .maybeSingle(),
        supabase
          .from("monthly_summary")
          .select("*")
          .eq("user_id", profile.id)
          .eq("log_month", initPeriod)
          .maybeSingle(),
      ]);
    setDetail({ profile, daily, monthly, summary });
    setDetailLoading(false);
  }

  function closeDetail() {
    setDetail(null);
  }

  function onDetailDateChange(e) {
    const date = e.target.value;
    const period = periodStartFromDate(date);
    setDetailDate(date);
    if (detail?.profile) {
      loadDetailDaily(detail.profile.id, date);
      if (period !== detailPeriod) {
        setDetailPeriod(period);
        loadDetailMonthly(detail.profile.id, period);
      }
    }
  }

  function goToPeriod(period) {
    setDetailPeriod(period);
    if (detail?.profile) loadDetailMonthly(detail.profile.id, period);
  }

  const isPastDetailDate = detail && detailDate !== todayISO();
  const isPastDetailPeriod = detail && detailPeriod !== currentPeriod();

  return (
    <Shell>
      <div className="dash-header">
        <h1>Team wellness overview</h1>
        <p className="dash-sub">Every employee's latest scores at a glance.</p>
      </div>

      <div className="stat-row">
        <div className="card stat-card">
          <span className="stat-num mono">{stats.total}</span>
          <span className="stat-label">Employees</span>
        </div>
        <div className="card stat-card">
          <span className="stat-num mono">{stats.loggedToday}</span>
          <span className="stat-label">Logged today</span>
        </div>
        <div className="card stat-card">
          <span className="stat-num mono">{stats.avg ?? "—"}</span>
          <span className="stat-label">Avg checkup score</span>
        </div>
        <div className="card stat-card">
          <span
            className="stat-num mono"
            style={stats.atRisk ? { color: "var(--risk)" } : undefined}
          >
            {stats.atRisk}
          </span>
          <span className="stat-label">At risk</span>
        </div>
      </div>

      <div className="card chart-card">
        <div className="chart-head">
          <h3>Daily log participation</h3>
          <div className="range-toggle">
            {["week", "month", "year"].map((r) => (
              <button
                key={r}
                className={participationRange === r ? "active" : ""}
                onClick={() => setParticipationRange(r)}
                type="button"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {participationLoading ? (
          <div className="empty-state">Loading…</div>
        ) : stats.total === 0 ? (
          <div className="empty-state">No employees yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={participationHistory}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="label" fontSize={11} stroke="var(--muted)" />
              <YAxis
                fontSize={11}
                stroke="var(--muted)"
                width={30}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="Logged"
                stackId="participation"
                fill="var(--accent)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="Not logged"
                stackId="participation"
                fill="var(--risk)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card table-card">
        <div className="table-head">
          <h3>Today's participation</h3>
        </div>
        {mailNotice && (
          <p
            style={{
              fontSize: 12,
              marginTop: 0,
              marginBottom: 10,
              color:
                mailNotice.type === "error" ? "var(--risk)" : "var(--accent)",
            }}
          >
            {mailNotice.text}
          </p>
        )}
        <div className="grid-2">
          <div>
            <h4
              style={{
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--accent)",
                marginBottom: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>Logged ({todayParticipation.logged.length})</span>
              <button
                type="button"
                className="today-btn"
                style={{ textTransform: "none", letterSpacing: "normal" }}
                disabled={
                  sendingThanks || todayParticipation.logged.length === 0
                }
                onClick={sendThanks}
              >
                {sendingThanks ? "Sending…" : "Send thanks"}
              </button>
            </h4>
            {todayParticipation.logged.length === 0 ? (
              <div className="empty-state">No one has logged yet today.</div>
            ) : (
              todayParticipation.logged.map((r) => (
                <div key={r.id} className="name-row">
                  <span>{r.full_name || r.email}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <h4
              style={{
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--risk)",
                marginBottom: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>Not logged ({todayParticipation.notLogged.length})</span>
              <button
                type="button"
                className="today-btn"
                style={{ textTransform: "none", letterSpacing: "normal" }}
                disabled={
                  sendingReminder || todayParticipation.notLogged.length === 0
                }
                onClick={sendReminders}
              >
                {sendingReminder ? "Sending…" : "Send reminder to all"}
              </button>
            </h4>
            {todayParticipation.notLogged.length === 0 ? (
              <div className="empty-state">Everyone has logged today.</div>
            ) : (
              todayParticipation.notLogged.map((r) => (
                <div key={r.id} className="name-row">
                  <span>{r.full_name || r.email}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <h3>Employees by category</h3>
        </div>
        <div className="stat-row">
          {[
            {
              key: null,
              label: "Total users",
              color: "var(--accent)",
              count: rows.length,
            },
            { key: "Moderate", label: "Moderate", color: "#d97706" },
            { key: "Critical", label: "Critical", color: "var(--risk)" },
            { key: "High Risk", label: "At Risk", color: "var(--risk)" },
          ].map((c) => {
            const active = employeeCategory === c.key && c.key !== null;
            const count = c.count ?? riskCounts[c.key];
            return (
              <button
                key={c.label}
                type="button"
                className="card stat-card"
                onClick={() =>
                  c.key === null
                    ? setEmployeeCategory(null)
                    : toggleEmployeeCategory(c.key)
                }
                style={{
                  cursor: "pointer",
                  textAlign: "left",
                  font: "inherit",
                  border: active
                    ? `2px solid ${c.color}`
                    : "1px solid var(--line)",
                }}
              >
                <span className="stat-num mono" style={{ color: c.color }}>
                  {count}
                </span>
                <span className="stat-label">{c.label}</span>
              </button>
            );
          })}
        </div>
        {employeeCategory && (
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
            Showing <strong>{employeeCategory}</strong> employees in the table
            below.{" "}
            <button
              type="button"
              className="today-btn"
              onClick={() => setEmployeeCategory(null)}
            >
              Clear filter
            </button>
          </p>
        )}
      </div>

      <div className="card table-card">
        <div className="table-head">
          <h3>Employees</h3>
          <input
            className="search-input"
            placeholder="Search name, email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="view-btn"
            onClick={exportEmployeesCSV}
            disabled={filtered.length === 0}
          >
            Export CSV
          </button>
        </div>

        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No employees match.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Today's score</th>
                <th>Checkup score</th>
                <th>Risk</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="emp-name">{r.full_name || "—"}</div>
                    <div className="emp-email">{r.email}</div>
                  </td>
                  <td className="mono">
                    {r.today_score != null ? Math.round(r.today_score) : "—"}
                  </td>
                  <td className="mono">
                    {r.monthly_score != null
                      ? Math.round(r.monthly_score)
                      : "—"}
                  </td>
                  <td>
                    {r.risk ? (
                      <span
                        className={`risk-tag risk-${r.risk.split(" ")[0].toLowerCase()}`}
                      >
                        {r.risk}
                      </span>
                    ) : (
                      <span className="risk-tag">No data</span>
                    )}
                  </td>
                  <td>
                    <button className="view-btn" onClick={() => openDetail(r)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <div className="modal-backdrop" onClick={closeDetail}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>{detail.profile.full_name || detail.profile.email}</h3>
                <div className="emp-email">{detail.profile.email}</div>
              </div>
              <button className="modal-close" onClick={closeDetail}>
                ×
              </button>
            </div>

            {detailLoading ? (
              <div className="empty-state">Loading…</div>
            ) : (
              <div className="modal-body">
                <div className="modal-section">
                  <h4>Export history</h4>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="radio"
                        name="exportMode"
                        checked={exportMode === "full"}
                        onChange={() => setExportMode("full")}
                      />
                      Full history
                    </label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="radio"
                        name="exportMode"
                        checked={exportMode === "range"}
                        onChange={() => setExportMode("range")}
                      />
                      Date range
                    </label>
                    {exportMode === "range" && (
                      <>
                        <input
                          type="date"
                          className="date-picker"
                          value={exportFrom}
                          max={exportTo || todayISO()}
                          onChange={(e) => setExportFrom(e.target.value)}
                        />
                        <span style={{ fontSize: 13 }}>to</span>
                        <input
                          type="date"
                          className="date-picker"
                          value={exportTo}
                          min={exportFrom || undefined}
                          max={todayISO()}
                          onChange={(e) => setExportTo(e.target.value)}
                        />
                      </>
                    )}
                    <button
                      type="button"
                      className="today-btn"
                      disabled={
                        exporting ||
                        (exportMode === "range" && (!exportFrom || !exportTo))
                      }
                      onClick={() => exportEmployeeHistory(detail.profile)}
                    >
                      {exporting ? "Exporting…" : "Download CSV"}
                    </button>
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      marginTop: 6,
                    }}
                  >
                    Includes both daily logs and half-yearly checkups in one
                    file.
                  </p>
                </div>

                <div className="modal-section">
                  <h4>
                    Daily log
                    <input
                      type="date"
                      className="date-picker"
                      value={detailDate}
                      max={todayISO()}
                      onChange={onDetailDateChange}
                    />
                    {isPastDetailDate && (
                      <button
                        type="button"
                        className="today-btn"
                        onClick={() =>
                          onDetailDateChange({ target: { value: todayISO() } })
                        }
                      >
                        Today
                      </button>
                    )}
                  </h4>
                  {detail.daily ? (
                    <div className="detail-grid">
                      <div>
                        <span className="detail-label">Steps</span>
                        <span className="mono">{detail.daily.steps}</span>
                      </div>
                      <div>
                        <span className="detail-label">Exercise (min)</span>
                        <span className="mono">
                          {detail.daily.exercise_minutes}
                        </span>
                      </div>
                      <div>
                        <span className="detail-label">Water (L)</span>
                        <span className="mono">{detail.daily.water_l}</span>
                      </div>
                      <div>
                        <span className="detail-label">Sleep (hrs)</span>
                        <span className="mono">{detail.daily.sleep_hours}</span>
                      </div>
                      <div>
                        <span className="detail-label">Daily score</span>
                        <span className="mono">
                          {Math.round(detail.daily.daily_score)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state">
                      No entry for {detailDate}.
                    </div>
                  )}
                </div>

                <div className="modal-section">
                  <h4>
                    Half-yearly checkup
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        marginLeft: 12,
                      }}
                    >
                      <button
                        type="button"
                        className="today-btn"
                        aria-label="Previous period"
                        onClick={() => goToPeriod(prevPeriod(detailPeriod))}
                      >
                        ‹
                      </button>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {periodLabel(detailPeriod)}
                      </span>
                      <button
                        type="button"
                        className="today-btn"
                        aria-label="Next period"
                        disabled={detailPeriod === currentPeriod()}
                        onClick={() => goToPeriod(nextPeriod(detailPeriod))}
                      >
                        ›
                      </button>
                    </span>
                    {isPastDetailPeriod && (
                      <button
                        type="button"
                        className="today-btn"
                        onClick={() => goToPeriod(currentPeriod())}
                      >
                        This period
                      </button>
                    )}
                  </h4>
                  {detail.monthly ? (
                    <div className="detail-grid">
                      <div>
                        <span className="detail-label">BMI</span>
                        <span className="mono">
                          {detail.monthly.bmi ?? "—"}
                        </span>
                      </div>
                      <div>
                        <span className="detail-label">Systolic BP</span>
                        <span className="mono">
                          {detail.monthly.systolic_bp ?? "—"}
                        </span>
                      </div>
                      <div>
                        <span className="detail-label">Diastolic BP</span>
                        <span className="mono">
                          {detail.monthly.diastolic_bp ?? "—"}
                        </span>
                      </div>
                      <div>
                        <span className="detail-label">Sugar</span>
                        <span className="mono">
                          {detail.monthly.sugar ?? "—"}
                        </span>
                      </div>
                      <div>
                        <span className="detail-label">Cholesterol</span>
                        <span className="mono">
                          {detail.monthly.cholesterol ?? "—"}
                        </span>
                      </div>
                      <div>
                        <span className="detail-label">Wellness activity</span>
                        <span className="mono">
                          {detail.monthly.wellness_activity ? "Yes" : "No"}
                        </span>
                      </div>
                      <div>
                        <span className="detail-label">Health check</span>
                        <span className="mono">
                          {detail.monthly.health_check ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state">
                      No checkup for {periodLabel(detailPeriod)}.
                    </div>
                  )}
                </div>

                {detail.summary && (
                  <div className="modal-section">
                    <h4>Combined</h4>
                    <div className="detail-grid">
                      <div>
                        <span className="detail-label">Checkup score</span>
                        <span className="mono">
                          {Math.round(detail.summary.monthly_score)}
                        </span>
                      </div>
                      <div>
                        <span className="detail-label">Risk category</span>
                        <span
                          className={`risk-tag risk-${detail.summary.risk_category.split(" ")[0].toLowerCase()}`}
                        >
                          {detail.summary.risk_category}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
