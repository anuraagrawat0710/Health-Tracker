import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import Shell from "../components/Shell";
import "./mfa-setup.css";

export default function MfaSetup() {
  const { enrollTOTP, verifyEnrollment, listFactors, unenrollFactor } = useAuth();
  const [factors, setFactors] = useState([]);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadFactors() {
    const { data, error } = await listFactors();
    if (!error) setFactors((data.totp || []).filter((f) => f.status === "verified"));
  }

  useEffect(() => {
    loadFactors();
  }, []);

  async function startEnroll() {
    setError("");
    setMsg("");
    setBusy(true);
    const { data, error } = await enrollTOTP();
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setEnrolling(true);
  }

  async function confirmEnroll(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await verifyEnrollment(factorId, code);
    setBusy(false);
    if (error) {
      setError(error.message || "Invalid code");
      return;
    }
    setMsg("Two-factor authentication enabled.");
    setEnrolling(false);
    setCode("");
    loadFactors();
  }

  async function removeFactor(id) {
    setError("");
    setMsg("");
    setBusy(true);
    const { error } = await unenrollFactor(id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setMsg("Two-factor authentication removed.");
    loadFactors();
  }

  return (
    <Shell>
      <div className="dash-header">
        <h1>Security</h1>
        <p className="dash-sub">Manage two-factor authentication for your account.</p>
      </div>

      <div className="card mfa-card">
        {factors.length > 0 ? (
          <>
            <p>
              Two-factor authentication is <strong>enabled</strong>.
            </p>
            {factors.map((f) => (
              <div key={f.id} className="mfa-factor-row">
                <span>{f.friendly_name || "Authenticator app"}</span>
                <button
                  className="today-btn"
                  onClick={() => removeFactor(f.id)}
                  disabled={busy}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
          </>
        ) : enrolling ? (
          <form onSubmit={confirmEnroll} className="auth-form">
            <p>
              Scan this QR code with your authenticator app (Google Authenticator,
              Authy, 1Password, etc):
            </p>
            {qrCode && <img src={qrCode} alt="TOTP QR code" className="mfa-qr" />}
            <p className="mfa-secret">
              Or enter this key manually: <code>{secret}</code>
            </p>
            <label>
              Enter the 6-digit code to confirm
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
              className="save-btn"
              type="submit"
              disabled={busy || code.length !== 6}
            >
              {busy ? "Verifying…" : "Confirm"}
            </button>
          </form>
        ) : (
          <>
            <p>
              Two-factor authentication is <strong>not enabled</strong>. Add an
              extra layer of security to your account.
            </p>
            {error && <div className="auth-error">{error}</div>}
            <button
              className="save-btn"
              onClick={startEnroll}
              disabled={busy}
              type="button"
            >
              {busy ? "Starting…" : "Enable two-factor authentication"}
            </button>
          </>
        )}
        {msg && <div className="msg-bar">{msg}</div>}
      </div>
    </Shell>
  );
}
