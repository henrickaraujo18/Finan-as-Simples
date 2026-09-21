// Teste real da API, separado dos mocks e da homologação visual Windows.
// Executar somente com conta e workspace descartáveis de homologação.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const required = ['FS_TEST_URL', 'FS_TEST_PUBLIC_KEY', 'FS_TEST_EMAIL', 'FS_TEST_PASSWORD', 'FS_TEST_WORKSPACE'];
if (required.some(k => !process.env[k]) || process.env.FS_TEST_ALLOW_WRITE !== 'homologacao') {
  console.error('Não executado: configure as variáveis FS_TEST_* e FS_TEST_ALLOW_WRITE=homologacao em ambiente seguro.');
  process.exit(2);
}
const base = new URL(process.env.FS_TEST_URL);
assert.equal(base.protocol, 'https:');
const workspace = process.env.FS_TEST_WORKSPACE;
assert.match(workspace, /^[\da-f-]{36}$/i);
let session, id;
async function call(path, method = 'GET', body, token = session?.access_token) {
  const response = await fetch(new URL(path, base), { method, headers: { apikey: process.env.FS_TEST_PUBLIC_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${path.split('?')[0]}`); // não registra tokens, senha ou payload
  return data;
}
try {
  session = await call('/auth/v1/token?grant_type=password', 'POST', { email: process.env.FS_TEST_EMAIL, password: process.env.FS_TEST_PASSWORD });
  assert.ok(session.access_token && session.refresh_token && session.user?.id);
  const members = await call(`/rest/v1/workspace_memberships?workspace_id=eq.${workspace}&user_id=eq.${session.user.id}&select=role,active`);
  assert.ok(members.some(m => m.active && m.role === 'owner'), 'Conta de teste precisa ser proprietária do ambiente descartável.');
  console.log('PASS: login real e membership.');
  const key = randomUUID();
  const rows = await call('/rest/v1/financial_entities', 'POST', { id: key, workspace_id: workspace, entity_type: 'accounts', data_json: { name: 'Homologação automática descartável', openingBalanceCents: 12345 }, version: 1, deleted: false, updated_by: session.user.id });
  id = key; assert.equal(rows[0].id, id);
  const secondSession = await call('/auth/v1/token?grant_type=password', 'POST', { email: process.env.FS_TEST_EMAIL, password: process.env.FS_TEST_PASSWORD });
  const downloaded = await call(`/rest/v1/financial_entities?id=eq.${id}&workspace_id=eq.${workspace}&select=data_json,version`, 'GET', undefined, secondSession.access_token);
  assert.equal(downloaded[0].data_json.openingBalanceCents, 12345);
  console.log('PASS: gravação e leitura real por duas sessões da API (não valida o cliente Windows).');
  session = await call('/auth/v1/token?grant_type=refresh_token', 'POST', { refresh_token: session.refresh_token });
  assert.ok(session.access_token);
  console.log('PASS: renovação real do token.');
  const foreign = randomUUID();
  const isolated = await call(`/rest/v1/financial_entities?workspace_id=eq.${foreign}&select=id`);
  assert.equal(isolated.length, 0);
  console.log('PASS: ambiente inexistente não retorna registros; teste com outro usuário ainda é necessário.');
} catch (error) {
  console.error('FAIL:', error.message); process.exitCode = 1;
} finally {
  if (id && session?.access_token) {
    try {
      await call(`/rest/v1/financial_entities?id=eq.${id}&workspace_id=eq.${workspace}`, 'PATCH', { deleted: true, version: 2, updated_by: session.user.id });
      console.log('Registro descartável marcado como excluído.');
    } catch { console.error('Limpeza incompleta; confira registros de homologação no workspace de teste.'); process.exitCode = 1; }
  }
}
