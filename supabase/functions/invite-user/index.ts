import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODULES = ["dashboard", "transactions", "accounts", "analytics", "openFinance", "investments", "exports", "settings", "users"] as const;
const ACTIONS = ["view", "create", "edit", "delete"] as const;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function sanitizePermissions(input: unknown) {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const result: Record<string, Record<string, boolean>> = {};
  for (const module of MODULES) {
    const moduleSource = (source[module] && typeof source[module] === "object" ? source[module] : {}) as Record<string, unknown>;
    result[module] = {};
    for (const action of ACTIONS) result[module][action] = moduleSource[action] === true;
  }
  return result;
}

Deno.serve(async (request) => {
  const headers = corsHeaders();
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = request.headers.get("Authorization") || "";

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userResult, error: userError } = await callerClient.auth.getUser();
  const caller = userResult?.user;
  if (userError || !caller) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers });
  }

  const workspaceId = String(body.workspaceId || "");
  const email = String(body.email || "").trim().toLowerCase();
  const role = ["admin", "operator", "viewer", "custom"].includes(String(body.role)) ? String(body.role) : "custom";
  const permissions = sanitizePermissions(body.permissions);
  const redirectTo = typeof body.redirectTo === "string" ? body.redirectTo : undefined;

  if (!workspaceId || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "invalid_input" }), { status: 400, headers });
  }

  const { data: adminProfile } = await adminClient
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", caller.id)
    .maybeSingle();

  const { data: membership } = await adminClient
    .from("workspace_memberships")
    .select("permissions")
    .eq("workspace_id", workspaceId)
    .eq("user_id", caller.id)
    .eq("active", true)
    .maybeSingle();

  const canManage = adminProfile?.is_platform_admin === true || membership?.permissions?.users?.create === true;
  if (!canManage) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });

  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id,email")
    .ilike("email", email)
    .maybeSingle();

  let targetUserId = existingProfile?.id as string | undefined;
  let invited = false;

  if (!targetUserId) {
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (inviteError || !inviteData.user) {
      return new Response(JSON.stringify({ error: "invite_failed", detail: inviteError?.message }), { status: 400, headers });
    }
    targetUserId = inviteData.user.id;
    invited = true;
  }

  const { error: membershipError } = await adminClient
    .from("workspace_memberships")
    .upsert({
      workspace_id: workspaceId,
      user_id: targetUserId,
      role,
      permissions,
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,user_id" });

  if (membershipError) {
    return new Response(JSON.stringify({ error: "membership_failed", detail: membershipError.message }), { status: 400, headers });
  }

  await adminClient.from("audit_log").insert({
    workspace_id: workspaceId,
    actor_user_id: caller.id,
    action: "member_grant",
    details: { targetUserId, email, role, invited },
  });

  return new Response(JSON.stringify({ ok: true, invited, userId: targetUserId }), { status: 200, headers });
});
