import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (!error) setProfile(data);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) loadProfile(session.user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session?.user) {
          loadProfile(session.user.id);
        } else {
          setProfile(null);
        }
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signUp(email, password, fullName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    return { data, error };
  }

  async function signIn(email, password) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const res = await fetch(`${supabaseUrl}/functions/v1/login-guard`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      // shape it like a normal supabase error object so callers don't need to change
      return {
        data: null,
        error: {
          message: data.message || "Login failed",
          status: res.status,
          locked_until: data.locked_until,
          attempts_left: data.attempts_left,
        },
      };
    }

    // data here is the raw Supabase auth token response — set the session manually
    const { error } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    return { data, error };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  const value = {
    session,
    profile,
    loading,
    signUp,
    signIn,
    signOut,
    refreshProfile: () => session?.user && loadProfile(session.user.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
