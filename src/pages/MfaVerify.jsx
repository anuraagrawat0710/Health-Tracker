import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./auth.css";

export default function MfaVerify() {
  const { session, listFactors, challengeAndVerify } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState(null);
  const [loadingFactor, setLoadingFactor] = useState(true);

  useEffect(() => {
    async function load() {
      const { data, error } = await listFactors();
      if (error) {
        setError(error.message);
        setLoadingFactor(false);
        return;
      }
      const totp = (data.totp || []).find((f) => f.status === "verified");
      setFactorId(totp?.id || null);
      setLoadingFactor(false);
    }
    load();
  }, []);

  if (!session) return <Navigate to="/login" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!factorId) {
      setError("No authenticator found on this account.");
      return;
    }
    setError("");
    setBusy(true);
    const { error } = await challengeAndVerify(factorId, code);
    setBusy(false);
    if (error) {
      setError(error.message || "Invalid code");
      return;
    }
    navigate("/");
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">BPL</div>
        <h1 className="auth-title">Two-factor verification</h1>
        <p className="auth-sub">
          Enter the 6-digit code from your authenticator app.
        </p>

        {loadingFactor ? (
          <div className="auth-sub">Loading…</div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <label>
              Authentication code
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
                autoFocus
              />
            </label>
            {error && <div className="auth-error">{error}</div>}
            <button
              className="auth-btn"
              type="submit"
              disabled={busy || code.length !== 6}
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
