import { useEffect, useMemo, useState } from "react";
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

// Converts an array of flat objects into a CSV file and triggers a browser
// download. Values containing a comma, quote, or newline get quoted and
// any internal quotes are escaped, per standard CSV rules.
function downloadCSV(filename, rows) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escapeCell = (val) => {
    const str = val == null ? "" : String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function OwnerDashboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(null); // { profile, daily, monthly, summary } | null
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDate, setDetailDate] = useState(todayISO());
  const [detailPeriod, setDetailPeriod] = useState(currentPeriod());
  const [exporting, setExporting] = useState(null); // 'employees' | 'daily' | 'checkup' | null

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: profiles }, { data: daily }, { data: monthly }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, department, role")
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.full_name || "").toLowerCase().includes(q) ||
        (r.department || "").toLowerCase().includes(q) ||
        (r.email || "").toLowerCase().includes(q),
    );
  }, [rows, query]);

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

  // Exports the currently filtered/searched employee overview table as a
  // single CSV — same rows the owner is currently looking at.
  function exportEmployeesCSV() {
    setExporting("employees");
    const data = filtered.map((r) => ({
      name: r.full_name || "",
      email: r.email,
      department: r.department || "",
      today_score: r.today_score ?? "",
      checkup_score: r.monthly_score ?? "",
      risk_category: r.risk ?? "",
    }));
    downloadCSV(`employees-overview-${todayISO()}.csv`, data);
    setExporting(null);
  }

  // Exports one employee's full daily log history (every day they've ever
  // logged), not just the currently selected date.
  async function exportDailyHistory(profile) {
    setExporting("daily");
    const { data, error } = await supabase
      .from("daily_logs")
      .select(
        "log_date, steps, exercise_minutes, water_l, sleep_hours, daily_score",
      )
      .eq("user_id", profile.id)
      .order("log_date", { ascending: true });
    setExporting(null);
    if (error || !data?.length) return;
    const safeName = (profile.full_name || profile.email).replace(
      /[^\w-]+/g,
      "_",
    );
    downloadCSV(`${safeName}-daily-logs.csv`, data);
  }

  // Exports one employee's full half-yearly checkup history, not just the
  // currently selected period.
  async function exportCheckupHistory(profile) {
    setExporting("checkup");
    const { data, error } = await supabase
      .from("monthly_logs")
      .select(
        "log_month, bmi, systolic_bp, diastolic_bp, sugar, cholesterol, wellness_activity, health_check",
      )
      .eq("user_id", profile.id)
      .order("log_month", { ascending: true });
    setExporting(null);
    if (error || !data?.length) return;
    const safeName = (profile.full_name || profile.email).replace(
      /[^\w-]+/g,
      "_",
    );
    const withLabels = data.map((row) => ({
      period: periodLabel(row.log_month),
      ...row,
    }));
    downloadCSV(`${safeName}-checkups.csv`, withLabels);
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

      <div className="card table-card">
        <div className="table-head">
          <h3>Employees</h3>
          <input
            className="search-input"
            placeholder="Search name, department, email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="view-btn"
            onClick={exportEmployeesCSV}
            disabled={filtered.length === 0 || exporting === "employees"}
          >
            {exporting === "employees" ? "Exporting…" : "Export CSV"}
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
                <th>Department</th>
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
                  <td>{r.department || "—"}</td>
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
                <div className="emp-email">
                  {detail.profile.email}{" "}
                  {detail.profile.department
                    ? `· ${detail.profile.department}`
                    : ""}
                </div>
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
                    <button
                      type="button"
                      className="today-btn"
                      style={{ marginLeft: 8 }}
                      disabled={exporting === "daily"}
                      onClick={() => exportDailyHistory(detail.profile)}
                    >
                      {exporting === "daily" ? "Exporting…" : "Export CSV"}
                    </button>
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
                    <button
                      type="button"
                      className="today-btn"
                      style={{ marginLeft: 8 }}
                      disabled={exporting === "checkup"}
                      onClick={() => exportCheckupHistory(detail.profile)}
                    >
                      {exporting === "checkup" ? "Exporting…" : "Export CSV"}
                    </button>
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
