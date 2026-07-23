import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Shell from "../components/Shell";
import "./dashboard.css";

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const toMonthInput = (isoDate) => isoDate.slice(0, 7);
const fromMonthInput = (yyyyMm) => `${yyyyMm}-01`;

export default function OwnerDashboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(null); // { profile, daily, monthly, summary } | null
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDate, setDetailDate] = useState(todayISO());
  const [detailMonth, setDetailMonth] = useState(toMonthInput(monthISO()));

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
            .eq("log_month", monthISO()),
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

  // Fetch monthly log + summary for the currently selected month, for the employee in detail view.
  async function loadDetailMonthly(profileId, monthFirstDay) {
    const [{ data: monthly }, { data: summary }] = await Promise.all([
      supabase
        .from("monthly_logs")
        .select("*")
        .eq("user_id", profileId)
        .eq("log_month", monthFirstDay)
        .maybeSingle(),
      supabase
        .from("monthly_summary")
        .select("*")
        .eq("user_id", profileId)
        .eq("log_month", monthFirstDay)
        .maybeSingle(),
    ]);
    setDetail((prev) => (prev ? { ...prev, monthly, summary } : prev));
  }

  async function openDetail(profile) {
    const initDate = todayISO();
    const initMonth = toMonthInput(monthISO());
    setDetailDate(initDate);
    setDetailMonth(initMonth);
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
          .eq("log_month", fromMonthInput(initMonth))
          .maybeSingle(),
        supabase
          .from("monthly_summary")
          .select("*")
          .eq("user_id", profile.id)
          .eq("log_month", fromMonthInput(initMonth))
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
    setDetailDate(date);
    if (detail?.profile) loadDetailDaily(detail.profile.id, date);
  }

  function onDetailMonthChange(e) {
    const month = e.target.value;
    setDetailMonth(month);
    if (detail?.profile) loadDetailMonthly(detail.profile.id, fromMonthInput(month));
  }

  const isPastDetailDate = detail && detailDate !== todayISO();
  const isPastDetailMonth = detail && detailMonth !== toMonthInput(monthISO());

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
          <span className="stat-label">Avg monthly score</span>
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
                <th>Monthly score</th>
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
                        onClick={() => onDetailDateChange({ target: { value: todayISO() } })}
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
                    <div className="empty-state">No entry for {detailDate}.</div>
                  )}
                </div>

                <div className="modal-section">
                  <h4>
                    Monthly checkup
                    <input
                      type="month"
                      className="date-picker"
                      value={detailMonth}
                      max={toMonthInput(monthISO())}
                      onChange={onDetailMonthChange}
                    />
                    {isPastDetailMonth && (
                      <button
                        type="button"
                        className="today-btn"
                        onClick={() =>
                          onDetailMonthChange({ target: { value: toMonthInput(monthISO()) } })
                        }
                      >
                        This month
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
                      No checkup for {detailMonth}.
                    </div>
                  )}
                </div>

                {detail.summary && (
                  <div className="modal-section">
                    <h4>Combined</h4>
                    <div className="detail-grid">
                      <div>
                        <span className="detail-label">Monthly score</span>
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
