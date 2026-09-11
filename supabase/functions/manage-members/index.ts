import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const MODULES = ['dashboard','transactions','accounts','analytics','openFinance','investments','exports','settings','users'] as const
const ACTIONS = ['view','create','edit','delete'] as const
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
const respond = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers})
function sanitizePermissions(input: unknown) {
  const source=(input&&typeof input==='object'?input:{}) as Record<string,unknown>; const result:Record<string,Record<string,boolean>>={}
  for(const module of MODULES){ const m=(source[module]&&typeof source[module]==='object'?source[module]:{}) as Record<string,unknown>; result[module]={}; for(const action of ACTIONS) result[module][action]=m[action]===true }
  return result
}
function subset(requested:Record<string,Record<string,boolean>>, caller:Record<string,Record<string,boolean>>){ for(const m of MODULES) for(const a of ACTIONS) if(requested[m]?.[a]===true&&caller[m]?.[a]!==true) return false; return true }

Deno.serve(async (request:Request)=>{
  if(request.method==='OPTIONS') return new Response('ok',{headers})
  if(request.method!=='POST') return respond({error:'method_not_allowed'},405)
  try{
    const supabaseUrl=Deno.env.get('SUPABASE_URL')??''
    const publishableKeys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')??'{}')
    const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')??'{}')
    const publishableKey=publishableKeys.default??''; const secretKey=secretKeys.default??''
    if(!supabaseUrl||!publishableKey||!secretKey) return respond({error:'backend_keys_missing'},500)
    const authorization=request.headers.get('Authorization')??''; const accessToken=authorization.replace(/^Bearer\s+/i,'')
    if(!accessToken) return respond({error:'unauthorized'},401)
    const callerClient=createClient(supabaseUrl,publishableKey,{global:{headers:{Authorization:`Bearer ${accessToken}`}},auth:{persistSession:false,autoRefreshToken:false}})
    const admin=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false}})
    const userResult=await callerClient.auth.getUser(accessToken); const caller=userResult.data.user
    if(userResult.error||!caller) return respond({error:'unauthorized'},401)
    const body=await request.json().catch(()=>({})) as Record<string,unknown>; const action=String(body.action??'list'); const workspaceId=String(body.workspaceId??'')
    if(!workspaceId) return respond({error:'invalid_workspace'},400)
    const profile=await admin.from('profiles').select('is_platform_admin').eq('id',caller.id).maybeSingle(); if(profile.error) throw profile.error
    const isPlatformAdmin=profile.data?.is_platform_admin===true
    const membership=await admin.from('workspace_memberships').select('role,permissions,active').eq('workspace_id',workspaceId).eq('user_id',caller.id).eq('active',true).maybeSingle(); if(membership.error) throw membership.error
    if(!membership.data&&!isPlatformAdmin) return respond({error:'forbidden'},403)
    const callerPermissions=sanitizePermissions(membership.data?.permissions); const callerRole=membership.data?.role??''
    const can=(kind:'view'|'edit'|'delete')=>isPlatformAdmin||callerRole==='owner'||callerPermissions.users?.[kind]===true
    if(action==='list'){
      if(!can('view')) return respond({error:'forbidden'},403)
      const workspace=await admin.from('workspaces').select('owner_user_id').eq('id',workspaceId).maybeSingle(); if(workspace.error||!workspace.data) return respond({error:'workspace_not_found'},404)
      const memberships=await admin.from('workspace_memberships').select('user_id,role,permissions,active').eq('workspace_id',workspaceId).eq('active',true); if(memberships.error) throw memberships.error
      const ids=(memberships.data??[]).map((m:any)=>m.user_id); const profiles=ids.length?await admin.from('profiles').select('id,email,is_platform_admin').in('id',ids):{data:[],error:null}; if(profiles.error) throw profiles.error
      const pmap=new Map((profiles.data??[]).map((p:any)=>[p.id,p]));
      return respond({members:(memberships.data??[]).map((m:any)=>{const p:any=pmap.get(m.user_id)||{};return{userId:m.user_id,email:p.email||'',role:m.role,permissions:m.permissions||{},isSuperAdmin:p.is_platform_admin===true,isOwner:m.user_id===workspace.data.owner_user_id}})})
    }
    const targetUserId=String(body.userId??''); if(!targetUserId||targetUserId===caller.id) return respond({error:'invalid_target'},400)
    const workspace=await admin.from('workspaces').select('owner_user_id').eq('id',workspaceId).maybeSingle(); if(workspace.error||!workspace.data) return respond({error:'workspace_not_found'},404)
    if(targetUserId===workspace.data.owner_user_id) return respond({error:'owner_membership_protected'},400)
    if(action==='remove'){
      if(!can('delete')) return respond({error:'forbidden'},403)
      const result=await admin.from('workspace_memberships').update({active:false,updated_at:new Date().toISOString()}).eq('workspace_id',workspaceId).eq('user_id',targetUserId); if(result.error) throw result.error
      await admin.from('audit_log').insert({workspace_id:workspaceId,actor_user_id:caller.id,action:'member_remove',details:{targetUserId}})
      return respond({ok:true})
    }
    if(action==='update'){
      if(!can('edit')) return respond({error:'forbidden'},403)
      const role=['admin','operator','viewer','custom'].includes(String(body.role))?String(body.role):'custom'; const requested=sanitizePermissions(body.permissions)
      if(!isPlatformAdmin&&callerRole!=='owner'&&!subset(requested,callerPermissions)) return respond({error:'permission_escalation_blocked'},403)
      if(!isPlatformAdmin&&callerRole!=='owner'&&role==='admin'&&callerRole!=='admin') return respond({error:'role_escalation_blocked'},403)
      const result=await admin.from('workspace_memberships').update({role,permissions:requested,updated_at:new Date().toISOString()}).eq('workspace_id',workspaceId).eq('user_id',targetUserId).eq('active',true); if(result.error) throw result.error
      await admin.from('audit_log').insert({workspace_id:workspaceId,actor_user_id:caller.id,action:'member_permissions_update',details:{targetUserId,role}})
      return respond({ok:true})
    }
    return respond({error:'invalid_action'},400)
  }catch(error){console.error('manage-members',error);return respond({error:'internal_error'},500)}
})
