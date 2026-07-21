import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import "./auth.css";

export default function VerifyEmail() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const email = session?.user?.email;

  async function resend() {
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  async function refreshAndContinue() {
    // pulls the latest session — if the user clicked the email link in another tab,
    // email_confirmed_at will now be set and ProtectedRoute will let them through
    await supabase.auth.refreshSession();
    navigate("/");
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">BPL</div>
        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-sub">
          Confirm <strong>{email}</strong> before you can use the tracker. Check
          your inbox for the link we sent when you signed up.
        </p>

        {error && <div className="auth-error">{error}</div>}
        {sent && !error && (
          <div
            className="auth-sub"
            style={{ color: "var(--accent)", marginBottom: 16 }}
          >
            Confirmation email resent.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="auth-btn" onClick={refreshAndContinue}>
            I've confirmed — continue
          </button>
          <button
            className="auth-btn"
            style={{
              background: "transparent",
              color: "var(--ink-soft)",
              border: "1px solid var(--line)",
            }}
            onClick={resend}
            disabled={busy}
          >
            {busy ? "Sending…" : "Resend confirmation email"}
          </button>
          <button
            className="auth-btn"
            style={{
              background: "transparent",
              color: "var(--muted)",
              border: "none",
            }}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
