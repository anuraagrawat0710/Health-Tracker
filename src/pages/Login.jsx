import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./auth.css";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000; // 60 seconds

function attemptsKey(email) {
  return `login_attempts_${email.trim().toLowerCase()}`;
}

function readAttempts(email) {
  try {
    const raw = localStorage.getItem(attemptsKey(email));
    if (!raw) return { count: 0, lockedUntil: 0 };
    return JSON.parse(raw);
  } catch {
    return { count: 0, lockedUntil: 0 };
  }
}

function writeAttempts(email, data) {
  try {
    localStorage.setItem(attemptsKey(email), JSON.stringify(data));
  } catch {
    /* ignore storage errors */
  }
}

function clearAttempts(email) {
  try {
    localStorage.removeItem(attemptsKey(email));
  } catch {
    /* ignore */
  }
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

  // tick every second so the countdown updates
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const isLocked = lockedUntil > now;
  const secondsLeft = Math.ceil((lockedUntil - now) / 1000);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const { count, lockedUntil: storedLock } = readAttempts(email);
    if (storedLock > Date.now()) {
      setLockedUntil(storedLock);
      setError(
        `Too many failed attempts. Try again in ${Math.ceil((storedLock - Date.now()) / 1000)}s.`,
      );
      return;
    }

    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);

    if (error) {
      const nextCount = count + 1;
      if (nextCount >= MAX_ATTEMPTS) {
        const lockUntil = Date.now() + LOCKOUT_MS;
        writeAttempts(email, { count: 0, lockedUntil: lockUntil });
        setLockedUntil(lockUntil);
        setError(`Too many failed attempts. Locked for ${LOCKOUT_MS / 1000}s.`);
      } else {
        writeAttempts(email, { count: nextCount, lockedUntil: 0 });
        setError(
          `${error.message} (${MAX_ATTEMPTS - nextCount} attempt${MAX_ATTEMPTS - nextCount === 1 ? "" : "s"} left before lockout)`,
        );
      }
      return;
    }

    clearAttempts(email);
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
              ? `Locked — try again in ${secondsLeft}s`
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
