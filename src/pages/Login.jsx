import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./auth.css";

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
    setBusy(true);
    const { error, aal } = await signIn(email, password);
    setBusy(false);

    if (error) {
      if (error.status === 429 && error.locked_until) {
        const until = new Date(error.locked_until).getTime();
        setLockedUntil(until);
        setError(
          `Too many failed attempts. Try again in ${formatDuration(until - Date.now())}.`,
        );
      } else if (error.attempts_left != null) {
        setError(
          `${error.message} (${error.attempts_left} attempt${error.attempts_left === 1 ? "" : "s"} left before lockout)`,
        );
      } else {
        setError(error.message || "Login failed");
      }
      return;
    }

    // account has a second factor enrolled and this session hasn't cleared it yet
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
      navigate("/mfa-verify");
      return;
    }

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
