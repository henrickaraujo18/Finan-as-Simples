import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const defaultPermissions = (role: string) => {
  if (role === 'owner' || role === 'admin') return {
    finance: { view: true, write: true },
    open_finance: { view: true, manage: true },
    investments: { view: true, write: true },
    users: { manage: true },
  }
  if (role === 'editor') return {
    finance: { view: true, write: true },
    open_finance: { view: true, manage: false },
    investments: { view: true, write: true },
    users: { manage: false },
  }
  return {
    finance: { view: true, write: false },
    open_finance: { view: false, manage: false },
    investments: { view: false, write: false },
    users: { manage: false },
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}')
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
    const publishableKey = publishableKeys.default
    const secretKey = secretKeys.default
    if (!supabaseUrl || !publishableKey || !secretKey) return json({ error: 'Backend sem chaves configuradas.' }, 500)

    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Sessão ausente.' }, 401)

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userError } = await userClient.auth.getUser(token)
    const user = userData.user
    if (userError || !user) return json({ error: 'Sessão inválida.' }, 401)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action ?? '')
    const workspaceId = String(body.workspaceId ?? '')
    const isPlatformAdmin = user.app_metadata?.platform_admin === true

    const requireWorkspaceManager = async () => {
      if (isPlatformAdmin) return true
      if (!workspaceId) return false
      const { data, error } = await adminClient
        .from('workspace_members')
        .select('role,permissions,status')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (error || !data || data.status !== 'active') return false
      return ['owner', 'admin'].includes(data.role) || data.permissions?.users?.manage === true
    }

    if (action === 'list_members') {
      if (!await requireWorkspaceManager()) return json({ error: 'Sem permissão para gerenciar usuários.' }, 403)
      const { data: members, error } = await adminClient
        .from('workspace_members')
        .select('id,workspace_id,user_id,role,permissions,status,created_at,updated_at')
        .eq('workspace_id', workspaceId)
        .order('created_at')
      if (error) throw error
      const ids = [...new Set((members ?? []).map((item) => item.user_id))]
      const { data: profiles } = ids.length
        ? await adminClient.from('profiles').select('id,email,display_name').in('id', ids)
        : { data: [] }
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
      return json({ members: (members ?? []).map((member) => ({ ...member, profile: profileMap.get(member.user_id) ?? null })) })
    }

    if (action === 'invite') {
      if (!await requireWorkspaceManager()) return json({ error: 'Sem permissão para convidar usuários.' }, 403)
      const email = String(body.email ?? '').trim().toLowerCase()
      const role = String(body.role ?? 'viewer')
      if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'E-mail inválido.' }, 400)
      if (!['admin','editor','viewer','custom'].includes(role)) return json({ error: 'Perfil inválido.' }, 400)
      const permissions = (body.permissions && typeof body.permissions === 'object') ? body.permissions : defaultPermissions(role)

      let invitedUserId = ''
      const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { invited_workspace_id: workspaceId },
      })
      if (inviteError) {
        const { data: usersPage, error: listError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
        if (listError) throw inviteError
        const existing = usersPage.users.find((candidate) => candidate.email?.toLowerCase() === email)
        if (!existing) throw inviteError
        invitedUserId = existing.id
      } else {
        invitedUserId = invited.user?.id ?? ''
      }
      if (!invitedUserId) return json({ error: 'Não foi possível identificar o usuário convidado.' }, 500)

      const { error: memberError } = await adminClient.from('workspace_members').upsert({
        workspace_id: workspaceId,
        user_id: invitedUserId,
        role,
        permissions,
        status: 'active',
        invited_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,user_id' })
      if (memberError) throw memberError

      await adminClient.from('audit_log').insert({
        workspace_id: workspaceId,
        actor_user_id: user.id,
        action: 'member.invite',
        entity_type: 'workspace_member',
        entity_id: invitedUserId,
        details: { email, role },
      })
      return json({ ok: true, userId: invitedUserId })
    }

    if (action === 'update_member') {
      if (!await requireWorkspaceManager()) return json({ error: 'Sem permissão para alterar usuários.' }, 403)
      const memberId = String(body.memberId ?? '')
      const role = String(body.role ?? 'viewer')
      const status = String(body.status ?? 'active')
      const permissions = (body.permissions && typeof body.permissions === 'object') ? body.permissions : defaultPermissions(role)
      const { data: current, error: currentError } = await adminClient.from('workspace_members').select('role,user_id').eq('id', memberId).eq('workspace_id', workspaceId).maybeSingle()
      if (currentError || !current) return json({ error: 'Usuário não encontrado.' }, 404)
      if (current.role === 'owner') return json({ error: 'O proprietário não pode ser rebaixado por esta tela.' }, 400)
      const { error } = await adminClient.from('workspace_members').update({ role, status, permissions, updated_at: new Date().toISOString() }).eq('id', memberId).eq('workspace_id', workspaceId)
      if (error) throw error
      await adminClient.from('audit_log').insert({ workspace_id: workspaceId, actor_user_id: user.id, action: 'member.update', entity_type: 'workspace_member', entity_id: current.user_id, details: { role, status } })
      return json({ ok: true })
    }

    if (action === 'remove_member') {
      if (!await requireWorkspaceManager()) return json({ error: 'Sem permissão para remover usuários.' }, 403)
      const memberId = String(body.memberId ?? '')
      const { data: current, error: currentError } = await adminClient.from('workspace_members').select('role,user_id').eq('id', memberId).eq('workspace_id', workspaceId).maybeSingle()
      if (currentError || !current) return json({ error: 'Usuário não encontrado.' }, 404)
      if (current.role === 'owner') return json({ error: 'O proprietário não pode ser removido.' }, 400)
      const { error } = await adminClient.from('workspace_members').delete().eq('id', memberId).eq('workspace_id', workspaceId)
      if (error) throw error
      await adminClient.from('audit_log').insert({ workspace_id: workspaceId, actor_user_id: user.id, action: 'member.remove', entity_type: 'workspace_member', entity_id: current.user_id, details: {} })
      return json({ ok: true })
    }

    return json({ error: 'Ação inválida.' }, 400)
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Erro interno.' }, 500)
  }
})
