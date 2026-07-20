import { useAuth } from "../context/AuthContext";
import "./Shell.css";

export default function Shell({ children }) {
  const { profile, signOut } = useAuth();

  return (
    <div className="shell">
      <header className="shell-top">
        <div className="shell-mark">BPL</div>
        <div className="shell-user">
          <div className="shell-user-info">
            <span className="shell-user-name">
              {profile?.full_name || profile?.email}
            </span>
            <span className="shell-user-role">
              {profile?.role === "owner" ? "Owner" : "Employee"}
            </span>
          </div>
          <button className="shell-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}
