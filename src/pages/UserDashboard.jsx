import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import ScoreRing from "../components/ScoreRing";
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

// Server-side CHECK constraints (security-hardening.sql) enforce these same
// bounds — this is just so the user gets a clear message instead of a raw
// database error or a silently failed save.
const DAILY_BOUNDS = {
  steps: { min: 0, max: 100000, label: "Steps" },
  exercise_minutes: { min: 0, max: 1440, label: "Exercise minutes" },
  water_l: { min: 0, max: 20, label: "Water (L)" },
  sleep_hours: { min: 0, max: 24, label: "Sleep (hrs)" },
};
const MONTHLY_BOUNDS = {
  bmi: { min: 5, max: 100, label: "BMI" },
  systolic_bp: { min: 40, max: 300, label: "Systolic BP" },
  diastolic_bp: { min: 20, max: 200, label: "Diastolic BP" },
  sugar: { min: 20, max: 600, label: "Sugar" },
  cholesterol: { min: 50, max: 500, label: "Cholesterol" },
};

function validateBounds(form, bounds, { allowEmpty }) {
  for (const key of Object.keys(bounds)) {
    const raw = form[key];
    if (raw === "" || raw == null) {
      if (allowEmpty) continue;
      return `${bounds[key].label} is required.`;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) return `${bounds[key].label} must be a number.`;
    const { min, max, label } = bounds[key];
    if (num < min || num > max)
      return `${label} must be between ${min} and ${max}.`;
  }
  return null;
}

