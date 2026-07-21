import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./auth.css";

const RULES = [
  { key: "length", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { key: "upper", label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { key: "lower", label: "One lowercase letter", test: (p) => /[a-z]/.test(p) },
  { key: "number", label: "One number", test: (p) => /[0-9]/.test(p) },
  {
    key: "special",
    label: "One special character",
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

function passwordIsValid(password) {
  return RULES.every((r) => r.test(password));
}

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!passwordIsValid(password)) {
      setPasswordTouched(true);
      setError("Password does not meet the requirements below.");
      return;
    }

    setBusy(true);
    const { error } = await signUp(email, password, fullName);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-mark">BPL</div>
          <h1 className="auth-title">Check your inbox</h1>
          <p className="auth-sub">
            We sent a confirmation link to {email}. Confirm it, then sign in.
          </p>
          <Link
            to="/login"
            className="auth-btn"
            style={{
              display: "inline-block",
              textAlign: "center",
              textDecoration: "none",
            }}
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">BPL</div>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Start logging your daily numbers.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Full name
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPasswordTouched(true)}
              required
            />
          </label>

          {passwordTouched && (
            <ul className="pw-rules">
              {RULES.map((r) => {
                const pass = r.test(password);
                return (
                  <li key={r.key} className={pass ? "pw-ok" : "pw-pending"}>
                    <span className="pw-mark">{pass ? "✓" : "·"}</span>{" "}
                    {r.label}
                  </li>
                );
              })}
            </ul>
          )}

          {error && <div className="auth-error">{error}</div>}
          <button className="auth-btn" type="submit" disabled={busy}>
            {busy ? "Creating account…" : "Sign up"}
          </button>
        </form>

        <p className="auth-foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
