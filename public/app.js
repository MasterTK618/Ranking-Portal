const $ = (id) => document.getElementById(id);
let sessionData = null, selectedMember = null, roles = [];
let managementTeams=[],teamAssignments=new Map(),teamStaffCache=[],teamMemberDraft=new Set(),groupRoleCache=[];
const pageNames = {overview:"Overview",views:"Views & Insights",rank:"Group Ranking",members:"Staff Directory",logs:"Ranking History",sessions:"Sessions & Events",activity:"Staff Activity",punishments:"Discipline Management",promotions:"Promotions",leaves:"Leave & Absence",tasks:"Staff Tasks",knowledge:"Knowledge Hub",settings:"Settings",notifications:"Notifications",approvals:"Approval Inbox",analytics:"Advanced Analytics"};
const defaultViews={sessions:"schedule",promotions:"requests",punishments:"requests",leaves:"request"};
function notice(message,type="") { const el=$("notice"); el.textContent=message; el.className="notice"+(type?" "+type:""); el.classList.remove("hidden"); window.scrollTo({top:0,behavior:"smooth"}); }
function clearNotice(){ $("notice").classList.add("hidden"); }
async function api(url,options={}) {
  const headers = {...(options.headers||{})};
  if (options.body) headers["Content-Type"]="application/json";
  if (options.method && options.method!=="GET" && sessionData?.csrfToken) headers["x-csrf-token"]=sessionData.csrfToken;
  const response = await fetch(url,{...options,headers,credentials:"same-origin"});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function showPage(page,view) {
  const selectedView=view||defaultViews[page]||"";
  Object.keys(pageNames).forEach(k=>$(`${k}Page`).classList.toggle("hidden",k!==page));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page&&(b.dataset.view||defaultViews[page]||"")===(selectedView||"")));
  const pageEl=$(`${page}Page`);
  if(pageEl?.querySelector("[data-workspace-panel]"))pageEl.querySelectorAll("[data-workspace-panel]").forEach(panel=>panel.classList.toggle("hidden",panel.dataset.workspacePanel!==selectedView));
  $("pageTitle").textContent=pageNames[page]||"Workspace";$("crumb").textContent=(selectedView?selectedView+" / ":"")+page.toUpperCase();
  clearNotice();
  if(page==="logs"){loadLogs();loadManagementAudit();}
  if(page==="rank")loadRoles();
  if(page==="views")loadViews();
  if(page==="settings")loadGameSettings();
  if(page==="sessions"){if(!staffDirectory.length)loadStaffDirectory();if(selectedView==="requests")loadSessionRequests();else loadSessions();}
  if(page==="members")loadStaffDirectory();
  if(page==="activity")loadManagement("activity");
  if(page==="punishments"){loadManagement("punishments");if(selectedView==="audit")loadPunishmentAudit();}
  if(page==="promotions"){loadManagement("promotions");if(selectedView==="history")loadPromotionAudit();}
  if(page==="leaves")loadManagement("leaves");
  if(page==="tasks")loadTasks();
  if(page==="knowledge")loadKnowledge();if(page==="notifications")loadNotifications();if(page==="approvals")loadApprovals();if(page==="analytics")loadAnalytics();
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page,b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.go)));
$("themeToggle").addEventListener("click",()=>{
  const dark=document.body.classList.toggle("dark");
  $("themeIcon").textContent=dark?"☀":"☾"; $("themeText").textContent=dark?"Light mode":"Dark mode";
  try{localStorage.setItem("lemonz-theme",dark?"dark":"light")}catch{}
});
try { if(localStorage.getItem("lemonz-theme")!=="light"){document.body.classList.add("dark");$("themeIcon").textContent="☀";$("themeText").textContent="Light mode";}}catch{}
const accentPalette={yellow:["#f5c928","#ffdf58"],orange:["#f59e0b","#fbbf24"],blue:["#60a5fa","#93c5fd"],pink:["#f472b6","#f9a8d4"]};
function applyAppearance(){try{const a=localStorage.getItem("lemonz-accent")||"yellow",d=localStorage.getItem("lemonz-density")||"comfortable";const colors=accentPalette[a]||accentPalette.yellow;document.documentElement.style.setProperty("--yellow",colors[0]);document.documentElement.style.setProperty("--yellow2",colors[1]);document.body.classList.toggle("compact-layout",d==="compact");if($("accentChoice"))$("accentChoice").value=a;if($("densityChoice"))$("densityChoice").value=d;}catch{}}
applyAppearance();
$("saveAppearance")?.addEventListener("click",()=>{try{localStorage.setItem("lemonz-accent",$("accentChoice").value);localStorage.setItem("lemonz-density",$("densityChoice").value);applyAppearance();notice("Appearance preferences saved on this browser.","success");}catch(e){notice("Could not save appearance preferences.","error");}});
function login(){location.href="/auth/login";}
$("loginButton").addEventListener("click",login); $("loginHero").addEventListener("click",login);
$("logoutButton").addEventListener("click",async()=>{try{await api("/auth/logout",{method:"POST",body:"{}"});location.reload()}catch(e){notice(e.message,"error")}});
async function loadRoles(){
  if(!sessionData?.identity?.canRank) return;
  try{
    const data=await api("/api/roles"); roles=data.roles;
    $("newRole").innerHTML='<option value="">Choose a role…</option>'+roles.map(r=>`<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} (Rank ${r.rank})</option>`).join("");
  }catch(e){notice(e.message,"error")}
}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function searchMember(){
  clearNotice(); const username=$("memberSearch").value.trim();
  if(!username)return notice("Enter a Roblox username first.","error");
  $("searchMember").disabled=true; $("searchMember").textContent="Searching…";
  try{
    const data=await api("/api/member/"+encodeURIComponent(username)); selectedMember=data;
    $("memberResult").innerHTML=`<b>${escapeHtml(data.user.name)}</b> <span class="muted">(${escapeHtml(data.user.displayName)})</span><br><span class="muted">Current role:</span> <b>${escapeHtml(data.role?.name||"Unknown")}</b> <span class="muted">· Rank ${data.role?.rank??"—"}</span>`;
    $("memberResult").classList.remove("hidden"); $("rankControls").classList.remove("hidden");
    const select=$("newRole"); select.innerHTML='<option value="">Choose a role…</option>'+data.eligibleRoles.map(r=>`<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} (Rank ${r.rank})</option>`).join("");
    if(!data.eligibleRoles.length)notice("No roles below your current rank are available.","error");
  }catch(e){selectedMember=null;$("memberResult").classList.add("hidden");$("rankControls").classList.add("hidden");notice(e.message,"error")}
  finally{$("searchMember").disabled=false;$("searchMember").textContent="Search member";}
}
$("searchMember").addEventListener("click",searchMember);
$("memberSearch").addEventListener("keydown",e=>{if(e.key==="Enter")searchMember()});
$("rankAction").addEventListener("change",()=>{
  const demote=$("rankAction").value==="demote";
  $("reason").placeholder=demote?"A reason is required for demotions…":"Add a short reason for this change…";
});
$("submitRank").addEventListener("click",async()=>{
  if(!selectedMember)return notice("Search for a member first.","error");
  const action=$("rankAction").value,roleId=$("newRole").value,reason=$("reason").value.trim();
  if(action==="set"&&!roleId)return notice("Choose a new role.","error");
  if(action==="demote"&&!reason)return notice("A reason is required for demotions.","error");
  const btn=$("submitRank");btn.disabled=true;btn.textContent="Processing…";
  try{
    const result=await api("/api/rank",{method:"POST",body:JSON.stringify({targetId:selectedMember.user.id,targetName:selectedMember.user.name,roleId,action,reason})});
    notice(result.message,"success"); $("memberResult").innerHTML=`<b>${escapeHtml(selectedMember.user.name)}</b><br><span class="muted">New role:</span> <b>${escapeHtml(result.newRole)}</b>`;
    $("rankControls").classList.add("hidden");selectedMember=null;$("memberSearch").value="";$("reason").value="";
    await refreshOverview();
  }catch(e){notice(e.message,"error")}
  finally{btn.disabled=false;btn.textContent="Confirm ranking";}
});
function formatDate(s){try{return new Date(s).toLocaleString()}catch{return s||"—"}}
async function loadLogs(){
  $("logsTable").textContent="Loading logs…";
  try{
    const d=await api("/api/logs");
    $("recentCount").textContent=d.logs.length;
    if(!d.logs.length){$("logsTable").textContent="No ranking actions have been recorded yet.";return}
    const logs=searchRows(d.logs,"logsSearch",["actor_name","target_name","previous_role","new_role","action","status","reason"]);
    $("logsTable").innerHTML=logs.length?`<table class="data-table"><thead><tr><th>DATE</th><th>RANKED BY</th><th>MEMBER</th><th>CHANGE</th><th>ACTION</th><th>STATUS</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${escapeHtml(formatDate(l.created_at))}</td><td>${escapeHtml(l.actor_name)}</td><td>${escapeHtml(l.target_name)}</td><td>${escapeHtml(l.previous_role||"—")} → ${escapeHtml(l.new_role||"—")}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.status)}</td></tr>`).join("")}</tbody></table>`:"No ranking logs match your search.";
  }catch(e){$("logsTable").textContent=e.message}
}
$("refreshLogs").addEventListener("click",loadLogs);
$("logsSearch")?.addEventListener("input",()=>{const q=$("logsSearch").value.toLowerCase();document.querySelectorAll("#logsTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));});

async function populateGroupRoleDropdowns(){
 const ids=["activityViewRank","activityEditRank","punishmentViewRank","punishmentRequestRank","punishmentAddRank","punishmentApproveRank","promotionSuggestRank","promotionApproveRank","leaveApproveRank","sessionCreateRank","sessionApproveRank","sessionStatusRank","sessionDeleteRank","taskViewRank","taskManageRank","knowledgeManageRank","notificationViewRank","analyticsViewRank","autoApproveRequestsRank","knowledgeMinRank"];
 const selects=ids.map(id=>$(id)).filter(Boolean);
 if(!selects.length)return;
 if(!groupRoleCache.length){const d=await api("/api/group/roles");groupRoleCache=Array.isArray(d.roles)?d.roles:[];}
 const list=[...groupRoleCache].sort((x,y)=>Number(x.rank)-Number(y.rank));
 for(const el of selects){const old=el.value;el.innerHTML=list.map(r=>`<option value="${Number(r.rank)}">${escapeHtml(r.name||("Rank "+r.rank))} · Rank ${Number(r.rank)}</option>`).join("");if(list.some(r=>String(r.rank)===old))el.value=old;}
}
async function loadQuotaRules(){
 const list=$("quotaRuleList");if(!list)return;
 try{
  const [d,t]=await Promise.all([api("/api/management/quotas"),api("/api/management/teams")]);
  const teams=t.teams||[];$("quotaTeam").innerHTML='<option value="">Choose team…</option>'+teams.map(x=>'<option value="'+escapeHtml(x.id)+'">'+escapeHtml(x.name)+'</option>').join("");
  $("quotaRuleManager")?.classList.toggle("hidden",!d.canManage);
  list.innerHTML=(d.rules||[]).length?(d.rules||[]).map(x=>'<div class="quota-rule-row"><b>'+escapeHtml(x.scope==="GLOBAL"?"Everyone":x.scope==="TEAM"?(teams.find(t=>String(t.id)===String(x.scope_id))?.name||"Team"):("Roles "+x.min_rank+"–"+x.max_rank))+'</b><span>'+Number(x.hours_per_week)+'h · '+x.sessions_per_week+' sessions · '+x.tasks_per_week+' tasks / week</span></div>').join(""):'<p class="muted">No custom quota rules yet. Default targets apply.</p>';
 }catch(e){list.textContent=e.message;}
}
function updateQuotaScope(){const scope=$("quotaScope").value;$("quotaTeamWrap").classList.toggle("hidden",scope!=="TEAM");$("quotaMinWrap").classList.toggle("hidden",scope!=="RANK");$("quotaMaxWrap").classList.toggle("hidden",scope!=="RANK");}
$("quotaScope")?.addEventListener("change",updateQuotaScope);
$("saveQuotaRule")?.addEventListener("click",async()=>{
 const b=$("saveQuotaRule"),scope=$("quotaScope").value;b.disabled=true;
 try{
  const payload={scope,scopeId:scope==="TEAM"?$("quotaTeam").value:"",minRank:scope==="RANK"?Number($("quotaMinRank").value):1,maxRank:scope==="RANK"?Number($("quotaMaxRank").value):255,hours:Number($("quotaRuleHours").value),sessions:Number($("quotaRuleSessions").value),tasks:Number($("quotaRuleTasks").value)};
  if(scope==="TEAM"&&!payload.scopeId)throw new Error("Choose a team for this quota rule.");
  if(scope==="RANK"&&(!payload.minRank||!payload.maxRank||payload.minRank>payload.maxRank))throw new Error("Choose a valid starting and ending role.");
  await api("/api/management/quotas",{method:"PUT",body:JSON.stringify(payload)});notice("Custom quota rule saved.","success");await loadQuotaRules();
 }catch(e){notice(e.message,"error");}finally{b.disabled=false;}
});
async function loadManagementSettings(){
  try{
    await populateGroupRoleDropdowns();
    const d=await api("/api/management/settings");
    await loadQuotaRules();updateQuotaScope();
    const map={activity_view_rank:"activityViewRank",activity_edit_rank:"activityEditRank",punishment_view_rank:"punishmentViewRank",punishment_add_rank:"punishmentAddRank",punishment_request_rank:"punishmentRequestRank",punishment_approve_rank:"punishmentApproveRank",promotion_suggest_rank:"promotionSuggestRank",promotion_approve_rank:"promotionApproveRank",leave_approve_rank:"leaveApproveRank",knowledge_manage_rank:"knowledgeManageRank",session_create_rank:"sessionCreateRank",session_delete_rank:"sessionDeleteRank",task_view_rank:"taskViewRank",task_manage_rank:"taskManageRank",session_approve_rank:"sessionApproveRank",session_status_rank:"sessionStatusRank",notification_view_rank:"notificationViewRank",analytics_view_rank:"analyticsViewRank",quota_hours_week:"quotaHoursWeek",quota_sessions_week:"quotaSessionsWeek",quota_tasks_week:"quotaTasksWeek",notifications_enabled:"notificationsEnabled",recurring_sessions_enabled:"recurringSessionsEnabled",auto_approve_requests_enabled:"autoApproveRequestsEnabled",auto_approve_requests_rank:"autoApproveRequestsRank"};
    Object.entries(map).forEach(([key,id])=>{const el=$(id);if(el.type==="checkbox")el.checked=Number(d.settings[key])!==0;else el.value=d.settings[key];});if($("autoApproveRequestsRankValue"))$("autoApproveRequestsRankValue").textContent=$("autoApproveRequestsRank")?.value||"249";
  }catch(e){if(!e.message.includes("Only the group owner"))notice(e.message,"error")}
}
$("autoApproveRequestsRank")?.addEventListener("input",()=>{$("autoApproveRequestsRankValue").textContent=$("autoApproveRequestsRank").value;});
$("saveManagementSettings").addEventListener("click",async()=>{
  const btn=$("saveManagementSettings");btn.disabled=true;btn.textContent="Saving…";
  try{
    const map={activity_view_rank:"activityViewRank",activity_edit_rank:"activityEditRank",punishment_view_rank:"punishmentViewRank",punishment_add_rank:"punishmentAddRank",punishment_request_rank:"punishmentRequestRank",punishment_approve_rank:"punishmentApproveRank",promotion_suggest_rank:"promotionSuggestRank",promotion_approve_rank:"promotionApproveRank",leave_approve_rank:"leaveApproveRank",knowledge_manage_rank:"knowledgeManageRank",session_create_rank:"sessionCreateRank",session_delete_rank:"sessionDeleteRank",task_view_rank:"taskViewRank",task_manage_rank:"taskManageRank",session_approve_rank:"sessionApproveRank",session_status_rank:"sessionStatusRank",notification_view_rank:"notificationViewRank",analytics_view_rank:"analyticsViewRank",quota_hours_week:"quotaHoursWeek",quota_sessions_week:"quotaSessionsWeek",quota_tasks_week:"quotaTasksWeek",notifications_enabled:"notificationsEnabled",recurring_sessions_enabled:"recurringSessionsEnabled",auto_approve_requests_enabled:"autoApproveRequestsEnabled",auto_approve_requests_rank:"autoApproveRequestsRank"};
    const values={};Object.entries(map).forEach(([key,id])=>{const el=$(id);values[key]=el.type==="checkbox"?(el.checked?1:0):Number(el.value);});
    await api("/api/management/settings",{method:"PUT",body:JSON.stringify(values)});
    notice("Management permissions saved.","success");
  }catch(e){notice(e.message,"error")}
  finally{btn.disabled=false;btn.textContent="Save permissions"}
});

let knowledgeItems=[],knowledgeCanManage=false;
async function loadKnowledge(){await populateGroupRoleDropdowns();const list=$("knowledgeList");if(!list)return;list.textContent="Loading resources…";try{if(!managementTeams.length){const td=await api("/api/management/teams");managementTeams=td.teams||[];teamAssignments=new Map((td.members||[]).map(x=>[String(x.user_id),String(x.team_id)]));}const d=await api("/api/management/knowledge");knowledgeItems=d.items||[];knowledgeCanManage=!!d.canManage;$("knowledgeManager").classList.toggle("hidden",!knowledgeCanManage);const options=managementTeams.map(t=>'<option value="'+escapeHtml(t.id)+'">'+escapeHtml(t.name)+"</option>").join("");$("knowledgeTeam").innerHTML='<option value="">All staff / general resource</option>'+options;const filter=$("knowledgeTeamFilter"),old=filter.value;filter.innerHTML='<option value="ALL">All teams</option><option value="GENERAL">General resources</option>'+options;if([...filter.options].some(o=>o.value===old))filter.value=old;renderKnowledge();}catch(e){list.textContent=e.message;}}
function renderKnowledge(){const q=($("knowledgeSearch").value||"").trim().toLowerCase(),teamFilter=$("knowledgeTeamFilter")?.value||"ALL";const items=knowledgeItems.filter(x=>(teamFilter==="ALL"||(teamFilter==="GENERAL"?!x.team_id:String(x.team_id||"")===teamFilter))&&[x.title,x.category,x.content,x.kind,x.team_name,x.team_department].some(v=>String(v||"").toLowerCase().includes(q)));$("knowledgeList").innerHTML=items.length?items.map(x=>{const body=escapeHtml(x.content);const open=x.kind==="link"?'<a class="knowledge-open" href="'+escapeHtml(x.url)+'" target="_blank" rel="noopener noreferrer">Open resource ↗</a>':'<details><summary>Read document</summary><div class="knowledge-document">'+body.replace(/\n/g,"<br>")+'</div></details>';return '<article class="knowledge-card"><div class="knowledge-card-top"><span class="knowledge-kind">'+(x.kind==="link"?"↗ LINK":"▤ DOCUMENT")+'</span><span class="knowledge-rank">RANK '+x.min_rank+'+</span></div><h3>'+escapeHtml(x.title)+'</h3><small>'+escapeHtml(x.category)+(x.team_name?' · '+escapeHtml(x.team_department)+' / '+escapeHtml(x.team_name):' · General resource')+' · Added by '+escapeHtml(x.created_by_name)+'</small><p>'+body.slice(0,260)+(body.length>260?"…":"")+'</p>'+open+(knowledgeCanManage?'<div class="knowledge-actions"><button class="quiet-btn" data-knowledge-edit="'+x.id+'">Edit</button><button class="danger-btn" data-knowledge-delete="'+x.id+'">Delete</button></div>':"")+'</article>';}).join(""):'<div class="empty-state">No resources are available to your rank, or your search found no matches.</div>';}
$("refreshKnowledge")?.addEventListener("click",loadKnowledge);$("knowledgeSearch")?.addEventListener("input",renderKnowledge);$("knowledgeTeamFilter")?.addEventListener("change",renderKnowledge);
$("knowledgeKind")?.addEventListener("change",()=>{$("knowledgeUrlWrap").classList.toggle("hidden",$("knowledgeKind").value!=="link");});
function resetKnowledgeForm(){["knowledgeTitle","knowledgeCategory","knowledgeUrl","knowledgeContent","knowledgeEditId"].forEach(id=>$(id).value="");$("knowledgeTeam").value="";$("knowledgeMinRank").value="1";$("knowledgeKind").value="document";$("knowledgeUrlWrap").classList.add("hidden");$("knowledgeFormTitle").textContent="Add a resource";$("saveKnowledge").textContent="Publish resource";$("cancelKnowledgeEdit").classList.add("hidden");}
$("cancelKnowledgeEdit")?.addEventListener("click",resetKnowledgeForm);
$("saveKnowledge")?.addEventListener("click",async()=>{const b=$("saveKnowledge"),id=$("knowledgeEditId").value;b.disabled=true;try{const payload={title:$("knowledgeTitle").value,category:$("knowledgeCategory").value,kind:$("knowledgeKind").value,minRank:Number($("knowledgeMinRank").value),teamId:$("knowledgeTeam").value||null,url:$("knowledgeUrl").value,content:$("knowledgeContent").value};await api(id?"/api/management/knowledge/"+encodeURIComponent(id):"/api/management/knowledge",{method:id?"PUT":"POST",body:JSON.stringify(payload)});resetKnowledgeForm();notice(id?"Knowledge resource updated.":"Knowledge resource published.","success");await loadKnowledge();}catch(e){notice(e.message,"error");}finally{b.disabled=false;}});
document.addEventListener("click",async e=>{const edit=e.target.closest("[data-knowledge-edit]");if(edit){const item=knowledgeItems.find(x=>String(x.id)===String(edit.dataset.knowledgeEdit));if(!item)return;$("knowledgeEditId").value=item.id;$("knowledgeTitle").value=item.title;$("knowledgeCategory").value=item.category;$("knowledgeKind").value=item.kind;$("knowledgeMinRank").value=item.min_rank;$("knowledgeTeam").value=item.team_id||"";$("knowledgeUrl").value=item.url||"";$("knowledgeContent").value=item.content;$("knowledgeUrlWrap").classList.toggle("hidden",item.kind!=="link");$("knowledgeFormTitle").textContent="Edit resource";$("saveKnowledge").textContent="Save changes";$("cancelKnowledgeEdit").classList.remove("hidden");$("knowledgeManager").scrollIntoView({behavior:"smooth"});return;}const b=e.target.closest("[data-knowledge-delete]");if(!b)return;if(!confirm("Delete this knowledge resource?"))return;try{await api("/api/management/knowledge/"+encodeURIComponent(b.dataset.knowledgeDelete),{method:"DELETE"});notice("Resource deleted.","success");loadKnowledge();}catch(err){notice(err.message,"error");}});
async function runRobloxDiagnostics(buttonId,outputId){const b=$(buttonId),out=$(outputId);if(!b||!out)return;b.disabled=true;b.textContent="Testing…";out.classList.remove("hidden");out.textContent="Checking Roblox endpoints…";try{const d=await api("/api/diagnostics/roblox");const item=(label,x)=>'<div class="diagnostic-line"><b>'+label+'</b><span class="'+(x.ok?"diagnostic-ok":"diagnostic-bad")+'">'+(x.ok?"Connected":"Failed")+(x.status?" · HTTP "+x.status:"")+(x.error?" · "+escapeHtml(x.error):"")+"</span></div>";out.innerHTML='<p>Group ID: <b>'+escapeHtml(d.groupId)+'</b> · API key configured: <b>'+(d.apiKeyConfigured?"Yes":"No")+"</b></p>"+item("Public Roblox Groups API",d.publicGroupApi)+item("Roblox Open Cloud Roles API",d.openCloudRoles)+(d.openCloudRoles.ok?'<small>Roles returned: '+d.openCloudRoles.roleCount+'</small>':"");}catch(e){out.textContent=e.message;}finally{b.disabled=false;b.textContent="Test Roblox API";}}
$("testRobloxConnection")?.addEventListener("click",()=>runRobloxDiagnostics("testRobloxConnection","robloxDiagnostics"));
$("directoryDiagnosticsButton")?.addEventListener("click",()=>runRobloxDiagnostics("directoryDiagnosticsButton","directoryDiagnostics"));

async function loadTeamsSettings(){
 const box=$("teamDirectory");if(!box)return;
 box.innerHTML='<div class="empty-state">Loading teams…</div>';
 try{
  const d=await api("/api/management/teams");
  managementTeams=Array.isArray(d.teams)?d.teams:[];
  teamAssignments=new Map();
  for(const x of(d.members||[])){const userId=String(x.user_id);if(!teamAssignments.has(userId))teamAssignments.set(userId,new Set());teamAssignments.get(userId).add(String(x.team_id));}
  let staffLoadError=null,groupRoles=[];
  const roleResult=await api("/api/group/roles");
  groupRoles=Array.isArray(roleResult.roles)?roleResult.roles:[];groupRoleCache=groupRoles;
  if(!groupRoles.length)throw new Error("Roblox returned no group roles. Check the configured group ID.");
  try{const staff=await api("/api/staff");teamStaffCache=Array.isArray(staff.members)?staff.members:[];}catch(staffError){staffLoadError=staffError;teamStaffCache=[];}
  if(teamStaffCache.length){try{await syncTeamsByGroupRole();}catch(syncError){console.warn("Team auto-assignment sync failed:",syncError);}}
  const ranks=groupRoles.map(r=>({rank:Number(r.rank),role:String(r.name||("Rank "+r.rank))})).filter(r=>Number.isInteger(r.rank)&&r.rank>=0&&r.rank<=255).sort((x,y)=>x.rank-y.rank);if($("teamRoleCount"))$("teamRoleCount").textContent=ranks.length+" group roles available";
  for(const id of ["teamRuleMin","teamRuleMax"]){const el=$(id),previous=el.value;el.innerHTML='<option value="">Choose rank…</option>'+ranks.map(r=>'<option value="'+r.rank+'">'+escapeHtml(r.role)+' · Rank '+r.rank+'</option>').join("");if(ranks.some(r=>String(r.rank)===previous))el.value=previous;}
  const teamSelect=$("teamAssignmentSelect"),previous=teamSelect.value;
  teamSelect.innerHTML='<option value="">Choose a team…</option>'+managementTeams.map(t=>'<option value="'+escapeHtml(t.id)+'">'+escapeHtml(t.name)+'</option>').join("");
  if(managementTeams.some(t=>String(t.id)===previous))teamSelect.value=previous;
  teamMemberDraft=new Set(teamStaffCache.filter(m=>teamAssignments.get(String(m.id))?.has(String(teamSelect.value||""))).map(m=>String(m.id)));
  renderTeamDirectory();renderTeamAssignmentMembers();renderStaffDirectory();updateTeamRuleFields();if(staffLoadError){const memberBox=$("teamMembersSelect");if(memberBox)memberBox.insertAdjacentHTML("afterbegin",'<div class="empty-state error-state">The complete group role list loaded, but the staff member list is unavailable: '+escapeHtml(staffLoadError.message)+'</div>');}
 }catch(e){box.innerHTML='<div class="empty-state error-state">'+escapeHtml(e.message)+'</div>';throw e;}
}
async function syncTeamsByGroupRole(){if(!teamStaffCache.length)return;for(const team of managementTeams){const mode=String(team.auto_assign_mode||"NONE").toUpperCase();if(!["ABOVE","RANGE"].includes(mode))continue;const min=Number(team.auto_assign_min_rank),max=Number(team.auto_assign_max_rank??255);if(!Number.isInteger(min)||min<1||min>255||(mode==="RANGE"&&(!Number.isInteger(max)||max<min||max>255)))continue;const matches=teamStaffCache.filter(m=>mode==="ABOVE"?Number(m.rank)>=min:Number(m.rank)>=min&&Number(m.rank)<=max);if(!matches.length)continue;const current=teamStaffCache.filter(m=>teamAssignments.get(String(m.id))?.has(String(team.id))).map(m=>String(m.id));const additions=matches.map(m=>String(m.id)).filter(id=>!current.includes(id));if(additions.length)await api("/api/management/teams/"+encodeURIComponent(team.id)+"/members",{method:"PUT",body:JSON.stringify({userIds:[...current,...additions]})});}const fresh=await api("/api/management/teams");teamAssignments=new Map();for(const x of(fresh.members||[])){const id=String(x.user_id);if(!teamAssignments.has(id))teamAssignments.set(id,new Set());teamAssignments.get(id).add(String(x.team_id));}}
function renderTeamDirectory(){
 const box=$("teamDirectory");if(!box)return;
 if(!managementTeams.length){box.innerHTML='<div class="empty-state">No teams yet. Create your first team above.</div>';return;}
 box.innerHTML='<div class="team-card-grid">'+managementTeams.map(t=>{
  const mode=t.auto_assign_mode||"NONE",rule=mode==="ABOVE"?"Rank "+t.auto_assign_min_rank+":":mode==="RANGE"?"Ranks "+t.auto_assign_min_rank+"–"+t.auto_assign_max_rank:"Manual assignment";
  const assigned=teamStaffCache.filter(member=>teamAssignments.get(String(member.id))?.has(String(t.id)));
  const names=assigned.length?'<div class="team-card-members">'+assigned.map(member=>'<span class="team-member-chip">'+escapeHtml(member.username||"Unknown username")+' <small>· '+escapeHtml(member.role||("Rank "+member.rank))+'</small></span>').join("")+'</div>':'<div class="team-card-empty">No staff assigned to this team yet.</div>';
  return '<article class="team-card"><span class="team-color-dot" style="background:'+escapeHtml(t.color)+'"></span><div class="team-card-copy"><b>'+escapeHtml(t.name)+'</b><small>'+""+'</small><em>'+assigned.length+' of '+teamStaffCache.length+' staff · '+escapeHtml(rule)+'</em></div>'+names+'<div class="team-card-actions"><button class="quiet-btn" data-team-dashboard="'+escapeHtml(t.id)+'">Team dashboard</button><button class="quiet-btn" data-team-manage="'+escapeHtml(t.id)+'">Manage members</button><button class="quiet-btn" data-team-edit="'+escapeHtml(t.id)+'">Edit</button><button class="danger-btn" data-team-delete="'+escapeHtml(t.id)+'">Delete</button></div></article>';
 }).join("")+'</div>';
}
document.addEventListener("click",async e=>{
 const b=e.target.closest("[data-team-dashboard]");if(!b)return;
 const card=b.closest(".team-card");if(!card)return;
 let panel=card.querySelector(".team-dashboard-inline");if(panel){panel.remove();b.textContent="Team dashboard";return;}
 b.disabled=true;b.textContent="Loading…";
 try{
  const d=await api("/api/management/teams/"+encodeURIComponent(b.dataset.teamDashboard)+"/dashboard");
  panel=document.createElement("div");panel.className="team-dashboard-inline";
  const hours=(d.activity||[]).reduce((n,x)=>n+Number(x.seconds||0),0)/3600;
  const tasks=(d.tasks||[]).reduce((n,x)=>n+Number(x.count||0),0);
  panel.innerHTML='<div class="team-dashboard-stats"><span><b>'+Number(d.members?.length||0)+'</b><small>Members</small></span><span><b>'+hours.toFixed(1)+'h</b><small>Recorded activity</small></span><span><b>'+Number(d.sessionCount||0)+'</b><small>Hosted sessions</small></span><span><b>'+tasks+'</b><small>Tracked tasks</small></span></div><div class="team-dashboard-task-list">'+(d.tasks||[]).map(x=>'<span>'+escapeHtml(x.status)+': '+Number(x.count)+'</span>').join(" · ")+'</div>';
  card.appendChild(panel);b.textContent="Hide dashboard";
 }catch(err){notice(err.message,"error");b.textContent="Team dashboard";}
 finally{b.disabled=false;}
});
function renderTeamAssignmentMembers(){
 const teamId=$("teamAssignmentSelect")?.value,box=$("teamMembersSelect");if(!box)return;
 const q=($("teamMemberSearch")?.value||"").trim().toLowerCase();
 if(!teamId){box.innerHTML='<div class="empty-state">Choose a team to manage its members.</div>';$("teamAssignmentHelp").textContent="Choose a team first.";$("teamSelectedCount").textContent="0 selected";return;}
 const visible=teamStaffCache.filter(m=>[m.username,m.displayName,m.role].some(v=>String(v||"").toLowerCase().includes(q)));
 box.innerHTML=visible.length?visible.map(m=>{const id=String(m.id),assigned=teamAssignments.get(id)||new Set(),checked=teamMemberDraft.has(id),other=[...assigned].filter(x=>x!==String(teamId)).length;return '<label class="team-member-row"><input type="checkbox" data-team-member-check="'+escapeHtml(id)+'" '+(checked?'checked':'')+'><span class="team-member-avatar">'+escapeHtml(String(m.username||"?").slice(0,1).toUpperCase())+'</span><span class="team-member-copy"><b>'+escapeHtml(m.username)+'</b><small>'+escapeHtml(m.displayName||m.role||"Staff member")+'</small></span><span class="team-member-current">'+(other?other+' other team(s)':checked?'Selected':'Not assigned')+'</span></label>';}).join(""):'<div class="empty-state">No staff matched your search.</div>';
 $("teamAssignmentHelp").textContent=teamMemberDraft.size+" selected for this team";$("teamSelectedCount").textContent=teamMemberDraft.size+" selected";
}
$("teamMembersSelect")?.addEventListener("change",e=>{const input=e.target.closest("[data-team-member-check]");if(!input)return;const id=String(input.dataset.teamMemberCheck);if(input.checked)teamMemberDraft.add(id);else teamMemberDraft.delete(id);renderTeamAssignmentMembers();});
$("teamSelectVisible")?.addEventListener("click",()=>{document.querySelectorAll("#teamMembersSelect [data-team-member-check]").forEach(el=>teamMemberDraft.add(String(el.dataset.teamMemberCheck)));renderTeamAssignmentMembers();});
$("teamClearVisible")?.addEventListener("click",()=>{document.querySelectorAll("#teamMembersSelect [data-team-member-check]").forEach(el=>teamMemberDraft.delete(String(el.dataset.teamMemberCheck)));renderTeamAssignmentMembers();});
function updateTeamRuleFields(){const mode=$("teamRuleMode").value;$("teamRuleMaxWrap").classList.toggle("hidden",mode!=="RANGE");$("teamRuleMin").disabled=mode==="NONE";$("teamRuleMax").disabled=mode!=="RANGE";}
$("teamRuleMode")?.addEventListener("change",updateTeamRuleFields);
$("createTeam")?.addEventListener("click",async()=>{
 const btn=$("createTeam");if(btn.disabled)return;
 const id=$("teamEditId").value, name=$("teamName").value.trim(), mode=$("teamRuleMode").value;
 const min=$("teamRuleMin").value,max=$("teamRuleMax").value;
 if(name.length<2||name.length>60){notice("Team name must be between 2 and 60 characters.","error");$("teamName").focus();return;}
 if(!["NONE","ABOVE","RANGE"].includes(mode)){notice("Choose a valid automatic assignment option.","error");return;}
 if(mode!=="NONE"&&(!min||!Number.isInteger(Number(min))||Number(min)<1||Number(min)>255)){notice("Choose a valid starting rank.","error");return;}
 if(mode==="RANGE"&&(!max||!Number.isInteger(Number(max))||Number(max)<Number(min)||Number(max)>255)){notice("Choose an ending rank equal to or above the starting rank.","error");return;}
 btn.disabled=true;const oldText=btn.textContent;btn.textContent=id?"Saving…":"Creating…";
 try{
  const payload={name,department:$("teamDepartment").value,color:$("teamColor").value,description:$("teamDescription").value.trim(),autoAssignMode:mode,autoAssignMinRank:mode==="NONE"?null:Number(min),autoAssignMaxRank:mode==="RANGE"?Number(max):null};
  const result=await api(id?"/api/management/teams/"+encodeURIComponent(id):"/api/management/teams",{method:id?"PUT":"POST",body:JSON.stringify(payload)});
  $("teamEditId").value="";$("teamName").value="";$("teamDepartment").value="Staff Management";$("teamDescription").value="";$("teamRuleMode").value="NONE";$("teamRuleMin").value="";$("teamRuleMax").value="";$("teamColor").value="#f5c928";$("cancelTeamEdit").classList.add("hidden");btn.textContent="Create team";updateTeamRuleFields();
  notice(id?"Team updated successfully.":"Team created successfully.","success");
  try{await loadTeamsSettings();}catch(refreshError){notice((id?"Team updated":"Team created")+" but the team list could not refresh: "+refreshError.message,"error");}
 }catch(e){notice(e.message||"Could not save the team. Please try again.","error");}
 finally{btn.disabled=false;if(btn.textContent==="Creating…"||btn.textContent==="Saving…")btn.textContent=oldText;}
});
$("cancelTeamEdit")?.addEventListener("click",()=>{$("teamEditId").value="";$("teamName").value="";$("teamDescription").value="";$("teamRuleMode").value="NONE";$("teamRuleMin").value="";$("teamRuleMax").value="";$("teamColor").value="#f5c928";$("cancelTeamEdit").classList.add("hidden");updateTeamRuleFields();});
$("teamAssignmentSelect")?.addEventListener("change",()=>{const id=$("teamAssignmentSelect").value;teamMemberDraft=new Set(teamStaffCache.filter(m=>teamAssignments.get(String(m.id))?.has(String(id))).map(m=>String(m.id)));renderTeamAssignmentMembers();});
$("teamMemberSearch")?.addEventListener("input",renderTeamAssignmentMembers);
$("saveTeamMembers")?.addEventListener("click",async()=>{
  const teamId=$("teamAssignmentSelect").value;if(!teamId){notice("Choose a team first.","error");return;}
  const btn=$("saveTeamMembers");btn.disabled=true;
  try{const userIds=[...teamMemberDraft];await api("/api/management/teams/"+encodeURIComponent(teamId)+"/members",{method:"PUT",body:JSON.stringify({userIds})});notice("Team assignments saved.","success");await loadTeamsSettings();}
  catch(e){notice(e.message,"error")}finally{btn.disabled=false;}
});

$("teamDirectory")?.addEventListener("click",async event=>{
  const edit=event.target.closest("[data-team-edit]");if(edit){const t=managementTeams.find(x=>String(x.id)===String(edit.dataset.teamEdit));if(!t)return;$("teamEditId").value=t.id;$("teamName").value=t.name;$("teamDepartment").value=t.department||"Staff Management";$("teamDescription").value=t.description||"";$("teamColor").value=t.color||"#f5c928";$("teamRuleMode").value=t.auto_assign_mode||"NONE";$("teamRuleMin").value=t.auto_assign_min_rank||"";$("teamRuleMax").value=t.auto_assign_max_rank||"";updateTeamRuleFields();$("createTeam").textContent="Save team changes";$("cancelTeamEdit").classList.remove("hidden");$("teamName").scrollIntoView({behavior:"smooth",block:"center"});return;}
  const manage=event.target.closest("[data-team-manage]");if(manage){const id=manage.dataset.teamManage;$("teamAssignmentSelect").value=id;teamMemberDraft=new Set(teamStaffCache.filter(m=>teamAssignments.get(String(m.id))?.has(String(id))).map(m=>String(m.id)));renderTeamAssignmentMembers();$("teamAssignmentSelect").scrollIntoView({behavior:"smooth",block:"center"});return;}
  const btn=event.target.closest("[data-team-delete]");if(!btn)return;
  if(!confirm("Delete this team? Its staff assignments will be cleared."))return;
  try{await api("/api/management/teams/"+encodeURIComponent(btn.dataset.teamDelete),{method:"DELETE"});notice("Team deleted.","success");await loadTeamsSettings();}
  catch(e){notice(e.message,"error")}
});
$("refreshTeams")?.addEventListener("click",async()=>{const b=$("refreshTeams");b.disabled=true;b.textContent="Refreshing…";try{await loadTeamsSettings();notice("Team list and Roblox staff data refreshed.","success");}catch(e){notice(e.message,"error");}finally{b.disabled=false;b.textContent="↻ Refresh teams";}});
$("directoryTeamFilter")?.addEventListener("change",renderStaffDirectory);
$("directoryResult")?.addEventListener("click",event=>{const b=event.target.closest("[data-member-teams]");if(!b)return;const id=String(b.dataset.memberTeams),ids=teamAssignments.get(id)||new Set(),teamId=[...ids][0]||"";$("teamAssignmentSelect").value=teamId;teamMemberDraft=new Set(teamStaffCache.filter(m=>teamAssignments.get(String(m.id))?.has(String(teamId))).map(m=>String(m.id)));renderTeamAssignmentMembers();$("teamAssignmentSelect").scrollIntoView({behavior:"smooth",block:"center"});});
async function loadGameSettings(){
  try{
    const d=await api("/api/settings/game-ranking");
    if(!d.canConfigure){$("settingsNav").classList.add("hidden");notice("Only the group owner can configure in-game ranking.","error");return}
    const s=d.settings;
    await loadManagementSettings();
    await loadTeamsSettings();
    const gameMinActorRankElement=$("gameMinActorRank");
    $("gameMinActorRank").value=s.min_actor_rank;
    $("gameMinTargetRank").value=s.min_target_rank;
    $("gameRankingEnabled").checked=s.enabled;
    $("gameAllowPromote").checked=s.allow_promote;
  }catch(e){notice(e.message,"error")}
}
$("saveGameSettings").addEventListener("click",async()=>{
  const btn=$("saveGameSettings");btn.disabled=true;btn.textContent="Saving…";
  try{
    const d=await api("/api/settings/game-ranking",{method:"PUT",body:JSON.stringify({
      minActorRank:Number($("gameMinActorRank").value),
      minTargetRank:Number($("gameMinTargetRank").value),
      enabled:$("gameRankingEnabled").checked,
      allowPromote:$("gameAllowPromote").checked
    })});
    notice("In-game ranking settings saved.","success");
    $("gameMinActorRank").value=d.settings.min_actor_rank;
    $("gameMinTargetRank").value=d.settings.min_target_rank;
  }catch(e){notice(e.message,"error")}
  finally{btn.disabled=false;btn.textContent="Save settings"}
});


async function loadOverviewInsights(){
 const metrics=$("overviewMetrics"),chart=$("overviewActivityChart"),upcomingBox=$("overviewUpcoming");if(!metrics)return;
 metrics.innerHTML='<div class="overview-metric"><small>STAFF MEMBERS</small><b>—</b><span>Loading</span></div>'.repeat(4);
 const results=await Promise.allSettled([api("/api/management/activity"),api("/api/management/sessions"),api("/api/staff")]);
 const activity=results[0].status==="fulfilled"?results[0].value:null,sessions=results[1].status==="fulfilled"?results[1].value.sessions||[]:[],staff=results[2].status==="fulfilled"?results[2].value.members||[]:[];
 const roster=activity?.members||[],active=roster.filter(x=>x.last_seen&&Date.now()-new Date(x.last_seen).getTime()<7*86400000).length;
 const hours=roster.reduce((n,x)=>n+Number(x.seconds||0),0)/3600;
 const next=sessions.filter(x=>["PLANNED","DELAYED"].includes(x.status)&&new Date(String(x.session_date).slice(0,10)+"T"+String(x.session_time||"00:00").slice(0,5)+":00")>=new Date()).sort((a,b)=>String(a.session_date+a.session_time).localeCompare(String(b.session_date+b.session_time)));
 const values=[[staff.length||"—","Group staff"],[activity?active:"—","Active in last 7 days"],[activity?hours.toFixed(1)+"h":"—","Tracked playtime"],[results[1].status==="fulfilled"?next.length:"—","Planned or delayed"]];
 metrics.innerHTML=values.map((x,i)=>'<div class="overview-metric"><small>'+["STAFF MEMBERS","ACTIVE STAFF","IN-GAME HOURS","UPCOMING SESSIONS"][i]+'</small><b>'+x[0]+'</b><span>'+x[1]+'</span></div>').join("");
 if(activity&&roster.length){
  const buckets=Array.from({length:7},(_,i)=>{const day=new Date();day.setDate(day.getDate()-(6-i));day.setHours(0,0,0,0);return {label:day.toLocaleDateString(undefined,{weekday:"short"}),count:roster.filter(x=>x.last_seen&&new Date(x.last_seen)>=day&&new Date(x.last_seen)<new Date(day.getTime()+86400000)).length};});
  const max=Math.max(1,...buckets.map(x=>x.count));
  chart.innerHTML=buckets.map(x=>'<div class="chart-column" title="'+x.count+' active staff"><div class="chart-bar" style="height:'+Math.max(3,x.count/max*100)+'%"></div><small>'+x.label+'</small></div>').join("");
 }else chart.innerHTML='<div class="chart-empty">No activity data is available for your account.</div>';
 const homeBoard=$("overviewLeaderboard");
 if(homeBoard){
  if(activity&&activity.canViewAll!==false){
   const byId=new Map(roster.map(x=>[String(x.user_id??x.id??""),x]));
   const ranked=staff.map(m=>{const r=byId.get(String(m.id??m.user_id??""))||{};return {...m,id:String(m.id??m.user_id??""),username:m.username||r.username||"Staff member",seconds:Number(r.seconds||0),last_seen:r.last_seen||null};}).filter(m=>/^\d+$/.test(m.id)).sort((a,b)=>b.seconds-a.seconds||String(a.username).localeCompare(String(b.username)));
   homeBoard.innerHTML=ranked.length?buildLeaderboard(ranked,5):'<div class="chart-empty">No staff activity has been recorded yet.</div>';
  }else homeBoard.innerHTML='<div class="chart-empty">The group leaderboard is not available with your current activity permissions.</div>';
 }
 upcomingBox.innerHTML=next.length?next.slice(0,4).map(x=>{const date=new Date(String(x.session_date).slice(0,10)+"T00:00:00");return '<div class="overview-session"><div class="overview-date">'+date.toLocaleDateString(undefined,{month:"short"}).toUpperCase()+'<b>'+date.getDate()+'</b></div><div><strong>'+escapeHtml(x.title)+'</strong><small>'+escapeHtml(String(x.session_time||"").slice(0,5))+' · '+escapeHtml(x.host_name||"Host pending")+'</small></div><span class="status-pill">'+escapeHtml(x.status)+'</span></div>';}).join(""):'<div class="chart-empty">No upcoming sessions are scheduled.</div>';
}
$("refreshOverviewInsights")?.addEventListener("click",()=>loadOverviewInsights().catch(e=>notice(e.message,"error")));

async function refreshOverview(){
  const data=await api("/api/me");sessionData=data;
  $("welcomeName").textContent=data.user.name;
  $("myRole").textContent=data.identity.roleName;
  $("myRank").textContent=data.identity.apiUnavailable?"—":"Rank "+data.identity.rank;
  $("accessStatus").textContent=data.identity.apiUnavailable?"Group API unavailable":(data.identity.canRank?"Enabled":"No access");
  $("userBox").textContent=data.user.name+" · "+data.identity.roleName;
  $("recentCount").textContent="—";
  if(data.identity.apiUnavailable){
    document.querySelectorAll(".nav-item[data-page='rank'],.nav-item[data-page='members'],.nav-item[data-page='logs']").forEach(b=>b.classList.add("hidden"));
    $("portal").classList.remove("hidden");$("loginPanel").classList.add("hidden");
    notice(data.apiError || "Your Roblox profile is verified, but group ranking access is not configured yet.","error");
  }else if(!data.identity.canRank){
    document.querySelectorAll(".nav-item[data-page='rank'],.nav-item[data-page='members'],.nav-item[data-page='logs']").forEach(b=>b.classList.add("hidden"));
    $("portal").classList.remove("hidden");$("loginPanel").classList.add("hidden");
    notice("Your Roblox account is verified, but your current Lemonz rank is below "+data.minRank+". Ranking tools are restricted.","error");
  }else{
    document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("hidden"));
    $("settingsNav").classList.toggle("hidden",data.identity.rank<255);
    $("portal").classList.remove("hidden");$("loginPanel").classList.add("hidden");
    try{const logs=await api("/api/logs");$("recentCount").textContent=logs.logs.length}catch{}
    loadOverviewInsights().catch(()=>{});
  }
  $("loginButton").classList.add("hidden");$("logoutButton").classList.remove("hidden");$("userBox").classList.remove("hidden");
}
(async()=>{
  try{await refreshOverview()}catch(e){
    if(e.message.includes("Sign in")){$("loginPanel").classList.remove("hidden");$("portal").classList.add("hidden")}
    else {notice(e.message,"error");$("loginPanel").classList.remove("hidden")}
  }
})();

// Workspace command palette: fast navigation and direct staff lookup.
const commandDialog=$("commandPalette"),commandInput=$("commandSearch"),commandResults=$("commandResults");
let commandSelection=0,commandItems=[];
function renderCommandResults(){
 if(!commandResults)return;
 const query=String(commandInput?.value||"").trim().toLowerCase();
 const pages=[...document.querySelectorAll(".nav-item:not(.hidden)")].map(b=>({kind:"page",page:b.dataset.page,view:b.dataset.view||"",label:b.textContent.trim().replace(/^[^\\w]+/,""),detail:"Open workspace",icon:"↗"}));
 const people=(staffDirectory||[]).filter(m=>!query||[m.username,m.displayName,m.role].some(v=>String(v||"").toLowerCase().includes(query))).slice(0,8).map(m=>({kind:"member",id:String(m.id),label:m.username||"Staff member",detail:(m.role||"Staff")+" · Roblox profile",icon:"♙"}));
 const matchingPages=pages.filter(x=>!query||(x.label+" "+x.page+" "+x.view).toLowerCase().includes(query));
 commandItems=[...matchingPages.slice(0,12),...people];
 if(!query)commandItems=pages.slice(0,12);
 commandSelection=0;
 commandResults.innerHTML=commandItems.length?commandItems.map((x,i)=>'<button type="button" class="command-result" data-command-index="'+i+'" aria-selected="'+(i===0?'true':'false')+'"><span class="command-result-icon">'+x.icon+'</span><span class="command-result-copy"><b>'+escapeHtml(x.label)+'</b><small>'+escapeHtml(x.detail)+'</small></span></button>').join(""):'<div class="command-empty">No matching pages or staff members found.</div>';
}
function openCommandPalette(){
 if(!commandDialog)return;
 renderCommandResults();if(!commandDialog.open)commandDialog.showModal();commandInput.value="";renderCommandResults();commandInput.focus();
}
function chooseCommand(index){
 const item=commandItems[index];if(!item)return;
 commandDialog.close();
 if(item.kind==="member"){showPage("members");showStaffProfile(item.id);}
 else showPage(item.page,item.view);
}
$("openCommandPalette")?.addEventListener("click",openCommandPalette);
$("closeCommandPalette")?.addEventListener("click",()=>commandDialog.close());
commandInput?.addEventListener("input",renderCommandResults);
commandResults?.addEventListener("click",e=>{const result=e.target.closest("[data-command-index]");if(result)chooseCommand(Number(result.dataset.commandIndex));});
commandInput?.addEventListener("keydown",e=>{
 if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(!commandItems.length)return;commandSelection=(commandSelection+(e.key==="ArrowDown"?1:-1)+commandItems.length)%commandItems.length;commandResults.querySelectorAll("[data-command-index]").forEach((el,i)=>el.setAttribute("aria-selected",String(i===commandSelection)));commandResults.querySelector('[data-command-index="'+commandSelection+'"]')?.scrollIntoView({block:"nearest"});}
 if(e.key==="Enter"){e.preventDefault();chooseCommand(commandSelection);}
});
document.addEventListener("keydown",e=>{
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCommandPalette();}
 if(e.key==="Escape"&&commandDialog?.open)commandDialog.close();
});

// Management workspace
function dateOnly(v){return v?String(v).slice(0,10):"—"}
function actionButtons(type,item,rank,settings){
  const field=type==="punishment"?"punishment_approve_rank":type==="promotion"?"promotion_approve_rank":"leave_approve_rank";
  const decision=item.status==="PENDING"&&rank>=Number(settings[field])
    ? '<button class="quiet-btn" data-decision="'+type+'" data-id="'+item.id+'" data-status="APPROVED">Approve</button> <button class="quiet-btn" data-decision="'+type+'" data-id="'+item.id+'" data-status="REJECTED">Reject</button>' : "";
  const remove=item.canDelete?'<button class="danger-btn" data-delete="'+type+'" data-id="'+item.id+'">Delete</button>':"";
  return '<div class="table-actions">'+decision+remove+'</div>';
}
function searchRows(items,id,fields){const q=($(id)?.value||"").trim().toLowerCase();return !q?items:items.filter(x=>fields.some(k=>String(x[k]??"").toLowerCase().includes(q)));}
function buildLeaderboard(roster,limit=5){
 const shown=roster.slice(0,limit);
 const avatar=(x,size)=>x.avatarUrl?'<img class="'+size+'" src="'+escapeHtml(x.avatarUrl)+'" alt="'+escapeHtml(x.username||"Staff avatar")+'" loading="lazy">':'<span class="'+size+' avatar-fallback">'+escapeHtml((x.username||"?").slice(0,1).toUpperCase())+'</span>';
 const podium=[shown[1],shown[0],shown[2]].filter(Boolean).map(x=>{
  const place=roster.indexOf(x)+1;
  return '<button type="button" class="leader-podium-card podium-place-'+place+'" data-leader-user="'+escapeHtml(x.id)+'" aria-label="Open '+escapeHtml(x.username)+' profile, leaderboard place '+place+'"><span class="podium-medal">'+(place===1?"♛":place===2?"Ⅱ":"Ⅲ")+'</span>'+avatar(x,"podium-avatar")+'<b class="podium-name">'+escapeHtml(x.username||"Staff member")+'</b><small>'+escapeHtml(x.role||("Rank "+(x.rank||"—")))+'</small><strong>'+(x.seconds/3600).toFixed(1)+'<small> hrs</small></strong><span class="podium-base">'+place+'</span></button>';
 }).join("");
 const rows=shown.slice(3).map((x,i)=>{
  const place=i+4,active=x.last_seen&&Date.now()-new Date(x.last_seen).getTime()<7*86400000;
  return '<button type="button" class="views-leader-row leader-profile-link" data-leader-user="'+escapeHtml(x.id)+'"><span class="views-leader-rank">'+place+'</span>'+avatar(x,"leader-avatar")+'<div class="leader-member-copy"><b>'+escapeHtml(x.username||"Staff member")+'</b><small>'+escapeHtml(x.role||("Rank "+(x.rank||"—")))+'</small></div><span class="leader-activity '+(active?"is-active":"")+'">'+(active?"Active":x.last_seen?"Tracked":"No recent data")+'</span><strong>'+(x.seconds/3600).toFixed(1)+'h</strong><span class="leader-open-profile">Profile ↗</span></button>';
 }).join("");
 return '<div class="leader-summary"><span>'+roster.length+' staff ranked</span><span>All-time recorded in-game time</span></div><div class="leader-podium">'+podium+'</div>'+(rows?'<div class="leader-table-head"><span>PLACE</span><span></span><span>STAFF MEMBER</span><span>ACTIVITY</span><span>HOURS</span><span></span></div>'+rows:'')+(roster.length>limit?'<div class="leader-footer"><button type="button" class="quiet-btn" data-leader-see-all>See all '+roster.length+' staff members →</button></div>':"");
}
let cachedLeaderboard=[];
async function loadViews(){
 const stats=$("viewsStats"),teams=$("viewsTeams"),sessions=$("viewsSessions"),leader=$("viewsLeaderboard");
 const showError=(el,label,error)=>{if(el)el.innerHTML='<div class="empty-state error-state">'+escapeHtml(label+": "+error.message)+'</div>';};
 [stats,teams,sessions,leader].forEach(el=>{if(el)el.setAttribute("aria-busy","true");});
 try{
  const results=await Promise.allSettled([api("/api/staff"),api("/api/management/activity"),api("/api/management/sessions"),api("/api/management/teams")]);
  const value=i=>results[i].status==="fulfilled"?results[i].value:null;
  const staffData=value(0),activityData=value(1),sessionData=value(2),teamData=value(3);
  const labels=["staff roster","activity","sessions","teams"],failed=results.map((r,i)=>r.status==="rejected"?labels[i]+": "+r.reason.message:null).filter(Boolean);
  if(!staffData)showError(stats,"Could not load overview",results[0].reason);
  else{
   const staff=staffData.members||[],activity=activityData?.members||[],allSessions=sessionData?.sessions||[];
   const active=activity.filter(x=>x.last_seen&&Date.now()-new Date(x.last_seen).getTime()<7*86400000).length;
   const hours=(activity.reduce((n,x)=>n+Number(x.seconds||0),0)/3600).toFixed(1);
   const upcoming=allSessions.filter(x=>["PLANNED","DELAYED"].includes(x.status)&&new Date(String(x.session_date).slice(0,10)+"T"+String(x.session_time||"00:00").slice(0,5)+":00")>=new Date()).length;
   stats.innerHTML=[["STAFF MEMBERS",staff.length],["ACTIVE STAFF",activityData?active:"—"],["IN-GAME HOURS",activityData?hours:"—"],["UPCOMING SESSIONS",sessionData?upcoming:"—"]].map(x=>'<article class="views-stat"><small>'+x[0]+'</small><b>'+x[1]+'</b><span>'+((x[0]==="ACTIVE STAFF"||x[0]==="IN-GAME HOURS")&&!activityData?"Activity unavailable":"Live portal data")+'</span></article>').join("");
   if(activityData&&activityData.canViewAll!==false){
    const byId=new Map(activity.map(x=>[String(x.user_id??x.id??""),x]).filter(x=>x[0]));
    cachedLeaderboard=staff.map(m=>{const id=String(m.id??m.user_id??""),r=byId.get(id)||{};return {...m,id,username:m.username||r.username||"Staff member",seconds:Number(r.seconds||0),last_seen:r.last_seen||null,shifts_attended:Number(r.shifts_attended||0)};}).filter(m=>/^\d+$/.test(m.id)).sort((x,y)=>y.seconds-x.seconds||String(x.username).localeCompare(String(y.username)));
    leader.innerHTML=cachedLeaderboard.length?buildLeaderboard(cachedLeaderboard,5):'<div class="empty-state">No staff members were returned by the group directory.</div>';
   }else{cachedLeaderboard=[];showError(leader,"Leaderboard unavailable",new Error(activityData?.canViewAll===false?"Your current rank does not have permission to view the group leaderboard. Ask an owner to grant activity viewing access.":results[1].reason?.message||"Activity data could not be loaded."));}
  }
  if(teamData){const all=teamData.teams||[];teams.innerHTML=all.length?all.map(t=>'<div class="views-team-row"><span class="views-team-dot" style="background:'+escapeHtml(t.color||"#f5c928")+'"></span><div><b>'+escapeHtml(t.name)+'</b></div><strong>'+Number(t.member_count||0)+'</strong></div>').join(""):'<div class="empty-state">No teams have been created yet.</div>';}else showError(teams,"Could not load teams",results[3].reason);
  if(sessionData){const all=sessionData.sessions||[],counts=[["Planned","PLANNED"],["On-going","ONGOING"],["Delayed","DELAYED"],["Completed","COMPLETED"],["Canceled","CANCELED"]].map(([label,status])=>[label,all.filter(x=>x.status===status).length]),max=Math.max(1,...counts.map(x=>x[1]));sessions.innerHTML=counts.map(x=>'<div class="views-pipeline-row"><span>'+x[0]+'</span><div><i style="width:'+Math.round(x[1]/max*100)+'%"></i></div><b>'+x[1]+'</b></div>').join("");}else showError(sessions,"Could not load sessions",results[2].reason);
  if(failed.length)notice("Some insight panels could not load: "+failed.join(" · "),"error");
 }catch(e){showError(stats,"Insights unavailable",e);}
 finally{[stats,teams,sessions,leader].forEach(el=>{if(el)el.removeAttribute("aria-busy");});}
}
document.addEventListener("click",async e=>{
 const all=e.target.closest("[data-leader-see-all]");if(all){showPage("views");await loadViews();if(cachedLeaderboard.length)$("viewsLeaderboard").innerHTML=buildLeaderboard(cachedLeaderboard,cachedLeaderboard.length);return;}const card=e.target.closest("[data-leader-user]");if(!card)return;
 const id=String(card.dataset.leaderUser||"");if(!/^\d+$/.test(id)){notice("This leaderboard entry does not have a valid Roblox user ID.","error");return;}
 card.disabled=true;showPage("members");
 try{await showStaffProfile(id);}finally{card.disabled=false;}
});

$("refreshViews")?.addEventListener("click",loadViews);
async function loadManagement(tab){
  if(!staffDirectory.length){try{await loadStaffDirectory();}catch{}}
  if(tab==="activity"){
    $("activityTable").textContent="Loading staff activity…";
    try{
      const d=await api("/api/management/activity");
      $("activityAdjustCard").classList.toggle("hidden",!d.canEdit);
      const stats=new Map((d.members||[]).map(m=>[String(m.user_id),m]));
      let roster;
      if(d.canViewAll&&staffDirectory.length){
        roster=staffDirectory.map(person=>{
          const data=stats.get(String(person.id))||{};
          return {...person,user_id:String(person.id),username:person.username,seconds:Number(data.seconds||0),shifts_attended:Number(data.shifts_attended||0),last_seen:data.last_seen||null};
        });
      }else{
        roster=(d.members||[]).map(person=>({...person,username:person.username||sessionData?.user?.name||"You",rank:person.rank??sessionData?.identity?.rank??"—",role:person.role||sessionData?.identity?.roleName||"—"}));
      }
      roster.sort((x,y)=>Number(y.rank||0)-Number(x.rank||0)||String(x.username).localeCompare(String(y.username)));
      const now=Date.now();
       roster=roster.map(person=>{const age=person.last_seen?now-new Date(person.last_seen).getTime():Infinity;return {...person,inactiveDays:person.last_seen?Math.floor(age/86400000):null,activityStatus:!person.last_seen?"Not tracked":age>30*86400000?"30+ days inactive":age>14*86400000?"14+ days inactive":age>7*86400000?"7+ days inactive":"Active"};});
       const totalShifts=roster.reduce((n,p)=>n+Number(p.shifts_attended||0),0);
       const totalMinutes=Math.floor(roster.reduce((n,p)=>n+Number(p.seconds||0),0)/60);
       const activeCount=roster.filter(p=>p.activityStatus==="Active").length;
       const inactiveCount=roster.filter(p=>p.activityStatus!=="Active").length;
       $("activitySummary").innerHTML='<div class="activity-stat"><small>STAFF SHOWN</small><b>'+roster.length.toLocaleString()+'</b></div><div class="activity-stat"><small>SHIFTS ATTENDED</small><b>'+totalShifts.toLocaleString()+'</b></div><div class="activity-stat"><small>TOTAL IN-GAME MINUTES</small><b>'+totalMinutes.toLocaleString()+'</b></div><div class="activity-stat"><small>INACTIVE / NOT TRACKED</small><b>'+inactiveCount.toLocaleString()+'</b><em>'+activeCount+' active in last 7 days</em></div>';
       const rows=searchRows(roster,"activitySearch",["username","displayName","role","rank","shifts_attended","seconds","activityStatus","inactiveDays"]);
      const scope=d.canViewAll?"All staff members":"Only your own activity is visible with your current permissions";
      $("activityTable").innerHTML='<div class="activity-table-heading"><span>'+escapeHtml(scope)+'</span><span>'+rows.length+' shown</span></div>'+
        (rows.length?'<table class="data-table activity-data-table"><thead><tr><th>STAFF MEMBER</th><th>GROUP RANK</th><th>SHIFTS ATTENDED</th><th>IN-GAME MINUTES</th><th>LAST ACTIVE</th><th>ACTIVITY STATUS</th><th>INACTIVITY</th></tr></thead><tbody>'+
        rows.map(person=>'<tr><td><div class="activity-person">'+(person.avatarUrl?'<img src="'+escapeHtml(person.avatarUrl)+'" alt="" loading="lazy">':'<span class="activity-avatar-fallback">'+escapeHtml(String(person.username||"?").slice(0,1).toUpperCase())+'</span>')+'<span><b>'+escapeHtml(person.username)+'</b>'+(person.displayName&&person.displayName!==person.username?'<small>'+escapeHtml(person.displayName)+'</small>':"")+'</span></div></td><td><span class="activity-role">'+escapeHtml(person.role||"—")+'</span><small class="activity-rank">Rank '+escapeHtml(person.rank??"—")+'</small></td><td><b>'+Number(person.shifts_attended||0).toLocaleString()+'</b></td><td><b>'+Math.floor(Number(person.seconds||0)/60).toLocaleString()+'</b> min</td><td>'+escapeHtml(person.last_seen?formatDate(person.last_seen):"—")+'</td><td><span class="status-pill">'+escapeHtml(person.activityStatus)+'</span></td><td>'+(person.inactiveDays===null?"No tracker data":person.inactiveDays+" days") +'</td></tr>').join("")+
        '</tbody></table>':'<div class="empty-state">No staff members match your search.</div>');
    }catch(e){$("activityTable").innerHTML='<div class="empty-state error-state">'+escapeHtml(e.message)+'</div>'}
  }
  if(tab==="punishments"){
    $("punishmentTable").textContent="Loading records…";
    try{const d=await api("/api/management/punishments"),all=d.items||[],rows=searchRows(all,"punishmentSearch",["username","type","reason","status","created_by_name","decision_note"]);$("punishmentSummary").innerHTML=[["PENDING",all.filter(x=>x.status==="PENDING").length,"Awaiting review"],["APPROVED",all.filter(x=>x.status==="APPROVED").length,"Approved actions"],["REJECTED",all.filter(x=>x.status==="REJECTED").length,"Declined requests"],["TOTAL",all.length,"Records and requests"]].map(x=>'<article class="session-stat"><span>⚑</span><small>'+x[0]+'</small><b>'+x[1]+'</b><em>'+x[2]+'</em></article>').join("");
      $("punishmentTable").innerHTML=rows.length?'<table class="data-table"><thead><tr><th>MEMBER</th><th>ACTION</th><th>REASON</th><th>STATUS</th><th>SUBMITTED BY</th><th>REVIEWED BY</th><th>REVIEW NOTE</th><th>ACTIONS</th></tr></thead><tbody>'+rows.map(i=>'<tr><td><b>'+escapeHtml(i.username)+'</b></td><td>'+escapeHtml(i.type)+' '+escapeHtml(i.duration||"")+'</td><td>'+escapeHtml(i.reason)+'</td><td><span class="status-pill">'+escapeHtml(i.status)+'</span></td><td>'+escapeHtml(i.created_by_name)+'</td><td>'+escapeHtml(i.decided_by_name||"—")+'</td><td>'+escapeHtml(i.decision_note||"—")+'</td><td>'+actionButtons("punishment",i,d.rank,d.settings)+'</td></tr>').join("")+'</tbody></table>':"No matching punishment records.";
      await loadPunishmentAudit();
    }catch(e){$("punishmentTable").textContent=e.message}
  }
  if(tab==="promotions"){
    $("promotionTable").textContent="Loading suggestions…";
    try{const d=await api("/api/management/promotions"),all=d.items||[],rows=searchRows(all,"promotionSearch",["username","suggested_role","reason","status","suggested_by_name"]);$("promotionSummary").innerHTML=[["PENDING",all.filter(x=>x.status==="PENDING").length,"Awaiting review"],["APPROVED",all.filter(x=>x.status==="APPROVED").length,"Approved suggestions"],["REJECTED",all.filter(x=>x.status==="REJECTED").length,"Declined suggestions"],["TOTAL",all.length,"All recommendations"]].map(x=>'<article class="session-stat"><span>★</span><small>'+x[0]+'</small><b>'+x[1]+'</b><em>'+x[2]+'</em></article>').join("");
      $("promotionTable").innerHTML=rows.length?'<table class="data-table"><thead><tr><th>MEMBER</th><th>SUGGESTED ROLE</th><th>REASON</th><th>STATUS</th><th>SUGGESTED BY</th><th>ACTIONS</th></tr></thead><tbody>'+rows.map(i=>'<tr><td>'+escapeHtml(i.username)+'</td><td>'+escapeHtml(i.suggested_role)+'</td><td>'+escapeHtml(i.reason)+'</td><td><span class="status-pill">'+escapeHtml(i.status)+'</span></td><td>'+escapeHtml(i.suggested_by_name)+'</td><td>'+actionButtons("promotion",i,d.rank,d.settings)+'</td></tr>').join("")+'</tbody></table>':"No matching promotion suggestions.";
    }catch(e){$("promotionTable").textContent=e.message}
  }
  if(tab==="leaves"){
    if(!$("leaveRoblox").value.trim())$("leaveRoblox").value=sessionData?.user?.name||"";
    $("leaveTable").textContent="Loading leave requests…";
    try{
      const d=await api("/api/management/leaves"),all=d.items||[],q=($("leaveSearch").value||"").toLowerCase(),filter=$("leaveStatusFilter").value;
      const rows=all.filter(i=>(filter==="ALL"||i.status===filter)&&[i.roblox_username,i.start_date,i.end_date,i.reason,i.status,i.created_by_name,i.decided_by_name,i.decision_note].some(v=>String(v||"").toLowerCase().includes(q)));
      const pending=all.filter(x=>x.status==="PENDING").length,approved=all.filter(x=>x.status==="APPROVED").length,rejected=all.filter(x=>x.status==="REJECTED").length;
      $("leaveSummary").innerHTML=[["PENDING",pending,"Awaiting a decision"],["APPROVED",approved,"Approved requests"],["REJECTED",rejected,"Declined requests"]].map(x=>`<article class="session-stat"><span>▤</span><small>${x[0]}</small><b>${x[1]}</b><em>${x[2]}</em></article>`).join("");
      $("leaveTable").innerHTML=rows.length?'<table class="data-table leave-data-table"><thead><tr><th>STAFF MEMBER</th><th>DATES</th><th>REASON / HANDOVER</th><th>LAST APPROVED LEAVE</th><th>STATUS</th><th>REVIEWED BY</th><th>REVIEW NOTE</th><th>ACTIONS</th></tr></thead><tbody>'+rows.map(i=>'<tr data-leave-status="'+escapeHtml(i.status)+'"><td><b>'+escapeHtml(i.roblox_username)+'</b><small class="table-subtext">Submitted '+escapeHtml(formatDate(i.created_at))+'</small></td><td><b>'+dateOnly(i.start_date)+'</b><small class="table-subtext">through '+dateOnly(i.end_date)+'</small></td><td class="reason-cell">'+escapeHtml(i.reason)+'</td><td>'+dateOnly(i.last_leave_at)+'</td><td><span class="status-pill status-'+escapeHtml(String(i.status).toLowerCase())+'">'+escapeHtml(i.status)+'</span></td><td>'+escapeHtml(i.decided_by_name||"—")+'</td><td class="reason-cell">'+escapeHtml(i.decision_note||"—")+(i.decided_at?'<small class="table-subtext">'+escapeHtml(formatDate(i.decided_at))+'</small>':"")+'</td><td>'+actionButtons("leave",i,d.rank,d.settings)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No leave requests match this filter.</div>';
      await loadLeaveAudit();
    }catch(e){$("leaveTable").textContent=e.message}
  }
}
$("refreshActivity").addEventListener("click",()=>loadManagement("activity"));
$("promotionSearch")?.addEventListener("input",()=>{const q=$("promotionSearch").value.toLowerCase();document.querySelectorAll("#promotionTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));});
$("punishmentSearch")?.addEventListener("input",()=>{const q=$("punishmentSearch").value.toLowerCase();document.querySelectorAll("#punishmentTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));});
$("activitySearch")?.addEventListener("input",()=>{const q=$("activitySearch").value.toLowerCase();document.querySelectorAll("#activityTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));});
$("saveActivityAdjust").addEventListener("click",async()=>{
  try{
    await api("/api/management/activity/adjust",{method:"POST",body:JSON.stringify({userId:$("activityUserId").value.trim(),username:$("activityUsername").value.trim(),minutes:Number($("activityMinutes").value),reason:$("activityReason").value.trim()})});
    notice("Activity adjustment saved.","success");["activityUserId","activityUsername","activityMinutes","activityReason"].forEach(id=>$(id).value="");loadManagement("activity");
  }catch(e){notice(e.message,"error")}
});
async function loadPunishmentAudit(){
  const el=$("punishmentAuditTable");if(!el)return;el.textContent="Loading audit log…";
  try{const d=await api("/api/management/punishments/audit"),items=d.items||[];
    el.innerHTML=items.length?'<table class="data-table"><thead><tr><th>DATE &amp; TIME</th><th>EVENT</th><th>MEMBER</th><th>DETAILS</th><th>PERFORMED BY</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+escapeHtml(formatDate(x.created_at))+'</td><td><span class="status-pill">'+escapeHtml(x.action)+'</span></td><td>'+escapeHtml(x.target_username||"—")+'</td><td>'+escapeHtml(x.details||"—")+'</td><td>'+escapeHtml(x.actor_name)+'</td></tr>').join("")+'</tbody></table>':"No discipline actions have been logged yet.";
  }catch(e){el.textContent=e.message}
}
$("refreshPunishmentAudit")?.addEventListener("click",loadPunishmentAudit);

async function loadPromotionAudit(){
 const el=$("promotionAuditTable");if(!el)return;el.textContent="Loading promotion history…";
 try{const d=await api("/api/management/promotions/audit"),items=d.items||[];
  el.innerHTML=items.length?'<table class="data-table"><thead><tr><th>DATE &amp; TIME</th><th>EVENT</th><th>MEMBER</th><th>DETAILS</th><th>PERFORMED BY</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+escapeHtml(formatDate(x.created_at))+'</td><td><span class="status-pill">'+escapeHtml(x.action)+'</span></td><td>'+escapeHtml(x.target_username||"—")+'</td><td>'+escapeHtml(x.details||"—")+'</td><td>'+escapeHtml(x.actor_name||"—")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No promotion history recorded yet.</div>';
 }catch(e){el.textContent=e.message;}
}
$("refreshPromotionAudit")?.addEventListener("click",loadPromotionAudit);

$("submitPunishment").addEventListener("click",async()=>{
  try{
    const d=await api("/api/management/punishments",{method:"POST",body:JSON.stringify({userId:$("punishUserId").value.trim(),username:$("punishUsername").value.trim(),type:$("punishType").value,duration:$("punishDuration").value.trim(),reason:$("punishReason").value.trim()})});
    notice(d.item.status==="PENDING"?"Discipline request sent for approval.":"Discipline record issued and logged.","success");
    ["punishUserId","punishUsername","punishDuration","punishReason"].forEach(id=>$(id).value="");loadManagement("punishments");
  }catch(e){notice(e.message,"error")}
});
$("submitPromotion").addEventListener("click",async()=>{
  try{
    await api("/api/management/promotions",{method:"POST",body:JSON.stringify({userId:$("promotionUserId").value.trim(),username:$("promotionUsername").value.trim(),suggestedRole:$("promotionRole").value.trim(),reason:$("promotionReason").value.trim()})});
    notice("Promotion request submitted and logged.","success");$("promotionUsername").value="";$("promotionUserId").value="";$("promotionReason").value="";loadManagement("promotions");
  }catch(e){notice(e.message,"error")}
});
async function loadLeaveAudit(){
  const el=$("leaveAuditTable");if(!el)return;el.textContent="Loading leave activity…";
  try{const d=await api("/api/management/leaves/audit"),items=d.items||[];
    el.innerHTML=items.length?'<table class="data-table"><thead><tr><th>DATE &amp; TIME</th><th>EVENT</th><th>STAFF MEMBER</th><th>DETAILS</th><th>PERFORMED BY</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+escapeHtml(formatDate(x.created_at))+'</td><td><span class="status-pill">'+escapeHtml(x.action)+'</span></td><td>'+escapeHtml(x.target_username||"—")+'</td><td class="reason-cell">'+escapeHtml(x.details||"—")+'</td><td>'+escapeHtml(x.actor_name||"—")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No leave activity has been recorded yet.</div>';
  }catch(e){el.textContent=e.message}
}
function fillTeamFilter(id){
 const el=$(id);if(!el)return "ALL";const previous=el.value;
 el.innerHTML='<option value="ALL">All teams</option><option value="UNASSIGNED">Unassigned</option>'+managementTeams.map(t=>'<option value="'+escapeHtml(t.id)+'">'+escapeHtml(t.name)+'</option>').join("");
 if([...el.options].some(o=>o.value===previous))el.value=previous;
 return el.value||"ALL";
}
async function loadTasks(){
  $("taskTable").textContent="Loading staff tasks…";
  try{if(!staffDirectory.length)await loadStaffDirectory();
    const d=await api("/api/management/tasks"),items=d.items||[],filter=$("taskStatusFilter").value,q=($("taskSearch").value||"").toLowerCase();const teamFilter=fillTeamFilter("taskTeamFilter");
    const teamAssignFilter=fillTeamFilter("taskTeamAssignFilter"),select=$("taskAssignedTo"),previous=select.value;select.innerHTML='<option value="">Choose a staff member…</option>'+staffDirectory.filter(m=>Number(m.rank)>=Number(d.settings.task_view_rank)&&(teamAssignFilter==="ALL"||(teamAssignments.get(String(m.id))||new Set()).has(teamAssignFilter))).map(m=>'<option value="'+escapeHtml(m.id)+'">'+escapeHtml(m.username)+' · '+escapeHtml(m.role)+'</option>').join("");if(previous&&[...select.options].some(o=>o.value===previous))select.value=previous;
    const rows=items.filter(x=>(filter==="ALL"||x.status===filter)&&(teamFilter==="ALL"||(teamFilter==="UNASSIGNED"?!((x.assigned_team_ids||[]).length):(x.assigned_team_ids||[]).map(String).includes(teamFilter)))&&[x.title,x.description,x.assigned_to_name,x.assigned_team_names,x.assigned_department_names,x.created_by_name,x.priority,x.status].some(v=>String(v||"").toLowerCase().includes(q)));
    const counts=[["OPEN",items.filter(x=>x.status==="OPEN").length,"Needs attention"],["IN PROGRESS",items.filter(x=>x.status==="IN_PROGRESS").length,"Currently being worked on"],["BLOCKED",items.filter(x=>x.status==="BLOCKED").length,"Needs help"],["COMPLETED",items.filter(x=>x.status==="COMPLETED").length,"Finished tasks"]];
    $("taskSummary").innerHTML=counts.map(x=>`<article class="session-stat"><span>✓</span><small>${x[0]}</small><b>${x[1]}</b><em>${x[2]}</em></article>`).join("");
    $("taskStorageDiagnostics")?.classList.toggle("hidden",Number(d.rank)<255);
    $("taskAuditCard").classList.toggle("hidden",!d.canManage);
    $("taskTable").innerHTML=rows.length?'<table class="data-table task-data-table"><thead><tr><th>TASK</th><th>ASSIGNED TO</th><th>TEAM</th><th>PRIORITY</th><th>DUE DATE</th><th>CREATED BY</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>'+rows.map(x=>'<tr><td><b>'+escapeHtml(x.title)+'</b><small class="task-id-label">TASK ID · #'+escapeHtml(String(x.id))+'</small><small class="table-subtext">'+escapeHtml(x.description||"No extra details") +'</small></td><td>'+escapeHtml(x.assigned_to_name)+'</td><td>'+escapeHtml(x.assigned_team_names?((x.assigned_department_names?x.assigned_department_names+' · ':'')+x.assigned_team_names):'Unassigned')+'</td><td><span class="priority-pill priority-'+escapeHtml(String(x.priority).toLowerCase())+'">'+escapeHtml(x.priority)+'</span></td><td>'+dateOnly(x.due_date)+'</td><td>'+escapeHtml(x.created_by_name)+'</td><td>'+(x.canUpdate?'<select class="task-status-select" data-task-status="'+escapeHtml(x.id)+'"><option value="OPEN"'+(x.status==="OPEN"?" selected":"")+ '>Open</option><option value="IN_PROGRESS"'+(x.status==="IN_PROGRESS"?" selected":"")+ '>In progress</option><option value="BLOCKED"'+(x.status==="BLOCKED"?" selected":"")+ '>Blocked</option><option value="COMPLETED"'+(x.status==="COMPLETED"?" selected":"")+ '>Completed</option></select>':'<span class="status-pill">'+escapeHtml(x.status)+'</span>')+'</td><td>'+(x.canDelete?'<button class="danger-btn" data-task-delete="'+escapeHtml(x.id)+'">Delete</button>':"—")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No tasks match this filter.</div>';
    if(d.canManage)await loadTaskAudit();
  }catch(e){$("taskTable").textContent=e.message}
}
async function loadTaskAudit(){const el=$("taskAuditTable");if(!el)return;try{const d=await api("/api/management/tasks/audit");el.innerHTML=(d.items||[]).length?'<table class="data-table"><thead><tr><th>DATE &amp; TIME</th><th>EVENT</th><th>ASSIGNED STAFF</th><th>DETAILS</th><th>PERFORMED BY</th></tr></thead><tbody>'+d.items.map(x=>'<tr><td>'+escapeHtml(formatDate(x.created_at))+'</td><td>'+escapeHtml(x.action)+'</td><td>'+escapeHtml(x.target_username||"—")+'</td><td>'+escapeHtml(x.details||"—")+'</td><td>'+escapeHtml(x.actor_name||"—")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No task actions logged yet.</div>';}catch(e){el.textContent=e.message}}
function setupLeaveDateLimits(){
  const start=$("leaveStart"),end=$("leaveEnd");if(!start||!end)return;
  const today=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10);};
  start.min=today();end.min=start.value||today();
  start.addEventListener("change",()=>{end.min=start.value||today();if(end.value&&end.value<end.min)end.value=end.min;});
}
setupLeaveDateLimits();
$("refreshLeaves")?.addEventListener("click",()=>loadManagement("leaves"));
$("refreshLeaveAudit")?.addEventListener("click",loadLeaveAudit);
$("leaveSearch")?.addEventListener("input",()=>loadManagement("leaves"));
$("leaveStatusFilter")?.addEventListener("change",()=>loadManagement("leaves"));
$("refreshTasks")?.addEventListener("click",loadTasks);
$("taskStorageDiagnostics")?.addEventListener("click",async()=>{
 const panel=$("taskStoragePanel"),details=$("taskStorageDetails");
 panel.classList.remove("hidden");details.textContent="Checking task storage…";
 try{
  const data=await api("/api/management/tasks/diagnostics");details.replaceChildren();
  const entries=[["TABLE",data.tableExists?"Available":"Missing"],["ID COLUMN",(data.idColumn?.data_type||"Unknown")+" · "+(data.idColumn?.udt_name||"Unknown")],["TOTAL TASKS",data.totalTasks||"0"]];
  for(const [label,value] of entries){const card=document.createElement("div");card.className="task-storage-stat";const small=document.createElement("small");small.textContent=label;const strong=document.createElement("b");strong.textContent=value;card.append(small,strong);details.append(card);}
  const recent=document.createElement("div");recent.className="task-storage-recent";const heading=document.createElement("b");heading.textContent="Recent stored task IDs";recent.append(heading);
  for(const item of data.recentTasks||[]){const row=document.createElement("p");row.textContent="#"+item.id+" · "+item.title+" · "+item.status;recent.append(row);}
  details.append(recent);
 }catch(error){details.textContent=error.message;}
});
$("closeTaskDiagnostics")?.addEventListener("click",()=>$("taskStoragePanel")?.classList.add("hidden"));

$("refreshTaskAudit")?.addEventListener("click",loadTaskAudit);
$("taskSearch")?.addEventListener("input",loadTasks);
$("taskStatusFilter")?.addEventListener("change",loadTasks);$("taskTeamFilter")?.addEventListener("change",loadTasks);$("taskTeamAssignFilter")?.addEventListener("change",loadTasks);
$("createTask")?.addEventListener("click",async()=>{
  const btn=$("createTask");btn.disabled=true;btn.textContent="Creating…";
  try{await api("/api/management/tasks",{method:"POST",body:JSON.stringify({title:$("taskTitle").value.trim(),description:$("taskDescription").value.trim(),assignedToId:$("taskAssignedTo").value,priority:$("taskPriority").value,dueDate:$("taskDueDate").value})});
    ["taskTitle","taskDescription","taskDueDate"].forEach(id=>$(id).value="");$("taskAssignedTo").value="";$("taskPriority").value="NORMAL";notice("Staff task created and logged.","success");await loadTasks();
  }catch(e){notice(e.message,"error")}finally{btn.disabled=false;btn.textContent="Create task"}
});
document.addEventListener("change",async e=>{
  const status=e.target.closest("[data-task-status]");if(status){status.disabled=true;try{await api("/api/management/tasks/"+encodeURIComponent(status.dataset.taskStatus)+"/status",{method:"PATCH",body:JSON.stringify({status:status.value})});notice("Task status updated and logged.","success");await loadTasks();}catch(err){notice(err.message,"error");await loadTasks();}return;}
});
document.addEventListener("click",async e=>{
  const del=e.target.closest("[data-task-delete]");if(!del)return;if(!confirm("Delete this staff task? Its audit history will remain."))return;
  del.disabled=true;del.textContent="Deleting…";try{await api("/api/management/tasks/"+encodeURIComponent(del.dataset.taskDelete),{method:"DELETE"});notice("Task deleted and logged.","success");await loadTasks();}catch(err){notice(err.message,"error");del.disabled=false;del.textContent="Delete";}
});

$("submitLeave").addEventListener("click",async()=>{
  const btn=$("submitLeave");btn.disabled=true;btn.textContent="Submitting…";
  try{
    const d=await api("/api/management/leaves",{method:"POST",body:JSON.stringify({robloxUsername:$("leaveRoblox").value.trim(),startDate:$("leaveStart").value,endDate:$("leaveEnd").value,reason:$("leaveReason").value.trim(),timezoneOffset:new Date().getTimezoneOffset()})});
    $("leaveReason").value="";$("leaveStart").value="";$("leaveEnd").value="";$("leaveEnd").min=$("leaveStart").min;notice("Time-off request submitted. Last approved leave: "+dateOnly(d.item.last_leave_at)+".","success");await loadManagement("leaves");
  }catch(e){notice(e.message,"error")}finally{btn.disabled=false;btn.textContent="Submit request"}
});
document.addEventListener("click",async e=>{
  const decision=e.target.closest("[data-decision]");
  if(decision){
    const type=decision.dataset.decision,id=decision.dataset.id,status=decision.dataset.status,route=type==="punishment"?"punishments":type==="promotion"?"promotions":"leaves";
    try{const note=(prompt(status==="REJECTED"?"Enter the reason for rejecting this request:":"Add an optional review note:")||"");if(status==="REJECTED"&&!note.trim()){notice("A rejection reason is required.","error");return;}await api(`/api/management/${route}/${encodeURIComponent(id)}/decision`,{method:"POST",body:JSON.stringify({status,note})});notice(type+" "+status.toLowerCase()+".","success");loadManagement(route);}
    catch(err){notice(err.message,"error")}return;
  }
  const remove=e.target.closest("[data-delete]");if(!remove)return;
  const type=remove.dataset.delete,id=remove.dataset.id,route=type==="punishment"?"punishments":type==="promotion"?"promotions":type==="leave"?"leaves":"sessions";
  if(!confirm("PERMANENT DELETION\\n\\nYou are deleting this "+(type==="leave"?"time-off request":type==="session"?"session":type)+". This cannot be undone. Continue?"))return;
  try{await api(`/api/management/${route}/${encodeURIComponent(id)}`,{method:"DELETE"});notice("Record deleted.","success");if(route==="sessions")loadSessions();else loadManagement(route);}
  catch(err){notice(err.message,"error")}
});


let staffDirectory=[], calendarCursor=new Date(), staffMinRank=230, staffDiagnostics=null;
function renderStaffDirectory(){
 const result=$("directoryResult"),status=$("directoryStatus"),search=$("directorySearch");if(!result)return;
 const q=(search?.value||"").trim().toLowerCase(),teamFilter=$("directoryTeamFilter")?.value||"ALL";
 const list=staffDirectory.filter(m=>{
  const teamIds=teamAssignments.get(String(m.id))||new Set();
  const teams=managementTeams.filter(t=>teamIds.has(String(t.id)));
  const matchesSearch=!q||[m.username,m.displayName,m.role,...teams.flatMap(t=>[t.name,t.department])].some(v=>String(v||"").toLowerCase().includes(q));
  const matchesTeam=teamFilter==="ALL"||(teamFilter==="UNASSIGNED"?!teamIds.size:teamIds.has(teamFilter));
  return matchesSearch&&matchesTeam;
 }).sort((x,y)=>Number(y.rank)-Number(x.rank)||String(x.role).localeCompare(String(y.role))||String(x.username).localeCompare(String(y.username)));
 $("staffCount").textContent=staffDirectory.length+" staff members · Rank "+staffMinRank+"+";
 status.textContent=list.length?"Showing "+list.length+" staff members":"No staff match that search or team filter.";
 result.innerHTML=list.map(m=>{
  const teamIds=teamAssignments.get(String(m.id))||new Set(),teams=managementTeams.filter(t=>teamIds.has(String(t.id)));
  const picker="";
  return '<article class="staff-card" data-staff-id="'+escapeHtml(m.id)+'"><img class="staff-avatar" src="'+escapeHtml(m.avatarUrl||"")+'" alt="" loading="lazy"><span class="staff-card-copy"><b>'+escapeHtml(m.username)+'</b><small>'+escapeHtml(m.role)+'</small><small class="staff-team-label">'+(teams.length?teams.map(t=>'<i style="background:'+escapeHtml(t.color)+'"></i>'+escapeHtml(t.name)).join(" · "):'Unassigned')+'</small></span><span class="staff-card-side"><span class="rank-pill">R'+m.rank+'</span>'+picker+'</span></article>';
 }).join("");
}
async function loadStaffDirectory(force=false){
 const result=$("directoryResult"),status=$("directoryStatus");if(result)result.innerHTML="";
 if(status)status.textContent="Loading staff ranked "+staffMinRank+"+…";
 if(staffDirectory.length&&!force){renderStaffDirectory();return;}
 if($("directoryButton"))$("directoryButton").disabled=true;
 try{
  const d=await api("/api/staff");staffDirectory=Array.isArray(d.members)?d.members:[];staffMinRank=Number(d.minRank||d.diagnostics?.minRank||230);staffDiagnostics=d.diagnostics||null;if(typeof populateCreateRoleSlots==="function")populateCreateRoleSlots();
  try{
   const teams=await api("/api/management/teams");managementTeams=teams.teams||[];teamAssignments=new Map();for(const x of(teams.members||[])){const userId=String(x.user_id);if(!teamAssignments.has(userId))teamAssignments.set(userId,new Set());teamAssignments.get(userId).add(String(x.team_id));}teamStaffCache=staffDirectory;await syncTeamsByGroupRole();
   const filter=$("directoryTeamFilter");
   if(filter){const old=filter.value;filter.innerHTML='<option value="ALL">All teams</option><option value="UNASSIGNED">Unassigned</option>'+managementTeams.map(t=>'<option value="'+escapeHtml(t.id)+'">'+escapeHtml(t.department)+' / '+escapeHtml(t.name)+'</option>').join("");if([...filter.options].some(o=>o.value===old))filter.value=old;}
  }catch{}

  renderStaffDirectory();if(!staffDirectory.length){const z=d.diagnostics||{};status.textContent="No staff at rank "+staffMinRank+"+ in group "+(z.groupId||"configured group")+". Source: "+(z.source||d.source||"unknown")+". Members scanned: "+(z.fetchedMembers??"unknown")+". Check STAFF_MIN_RANK and the group ID."; }
  try{if(!groupRoleCache.length){const groupRoleData=await api("/api/group/roles");groupRoleCache=groupRoleData.roles||[];}}catch(roleError){console.warn("Complete group role list unavailable:",roleError);}
  const roleSelect=$("promotionRole");if(roleSelect)roleSelect.innerHTML='<option value="">Choose suggested role…</option>'+(groupRoleCache.length?groupRoleCache:d.roles||[]).map(r=>'<option value="'+escapeHtml(r.name)+'">'+escapeHtml(r.name)+' (Rank '+r.rank+')</option>').join("");
  const dl=document.getElementById("staffSuggestions")||document.createElement("datalist");dl.id="staffSuggestions";dl.innerHTML=staffDirectory.map(m=>'<option value="'+escapeHtml(m.username)+'"></option>').join("");document.body.appendChild(dl);
  ["punishUsername","promotionUsername","activityUsername","sessionAttendeeSearch"].forEach(id=>{const el=$(id);if(el)el.setAttribute("list","staffSuggestions");});
  const configs=[["sessionHost","Choose host…",false],["sessionCoHost","No co-host",false],["sessionPromoter","Choose promoter…",true]];
  [[ "sessionRequestHost","Choose host…" ],[ "sessionRequestCoHost","No co-host" ],[ "editSessionHost","Choose host…" ],[ "editSessionCoHost","No co-host" ]].forEach(([id,placeholder])=>{const el=$(id);if(el)el.innerHTML='<option value="">'+placeholder+'</option>'+staffDirectory.map(m=>'<option value="'+escapeHtml(m.id)+'">'+escapeHtml(m.username)+' — '+escapeHtml(m.role)+'</option>').join("");});

  configs.forEach(([id,placeholder,senior])=>{const el=$(id);if(el)el.innerHTML='<option value="">'+placeholder+'</option>'+staffDirectory.filter(m=>!senior||m.rank>=245).map(m=>'<option value="'+escapeHtml(m.id)+'">'+escapeHtml(m.username)+' — '+escapeHtml(m.role)+'</option>').join("");});
  const oversee=$("sessionOversee");if(oversee)oversee.innerHTML=staffDirectory.filter(m=>m.rank>=245).map(m=>'<option value="'+escapeHtml(m.id)+'">'+escapeHtml(m.username)+' — '+escapeHtml(m.role)+' (R'+m.rank+')</option>').join("");
 }catch(e){
  if(status)status.textContent="Could not load staff: "+e.message;
  if(result)result.innerHTML='<div class="directory-error"><b>Staff list unavailable</b><p>'+escapeHtml(e.message)+'</p><button type="button" class="quiet-btn" id="retryStaffLoad">Try again</button></div>';
  $("retryStaffLoad")?.addEventListener("click",()=>loadStaffDirectory(true));
 }finally{if($("directoryButton"))$("directoryButton").disabled=false;}
}
$("directoryButton")?.addEventListener("click",()=>loadStaffDirectory(true));
 $("exportStaff")?.addEventListener("click",()=>{
   if(!staffDirectory.length){notice("There are no staff members to export.","error");return;}
   const fields=["username","displayName","role","rank","id"];
   const quote=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
   const csv=[fields.join(","),...staffDirectory.map(m=>fields.map(k=>quote(m[k])).join(","))].join("\r\n");
   const link=document.createElement("a");link.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);link.download="lemonz-staff-directory.csv";link.click();
 });
$("directorySearch")?.addEventListener("input",renderStaffDirectory);
$("directoryResult")?.addEventListener("click",e=>{if(e.target.closest("select,button"))return;const card=e.target.closest("[data-staff-id]");if(card)showStaffProfile(card.dataset.staffId);});
// Team memberships are managed in the multi-team assignment panel; no legacy single-team picker handler.

async function showStaffProfile(id,openTeams=false){
  const panel=$("memberProfile");panel.classList.remove("hidden");panel.innerHTML='<div class="profile-loading"><span class="loading-dot"></span> Loading staff profile…</div>';
  try{
    const d=await api("/api/management/members/"+encodeURIComponent(id)),m=d.member;
    const canManageTeams=Number(sessionData?.identity?.rank)>=255;const tabs=[["overview","Overview"],["requests","Requests"],["timeline","Full history"],["teams","Teams"],["shifts","Shift history"],["discipline","Discipline"],["notes","Management notes"]].filter(t=>t[0]!=="teams"||canManageTeams);
    panel.innerHTML='<div class="profile-head"><img class="profile-avatar" src="'+escapeHtml(m.avatarUrl||"")+'" alt="Roblox avatar"><div class="profile-identity"><div class="eyebrow">STAFF PROFILE</div><h3>'+escapeHtml(m.username)+'</h3><p>'+escapeHtml(m.role)+' · Rank '+m.rank+'</p></div><a class="quiet-btn profile-roblox-link" href="https://www.roblox.com/users/'+encodeURIComponent(m.id)+'/profile" target="_blank" rel="noopener">Open Roblox profile ↗</a></div>'+
    '<div class="profile-stats"><div><b>'+d.sessions.length+'</b><small>Shifts attended</small></div><div><b>'+Number(d.strikeCount||0)+'</b><small>Approved strikes</small></div><div><b>'+escapeHtml(d.lastPromotionAt?formatDate(d.lastPromotionAt):"No record")+'</b><small>Last promotion date · approved Roblox rank request</small></div><div><b>'+escapeHtml(d.lastPunishmentAt?formatDate(d.lastPunishmentAt):"No record")+'</b><small>Last punishment date</small></div><div><b>'+Math.floor(Number(d.activity?.active_seconds||0)/3600)+'h</b><small>Active play time</small></div><div><b>'+Number(d.activity?.message_count||0).toLocaleString()+'</b><small>Chat messages</small></div><div><b>'+Math.floor(Number(d.activity?.typing_seconds||0)/60)+'m</b><small>Chat typing time</small></div><div><b>'+Math.floor(Number(d.activity?.afk_seconds||0)/60)+'m</b><small>AFK time</small></div></div>'+'<div class="profile-activity"><div class="profile-activity-heading"><div><h4>Recent session attendance</h4><p>Sessions recorded over the last seven days</p></div><span>'+d.sessions.filter(s=>new Date(String(s.session_date).slice(0,10)+"T00:00:00")>=new Date(Date.now()-7*86400000)).length+' sessions</span></div><div class="profile-week-chart">'+Array.from({length:7},(_,i)=>{const day=new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-(6-i));const count=d.sessions.filter(s=>String(s.session_date).slice(0,10)===day.toISOString().slice(0,10)).length;return '<div class="profile-week-day"><b>'+count+'</b><i style="height:'+Math.max(4,Math.min(100,count*24))+'%"></i><small>'+day.toLocaleDateString(undefined,{weekday:"short"})+'</small></div>';}).join("")+'</div></div>'+
    '<nav class="profile-tabs" aria-label="Staff profile sections">'+tabs.map((t,i)=>'<button type="button" class="profile-tab'+(i===0?' active':'')+'" data-profile-tab="'+t[0]+'">'+t[1]+'</button>').join("")+'</nav>'+
    '<section class="profile-panel hidden" data-profile-panel="requests"><div class="profile-notes-heading"><div><h4>Submit a request for '+escapeHtml(m.username)+'</h4><p class="muted">Requests are linked to this member and follow your existing approval settings.</p></div></div>'+
(d.canRequestPromotion?'<form id="memberPromotionRequestForm" class="member-request-form"><h5>Promotion recommendation</h5><label for="memberSuggestedRole">SUGGESTED ROLE</label><input id="memberSuggestedRole" maxlength="80" required placeholder="Enter the role you recommend"><label for="memberPromotionReason">REASON</label><textarea id="memberPromotionReason" rows="3" maxlength="2000" required placeholder="Explain why this member should be promoted…"></textarea><button class="primary-btn" type="submit">＋ Submit promotion request</button></form>':'<p class="muted">Your rank cannot submit promotion recommendations.</p>')+
(d.canRequestPunishment?'<form id="memberPunishmentRequestForm" class="member-request-form"><h5>Discipline request</h5><label for="memberPunishmentType">ACTION</label><select id="memberPunishmentType"><option>Strike</option><option>Demotion</option><option>Termination</option><option>Ban</option><option>Suspension</option><option>Other</option></select><label for="memberPunishmentReason">REASON / EVIDENCE SUMMARY</label><textarea id="memberPunishmentReason" rows="3" maxlength="2000" required placeholder="Explain the concern and relevant details…"></textarea><button class="primary-btn" type="submit">＋ Submit discipline request</button></form>':'<p class="muted">Your rank cannot submit discipline requests.</p>')+'</section>'+'<section class="profile-panel" data-profile-panel="overview"><div class="profile-columns"><section><h4>Staff overview</h4><div class="profile-detail-row"><span>Current role</span><b>'+escapeHtml(m.role)+'</b></div><div class="profile-detail-row"><span>Group rank</span><b>'+m.rank+'</b></div><div class="profile-detail-row"><span>Game sessions</span><b>'+Number(d.activity?.sessions||0)+'</b></div><div class="profile-detail-row"><span>Last activity</span><b>'+escapeHtml(d.activity?.last_seen?formatDate(d.activity.last_seen):"No activity recorded")+'</b></div></section><section><h4>Recent activity</h4><p class="muted">This profile brings together attendance, recorded activity, discipline history, and internal management notes.</p><button type="button" class="quiet-btn" data-profile-tab-jump="shifts">View shift history →</button></section></div></section>'+
    '<section class="profile-panel hidden" data-profile-panel="teams"><div class="profile-notes-heading"><div><h4>Team memberships</h4><p class="muted">Assign this staff member to one or more teams. Changes save directly to their profile.</p></div><span class="profile-note-count" id="profileTeamCount">Loading teams…</span></div><div class="profile-team-toolbar"><input id="profileTeamSearch" type="search" placeholder="Search teams…"><button type="button" class="quiet-btn" id="profileTeamClear">Clear all</button></div><div id="profileTeamChoices" class="profile-team-choices"><div class="empty-state">Loading available teams…</div></div><div class="profile-team-history"><h4>Team assignment history</h4><p class="muted">Who changed this member’s teams and when.</p><div id="profileTeamHistory" class="history-list"><div class="empty-state">Loading history…</div></div></div><div class="profile-team-footer"><span id="profileTeamStatus" class="muted">Select the teams this staff member belongs to.</span><button type="button" class="primary-btn" id="saveProfileTeams">Save team changes</button></div></section><section class="profile-panel hidden" data-profile-panel="shifts"><h4>Shift history</h4>'+(d.sessions.length?'<ul class="history-list">'+d.sessions.map(s=>'<li><b>'+escapeHtml(s.title)+'</b><small>'+escapeHtml(String(s.session_date).slice(0,10))+' · '+escapeHtml(String(s.session_time||"").slice(0,5))+' · '+escapeHtml(s.member_role||"Attendee")+'</small></li>').join("")+'</ul>':'<p class="muted">No shifts recorded.</p>')+'</section>'+
    '<section class="profile-panel hidden" data-profile-panel="discipline"><h4>Discipline history</h4>'+(d.punishments.length?'<ul class="history-list">'+d.punishments.map(p=>'<li><b>'+escapeHtml(p.type)+' · '+escapeHtml(p.status)+'</b><small>'+escapeHtml(p.reason)+' · '+escapeHtml(formatDate(p.created_at))+'</small></li>').join("")+'</ul>':'<p class="muted">No punishment records.</p>')+'</section>'+
    '<section class="profile-panel hidden" data-profile-panel="notes"><div class="profile-notes-heading"><div><h4>Management notes</h4><p class="muted">Internal notes for staff management. Keep entries factual and professional.</p></div><span class="profile-note-count">'+(d.notes||[]).length+' notes</span></div>'+
    (d.canAddNotes?'<form id="memberNoteForm" class="member-note-form"><label for="memberNoteBody">ADD A NOTE</label><textarea id="memberNoteBody" rows="3" maxlength="2000" placeholder="Write a private management note about this staff member…"></textarea><div class="profile-note-footer"><small>Visible to authorized staff viewing this profile.</small><button class="primary-btn" type="submit">＋ Add note</button></div></form>':'<p class="muted">You need rank 238 or higher to add management notes.</p>')+
    '<div id="memberNotesList" class="member-notes-list">'+((d.notes||[]).length?d.notes.map(n=>'<article class="member-note"><div><b>'+escapeHtml(n.created_by_name)+'</b><time>'+escapeHtml(formatDate(n.created_at))+'</time></div><p>'+escapeHtml(n.body)+'</p>'+((String(n.created_by)===String(sessionData?.user?.id)||d.canModerateNotes)?'<button type="button" class="danger-text-btn" data-note-delete="'+escapeHtml(n.id)+'">Delete note</button>':'')+'</article>').join(""):'<div class="empty-state">No management notes yet.</div>')+'</div></section>';
    panel.insertAdjacentHTML("beforeend",'<section class="profile-panel hidden" data-profile-panel="timeline"><h4>Complete management timeline</h4><p class="muted">Recorded actions involving this staff member, newest first.</p>'+(d.timeline?.length?'<ul class="history-list">'+d.timeline.map(x=>'<li><b>'+escapeHtml(x.category)+' · '+escapeHtml(x.action)+'</b><small>'+escapeHtml(x.details||"Management action")+' · '+escapeHtml(x.actor_name||"Management")+' · '+escapeHtml(formatDate(x.created_at))+'</small></li>').join("")+'</ul>':'<p class="muted">No management actions have been recorded for this staff member yet.</p>')+'</section>');
    panel.dataset.memberId=String(m.id);
    if(canManageTeams){await loadProfileTeamEditor(m.id);if(openTeams)panel.querySelector('[data-profile-tab="teams"]')?.click();}
    panel.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){panel.innerHTML='<div class="profile-error">'+escapeHtml(e.message)+'</div>';}
}
async function loadProfileTeamEditor(userId){
 const choices=$("profileTeamChoices"),status=$("profileTeamStatus"),save=$("saveProfileTeams");
 if(!choices||!save)return;
 choices.innerHTML='<div class="empty-state">Loading teams…</div>';save.disabled=true;
 try{
  const data=await api("/api/management/teams"),teams=Array.isArray(data.teams)?data.teams:[],members=Array.isArray(data.members)?data.members:[];
  const selected=new Set(members.filter(x=>String(x.user_id)===String(userId)).map(x=>String(x.team_id)));
  const render=()=>{
   const q=($("profileTeamSearch")?.value||"").trim().toLowerCase();
   const filtered=teams.filter(t=>[t.name,t.description,t.department].some(v=>String(v||"").toLowerCase().includes(q)));
   choices.innerHTML=filtered.length?filtered.map(t=>'<label class="profile-team-option"><input type="checkbox" data-profile-team="'+escapeHtml(t.id)+'" '+(selected.has(String(t.id))?'checked':'')+'><span class="profile-team-swatch" style="background:'+escapeHtml(t.color||"#f5c928")+'"></span><span class="profile-team-option-copy"><b>'+escapeHtml(t.name)+'</b><small>'+escapeHtml(t.description||t.department||"Team")+'</small></span><span class="profile-team-option-state">'+(selected.has(String(t.id))?'Assigned':'Not assigned')+'</span></label>').join(""):'<div class="empty-state">No teams match your search.</div>';
   $("profileTeamCount").textContent=selected.size+" of "+teams.length+" assigned";
   choices.querySelectorAll("[data-profile-team]").forEach(input=>input.addEventListener("change",()=>{const id=String(input.dataset.profileTeam);if(input.checked)selected.add(id);else selected.delete(id);render();}));
  };
  render();
  const profileData=await api("/api/management/members/"+encodeURIComponent(userId));
  const historyBox=$("profileTeamHistory");
  if(historyBox){const rows=profileData.teamHistory||[];historyBox.innerHTML=rows.length?rows.map(row=>'<li><b>'+escapeHtml(row.action==="ASSIGNED"?"Team added":"Team removed")+' · '+escapeHtml(row.details)+'</b><small>'+escapeHtml(row.actor_name||"Management")+' · '+escapeHtml(formatDate(row.created_at))+'</small></li>').join(""):'<div class="empty-state">No team changes recorded yet. New changes will appear here.</div>';}
  $("profileTeamSearch")?.addEventListener("input",render);
  $("profileTeamClear")?.addEventListener("click",()=>{selected.clear();render();});
  save.onclick=async()=>{save.disabled=true;save.textContent="Saving…";try{await api("/api/management/teams/member/"+encodeURIComponent(userId),{method:"PUT",body:JSON.stringify({teamIds:[...selected]})});status.textContent="Team memberships saved.";status.className="success-text";const fresh=await api("/api/management/teams");managementTeams=fresh.teams||[];teamAssignments=new Map();for(const row of(fresh.members||[])){const id=String(row.user_id);if(!teamAssignments.has(id))teamAssignments.set(id,new Set());teamAssignments.get(id).add(String(row.team_id));}renderStaffDirectory();renderTeamDirectory();$("profileTeamCount").textContent=selected.size+" of "+teams.length+" assigned";}catch(err){status.textContent=err.message;status.className="error-text";}finally{save.disabled=false;save.textContent="Save team changes";}};
  save.disabled=false;
 }catch(err){choices.innerHTML='<div class="empty-state error-state">'+escapeHtml(err.message)+'</div>';status.textContent="Could not load team memberships.";save.disabled=true;}
}
document.addEventListener("click",async e=>{
  const tab=e.target.closest("[data-profile-tab],[data-profile-tab-jump]");
  if(tab){const key=tab.dataset.profileTab||tab.dataset.profileTabJump,panel=$("memberProfile");panel.querySelectorAll("[data-profile-panel]").forEach(x=>x.classList.toggle("hidden",x.dataset.profilePanel!==key));panel.querySelectorAll("[data-profile-tab]").forEach(x=>x.classList.toggle("active",x.dataset.profileTab===key));return;}
  const teamButton=e.target.closest("[data-member-teams]");if(teamButton){e.preventDefault();e.stopPropagation();await showStaffProfile(String(teamButton.dataset.memberTeams),true);return;}
  const del=e.target.closest("[data-note-delete]");if(del){if(!confirm("Delete this management note?"))return;del.disabled=true;try{await api("/api/management/members/"+encodeURIComponent($("memberProfile").dataset.memberId)+"/notes/"+encodeURIComponent(del.dataset.noteDelete),{method:"DELETE"});await showStaffProfile($("memberProfile").dataset.memberId);$("memberProfile").querySelector('[data-profile-tab="notes"]')?.click();}catch(err){notice(err.message,"error");del.disabled=false;}return;}
});
document.addEventListener("submit",async e=>{
  if(e.target.id!=="memberNoteForm")return;e.preventDefault();const id=$("memberProfile").dataset.memberId,body=$("memberNoteBody").value.trim(),btn=e.target.querySelector('button[type="submit"]');if(!body){notice("Write a note first.","error");return;}btn.disabled=true;btn.textContent="Saving…";
  try{await api("/api/management/members/"+encodeURIComponent(id)+"/notes",{method:"POST",body:JSON.stringify({body})});await showStaffProfile(id);$("memberProfile").querySelector('[data-profile-tab="notes"]')?.click();notice("Management note added.","success");}catch(err){notice(err.message,"error");btn.disabled=false;btn.textContent="＋ Add note";}
});
function calendarMonthKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}
function drawSessionsCalendar(items){
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),first=new Date(y,m,1),offset=first.getDay(),days=new Date(y,m+1,0).getDate(),cells=[];
  for(let i=0;i<offset;i++)cells.push('<div class="calendar-day outside"></div>');
  for(let day=1;day<=days;day++){const date=y+"-"+String(m+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");const events=items.filter(s=>String(s.session_date).slice(0,10)===date);cells.push('<div class="calendar-day"><b>'+day+'</b>'+events.map(s=>'<div class="calendar-event calendar-'+String(s.status||"PLANNED").toLowerCase()+'"><b>'+escapeHtml(s.title)+'</b><small>'+sessionTypeLabel(s.session_type)+' · '+sessionStatusLabel(s.status||"PLANNED")+' · '+escapeHtml(String(s.session_time||"").slice(0,5))+'</small></div>').join("")+'</div>');}
  $("sessionsCalendar").innerHTML='<div class="calendar-weekdays">'+["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>'<b>'+d+'</b>').join("")+'</div><div class="calendar-grid">'+cells.join("")+'</div>';
}
function sessionTypeLabel(v){return v==="RECRUITMENT"?"Recruitment":v==="MINI_GAMES"?"Mini-Games":"Promotional";}
function sessionStatusLabel(v){return ({PLANNED:"Planned",ONGOING:"On-Going",DELAYED:"Delayed",CANCELED:"Canceled",COMPLETED:"Completed"})[v]||"Planned";}
function sessionStatusControl(s){return s.canUpdate?'<select class="task-status-select session-status-select" data-session-status="'+escapeHtml(s.id)+'">'+["PLANNED","ONGOING","DELAYED","CANCELED","COMPLETED"].map(v=>'<option value="'+v+'"'+(s.status===v?" selected":"")+'>'+sessionStatusLabel(v)+'</option>').join("")+'</select>':'<span class="status-pill status-'+String(s.status||"PLANNED").toLowerCase()+'">'+sessionStatusLabel(s.status||"PLANNED")+'</span>';}
function sessionRoleSlots(s,key,legacyIds,legacyNames){const saved=Array.isArray(s[key])?s[key]:[];if(saved.length)return saved;const ids=Array.isArray(s[legacyIds])?s[legacyIds]:[],names=Array.isArray(s[legacyNames])?s[legacyNames]:[];return ids.map((userId,i)=>({label:(key==="oversee_slots"?"Oversee ":"Attendee ")+(i+1),userId,name:names[i]||userId}));}
function sessionAssignmentBlock(label,slots){const rows=slots.map((slot,i)=>{const avatar=slot.userId?'<img class="session-assignment-avatar" src="https://www.roblox.com/headshot-thumbnail/image?userId='+encodeURIComponent(slot.userId)+'&width=48&height=48&format=png" alt="">' : '<span class="session-assignment-avatar session-avatar-empty">?</span>';return '<div class="session-assignment-row"><span class="session-assignment-index">'+(i+1)+'</span>'+avatar+'<div class="session-assignment-copy"><small>'+escapeHtml(slot.label||label)+'</small><b>'+escapeHtml(slot.name||slot.username||slot.userName||slot.userId||"Unassigned")+'</b></div><span class="session-assignment-state">'+(slot.userId?"Assigned":"Open")+'</span></div>';}).join("");return '<section class="session-assignment-group"><div class="session-assignment-heading"><span>'+escapeHtml(label)+'</span><small>'+slots.filter(x=>x.userId).length+'/'+slots.length+' assigned</small></div>'+(rows||'<div class="session-assignment-empty">No positions added yet</div>')+'</section>';}
function renderSessionTable(items,el,searchText=""){
 if(!el)return;const q=String(searchText||"").toLowerCase(),rows=items.filter(s=>!q||[s.title,s.session_type,s.status,s.status_note,s.host_name,s.cohost_name,s.host_team_name,s.host_department,s.session_date,s.promoter_name,...(s.attendee_names||[]),...(s.oversee_names||[])].some(v=>String(v||"").toLowerCase().includes(q)));
 el.innerHTML=rows.length?'<div class="session-agenda-list">'+rows.map(s=>{const ov=sessionRoleSlots(s,"oversee_slots","oversee_ids","oversee_names"),at=sessionRoleSlots(s,"attendee_slots","attendee_ids","attendee_names"),host=[{label:"Host",userId:s.host_id,name:s.host_name}],cohost=[{label:"Co-Host",userId:s.cohost_id,name:s.cohost_name}];return '<article class="session-agenda-row session-agenda-card"><header class="session-card-top"><div class="session-card-identity"><span class="session-card-icon">▤</span><div><span class="session-type-pill">'+sessionTypeLabel(s.session_type)+'</span><h3>'+escapeHtml(s.title)+'</h3><small>#'+escapeHtml(s.id)+' · '+escapeHtml(dateOnly(s.session_date))+' · '+escapeHtml(String(s.session_time||"").slice(0,5))+'</small></div></div><span class="status-pill status-'+String(s.status||"PLANNED").toLowerCase()+'">'+sessionStatusLabel(s.status||"PLANNED")+'</span></header><div class="session-assignment-grid">'+sessionAssignmentBlock("HOST",host)+sessionAssignmentBlock("CO-HOST",cohost)+sessionAssignmentBlock("OVERSEES",ov)+sessionAssignmentBlock("ATTENDEES",at)+'</div>'+(s.promoter_name?'<div class="session-promoter-line"><small>PROMOTER</small><b>'+escapeHtml(s.promoter_name)+'</b></div>':"")+(s.status_note?'<p class="session-note">'+escapeHtml(s.status_note)+'</p>':"")+'<footer class="session-agenda-actions">'+(s.canUpdate?'<label class="session-status-label">Status '+sessionStatusControl(s)+'</label><button class="quiet-btn" data-edit-session-roles="'+escapeHtml(s.id)+'">Edit session</button>':"")+(s.canDelete?'<button class="danger-btn" data-delete="session" data-id="'+escapeHtml(s.id)+'">Delete</button>':"")+'</footer></article>';}).join("")+'</div>':'<div class="empty-state">No sessions match this view.</div>';
}
async function loadSessions(){
 try{
  if(!staffDirectory.length)await loadStaffDirectory();
  const d=await api("/api/management/sessions"),all=d.sessions||[];window.__lemonzSessions=all;$("sessionCreateCard")?.classList.toggle("hidden",!d.canCreate);
  const now=new Date(),upcoming=all.filter(s=>s.status==="PLANNED"||s.status==="DELAYED").filter(s=>new Date(String(s.session_date).slice(0,10)+"T"+String(s.session_time||"00:00").slice(0,5)+":00")>=now).length;const teamFilter=fillTeamFilter("sessionTeamFilter");
  const counts=[["TOTAL SESSIONS",all.length,"All recorded events"],["UPCOMING",upcoming,"Planned or delayed"],["ON-GOING",all.filter(s=>s.status==="ONGOING").length,"Currently running"],["COMPLETED",all.filter(s=>s.status==="COMPLETED").length,"Successfully delivered"]];
  $("sessionSummary").innerHTML=counts.map(x=>'<article class="session-stat"><span>▦</span><small>'+x[0]+'</small><b>'+x[1]+'</b><em>'+x[2]+'</em></article>').join("");
  const items=all.filter(s=>String(s.session_date).slice(0,7)===calendarMonthKey(calendarCursor)&&(teamFilter==="ALL"||(teamFilter==="UNASSIGNED"?!s.host_team_name:String(s.host_team_id||"")===teamFilter)));
  $("calendarMonth").textContent=calendarCursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});drawSessionsCalendar(items);
  const q=$("sessionSearch")?.value||"",filter=$("sessionFilter")?.value||"all";
  const visible=all.filter(s=>{const future=new Date(String(s.session_date).slice(0,10)+"T"+String(s.session_time||"00:00").slice(0,5)+":00")>=now;const teamMatch=teamFilter==="ALL"||(teamFilter==="UNASSIGNED"?!s.host_team_name:String(s.host_team_id||"")===teamFilter);return teamMatch&&(filter==="all"||(filter==="upcoming"&&future&&["PLANNED","DELAYED"].includes(s.status))||(filter==="past"&&(!future||["CANCELED","COMPLETED"].includes(s.status))));});
  renderSessionTable(visible,$("sessionList"),q);
  const historyFilter=$("sessionHistoryFilter")?.value||"all",historyQ=$("sessionHistorySearch")?.value||"";
  const history=all.filter(s=>{const ended=new Date(String(s.session_date).slice(0,10)+"T"+String(s.session_time||"00:00").slice(0,5)+":00")<now||["COMPLETED","CANCELED","DELAYED"].includes(s.status);return ended&&(historyFilter==="all"||s.status===historyFilter);});
  renderSessionTable(history,$("sessionHistoryList"),historyQ);
 }catch(e){$("sessionList").innerHTML='<div class="empty-state error-state">'+escapeHtml(e.message)+'</div>';}
}
async function loadSessionRequests(){
 const el=$("sessionRequestTable");if(!el)return;el.textContent="Loading session requests…";
 try{const d=await api("/api/management/session-requests"),items=d.items||[];
  const pending=items.filter(x=>x.status==="PENDING").length,approved=items.filter(x=>x.status==="APPROVED").length;
  el.innerHTML='<div class="request-summary"><span>'+items.length+' total requests</span><span>'+pending+' pending</span><span>'+approved+' approved</span></div>'+(items.length?'<div class="session-request-list">'+items.map(x=>'<article class="session-request-card"><div class="session-request-card-main"><div><span class="session-type-pill">'+sessionTypeLabel(x.session_type)+'</span><h3>'+escapeHtml(x.title)+'</h3><p>'+escapeHtml(x.details||"No additional details provided.")+'</p></div><span class="status-pill status-'+String(x.status).toLowerCase()+'">'+escapeHtml(x.status)+'</span></div><div class="session-request-meta"><span><small>PROPOSED DATE</small><b>'+dateOnly(x.preferred_date)+' · '+escapeHtml(String(x.preferred_time||"").slice(0,5))+'</b></span><span><small>HOST</small><b>'+escapeHtml(x.host_name||"—")+(x.cohost_name?" · "+escapeHtml(x.cohost_name):"") +'</b></span><span><small>REQUESTED BY</small><b>'+escapeHtml(x.requested_by_name)+'</b></span></div>'+(x.review_note?'<div class="session-request-review"><small>REVIEW NOTE</small><p>'+escapeHtml(x.review_note)+'</p></div>':"") +'<footer>'+(d.canReview&&x.status==="PENDING"?'<button class="primary-btn" data-session-request-decision="'+x.id+'" data-status="APPROVED">Approve request</button> <button class="quiet-btn" data-session-request-decision="'+x.id+'" data-status="REJECTED">Decline</button>':"")+(x.canCancel?' <button class="danger-btn" data-session-request-cancel="'+x.id+'">Cancel</button>':"") +'</footer></article>').join("")+'</div>':'<div class="empty-state">No session requests have been submitted yet.</div>');
  $("sessionRequestAuditCard").classList.toggle("hidden",!d.canReview);if(d.canReview)await loadSessionRequestAudit();
 }catch(e){el.innerHTML='<div class="empty-state error-state">'+escapeHtml(e.message)+'</div>';}
}
async function loadSessionRequestAudit(){
 const el=$("sessionRequestAuditTable");if(!el)return;try{const d=await api("/api/management/session-requests/audit"),items=d.items||[];el.innerHTML=items.length?'<table class="data-table"><thead><tr><th>DATE</th><th>ACTION</th><th>REQUESTER</th><th>DETAILS</th><th>REVIEWED BY</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+escapeHtml(formatDate(x.created_at))+'</td><td>'+escapeHtml(x.action)+'</td><td>'+escapeHtml(x.target_username||"—")+'</td><td>'+escapeHtml(x.details||"—")+'</td><td>'+escapeHtml(x.actor_name||"—")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No session request actions logged yet.</div>';}catch(e){el.textContent=e.message;}
}
$("submitSessionRequest")?.addEventListener("click",async()=>{
 const b=$("submitSessionRequest");b.disabled=true;b.textContent="Sending…";
 try{await api("/api/management/session-requests",{method:"POST",body:JSON.stringify({sessionType:$("sessionRequestType").value,title:$("sessionRequestTitle").value.trim(),details:$("sessionRequestDetails").value.trim(),preferredDate:$("sessionRequestDate").value,preferredTime:$("sessionRequestTime").value,hostId:$("sessionRequestHost").value,cohostId:$("sessionRequestCoHost").value})});["sessionRequestTitle","sessionRequestDetails","sessionRequestDate","sessionRequestTime"].forEach(id=>$(id).value="");$("sessionRequestHost").value="";$("sessionRequestCoHost").value="";notice("Session request submitted and logged.","success");await loadSessionRequests();}
 catch(e){notice(e.message,"error");}finally{b.disabled=false;b.textContent="Send session request";}
});
$("refreshSessionRequests")?.addEventListener("click",loadSessionRequests);
$("refreshSessionAudit")?.addEventListener("click",loadSessionRequestAudit);
$("sessionHistorySearch")?.addEventListener("input",loadSessions);$("sessionHistoryFilter")?.addEventListener("change",loadSessions);
document.addEventListener("change",async e=>{
 const select=e.target.closest("[data-session-status]");if(!select)return;
 const status=select.value,note=["DELAYED","CANCELED"].includes(status)?(prompt(status==="DELAYED"?"Why is this session delayed?":"Why was this session canceled?")||""):"";
 if(["DELAYED","CANCELED"].includes(status)&&!note.trim()){notice("Add a short note explaining this status change.","error");await loadSessions();return;}
 select.disabled=true;try{await api("/api/management/sessions/"+encodeURIComponent(select.dataset.sessionStatus)+"/status",{method:"PATCH",body:JSON.stringify({status,note})});notice("Session status updated and logged.","success");await loadSessions();}catch(err){notice(err.message,"error");await loadSessions();}
});
document.addEventListener("click",async e=>{
 const cancel=e.target.closest("[data-session-request-cancel]");if(cancel){if(!confirm("Cancel this pending session request?"))return;cancel.disabled=true;try{await api("/api/management/session-requests/"+encodeURIComponent(cancel.dataset.sessionRequestCancel),{method:"DELETE"});notice("Session request canceled.","success");await loadSessionRequests();}catch(err){notice(err.message,"error");}return;}
 const b=e.target.closest("[data-session-request-decision]");if(!b)return;const status=b.dataset.status,note=prompt(status==="REJECTED"?"Why are you declining this session request?":"Optional review note:")||"";
 if(status==="REJECTED"&&!note.trim()){notice("A reason is required when declining a request.","error");return;}
 b.disabled=true;try{await api("/api/management/session-requests/"+encodeURIComponent(b.dataset.sessionRequestDecision)+"/decision",{method:"POST",body:JSON.stringify({status,note})});notice(status==="APPROVED"?"Request approved and added to the session schedule.":"Session request declined.","success");await loadSessionRequests();await loadSessions();}catch(err){notice(err.message,"error");}
});
function staffSlotOptions(selectedId="",senior=false){const people=staffDirectory.filter(m=>!senior||Number(m.rank)>=245);return '<option value="">Select user</option>'+people.map(m=>'<option value="'+escapeHtml(m.id)+'"'+(String(m.id)===String(selectedId)?" selected":"")+'>'+escapeHtml(m.username)+' · '+escapeHtml(m.role)+'</option>').join("");}
function addSessionRoleSlot(containerId,label,selected={},senior=false){const c=$(containerId);if(!c)return;const row=document.createElement("div");row.className="session-slot-row";row.innerHTML='<input class="session-slot-label" maxlength="40" aria-label="Role name" placeholder="Role name"><select class="session-slot-user" aria-label="Select staff member"></select><button type="button" class="danger-btn session-slot-remove" aria-label="Remove role">×</button>';row.querySelector(".session-slot-label").value=selected.label||label;row.querySelector(".session-slot-user").innerHTML=staffSlotOptions(selected.userId||"",senior);row.querySelector(".session-slot-remove").addEventListener("click",()=>row.remove());c.appendChild(row);}
function collectSessionRoleSlots(containerId){return [...($(containerId)?.querySelectorAll(".session-slot-row")||[])].map(row=>({label:row.querySelector(".session-slot-label").value.trim()||"Role",userId:row.querySelector(".session-slot-user").value}));}
function populateCreateRoleSlots(){if(!$("createOverseeSlots"))return;if(!$("createOverseeSlots").dataset.ready){$("createOverseeSlots").dataset.ready="1";$("createAttendeeSlots").dataset.ready="1";addSessionRoleSlot("createOverseeSlots","Oversee 1",{},true);addSessionRoleSlot("createAttendeeSlots","Attendee 1");}for(const [id,senior] of [["createOverseeSlots",true],["createAttendeeSlots",false]])$(id)?.querySelectorAll(".session-slot-user").forEach(select=>{const selected=select.value;select.innerHTML=staffSlotOptions(selected,senior);});}
function openSessionRoles(id){const s=(window.__lemonzSessions||[]).find(x=>String(x.id)===String(id));if(!s)return;if(!staffDirectory.length){notice("Staff directory is still loading. Try again.","error");return;}const fill=(key,value,optional=false,senior=false)=>{const el=$(key),people=staffDirectory.filter(m=>!senior||Number(m.rank)>=245);el.innerHTML=(optional?'<option value="">None</option>':'<option value="">Choose staff…</option>')+people.map(m=>'<option value="'+escapeHtml(m.id)+'">'+escapeHtml(m.username)+' — '+escapeHtml(m.role)+'</option>').join("");el.value=value||"";};$("editSessionId").value=s.id;$("editSessionTitle").value=s.title||"";$("editSessionType").value=s.session_type||"PROMOTIONAL";$("editSessionDate").value=String(s.session_date||"").slice(0,10);$("editSessionTime").value=String(s.session_time||"").slice(0,5);$("editSessionStatus").value=s.status||"PLANNED";$("editSessionStatusNote").value=s.status_note||"";fill("editSessionHost",s.host_id);fill("editSessionCoHost",s.cohost_id,true);fill("editSessionPromoter",s.promoter_id,true,true);$("editOverseeSlots").innerHTML="";$("editAttendeeSlots").innerHTML="";const ov=sessionRoleSlots(s,"oversee_slots","oversee_ids","oversee_names"),at=sessionRoleSlots(s,"attendee_slots","attendee_ids","attendee_names");(ov.length?ov:[{label:"Oversee 1"}]).forEach(x=>addSessionRoleSlot("editOverseeSlots",x.label,x,true));(at.length?at:[{label:"Attendee 1"}]).forEach(x=>addSessionRoleSlot("editAttendeeSlots",x.label,x));$("sessionRolesDialog").showModal();}
document.addEventListener("click",e=>{const b=e.target.closest("[data-edit-session-roles]");if(b)openSessionRoles(b.dataset.editSessionRoles);});
document.addEventListener("change",async e=>{const control=e.target.closest("[data-session-status]");if(!control)return;const prior=(window.__lemonzSessions||[]).find(s=>String(s.id)===String(control.dataset.sessionStatus));control.disabled=true;try{await api("/api/management/sessions/"+encodeURIComponent(control.dataset.sessionStatus)+"/status",{method:"PATCH",body:JSON.stringify({status:control.value,note:prior?.status_note||""})});notice("Session status updated.","success");await loadSessions();}catch(err){notice(err.message,"error");await loadSessions();}finally{control.disabled=false;}});
["closeSessionRoles","cancelSessionRoles"].forEach(id=>$(id)?.addEventListener("click",()=> $("sessionRolesDialog").close()));
$("sessionRolesForm")?.addEventListener("submit",async e=>{e.preventDefault();const btn=$("saveSessionRoles");btn.disabled=true;const body={title:$("editSessionTitle").value.trim(),sessionType:$("editSessionType").value,date:$("editSessionDate").value,time:$("editSessionTime").value,status:$("editSessionStatus").value,statusNote:$("editSessionStatusNote").value,hostId:$("editSessionHost").value,cohostId:$("editSessionCoHost").value,promoterId:$("editSessionPromoter").value,overseeSlots:collectSessionRoleSlots("editOverseeSlots"),attendeeSlots:collectSessionRoleSlots("editAttendeeSlots")};try{await api("/api/management/sessions/"+encodeURIComponent($("editSessionId").value)+"/roles",{method:"PATCH",body:JSON.stringify(body)});notice("Session updated.","success");$("sessionRolesDialog").close();await loadSessions();}catch(err){notice(err.message,"error");}finally{btn.disabled=false;}});
$("calendarPrev").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);loadSessions();});
$("calendarNext").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);loadSessions();});
$("refreshSessions")?.addEventListener("click",loadSessions);
$("sessionSearch")?.addEventListener("input",loadSessions);$("sessionFilter")?.addEventListener("change",loadSessions);$("sessionTeamFilter")?.addEventListener("change",loadSessions);
populateCreateRoleSlots();
$("addOverseeSlot")?.addEventListener("click",()=>addSessionRoleSlot("createOverseeSlots","Oversee "+($("createOverseeSlots").children.length+1),{},true));
$("addAttendeeSlot")?.addEventListener("click",()=>addSessionRoleSlot("createAttendeeSlots","Attendee "+($("createAttendeeSlots").children.length+1)));
$("editAddOverseeSlot")?.addEventListener("click",()=>addSessionRoleSlot("editOverseeSlots","Oversee "+($("editOverseeSlots").children.length+1),{},true));
$("editAddAttendeeSlot")?.addEventListener("click",()=>addSessionRoleSlot("editAttendeeSlots","Attendee "+($("editAttendeeSlots").children.length+1)));
$("sessionRepeat")?.addEventListener("change",()=>{$("sessionRepeatUntilWrap").classList.toggle("hidden",$("sessionRepeat").value==="NONE");});
$("createSession").addEventListener("click",async()=>{
 const hostId=$("sessionHost").value,cohostId=$("sessionCoHost").value,promoterId=$("sessionPromoter").value;
 if(!hostId){notice("Choose a host from the dropdown.","error");return;}
 const body={title:$("sessionTitle").value.trim(),sessionType:$("sessionType").value,date:$("sessionDate").value,time:$("sessionTime").value,hostId,cohostId,overseeSlots:collectSessionRoleSlots("createOverseeSlots"),attendeeSlots:collectSessionRoleSlots("createAttendeeSlots"),promoterId,recurrenceRule:$("sessionRepeat").value,recurrenceUntil:$("sessionRepeatUntil").value};
 if(!body.title||!body.date||!body.time){notice("Enter a shift name, date, and time.","error");return;}
 const btn=$("createSession");btn.disabled=true;
 try{const created=await api("/api/management/sessions",{method:"POST",body:JSON.stringify(body)});notice(created.createdCount>1?created.createdCount+" recurring sessions created.":"Shift created.","success");$("sessionTitle").value="";loadSessions();}catch(e){notice(e.message,"error");}finally{btn.disabled=false;}
});


// Resolve typed Roblox usernames to exact staff IDs before saving a shift.
function connectShiftSearch(inputId,selectId){
  const input=$(inputId),select=$(selectId);if(!input||!select)return;
  const resolve=()=>{const match=staffDirectory.find(m=>m.username.toLowerCase()===input.value.trim().toLowerCase());select.value=match?match.id:"";if(!match&&input.value.trim())notice("Choose an exact staff username from the suggestions.","error");};
  input.addEventListener("change",resolve);input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();resolve();}});
}


// Keep staff suggestions synchronized with the ID fields used by staff forms.
document.addEventListener("change",e=>{
 const pair={punishUsername:"punishUserId",promotionUsername:"promotionUserId",activityUsername:"activityUserId"};
 const idField=pair[e.target.id];if(!idField)return;
 const match=staffDirectory.find(m=>m.username.toLowerCase()===e.target.value.trim().toLowerCase());
 if(match)$(idField).value=match.id;
});


async function loadNotifications(){const el=$("notificationList");if(!el)return;el.textContent="Loading notifications…";try{const d=await api("/api/management/notifications");el.innerHTML=d.enabled?(d.items.length?d.items.map(x=>'<article class="notification-row'+(x.read?" is-read":"")+'><span class="notification-icon">'+(x.kind==="APPROVAL"?"✓":x.kind==="TASK"?"▣":"◷")+'</span><div><b>'+escapeHtml(x.title)+'</b><p>'+escapeHtml(x.body)+'</p><small>'+escapeHtml(formatDate(x.created_at))+'</small></div><button class="quiet-btn" data-notification-open="'+escapeHtml(x.href)+'">Open</button><button class="quiet-btn" data-notification-read="'+escapeHtml(x.id)+'" '+(x.read?"disabled":"")+'>'+(x.read?"Read":"Mark read")+'</button></article>').join(""):'<div class="empty-state">You are all caught up.</div>'):'<div class="empty-state">Notifications are disabled in Settings.</div>';}catch(e){el.textContent=e.message;}}
async function loadApprovals(){const el=$("approvalList");if(!el)return;el.textContent="Loading approvals…";try{const d=await api("/api/management/approvals");el.innerHTML=d.items.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>TYPE</th><th>REQUEST</th><th>DETAILS</th><th>SUBMITTED</th><th></th></tr></thead><tbody>'+d.items.map(x=>'<tr><td>'+escapeHtml(x.type)+'</td><td><b>'+escapeHtml(x.target)+'</b></td><td>'+escapeHtml(x.detail||"—")+'</td><td>'+escapeHtml(formatDate(x.created_at))+'</td><td><button class="quiet-btn" data-approval-open="'+x.type+'">Review</button></td></tr>').join("")+'</tbody></table></div>':'<div class="empty-state">No pending requests available to your rank.</div>';}catch(e){el.textContent=e.message;}}
async function loadManagementAudit(){
 const el=$("managementAuditTable");if(!el)return;el.textContent="Loading management history…";
 try{
  const q=new URLSearchParams({category:$("auditCategory")?.value||"",actor:$("auditActor")?.value||"",target:$("auditTarget")?.value||"",limit:"200"});
  const d=await api("/api/management/audit?"+q.toString());
  el.innerHTML=d.items.length?'<table class="data-table"><thead><tr><th>WHEN</th><th>CATEGORY</th><th>ACTION</th><th>TARGET</th><th>DETAILS</th><th>BY</th></tr></thead><tbody>'+d.items.map(x=>'<tr><td>'+escapeHtml(formatDate(x.created_at))+'</td><td>'+escapeHtml(x.category)+'</td><td>'+escapeHtml(x.action)+'</td><td>'+escapeHtml(x.target_username||"Unknown member")+'</td><td>'+escapeHtml(x.details||"—")+'</td><td>'+escapeHtml(x.actor_name||"Management")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No management actions match these filters.</div>';
 }catch(e){el.innerHTML='<div class="empty-state error-state">'+escapeHtml(e.message)+'</div>';}
}
async function renderQuotaProgress(el){
 const d=await api("/api/management/quota-progress"),rows=d.members||[],targets=d.defaults||{};
 const hours=Number(targets.hours||0),sessions=Number(targets.sessions||0),tasks=Number(targets.tasks||0);
 el.insertAdjacentHTML("beforeend",'<section class="quota-progress"><h3>Weekly staff quota progress</h3><p class="muted">Targets: '+hours+' activity hours · '+sessions+' completed sessions · '+tasks+' completed tasks.</p>'+(rows.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>STAFF MEMBER</th><th>ACTIVITY</th><th>SESSIONS</th><th>TASKS</th><th>TEAMS</th></tr></thead><tbody>'+rows.sort((x,y)=>y.hours-x.hours).map(x=>'<tr><td>'+escapeHtml(x.username)+'</td><td>'+Number(x.hours).toFixed(1)+' / '+hours+'h</td><td>'+x.sessions+' / '+sessions+'</td><td>'+x.tasks+' / '+tasks+'</td><td>'+x.teamIds.length+'</td></tr>').join("")+'</tbody></table></div>':'<div class="empty-state">No weekly quota activity has been recorded yet.</div>')+'</section>');
}
async function loadAnalytics(){const el=$("analyticsContent");if(!el)return;el.textContent="Loading analytics…";try{const d=await api("/api/management/analytics"),max=Math.max(1,...d.weekly.map(x=>Number(x.hours))),tm=Math.max(1,...d.teams.map(x=>Number(x.seconds)));el.innerHTML='<h3>Weekly activity · 12 weeks</h3>'+d.weekly.map(x=>'<div class="analytics-bar-row"><span>'+escapeHtml(String(x.week).slice(0,10))+'</span><div><i style="width:'+Math.min(100,Number(x.hours)/max*100)+'%"></i></div><b>'+Number(x.hours).toFixed(1)+'h</b></div>').join("")+'<h3>Team comparison</h3>'+d.teams.map(x=>'<div class="analytics-bar-row"><span>'+escapeHtml(x.name)+'</span><div><i style="width:'+Math.min(100,Number(x.seconds)/tm*100)+'%"></i></div><b>'+(Number(x.seconds)/3600).toFixed(1)+'h</b></div>').join("")+'<h3>Most active this week</h3>'+d.top.map((x,i)=>'<div class="analytics-top-row"><b>#'+(i+1)+' '+escapeHtml(x.username)+'</b><span>'+(Number(x.seconds)/3600).toFixed(1)+' hours</span></div>').join("");}catch(e){el.textContent=e.message;return;}try{await renderQuotaProgress(el);}catch(e){el.insertAdjacentHTML("beforeend",'<p class="muted">Quota progress is unavailable: '+escapeHtml(e.message)+'</p>');}}
document.addEventListener("click",async e=>{const read=e.target.closest("[data-notification-read]");if(read){read.disabled=true;try{await api("/api/management/notifications/read",{method:"POST",body:JSON.stringify({ids:[read.dataset.notificationRead]})});await loadNotifications();}catch(err){notice(err.message,"error");read.disabled=false;}return;}const n=e.target.closest("[data-notification-open]");if(n)showPage(n.dataset.notificationOpen);const a=e.target.closest("[data-approval-open]");if(a){const map={PROMOTION:"promotions",PUNISHMENT:"punishments",LEAVE:"leaves",SESSION:"sessions"};showPage(map[a.dataset.approvalOpen]||"overview");}});
$("refreshManagementAudit")?.addEventListener("click",loadManagementAudit);$("auditCategory")?.addEventListener("change",loadManagementAudit);["auditActor","auditTarget"].forEach(id=>$(id)?.addEventListener("input",()=>{clearTimeout(window.__auditFilterTimer);window.__auditFilterTimer=setTimeout(loadManagementAudit,250);}));$("refreshNotifications")?.addEventListener("click",loadNotifications);$("refreshApprovals")?.addEventListener("click",loadApprovals);$("refreshAnalytics")?.addEventListener("click",loadAnalytics);
$("exportManagementBackup")?.addEventListener("click",async()=>{const button=$("exportManagementBackup");button.disabled=true;button.textContent="Preparing backup…";try{const response=await fetch("/api/management/backup/export",{credentials:"same-origin",headers:{"Accept":"application/json"}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Backup export failed.");const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="lemonz-management-backup-"+new Date().toISOString().slice(0,10)+".json";document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);notice("Management backup exported.","success");}catch(e){notice(e.message,"error");}finally{button.disabled=false;button.textContent="↓ Export management backup";}});
document.addEventListener("submit",async e=>{
 const form=e.target;if(!["memberPromotionRequestForm","memberPunishmentRequestForm"].includes(form.id))return;e.preventDefault();
 const id=$("memberProfile")?.dataset.memberId;if(!id)return;
 const memberName=$("memberProfile .profile-identity h3")?.textContent||"Staff member";
 const btn=form.querySelector('button[type="submit"]');if(btn.disabled)return;btn.disabled=true;const original=btn.textContent;btn.textContent="Submitting…";
 try{
  if(form.id==="memberPromotionRequestForm"){
   const suggestedRole=$("memberSuggestedRole").value.trim(),reason=$("memberPromotionReason").value.trim();if(!suggestedRole||!reason)throw new Error("Enter a suggested role and reason.");
   await api("/api/management/promotions",{method:"POST",body:JSON.stringify({userId:id,username:memberName,suggestedRole,reason})});notice("Promotion request submitted for "+memberName+".","success");
  }else{
   const type=$("memberPunishmentType").value,reason=$("memberPunishmentReason").value.trim();if(!reason)throw new Error("Enter a reason for the discipline request.");
   await api("/api/management/punishments",{method:"POST",body:JSON.stringify({userId:id,username:memberName,type,reason})});notice("Discipline request submitted for "+memberName+".","success");
  }
  await showStaffProfile(id);$("memberProfile").querySelector('[data-profile-tab="requests"]')?.click();
 }catch(err){notice(err.message||"Could not submit the request.","error");btn.disabled=false;btn.textContent=original;}
});