export default function UserDashboard() {
  const { profile } = useAuth();

  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedPeriod, setSelectedPeriod] = useState(currentPeriod());

  const [dailyForm, setDailyForm] = useState({
    steps: "",
    exercise_minutes: "",
    water_l: "",
    sleep_hours: "",
  });
  const [monthlyForm, setMonthlyForm] = useState({
    bmi: "",
    systolic_bp: "",
    diastolic_bp: "",
    sugar: "",
    cholesterol: "",
    wellness_activity: false,
    health_check: false,
  });
  const [dayLog, setDayLog] = useState(null);
  const [monthLog, setMonthLog] = useState(null);
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [monthlyHistory, setMonthlyHistory] = useState([]);
  const [range, setRange] = useState("week");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgIsError, setMsgIsError] = useState(false);

  async function loadDaily(date) {
    const { data } = await supabase
      .from("daily_logs")
      .select("*")
      .eq("user_id", profile.id)
      .eq("log_date", date)
      .maybeSingle();
    setDayLog(data);
    setDailyForm(
      data
        ? {
            steps: data.steps,
            exercise_minutes: data.exercise_minutes,
            water_l: data.water_l,
            sleep_hours: data.sleep_hours,
          }
        : { steps: "", exercise_minutes: "", water_l: "", sleep_hours: "" },
    );
  }

  async function loadMonthly(periodFirstDay) {
    const { data } = await supabase
      .from("monthly_logs")
      .select("*")
      .eq("user_id", profile.id)
      .eq("log_month", periodFirstDay)
      .maybeSingle();
    setMonthLog(data);
    setMonthlyForm(
      data
        ? {
            bmi: data.bmi ?? "",
            systolic_bp: data.systolic_bp ?? "",
            diastolic_bp: data.diastolic_bp ?? "",
            sugar: data.sugar ?? "",
            cholesterol: data.cholesterol ?? "",
            wellness_activity: data.wellness_activity,
            health_check: data.health_check,
          }
        : {
            bmi: "",
            systolic_bp: "",
            diastolic_bp: "",
            sugar: "",
            cholesterol: "",
            wellness_activity: false,
            health_check: false,
          },
    );
    const { data: sm } = await supabase
      .from("monthly_summary")
      .select("*")
      .eq("user_id", profile.id)
      .eq("log_month", periodFirstDay)
      .maybeSingle();
    setSummary(sm);
  }

  async function loadHistory() {
    const { data } = await supabase
      .from("daily_logs")
      .select("log_date, daily_score")
      .eq("user_id", profile.id)
      .order("log_date", { ascending: true })
      .limit(370);
    setHistory(data || []);
  }

  async function loadMonthlyHistory() {
    const { data } = await supabase
      .from("monthly_summary")
      .select("log_month, monthly_score, risk_category")
      .eq("user_id", profile.id)
      .order("log_month", { ascending: true });
    setMonthlyHistory(data || []);
  }

  useEffect(() => {
    if (profile) {
      loadHistory();
      loadMonthlyHistory();
    }
  }, [profile]);
  useEffect(() => {
    if (profile) loadDaily(selectedDate);
  }, [profile, selectedDate]);
  useEffect(() => {
    if (profile) loadMonthly(selectedPeriod);
  }, [profile, selectedPeriod]);

  // Once a row exists, it's locked — permanently, regardless of date.
  // This mirrors the database side: the UPDATE policy has been removed
  // entirely for daily_logs/monthly_logs, so a second save attempt on an
  // existing row is rejected by RLS no matter what the client sends.
  const isDailyLocked = !!dayLog;
  const isMonthlyLocked = !!monthLog;

  async function saveDaily(e) {
    e.preventDefault();
    setMsg("");
    setMsgIsError(false);

    if (isDailyLocked) {
      setMsg("This day's log is already saved and can no longer be edited.");
      setMsgIsError(true);
      return;
    }

    const boundsError = validateBounds(dailyForm, DAILY_BOUNDS, {
      allowEmpty: false,
    });
    if (boundsError) {
      setMsg(boundsError);
      setMsgIsError(true);
      return;
    }

    setSaving(true);
    const payload = {
      user_id: profile.id,
      log_date: selectedDate,
      steps: Number(dailyForm.steps) || 0,
      exercise_minutes: Number(dailyForm.exercise_minutes) || 0,
      water_l: Number(dailyForm.water_l) || 0,
      sleep_hours: Number(dailyForm.sleep_hours) || 0,
    };
    const { error } = await supabase
      .from("daily_logs")
      .upsert(payload, { onConflict: "user_id,log_date" });
    setSaving(false);
    setMsgIsError(!!error);
    setMsg(error ? error.message : `Saved log for ${selectedDate}.`);
    if (!error) {
      loadDaily(selectedDate);
      loadHistory();
    }
  }

  async function saveMonthly(e) {
    e.preventDefault();
    setMsg("");
    setMsgIsError(false);

    if (isMonthlyLocked) {
      setMsg(
        "This period's checkup is already saved and can no longer be edited.",
      );
      setMsgIsError(true);
      return;
    }

    const boundsError = validateBounds(monthlyForm, MONTHLY_BOUNDS, {
      allowEmpty: true,
    });
    if (boundsError) {
      setMsg(boundsError);
      setMsgIsError(true);
      return;
    }

    setSaving(true);
    const payload = {
      user_id: profile.id,
      log_month: selectedPeriod,
      bmi: monthlyForm.bmi === "" ? null : Number(monthlyForm.bmi),
      systolic_bp:
        monthlyForm.systolic_bp === "" ? null : Number(monthlyForm.systolic_bp),
      diastolic_bp:
        monthlyForm.diastolic_bp === ""
          ? null
          : Number(monthlyForm.diastolic_bp),
      sugar: monthlyForm.sugar === "" ? null : Number(monthlyForm.sugar),
      cholesterol:
        monthlyForm.cholesterol === "" ? null : Number(monthlyForm.cholesterol),
      wellness_activity: monthlyForm.wellness_activity,
      health_check: monthlyForm.health_check,
    };
    const { error } = await supabase
      .from("monthly_logs")
      .upsert(payload, { onConflict: "user_id,log_month" });
    setSaving(false);
    setMsgIsError(!!error);
    setMsg(
      error
        ? error.message
        : `Saved checkup for ${periodLabel(selectedPeriod)}.`,
    );
    if (!error) loadMonthly(selectedPeriod);
    if (!error) loadMonthlyHistory();
  }

  const chartData = useMemo(() => {
    if (!history.length) return [];
    const now = new Date();
    if (range === "week") {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 7);
      return history
        .filter((h) => new Date(h.log_date) >= cutoff)
        .map((h) => ({
          label: h.log_date.slice(5),
          score: Number(h.daily_score),
        }));
    }
    if (range === "month") {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 30);
      return history
        .filter((h) => new Date(h.log_date) >= cutoff)
        .map((h) => ({
          label: h.log_date.slice(5),
          score: Number(h.daily_score),
        }));
    }
    const buckets = {};
    history.forEach((h) => {
      const key = h.log_date.slice(0, 7);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(Number(h.daily_score));
    });
    return Object.entries(buckets).map(([key, vals]) => ({
      label: key.slice(5),
      score:
        Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
    }));
  }, [history, range]);

  const monthlyChartData = useMemo(
    () =>
      monthlyHistory.map((m) => ({
        label: periodLabel(m.log_month),
        score: Math.round(Number(m.monthly_score) * 10) / 10,
      })),
    [monthlyHistory],
  );

  const isPastDaily = selectedDate !== todayISO();
  const isPastPeriod = selectedPeriod !== currentPeriod();

  return (
    <Shell>
      <div className="dash-header">
        <h1>Your health tracker</h1>
        <p className="dash-sub">
          Log today's numbers, your half-yearly checkup — or backfill a date or
          period you missed.
        </p>
      </div>

      <div className="score-row">
        <div className="card score-card">
          <ScoreRing
            value={dayLog?.daily_score}
            max={80}
            label={isPastDaily ? `Score for ${selectedDate}` : "Today's score"}
            color={isPastDaily ? "var(--warn)" : undefined}
          />
          {isPastDaily && (
            <button
              type="button"
              className="today-btn"
              onClick={() => setSelectedDate(todayISO())}
            >
              Back to today
            </button>
          )}
        </div>
        <div className="card score-card">
          <ScoreRing
            value={summary?.monthly_score}
            max={100}
            label={
              isPastPeriod
                ? `Score for ${periodLabel(selectedPeriod)}`
                : "This period's score"
            }
            color={
              summary?.risk_category === "Low Risk"
                ? "var(--accent)"
                : summary?.risk_category === "Moderate Risk"
                  ? "var(--warn)"
                  : "var(--risk)"
            }
          />
          {summary?.risk_category && (
            <span
              className={`risk-tag risk-${summary.risk_category.split(" ")[0].toLowerCase()}`}
            >
              {summary.risk_category}
            </span>
          )}
          {isPastPeriod && (
            <button
              type="button"
              className="today-btn"
              onClick={() => setSelectedPeriod(currentPeriod())}
            >
              Back to this period
            </button>
          )}
        </div>
      </div>

      <div className="grid-2">
        <form className="card form-card" onSubmit={saveDaily}>
          <h3>
            Daily log
            <input
              type="date"
              className="date-picker"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            {isDailyLocked ? (
              <span className="backfill-tag">Locked</span>
            ) : (
              isPastDaily && <span className="backfill-tag">Backfilling</span>
            )}
          </h3>
          {isDailyLocked && (
            <p className="dash-sub" style={{ margin: "-8px 0 12px" }}>
              This day's log is already saved and can no longer be edited.
            </p>
          )}
          <div className="field-grid">
            <label>
              Steps
              <input
                type="number"
                min={DAILY_BOUNDS.steps.min}
                max={DAILY_BOUNDS.steps.max}
                value={dailyForm.steps}
                disabled={isDailyLocked}
                onChange={(e) =>
                  setDailyForm({ ...dailyForm, steps: e.target.value })
                }
              />
            </label>
            <label>
              Exercise (min)
              <input
                type="number"
                min={DAILY_BOUNDS.exercise_minutes.min}
                max={DAILY_BOUNDS.exercise_minutes.max}
                value={dailyForm.exercise_minutes}
                disabled={isDailyLocked}
                onChange={(e) =>
                  setDailyForm({
                    ...dailyForm,
                    exercise_minutes: e.target.value,
                  })
                }
              />
            </label>
            <label>
              Water (L)
              <input
                type="number"
                min={DAILY_BOUNDS.water_l.min}
                max={DAILY_BOUNDS.water_l.max}
                step="0.1"
                value={dailyForm.water_l}
                disabled={isDailyLocked}
                onChange={(e) =>
                  setDailyForm({ ...dailyForm, water_l: e.target.value })
                }
              />
            </label>
            <label>
              Sleep (hrs)
              <input
                type="number"
                min={DAILY_BOUNDS.sleep_hours.min}
                max={DAILY_BOUNDS.sleep_hours.max}
                step="0.1"
                value={dailyForm.sleep_hours}
                disabled={isDailyLocked}
                onChange={(e) =>
                  setDailyForm({ ...dailyForm, sleep_hours: e.target.value })
                }
              />
            </label>
          </div>
          <button className="save-btn" disabled={saving || isDailyLocked}>
            {isDailyLocked ? "Locked" : `Save log for ${selectedDate}`}
          </button>
        </form>

        <form className="card form-card" onSubmit={saveMonthly}>
          <h3>
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
                onClick={() => setSelectedPeriod(prevPeriod(selectedPeriod))}
              >
                ‹
              </button>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {periodLabel(selectedPeriod)}
              </span>
              <button
                type="button"
                className="today-btn"
                aria-label="Next period"
                disabled={selectedPeriod === currentPeriod()}
                onClick={() => setSelectedPeriod(nextPeriod(selectedPeriod))}
              >
                ›
              </button>
            </span>
            {isMonthlyLocked ? (
              <span className="backfill-tag">Locked</span>
            ) : (
              isPastPeriod && <span className="backfill-tag">Backfilling</span>
            )}
          </h3>
          {isMonthlyLocked && (
            <p className="dash-sub" style={{ margin: "-8px 0 12px" }}>
              This period's checkup is already saved and can no longer be
              edited.
            </p>
          )}
          <div className="field-grid">
            <label>
              BMI
              <input
                type="number"
                min={MONTHLY_BOUNDS.bmi.min}
                max={MONTHLY_BOUNDS.bmi.max}
                step="0.1"
                value={monthlyForm.bmi}
                disabled={isMonthlyLocked}
                onChange={(e) =>
                  setMonthlyForm({ ...monthlyForm, bmi: e.target.value })
                }
              />
            </label>
            <label>
              Systolic BP
              <input
                type="number"
                min={MONTHLY_BOUNDS.systolic_bp.min}
                max={MONTHLY_BOUNDS.systolic_bp.max}
                value={monthlyForm.systolic_bp}
                disabled={isMonthlyLocked}
                onChange={(e) =>
                  setMonthlyForm({
                    ...monthlyForm,
                    systolic_bp: e.target.value,
                  })
                }
              />
            </label>
            <label>
              Diastolic BP
              <input
                type="number"
                min={MONTHLY_BOUNDS.diastolic_bp.min}
                max={MONTHLY_BOUNDS.diastolic_bp.max}
                value={monthlyForm.diastolic_bp}
                disabled={isMonthlyLocked}
                onChange={(e) =>
                  setMonthlyForm({
                    ...monthlyForm,
                    diastolic_bp: e.target.value,
                  })
                }
              />
            </label>
            <label>
              Sugar
              <input
                type="number"
                min={MONTHLY_BOUNDS.sugar.min}
                max={MONTHLY_BOUNDS.sugar.max}
                value={monthlyForm.sugar}
                disabled={isMonthlyLocked}
                onChange={(e) =>
                  setMonthlyForm({ ...monthlyForm, sugar: e.target.value })
                }
              />
            </label>
            <label>
              Cholesterol
              <input
                type="number"
                min={MONTHLY_BOUNDS.cholesterol.min}
                max={MONTHLY_BOUNDS.cholesterol.max}
                value={monthlyForm.cholesterol}
                disabled={isMonthlyLocked}
                onChange={(e) =>
                  setMonthlyForm({
                    ...monthlyForm,
                    cholesterol: e.target.value,
                  })
                }
              />
            </label>
          </div>
          <div className="check-row">
            <label className="check-label">
              <input
                type="checkbox"
                checked={monthlyForm.wellness_activity}
                disabled={isMonthlyLocked}
                onChange={(e) =>
                  setMonthlyForm({
                    ...monthlyForm,
                    wellness_activity: e.target.checked,
                  })
                }
              />
              Attended a wellness activity
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={monthlyForm.health_check}
                disabled={isMonthlyLocked}
                onChange={(e) =>
                  setMonthlyForm({
                    ...monthlyForm,
                    health_check: e.target.checked,
                  })
                }
              />
              Completed health check
            </label>
          </div>
          <button className="save-btn" disabled={saving || isMonthlyLocked}>
            {isMonthlyLocked
              ? "Locked"
              : `Save checkup for ${periodLabel(selectedPeriod)}`}
          </button>
        </form>
      </div>

      {msg && (
        <div className={msgIsError ? "msg-bar msg-bar-error" : "msg-bar"}>
          {msg}
        </div>
      )}

      <div className="card chart-card">
        <div className="chart-head">
          <h3>Score trend</h3>
          <div className="range-toggle">
            {["week", "month", "year"].map((r) => (
              <button
                key={r}
                className={range === r ? "active" : ""}
                onClick={() => setRange(r)}
                type="button"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" fontSize={11} stroke="var(--muted)" />
            <YAxis fontSize={11} stroke="var(--muted)" width={30} />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--line)",
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="card chart-card">
        <div className="chart-head">
          <h3>Half-yearly checkup trend</h3>
        </div>
        {monthlyChartData.length === 0 ? (
          <div className="empty-state">No checkups saved yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyChartData}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="label" fontSize={11} stroke="var(--muted)" />
              <YAxis fontSize={11} stroke="var(--muted)" width={30} />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="var(--warn)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Shell>
  );
}
