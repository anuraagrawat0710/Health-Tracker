import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./auth.css";

// First lockout triggers after 5 failed attempts.
// Every lockout after that triggers after only 2 more failed attempts.
const FIRST_ROUND_ATTEMPTS = 5;
const REPEAT_ROUND_ATTEMPTS = 2;

// Escalating lockout durations — tier 0 is the first lockout, tier 1 the next, etc.
// Stays at the last value (24h) for any further tier.
const LOCKOUT_TIERS_MS = [
  60 * 1000, // 60 seconds
  60 * 60 * 1000, // 1 hour
  6 * 60 * 60 * 1000, // 6 hours
  12 * 60 * 60 * 1000, // 12 hours
  24 * 60 * 60 * 1000, // 1 day
];

function attemptsKey(email) {
  return `login_attempts_${email.trim().toLowerCase()}`;
}

function readState(email) {
  try {
    const raw = localStorage.getItem(attemptsKey(email));
    if (!raw) return { count: 0, lockedUntil: 0, tier: 0 };
    const parsed = JSON.parse(raw);
    return {
      count: parsed.count || 0,
      lockedUntil: parsed.lockedUntil || 0,
      tier: parsed.tier || 0,
    };
  } catch {
    return { count: 0, lockedUntil: 0, tier: 0 };
  }
}

function writeState(email, data) {
  try {
    localStorage.setItem(attemptsKey(email), JSON.stringify(data));
  } catch {
    /* ignore storage errors */
  }
}

function clearState(email) {
  try {
    localStorage.removeItem(attemptsKey(email));
  } catch {
    /* ignore */
  }
}

function formatDuration(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.ceil(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.ceil(h / 24);
  return `${d}d`;
}

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const isLocked = lockedUntil > now;
  const msLeft = lockedUntil - now;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const state = readState(email);

    if (state.lockedUntil > Date.now()) {
      setLockedUntil(state.lockedUntil);
      setError(
        `Too many failed attempts. Try again in ${formatDuration(state.lockedUntil - Date.now())}.`,
      );
      return;
    }

    // lockout window passed — reset count for this new round, keep tier
    const activeCount = state.lockedUntil > 0 ? 0 : state.count;
    const maxAttempts =
      state.tier === 0 ? FIRST_ROUND_ATTEMPTS : REPEAT_ROUND_ATTEMPTS;

    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);

    if (error) {
      const nextCount = activeCount + 1;
      if (nextCount >= maxAttempts) {
        const tierIndex = Math.min(state.tier, LOCKOUT_TIERS_MS.length - 1);
        const duration = LOCKOUT_TIERS_MS[tierIndex];
        const lockUntil = Date.now() + duration;
        writeState(email, {
          count: 0,
          lockedUntil: lockUntil,
          tier: state.tier + 1,
        });
        setLockedUntil(lockUntil);
        setError(
          `Too many failed attempts. Locked for ${formatDuration(duration)}.`,
        );
      } else {
        writeState(email, {
          count: nextCount,
          lockedUntil: 0,
          tier: state.tier,
        });
        const remaining = maxAttempts - nextCount;
        setError(
          `${error.message} (${remaining} attempt${remaining === 1 ? "" : "s"} left before lockout)`,
        );
      }
      return;
    }

    clearState(email);
    navigate("/");
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">BPL</div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Log in to track today's numbers.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLocked}
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button
            className="auth-btn"
            type="submit"
            disabled={busy || isLocked}
          >
            {isLocked
              ? `Locked — try again in ${formatDuration(msLeft)}`
              : busy
                ? "Signing in…"
                : "Sign in"}
          </button>
        </form>

        <p className="auth-foot">
          No account yet? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
