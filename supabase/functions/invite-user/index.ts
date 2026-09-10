import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const MODULES = ['dashboard', 'transactions', 'accounts', 'analytics', 'openFinance', 'investments', 'exports', 'settings', 'users'] as const
const ACTIONS = ['view', 'create', 'edit', 'delete'] as const

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

function sanitizePermissions(input: unknown) {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const result: Record<string, Record<string, boolean>> = {}
  for (const module of MODULES) {
    const moduleSource = (source[module] && typeof source[module] === 'object' ? source[module] : {}) as Record<string, unknown>
    result[module] = {}
    for (const action of ACTIONS) result[module][action] = moduleSource[action] === true
  }
  return result
}

function permissionSubset(requested: Record<string, Record<string, boolean>>, caller: Record<string, Record<string, boolean>>) {
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      if (requested[module]?.[action] === true && caller[module]?.[action] !== true) return false
    }
  }
  return true
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return respond({ error: 'method_not_allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}')
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
    const publishableKey = publishableKeys.default ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const secretKey = secretKeys.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !publishableKey || !secretKey) return respond({ error: 'backend_keys_missing' }, 500)

    const authorization = request.headers.get('Authorization') ?? ''
    const accessToken = authorization.replace(/^Bearer\s+/i, '')
    if (!accessToken) return respond({ error: 'unauthorized' }, 401)

    const callerClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userResult, error: userError } = await callerClient.auth.getUser(accessToken)
    const caller = userResult.user
    if (userError || !caller) return respond({ error: 'unauthorized' }, 401)

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const workspaceId = String(body.workspaceId ?? '')
    const email = String(body.email ?? '').trim().toLowerCase()
    const role = ['admin', 'operator', 'viewer', 'custom'].includes(String(body.role)) ? String(body.role) : 'custom'
    const requestedPermissions = sanitizePermissions(body.permissions)
    const redirectTo = typeof body.redirectTo === 'string' && body.redirectTo.startsWith('https://') ? body.redirectTo : undefined

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !workspaceId) return respond({ error: 'invalid_input' }, 400)

    const { data: adminProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', caller.id)
      .maybeSingle()
    if (profileError) throw profileError
    const isPlatformAdmin = adminProfile?.is_platform_admin === true

    const { data: callerMembership, error: membershipError } = await adminClient
      .from('workspace_memberships')
      .select('role,permissions,active')
      .eq('workspace_id', workspaceId)
      .eq('user_id', caller.id)
      .eq('active', true)
      .maybeSingle()
    if (membershipError) throw membershipError

    if (!isPlatformAdmin && !callerMembership) return respond({ error: 'forbidden' }, 403)

    const callerPermissions = sanitizePermissions(callerMembership?.permissions)
    const canCreateUsers = isPlatformAdmin || callerPermissions.users?.create === true
    if (!canCreateUsers) return respond({ error: 'forbidden' }, 403)

    if (!isPlatformAdmin) {
      if (!permissionSubset(requestedPermissions, callerPermissions)) return respond({ error: 'permission_escalation_blocked' }, 403)
      if (role === 'admin' && !['owner', 'admin'].includes(callerMembership?.role ?? '')) return respond({ error: 'role_escalation_blocked' }, 403)
    }

    const { data: workspace, error: workspaceError } = await adminClient.from('workspaces').select('id,active').eq('id', workspaceId).maybeSingle()
    if (workspaceError || !workspace?.active) return respond({ error: 'workspace_not_found' }, 404)

    const { data: existingProfile, error: existingProfileError } = await adminClient
      .from('profiles')
      .select('id,email')
      .ilike('email', email)
      .maybeSingle()
    if (existingProfileError) throw existingProfileError

    let targetUserId = existingProfile?.id as string | undefined
    let invited = false

    if (!targetUserId) {
      const options = redirectTo ? { redirectTo, data: { invited_workspace_id: workspaceId } } : { data: { invited_workspace_id: workspaceId } }
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, options)
      if (inviteError || !inviteData.user) return respond({ error: 'invite_failed', detail: inviteError?.message }, 400)
      targetUserId = inviteData.user.id
      invited = true
    }

    if (targetUserId === caller.id) return respond({ error: 'self_membership_change_not_allowed' }, 400)

    const { data: existingMembership } = await adminClient
      .from('workspace_memberships')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId)
      .maybeSingle()
    if (existingMembership?.role === 'owner') return respond({ error: 'owner_membership_protected' }, 400)

    const { error: upsertError } = await adminClient
      .from('workspace_memberships')
      .upsert({
        workspace_id: workspaceId,
        user_id: targetUserId,
        role,
        permissions: requestedPermissions,
        active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,user_id' })
    if (upsertError) throw upsertError

    await adminClient.from('audit_log').insert({
      workspace_id: workspaceId,
      actor_user_id: caller.id,
      action: invited ? 'member_invite' : 'member_grant',
      details: { targetUserId, email, role, invited },
    })

    return respond({ ok: true, invited, userId: targetUserId })
  } catch (error) {
    console.error('invite-user', error)
    return respond({ error: 'internal_error' }, 500)
  }
})
