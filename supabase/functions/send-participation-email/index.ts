// Supabase Edge Function: send-participation-email
//
// Sends either a "reminder" or "thanks" email to a list of employees.
// The Resend API key stays server-side as a Supabase secret — it is
// NEVER exposed to the browser.
//
// Deploy with:
//   supabase functions deploy send-participation-email
// Set the secret with:
//   supabase secrets set RESEND_API_KEY=your_resend_key
//   supabase secrets set RESEND_FROM="Health Tracker <onboarding@resend.dev>"
//
// Call from the frontend with supabase.functions.invoke(...)

import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "onboarding@resend.dev";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUBJECTS = {
  reminder: "Reminder: log today's health check-in",
  thanks: "Thanks for logging your health check-in today!",
};

function buildEmailBody(type, fullName) {
  const name = fullName || "there";
  if (type === "reminder") {
    return {
      subject: SUBJECTS.reminder,
      html: `<p>Hi ${name},</p><p>Just a friendly reminder that you haven't logged your daily health check-in yet today. It only takes a minute — please log it when you get a chance.</p><p>Thanks!</p>`,
    };
  }
  return {
    subject: SUBJECTS.thanks,
    html: `<p>Hi ${name},</p><p>Thanks for logging your daily health check-in today! We appreciate you staying on top of it.</p>`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (!RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY is not configured" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  try {
    // Verify the caller is a logged-in owner before sending anything.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (profileErr || profile?.role !== "owner") {
      return new Response(JSON.stringify({ error: "Forbidden: owner only" }), {
        status: 403,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { type, recipients } = await req.json();

    if (type !== "reminder" && type !== "thanks") {
      return new Response(JSON.stringify({ error: "type must be 'reminder' or 'thanks'" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "recipients must be a non-empty array" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const results = await Promise.all(
      recipients.map(async (r) => {
        if (!r?.email) return { email: r?.email ?? null, ok: false, error: "missing email" };
        const { subject, html } = buildEmailBody(type, r.full_name);
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: r.email,
              subject,
              html,
            }),
          });
          if (!res.ok) {
            const errText = await res.text();
            return { email: r.email, ok: false, error: errText };
          }
          return { email: r.email, ok: true };
        } catch (err) {
          return { email: r.email, ok: false, error: String(err) };
        }
      }),
    );

    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    return new Response(JSON.stringify({ sent, failed }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
