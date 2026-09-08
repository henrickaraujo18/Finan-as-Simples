const invoke=window.__TAURI__?.core?.invoke;
const TYPES=["transactions","accounts","investments","settings"];
const PAYS={pix:"PIX",transfer:"Transferência",debit_card:"Débito",credit_card:"Crédito",boleto:"Boleto",cash:"Dinheiro",other:"Outro"};
const D={profileName:"Meu financeiro",openingBalanceCents:0,averageMonthlyIncomeCents:0,creditCardLimitCents:0,defaultAccount:"",currency:"BRL"};
const S={page:"dashboard",month:new Date().toISOString().slice(0,7),runtime:null,data:Object.fromEntries(TYPES.map(x=>[x,[]])),settings:{...D},edit:{transactions:null,accounts:null,investments:null}};
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const money=c=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(c||0)/100);
const inputMoney=c=>(Number(c||0)/100).toFixed(2).replace(".",",");
const parseMoney=v=>{let s=String(v??"").trim().replace(/\s/g,"").replace(/R\$/gi,"");if(!s)return 0;s=s.includes(",")?s.replace(/\./g,"").replace(",","."):s;let n=Number(s);return Number.isFinite(n)?Math.round(n*100):0};
const pct=n=>`${Number(n||0).toFixed(1)}%`;
const today=()=>{let d=new Date(),l=new Date(d.getTime()-d.getTimezoneOffset()*60000);return l.toISOString().slice(0,10)};
const monthOf=d=>String(d||"").slice(0,7);
const row=r=>({id:r.id,...(r.data||{}),_updatedAt:r.updatedAt});
async function list(t){return(await invoke("list_entities",{entityType:t})).map(row)}
async function save(t,data,id=null){return row(await invoke("upsert_entity",{input:{entityType:t,id,data}}))}
async function remove(t,id){return invoke("delete_entity",{entityType:t,id})}
async function load(){for(const t of TYPES)S.data[t]=await list(t);S.settings={...D,...(S.data.settings[0]||{})}}
const tx=()=>S.data.transactions||[], ac=()=>S.data.accounts||[], inv=()=>S.data.investments||[];
function metrics(){
 const r=tx().filter(x=>monthOf(x.date)===S.month);
 const sum=(kind,status)=>r.filter(x=>x.kind===kind&&x.status===status).reduce((a,x)=>a+Number(x.amountCents||0),0);
 const ip=sum("income","paid"),ipp=sum("income","pending"),ep=sum("expense","paid"),epp=sum("expense","pending");
 const card=r.filter(x=>x.kind==="expense"&&x.paymentMethod==="credit_card").reduce((a,x)=>a+Number(x.amountCents||0),0);
 const income=Number(S.settings.averageMonthlyIncomeCents||0);
 return{r,ip,ipp,ep,epp,real:ip-ep,forecast:ip+ipp-ep-epp,card,commit:income?card/income*100:0}
}
function currentBalance(){return Number(S.settings.openingBalanceCents||0)+tx().filter(x=>x.status==="paid").reduce((a,x)=>a+(x.kind==="income"?1:-1)*Number(x.amountCents||0),0)}
function forecastBalance(){return Number(S.settings.openingBalanceCents||0)+tx().reduce((a,x)=>a+(x.kind==="income"?1:-1)*Number(x.amountCents||0),0)}
function invMetrics(){let cost=0,now=0;for(const i of inv()){cost+=Math.round(Number(i.quantity||0)*Number(i.averagePriceCents||0));now+=Math.round(Number(i.quantity||0)*Number(i.currentPriceCents||0))}return{cost,now,gain:now-cost}}
function k(l,v,h=""){return`<article class="kpi"><span>${esc(l)}</span><strong>${esc(v)}</strong><small>${esc(h)}</small></article>`}
function title(){return{dashboard:"Dashboard",transactions:"Lançamentos",openfinance:"Open Finance",investments:"Investimentos",settings:"Parametrização"}[S.page]}
function shell(){
 $("pageTitle").textContent=title();$("connectionBadge").textContent=navigator.onLine?"Online":"Offline";$("connectionBadge").classList.toggle("online",navigator.onLine);
 $("platformBadge").textContent="Windows";$("storageLabel").textContent=S.runtime?.storage||"SQLite local";
 document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===S.page));
}
function dashboard(){
 const m=metrics(),im=invMetrics(),recent=[...tx()].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,8);
 const daily=new Map();for(const x of m.r){let d=daily.get(x.date)||{i:0,e:0};d[x.kind==="income"?"i":"e"]+=Number(x.amountCents||0);daily.set(x.date,d)}
 const cats=new Map(),tot=m.r.filter(x=>x.kind==="expense").reduce((a,x)=>a+Number(x.amountCents||0),0);for(const x of m.r.filter(x=>x.kind==="expense"))cats.set(x.category||"Sem categoria",(cats.get(x.category||"Sem categoria")||0)+Number(x.amountCents||0));
 return`<section class="hero"><div><h2>${esc(S.settings.profileName)}</h2><p>Controle financeiro local no Windows. O núcleo funciona sem internet.</p></div><button class="primary" data-page="transactions">Novo lançamento</button></section>
 <section class="report-toolbar panel"><label>Mês<input id="month" type="month" value="${S.month}"></label></section>
 <section class="kpi-grid">${k("Saldo atual",money(currentBalance()),"realizado")}${k("Saldo previsto",money(forecastBalance()),"inclui pendências")}${k("Receitas realizadas",money(m.ip))}${k("A receber",money(m.ipp))}${k("Despesas realizadas",money(m.ep))}${k("A pagar",money(m.epp))}${k("Resultado",money(m.real),`previsto ${money(m.forecast)}`)}${k("Comprometimento cartão",pct(m.commit),money(m.card))}</section>
 <div class="two-col"><section class="panel"><div class="panel-head"><h3>Movimento diário</h3></div><div class="table-wrap"><table><thead><tr><th>Data</th><th class="right">Receitas</th><th class="right">Despesas</th></tr></thead><tbody>${daily.size?[...daily].sort((a,b)=>b[0].localeCompare(a[0])).map(([d,v])=>`<tr><td>${d}</td><td class="right income">${money(v.i)}</td><td class="right expense">${money(v.e)}</td></tr>`).join(""):`<tr><td colspan="3" class="empty">Sem movimento.</td></tr>`}</tbody></table></div></section>
 <section class="panel"><div class="panel-head"><h3>Despesas por categoria</h3></div><div class="table-wrap"><table><thead><tr><th>Categoria</th><th class="right">Valor</th><th class="right">%</th></tr></thead><tbody>${cats.size?[...cats].sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<tr><td>${esc(c)}</td><td class="right">${money(v)}</td><td class="right">${pct(tot?v/tot*100:0)}</td></tr>`).join(""):`<tr><td colspan="3" class="empty">Sem despesas.</td></tr>`}</tbody></table></div></section></div>
 <div class="two-col"><section class="panel"><div class="panel-head"><h3>Últimos lançamentos</h3></div><div class="table-wrap"><table><tbody>${recent.length?recent.map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.description)}</td><td class="right ${x.kind}">${x.kind==="income"?"+":"−"}${money(x.amountCents)}</td></tr>`).join(""):`<tr><td class="empty">Nenhum lançamento.</td></tr>`}</tbody></table></div></section><section class="panel"><div class="panel-head"><h3>Investimentos</h3></div><div class="panel-body mini-kpis">${k("Custo",money(im.cost))}${k("Valor atual",money(im.now))}${k("Resultado",money(im.gain),im.cost?pct(im.gain/im.cost*100):"—")}</div></section></div>`
}
function txForm(){
 const e=S.edit.transactions?tx().find(x=>x.id===S.edit.transactions):null;
 return`<section class="panel"><div class="panel-head"><h3>${e?"Editar":"Novo"} lançamento</h3>${e?`<button class="ghost" data-action="cancel" data-type="transactions">Cancelar</button>`:""}</div><form id="txForm" class="form panel-body"><div class="form-grid">
 <label>Tipo<select name="kind"><option value="income" ${e?.kind==="income"?"selected":""}>Receita</option><option value="expense" ${e?.kind==="expense"?"selected":""}>Despesa</option></select></label>
 <label>Status<select name="status"><option value="paid" ${e?.status!=="pending"?"selected":""}>Realizado</option><option value="pending" ${e?.status==="pending"?"selected":""}>Pendente</option></select></label>
 <label class="wide">Descrição<input name="description" required value="${esc(e?.description||"")}"></label><label>Categoria<input name="category" required value="${esc(e?.category||"")}"></label>
 <label>Conta<input name="account" value="${esc(e?.account||S.settings.defaultAccount||"")}"></label><label>Forma<select name="paymentMethod">${Object.entries(PAYS).map(([v,l])=>`<option value="${v}" ${e?.paymentMethod===v?"selected":""}>${l}</option>`).join("")}</select></label>
 <label>Valor<input name="amount" required value="${e?inputMoney(e.amountCents):""}" placeholder="0,00"></label><label>Data<input name="date" type="date" required value="${e?.date||today()}"></label><label>Vencimento<input name="dueDate" type="date" value="${e?.dueDate||""}"></label>
 </div><button class="primary">Salvar</button><span id="msg" class="form-msg"></span></form></section>`
}
function transactions(){
 const rows=tx().filter(x=>monthOf(x.date)===S.month).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 return`<div class="two-col">${txForm()}<section class="panel"><div class="panel-head"><h3>Importar fatura CSV</h3></div><form id="importForm" class="form panel-body"><p class="muted">Colunas: data, descrição e valor. Os itens entram como despesas pendentes no cartão de crédito.</p><label>Arquivo<input name="file" type="file" accept=".csv,text/csv" required></label><label>Vencimento<input name="dueDate" type="date"></label><label>Conta/cartão<input name="account" value="${esc(S.settings.defaultAccount)}"></label><button class="ghost">Importar</button><span id="importMsg" class="form-msg"></span></form></section></div>
 <section class="panel"><div class="report-toolbar"><label>Mês<input id="month" type="month" value="${S.month}"></label><div><button class="ghost" data-action="exportTx">Exportar CSV</button></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Forma</th><th>Status</th><th class="right">Valor</th><th></th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td>${x.date}</td><td>${esc(x.description)}</td><td>${esc(x.category)}</td><td>${esc(x.account||"—")}</td><td>${esc(PAYS[x.paymentMethod]||"Outro")}</td><td>${x.status==="pending"?"Pendente":"Realizado"}</td><td class="right ${x.kind}">${x.kind==="income"?"+":"−"}${money(x.amountCents)}</td><td class="right actions-cell">${x.status==="pending"?`<button class="ghost" data-action="settle" data-id="${x.id}">Baixar</button>`:""}<button class="ghost" data-action="edit" data-type="transactions" data-id="${x.id}">Editar</button><button class="danger ghost" data-action="delete" data-type="transactions" data-id="${x.id}">Excluir</button></td></tr>`).join(""):`<tr><td colspan="8" class="empty">Nenhum lançamento.</td></tr>`}</tbody></table></div></section>`
}
function openfinance(){
 const e=S.edit.accounts?ac().find(x=>x.id===S.edit.accounts):null,total=ac().reduce((a,x)=>a+Number(x.balanceCents||0),0);
 return`<section class="hero"><div><h2>Open Finance</h2><p>A conexão automática exige backend seguro. Nenhuma credencial bancária é embutida no aplicativo.</p></div><span class="status-badge ${navigator.onLine?"online":""}">${navigator.onLine?"Internet disponível":"Offline"}</span></section>
 <div class="two-col"><section class="panel"><div class="panel-head"><h3>${e?"Editar":"Cadastrar"} conta manual</h3>${e?`<button class="ghost" data-action="cancel" data-type="accounts">Cancelar</button>`:""}</div><form id="accountForm" class="form panel-body"><div class="form-grid"><label class="wide">Nome<input name="name" required value="${esc(e?.name||"")}"></label><label>Instituição<input name="institution" value="${esc(e?.institution||"")}"></label><label>Tipo<select name="type"><option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="credit">Cartão</option><option value="other">Outra</option></select></label><label>Saldo informado<input name="balance" value="${e?inputMoney(e.balanceCents):""}"></label></div><button class="primary">Salvar conta</button></form></section>
 <section class="panel"><div class="panel-head"><h3>Status</h3></div><div class="panel-body">${k("Saldo informado",money(total),`${ac().length} conta(s)`)}<p class="muted">Integração automática: não configurada nesta build. As contas manuais funcionam offline.</p></div></section></div>
 <section class="panel"><div class="table-wrap"><table><thead><tr><th>Conta</th><th>Instituição</th><th class="right">Saldo</th><th></th></tr></thead><tbody>${ac().length?ac().map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.institution||"—")}</td><td class="right">${money(x.balanceCents)}</td><td class="right actions-cell"><button class="ghost" data-action="edit" data-type="accounts" data-id="${x.id}">Editar</button><button class="danger ghost" data-action="delete" data-type="accounts" data-id="${x.id}">Excluir</button></td></tr>`).join(""):`<tr><td colspan="4" class="empty">Nenhuma conta.</td></tr>`}</tbody></table></div></section>`
}
function investments(){
 const e=S.edit.investments?inv().find(x=>x.id===S.edit.investments):null,m=invMetrics();
 return`<div class="two-col"><section class="panel"><div class="panel-head"><h3>${e?"Editar":"Novo"} investimento</h3>${e?`<button class="ghost" data-action="cancel" data-type="investments">Cancelar</button>`:""}</div><form id="invForm" class="form panel-body"><div class="form-grid"><label class="wide">Ativo<input name="name" required value="${esc(e?.name||"")}"></label><label>Tipo<select name="type"><option value="fixed_income">Renda fixa</option><option value="stock">Ação</option><option value="fund">Fundo</option><option value="etf">ETF</option><option value="crypto">Cripto</option><option value="other">Outro</option></select></label><label>Instituição<input name="institution" value="${esc(e?.institution||"")}"></label><label>Quantidade<input name="quantity" type="number" step="0.00000001" min="0" required value="${e?.quantity??1}"></label><label>Preço médio<input name="averagePrice" required value="${e?inputMoney(e.averagePriceCents):""}"></label><label>Preço atual<input name="currentPrice" required value="${e?inputMoney(e.currentPriceCents):""}"></label></div><button class="primary">Salvar investimento</button></form></section><section class="panel"><div class="panel-head"><h3>Carteira</h3></div><div class="panel-body mini-kpis">${k("Custo",money(m.cost))}${k("Valor atual",money(m.now))}${k("Resultado",money(m.gain),m.cost?pct(m.gain/m.cost*100):"—")}</div><div class="panel-body"><p class="muted">Preços atuais são informados manualmente enquanto o serviço de cotações não estiver integrado.</p></div></section></div>
 <section class="panel"><div class="panel-head"><h3>Posições</h3><button class="ghost" data-action="exportInv">Exportar CSV</button></div><div class="table-wrap"><table><thead><tr><th>Ativo</th><th>Tipo</th><th>Instituição</th><th class="right">Qtd.</th><th class="right">Preço médio</th><th class="right">Preço atual</th><th class="right">Resultado</th><th></th></tr></thead><tbody>${inv().length?inv().map(x=>{let c=Math.round(x.quantity*x.averagePriceCents),n=Math.round(x.quantity*x.currentPriceCents);return`<tr><td>${esc(x.name)}</td><td>${esc(x.type)}</td><td>${esc(x.institution||"—")}</td><td class="right">${x.quantity}</td><td class="right">${money(x.averagePriceCents)}</td><td class="right">${money(x.currentPriceCents)}</td><td class="right ${n-c>=0?"income":"expense"}">${money(n-c)}</td><td class="right actions-cell"><button class="ghost" data-action="edit" data-type="investments" data-id="${x.id}">Editar</button><button class="danger ghost" data-action="delete" data-type="investments" data-id="${x.id}">Excluir</button></td></tr>`}).join(""):`<tr><td colspan="8" class="empty">Nenhum investimento.</td></tr>`}</tbody></table></div></section>`
}
function settings(){
 const s=S.settings;
 return`<div class="two-col"><section class="panel"><div class="panel-head"><h3>Parâmetros financeiros</h3></div><form id="settingsForm" class="form panel-body"><div class="form-grid"><label class="wide">Nome do perfil<input name="profileName" required value="${esc(s.profileName)}"></label><label>Saldo inicial<input name="openingBalance" value="${inputMoney(s.openingBalanceCents)}"></label><label>Renda média mensal<input name="income" value="${inputMoney(s.averageMonthlyIncomeCents)}"></label><label>Limite total de cartões<input name="limit" value="${inputMoney(s.creditCardLimitCents)}"></label><label>Conta padrão<input name="defaultAccount" value="${esc(s.defaultAccount)}"></label></div><button class="primary">Salvar parâmetros</button></form></section>
 <section class="panel"><div class="panel-head"><h3>Dados locais</h3></div><div class="panel-body"><p class="muted">Banco SQLite local, com verificação de integridade e backup.</p><div class="button-row"><button class="ghost" data-action="backup">Criar backup</button><button class="ghost" data-action="snapshot">Exportar JSON</button></div><p id="backupMsg" class="muted"></p></div></section></div>
 <section class="panel"><div class="panel-body report-lines"><div><span>Armazenamento</span><strong>${esc(S.runtime?.storage||"—")}</strong></div><div><span>Integridade do banco</span><strong>${S.runtime?.databaseHealthy?"OK":esc(S.runtime?.databaseCheck||"Não verificado")}</strong></div><div><span>Banco local</span><strong>${esc(S.runtime?.databasePath||"—")}</strong></div><div><span>Modo offline</span><strong>${S.runtime?.offlineReady?"Pronto":"Indisponível"}</strong></div></div></section>`
}
function render(){shell();$("view").innerHTML=({dashboard,transactions,openfinance,investments,settings}[S.page]||dashboard)()}
async function refresh(t){S.data[t]=await list(t);if(t==="settings")S.settings={...D,...(S.data.settings[0]||{})}}
function csvLine(line,del){let o=[],c="",q=false;for(let i=0;i<line.length;i++){let ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){c+='"';i++}else q=!q}else if(ch===del&&!q){o.push(c.trim());c=""}else c+=ch}o.push(c.trim());return o}
function norm(s){return String(s||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function parseCsv(text){
 const lines=String(text).split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)throw Error("CSV vazio.");
 const del=((lines[0].match(/;/g)||[]).length>=(lines[0].match(/,/g)||[]).length)?";":",",h=csvLine(lines[0],del).map(norm),fi=(...n)=>h.findIndex(x=>n.includes(x));
 const di=fi("data","date","data compra"),xi=fi("descricao","description","historico","estabelecimento","lancamento"),ai=fi("valor","amount","total"),ci=fi("categoria","category");if(di<0||xi<0||ai<0)throw Error("O CSV precisa ter data, descrição e valor.");
 return lines.slice(1).map(l=>{let c=csvLine(l,del),d=String(c[di]||"").trim();if(/^\d{2}\/\d{2}\/\d{4}$/.test(d)){let[a,b,y]=d.split("/");d=`${y}-${b}-${a}`}return{date:d,description:String(c[xi]||"").trim(),amountCents:Math.abs(parseMoney(c[ai])),category:ci>=0?String(c[ci]||"Cartão de crédito"):"Cartão de crédito"}}).filter(x=>x.description&&x.amountCents>0&&/^\d{4}-\d{2}-\d{2}$/.test(x.date))
}
function download(name,text,type="text/plain;charset=utf-8"){let u=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),500)}
const q=v=>`"${String(v??"").replaceAll('"','""')}"`;
function exportTx(){let h=["Data","Tipo","Status","Descrição","Categoria","Conta","Forma","Valor"],r=tx().map(x=>[x.date,x.kind,x.status,x.description,x.category,x.account||"",PAYS[x.paymentMethod]||"",inputMoney(x.amountCents)].map(q).join(";"));download(`financa-simples-lancamentos-${today()}.csv`,[h.map(q).join(";"),...r].join("\n"),"text/csv;charset=utf-8")}
function exportInv(){let h=["Ativo","Tipo","Instituição","Quantidade","Preço médio","Preço atual"],r=inv().map(x=>[x.name,x.type,x.institution||"",x.quantity,inputMoney(x.averagePriceCents),inputMoney(x.currentPriceCents)].map(q).join(";"));download(`financa-simples-investimentos-${today()}.csv`,[h.map(q).join(";"),...r].join("\n"),"text/csv;charset=utf-8")}
document.addEventListener("click",async e=>{
 const b=e.target.closest("button");if(!b)return;
 if(b.dataset.page){S.page=b.dataset.page;render();return}
 const a=b.dataset.action,t=b.dataset.type,id=b.dataset.id;
 try{
  if(a==="edit"){S.edit[t]=id;S.page=t==="transactions"?"transactions":t==="accounts"?"openfinance":"investments"}
  if(a==="cancel")S.edit[t]=null;
  if(a==="delete"){if(confirm("Excluir este registro?")){await remove(t,id);await refresh(t);S.edit[t]=null}}
  if(a==="settle"){let x=tx().find(y=>y.id===id),{id:_id,_updatedAt,...d}=x;await save("transactions",{...d,status:"paid"},id);await refresh("transactions")}
  if(a==="exportTx")exportTx();if(a==="exportInv")exportInv();
  if(a==="backup")$("backupMsg").textContent=await invoke("create_backup");
  if(a==="snapshot")download(`financa-simples-${today()}.json`,JSON.stringify({product:"Finança Simples",schemaVersion:3,generatedAt:new Date().toISOString(),settings:S.settings,transactions:tx(),accounts:ac(),investments:inv()},null,2),"application/json");
  render()
 }catch(err){alert(err.message||err)}
});
document.addEventListener("change",e=>{if(e.target.id==="month"){S.month=e.target.value;render()}});
document.addEventListener("submit",async e=>{
 e.preventDefault();let f=e.target,fd=new FormData(f);
 try{
  if(f.id==="txForm"){let d={kind:fd.get("kind"),status:fd.get("status"),description:String(fd.get("description")||"").trim(),category:String(fd.get("category")||"").trim(),account:String(fd.get("account")||"").trim(),paymentMethod:fd.get("paymentMethod"),amountCents:parseMoney(fd.get("amount")),date:fd.get("date"),dueDate:fd.get("dueDate")||"",source:"manual"};if(!d.description||!d.category||!d.date||d.amountCents<=0)throw Error("Preencha os campos obrigatórios.");await save("transactions",d,S.edit.transactions);S.edit.transactions=null;await refresh("transactions")}
  if(f.id==="accountForm"){let d={name:String(fd.get("name")||"").trim(),institution:String(fd.get("institution")||"").trim(),type:fd.get("type"),balanceCents:parseMoney(fd.get("balance"))};if(!d.name)throw Error("Informe o nome da conta.");await save("accounts",d,S.edit.accounts);S.edit.accounts=null;await refresh("accounts")}
  if(f.id==="invForm"){let d={name:String(fd.get("name")||"").trim(),type:fd.get("type"),institution:String(fd.get("institution")||"").trim(),quantity:Number(fd.get("quantity")||0),averagePriceCents:parseMoney(fd.get("averagePrice")),currentPriceCents:parseMoney(fd.get("currentPrice"))};if(!d.name||d.quantity<=0)throw Error("Preencha o investimento.");await save("investments",d,S.edit.investments);S.edit.investments=null;await refresh("investments")}
  if(f.id==="settingsForm"){let d={profileName:String(fd.get("profileName")||"Meu financeiro"),openingBalanceCents:parseMoney(fd.get("openingBalance")),averageMonthlyIncomeCents:parseMoney(fd.get("income")),creditCardLimitCents:parseMoney(fd.get("limit")),defaultAccount:String(fd.get("defaultAccount")||""),currency:"BRL"};await save("settings",d,S.data.settings[0]?.id||null);await refresh("settings")}
  if(f.id==="importForm"){let file=fd.get("file");if(!(file instanceof File)||!file.size)throw Error("Selecione um CSV.");let rows=parseCsv(await file.text()),due=fd.get("dueDate")||"",account=String(fd.get("account")||"");if(!rows.length)throw Error("Nenhum item válido.");for(const x of rows)await save("transactions",{kind:"expense",status:"pending",description:x.description,category:x.category,account,paymentMethod:"credit_card",amountCents:x.amountCents,date:x.date,dueDate:due,source:"invoice_csv"});await refresh("transactions");alert(`${rows.length} item(ns) importado(s).`)}
  render()
 }catch(err){alert(err.message||err)}
});
window.addEventListener("online",shell);window.addEventListener("offline",shell);
document.addEventListener("DOMContentLoaded",async()=>{try{if(!invoke)throw Error("O Finança Simples deve ser aberto pelo aplicativo instalado no Windows.");S.runtime=await invoke("runtime_status");await load();render()}catch(err){$("view").innerHTML=`<section class="fatal"><h3>Falha ao iniciar.</h3><p>${esc(err.message||err)}</p></section>`}});
