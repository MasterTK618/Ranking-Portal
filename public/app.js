const $ = (id) => document.getElementById(id);
let sessionData = null, selectedMember = null, roles = [];\nlet managementTeams=[],teamAssignments=new Map(),teamStaffCache=[];
const pageNames = {overview:"Overview",rank:"Group Ranking",members:"Staff Directory",logs:"Ranking History",sessions:"Sessions & Events",activity:"Staff Activity",punishments:"Discipline Management",promotions:"Promotions",leaves:"Leave & Absence",tasks:"Staff Tasks",knowledge:"Knowledge Hub",settings:"Settings"};
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
  if(page==="logs")loadLogs();
  if(page==="rank")loadRoles();
  if(page==="settings")loadGameSettings();
  if(page==="sessions"){if(selectedView==="requests")loadSessionRequests();else loadSessions();}
  if(page==="members")loadStaffDirectory();
  if(page==="activity")loadManagement("activity");
  if(page==="punishments"){loadManagement("punishments");if(selectedView==="audit")loadPunishmentAudit();}
  if(page==="promotions"){loadManagement("promotions");if(selectedView==="history")loadPromotionAudit();}
  if(page==="leaves")loadManagement("leaves");
  if(page==="tasks")loadTasks();
  if(page==="knowledge")loadKnowledge();
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page,b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.go)));
$("themeToggle").addEventListener("click",()=>{
  const dark=document.body.classList.toggle("dark");
  $("themeIcon").textContent=dark?"☀":"☾"; $("themeText").textContent=dark?"Light mode":"Dark mode";
  try{localStorage.setItem("lemonz-theme",dark?"dark":"light")}catch{}
});
try { if(localStorage.getItem("lemonz-theme")==="dark"){document.body.classList.add("dark");$("themeIcon").textContent="☀";$("themeText").textContent="Light mode";}}catch{}
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

async function loadManagementSettings(){
  try{
    const d=await api("/api/management/settings");
    const map={activity_view_rank:"activityViewRank",activity_edit_rank:"activityEditRank",punishment_view_rank:"punishmentViewRank",punishment_add_rank:"punishmentAddRank",punishment_request_rank:"punishmentRequestRank",punishment_approve_rank:"punishmentApproveRank",promotion_suggest_rank:"promotionSuggestRank",promotion_approve_rank:"promotionApproveRank",leave_approve_rank:"leaveApproveRank",knowledge_manage_rank:"knowledgeManageRank",session_create_rank:"sessionCreateRank",session_delete_rank:"sessionDeleteRank",task_view_rank:"taskViewRank",task_manage_rank:"taskManageRank",session_approve_rank:"sessionApproveRank",session_status_rank:"sessionStatusRank"};
    Object.entries(map).forEach(([key,id])=>$(id).value=d.settings[key]);
  }catch(e){if(!e.message.includes("Only the group owner"))notice(e.message,"error")}
}
$("saveManagementSettings").addEventListener("click",async()=>{
  const btn=$("saveManagementSettings");btn.disabled=true;btn.textContent="Saving…";
  try{
    const map={activity_view_rank:"activityViewRank",activity_edit_rank:"activityEditRank",punishment_view_rank:"punishmentViewRank",punishment_add_rank:"punishmentAddRank",punishment_request_rank:"punishmentRequestRank",punishment_approve_rank:"punishmentApproveRank",promotion_suggest_rank:"promotionSuggestRank",promotion_approve_rank:"promotionApproveRank",leave_approve_rank:"leaveApproveRank",knowledge_manage_rank:"knowledgeManageRank",session_create_rank:"sessionCreateRank",session_delete_rank:"sessionDeleteRank",task_view_rank:"taskViewRank",task_manage_rank:"taskManageRank",session_approve_rank:"sessionApproveRank",session_status_rank:"sessionStatusRank"};
    const values={};Object.entries(map).forEach(([key,id])=>values[key]=Number($(id).value));
    await api("/api/management/settings",{method:"PUT",body:JSON.stringify(values)});
    notice("Management permissions saved.","success");
  }catch(e){notice(e.message,"error")}
  finally{btn.disabled=false;btn.textContent="Save permissions"}
});

let knowledgeItems=[],knowledgeCanManage=false;
async function loadKnowledge(){const list=$("knowledgeList");if(!list)return;list.textContent="Loading resources…";try{const d=await api("/api/management/knowledge");knowledgeItems=d.items||[];knowledgeCanManage=!!d.canManage;$("knowledgeManager").classList.toggle("hidden",!knowledgeCanManage);renderKnowledge();}catch(e){list.textContent=e.message;}}
function renderKnowledge(){const q=($("knowledgeSearch").value||"").trim().toLowerCase();const items=knowledgeItems.filter(x=>[x.title,x.category,x.content,x.kind].some(v=>String(v||"").toLowerCase().includes(q)));$("knowledgeList").innerHTML=items.length?items.map(x=>{const body=escapeHtml(x.content);const open=x.kind==="link"?'<a class="knowledge-open" href="'+escapeHtml(x.url)+'" target="_blank" rel="noopener noreferrer">Open resource ↗</a>':'<details><summary>Read document</summary><div class="knowledge-document">'+body.replace(/\n/g,"<br>")+'</div></details>';return '<article class="knowledge-card"><div class="knowledge-card-top"><span class="knowledge-kind">'+(x.kind==="link"?"↗ LINK":"▤ DOCUMENT")+'</span><span class="knowledge-rank">RANK '+x.min_rank+'+</span></div><h3>'+escapeHtml(x.title)+'</h3><small>'+escapeHtml(x.category)+' · Added by '+escapeHtml(x.created_by_name)+'</small><p>'+body.slice(0,260)+(body.length>260?"…":"")+'</p>'+open+(knowledgeCanManage?'<div class="knowledge-actions"><button class="quiet-btn" data-knowledge-edit="'+x.id+'">Edit</button><button class="danger-btn" data-knowledge-delete="'+x.id+'">Delete</button></div>':"")+'</article>';}).join(""):'<div class="empty-state">No resources are available to your rank, or your search found no matches.</div>';}
$("refreshKnowledge")?.addEventListener("click",loadKnowledge);$("knowledgeSearch")?.addEventListener("input",renderKnowledge);
$("knowledgeKind")?.addEventListener("change",()=>{$("knowledgeUrlWrap").classList.toggle("hidden",$("knowledgeKind").value!=="link");});
function resetKnowledgeForm(){["knowledgeTitle","knowledgeCategory","knowledgeUrl","knowledgeContent","knowledgeEditId"].forEach(id=>$(id).value="");$("knowledgeMinRank").value="1";$("knowledgeKind").value="document";$("knowledgeUrlWrap").classList.add("hidden");$("knowledgeFormTitle").textContent="Add a resource";$("saveKnowledge").textContent="Publish resource";$("cancelKnowledgeEdit").classList.add("hidden");}
$("cancelKnowledgeEdit")?.addEventListener("click",resetKnowledgeForm);
$("saveKnowledge")?.addEventListener("click",async()=>{const b=$("saveKnowledge"),id=$("knowledgeEditId").value;b.disabled=true;try{const payload={title:$("knowledgeTitle").value,category:$("knowledgeCategory").value,kind:$("knowledgeKind").value,minRank:Number($("knowledgeMinRank").value),url:$("knowledgeUrl").value,content:$("knowledgeContent").value};await api(id?"/api/management/knowledge/"+encodeURIComponent(id):"/api/management/knowledge",{method:id?"PUT":"POST",body:JSON.stringify(payload)});resetKnowledgeForm();notice(id?"Knowledge resource updated.":"Knowledge resource published.","success");await loadKnowledge();}catch(e){notice(e.message,"error");}finally{b.disabled=false;}});
document.addEventListener("click",async e=>{const edit=e.target.closest("[data-knowledge-edit]");if(edit){const item=knowledgeItems.find(x=>String(x.id)===String(edit.dataset.knowledgeEdit));if(!item)return;$("knowledgeEditId").value=item.id;$("knowledgeTitle").value=item.title;$("knowledgeCategory").value=item.category;$("knowledgeKind").value=item.kind;$("knowledgeMinRank").value=item.min_rank;$("knowledgeUrl").value=item.url||"";$("knowledgeContent").value=item.content;$("knowledgeUrlWrap").classList.toggle("hidden",item.kind!=="link");$("knowledgeFormTitle").textContent="Edit resource";$("saveKnowledge").textContent="Save changes";$("cancelKnowledgeEdit").classList.remove("hidden");$("knowledgeManager").scrollIntoView({behavior:"smooth"});return;}const b=e.target.closest("[data-knowledge-delete]");if(!b)return;if(!confirm("Delete this knowledge resource?"))return;try{await api("/api/management/knowledge/"+encodeURIComponent(b.dataset.knowledgeDelete),{method:"DELETE"});notice("Resource deleted.","success");loadKnowledge();}catch(err){notice(err.message,"error");}});
async function runRobloxDiagnostics(buttonId,outputId){const b=$(buttonId),out=$(outputId);if(!b||!out)return;b.disabled=true;b.textContent="Testing…";out.classList.remove("hidden");out.textContent="Checking Roblox endpoints…";try{const d=await api("/api/diagnostics/roblox");const item=(label,x)=>'<div class="diagnostic-line"><b>'+label+'</b><span class="'+(x.ok?"diagnostic-ok":"diagnostic-bad")+'">'+(x.ok?"Connected":"Failed")+(x.status?" · HTTP "+x.status:"")+(x.error?" · "+escapeHtml(x.error):"")+"</span></div>";out.innerHTML='<p>Group ID: <b>'+escapeHtml(d.groupId)+'</b> · API key configured: <b>'+(d.apiKeyConfigured?"Yes":"No")+"</b></p>"+item("Public Roblox Groups API",d.publicGroupApi)+item("Roblox Open Cloud Roles API",d.openCloudRoles)+(d.openCloudRoles.ok?'<small>Roles returned: '+d.openCloudRoles.roleCount+'</small>':"");}catch(e){out.textContent=e.message;}finally{b.disabled=false;b.textContent="Test Roblox API";}}
$("testRobloxConnection")?.addEventListener("click",()=>runRobloxDiagnostics("testRobloxConnection","robloxDiagnostics"));
$("directoryDiagnosticsButton")?.addEventListener("click",()=>runRobloxDiagnostics("directoryDiagnosticsButton","directoryDiagnostics"));

async function loadTeamsSettings(){
  const box=$("teamDirectory");if(!box)return;
  box.innerHTML='<div class="empty-state">Loading teams and departments…</div>';
  try{
    const d=await api("/api/management/teams");managementTeams=d.teams||[];teamAssignments=new Map((d.members||[]).map(x=>[String(x.user_id),String(x.team_id)]));
    if(!teamStaffCache.length){const staff=await api("/api/staff");teamStaffCache=staff.members||[];}
    const teamSelect=$("teamAssignmentSelect"),previous=teamSelect.value;
    teamSelect.innerHTML='<option value="">Choose a team…</option>'+managementTeams.map(t=>'<option value="'+escapeHtml(t.id)+'">'+escapeHtml(t.department)+' / '+escapeHtml(t.name)+'</option>').join("");
    if(managementTeams.some(t=>String(t.id)===previous))teamSelect.value=previous;
    renderTeamDirectory();renderTeamAssignmentMembers();renderStaffDirectory();
  }catch(e){box.innerHTML='<div class="empty-state error-state">'+escapeHtml(e.message)+'</div>';}
}
function renderTeamDirectory(){
  const box=$("teamDirectory");if(!box)return;
  if(!managementTeams.length){box.innerHTML='<div class="empty-state">No teams yet. Create your first team above.</div>';return;}
  const departments=[...new Set(managementTeams.map(t=>t.department))];
  box.innerHTML=departments.map(dept=>'<section class="department-group"><div class="department-heading"><b>'+escapeHtml(dept)+'</b><span>'+managementTeams.filter(t=>t.department===dept).length+' teams</span></div><div class="team-card-grid">'+managementTeams.filter(t=>t.department===dept).map(t=>'<article class="team-card"><span class="team-color-dot" style="background:'+escapeHtml(t.color)+'"></span><div class="team-card-copy"><b>'+escapeHtml(t.name)+'</b><small>'+escapeHtml(t.description||"No description")+'</small><em>'+Number(t.member_count||0)+' assigned staff</em></div><button class="quiet-btn" data-team-edit="'+escapeHtml(t.id)+'">Edit</button><button class="danger-btn" data-team-delete="'+escapeHtml(t.id)+'">Delete</button></article>').join("")+'</div></section>').join("");
}
function renderTeamAssignmentMembers(){
  const teamId=$("teamAssignmentSelect")?.value,select=$("teamMembersSelect");if(!select)return;
  const q=($("teamMemberSearch")?.value||"").trim().toLowerCase();
  const selected=teamStaffCache.filter(m=>String(teamAssignments.get(String(m.id))||"")===String(teamId||""));
  select.innerHTML=teamStaffCache.map(m=>{
    const match=!q||[m.username,m.displayName,m.role].some(v=>String(v||"").toLowerCase().includes(q));
    const elsewhere=teamAssignments.has(String(m.id))&&String(teamAssignments.get(String(m.id)))!==String(teamId);
    return '<option value="'+escapeHtml(m.id)+'"'+(selected.some(x=>String(x.id)===String(m.id))?' selected':'')+(!match?' hidden':'')+'>'+escapeHtml(m.username)+' · '+escapeHtml(m.role)+(elsewhere?' · assigned elsewhere':'')+'</option>';
  }).join("");
  $("teamAssignmentHelp").textContent=teamId?selected.length+" staff currently assigned. Select the members who should belong to this team.":"Select a team to load its current members.";
}
$("createTeam")?.addEventListener("click",async()=>{
  const btn=$("createTeam");btn.disabled=true;
  try{const id=$("teamEditId").value;const payload={name:$("teamName").value,department:$("teamDepartment").value,description:$("teamDescription").value,color:$("teamColor").value};await api(id?"/api/management/teams/"+encodeURIComponent(id):"/api/management/teams",{method:id?"PUT":"POST",body:JSON.stringify(payload)});
    $("teamEditId").value="";$("teamName").value="";$("teamDepartment").value="";$("teamDescription").value="";$("teamColor").value="#f5c928";btn.textContent="＋ Create team";notice(id?"Team updated.":"Team created.","success");await loadTeamsSettings();
  }catch(e){notice(e.message,"error")}finally{btn.disabled=false;}
});
$("teamAssignmentSelect")?.addEventListener("change",renderTeamAssignmentMembers);
$("teamMemberSearch")?.addEventListener("input",renderTeamAssignmentMembers);
$("saveTeamMembers")?.addEventListener("click",async()=>{
  const teamId=$("teamAssignmentSelect").value;if(!teamId){notice("Choose a team first.","error");return;}
  const btn=$("saveTeamMembers");btn.disabled=true;
  try{const userIds=Array.from($("teamMembersSelect").selectedOptions).map(o=>o.value);await api("/api/management/teams/"+encodeURIComponent(teamId)+"/members",{method:"PUT",body:JSON.stringify({userIds})});notice("Team assignments saved.","success");await loadTeamsSettings();}
  catch(e){notice(e.message,"error")}finally{btn.disabled=false;}
});
$("teamDirectory")?.addEventListener("click",async event=>{
  const edit=event.target.closest("[data-team-edit]");
  if(edit){const t=managementTeams.find(x=>String(x.id)===String(edit.dataset.teamEdit));if(!t)return;$("teamEditId").value=t.id;$("teamName").value=t.name;$("teamDepartment").value=t.department;$("teamDescription").value=t.description||"";$("teamColor").value=t.color||"#f5c928";$("createTeam").textContent="Save team changes";$("teamName").focus();$("teamName").scrollIntoView({behavior:"smooth",block:"center"});return;}
  const btn=event.target.closest("[data-team-delete]");if(!btn)return;
  if(!confirm("Delete this team? Its staff assignments will be cleared."))return;
  try{await api("/api/management/teams/"+encodeURIComponent(btn.dataset.teamDelete),{method:"DELETE"});notice("Team deleted.","success");await loadTeamsSettings();}
  catch(e){notice(e.message,"error")}
});
$("directoryTeamFilter")?.addEventListener("change",renderStaffDirectory);
async function loadGameSettings(){
  try{
    const d=await api("/api/settings/game-ranking");
    if(!d.canConfigure){$("settingsNav").classList.add("hidden");notice("Only the group owner can configure in-game ranking.","error");return}
    const s=d.settings;
    await loadManagementSettings();
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
  }
  $("loginButton").classList.add("hidden");$("logoutButton").classList.remove("hidden");$("userBox").classList.remove("hidden");
}
(async()=>{
  try{await refreshOverview()}catch(e){
    if(e.message.includes("Sign in")){$("loginPanel").classList.remove("hidden");$("portal").classList.add("hidden")}
    else {notice(e.message,"error");$("loginPanel").classList.remove("hidden")}
  }
})();

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
       roster=roster.map(person=>{const age=person.last_seen?now-new Date(person.last_seen).getTime():Infinity;return {...person,activityStatus:!person.last_seen?"Not tracked":age>7*86400000?"Inactive":"Active"};});
       const totalShifts=roster.reduce((n,p)=>n+Number(p.shifts_attended||0),0);
       const totalMinutes=Math.floor(roster.reduce((n,p)=>n+Number(p.seconds||0),0)/60);
       const activeCount=roster.filter(p=>p.activityStatus==="Active").length;
       const inactiveCount=roster.filter(p=>p.activityStatus!=="Active").length;
       $("activitySummary").innerHTML='<div class="activity-stat"><small>STAFF SHOWN</small><b>'+roster.length.toLocaleString()+'</b></div><div class="activity-stat"><small>SHIFTS ATTENDED</small><b>'+totalShifts.toLocaleString()+'</b></div><div class="activity-stat"><small>TOTAL IN-GAME MINUTES</small><b>'+totalMinutes.toLocaleString()+'</b></div><div class="activity-stat"><small>INACTIVE / NOT TRACKED</small><b>'+inactiveCount.toLocaleString()+'</b><em>'+activeCount+' active in last 7 days</em></div>';
       const rows=searchRows(roster,"activitySearch",["username","displayName","role","rank","shifts_attended","seconds","activityStatus"]);
      const scope=d.canViewAll?"All staff members":"Only your own activity is visible with your current permissions";
      $("activityTable").innerHTML='<div class="activity-table-heading"><span>'+escapeHtml(scope)+'</span><span>'+rows.length+' shown</span></div>'+
        (rows.length?'<table class="data-table activity-data-table"><thead><tr><th>STAFF MEMBER</th><th>GROUP RANK</th><th>SHIFTS ATTENDED</th><th>IN-GAME MINUTES</th><th>LAST ACTIVE</th><th>ACTIVITY STATUS</th></tr></thead><tbody>'+
        rows.map(person=>'<tr><td><div class="activity-person">'+(person.avatarUrl?'<img src="'+escapeHtml(person.avatarUrl)+'" alt="" loading="lazy">':'<span class="activity-avatar-fallback">'+escapeHtml(String(person.username||"?").slice(0,1).toUpperCase())+'</span>')+'<span><b>'+escapeHtml(person.username)+'</b>'+(person.displayName&&person.displayName!==person.username?'<small>'+escapeHtml(person.displayName)+'</small>':"")+'</span></div></td><td><span class="activity-role">'+escapeHtml(person.role||"—")+'</span><small class="activity-rank">Rank '+escapeHtml(person.rank??"—")+'</small></td><td><b>'+Number(person.shifts_attended||0).toLocaleString()+'</b></td><td><b>'+Math.floor(Number(person.seconds||0)/60).toLocaleString()+'</b> min</td><td>'+escapeHtml(person.last_seen?formatDate(person.last_seen):"—")+'</td><td><span class="status-pill">'+escapeHtml(person.activityStatus)+'</span></td></tr>').join("")+
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
      const rows=all.filter(i=>(filter==="ALL"||i.status===filter)&&[i.discord_username,i.roblox_username,i.start_date,i.end_date,i.reason,i.status,i.created_by_name,i.decided_by_name,i.decision_note].some(v=>String(v||"").toLowerCase().includes(q)));
      const pending=all.filter(x=>x.status==="PENDING").length,approved=all.filter(x=>x.status==="APPROVED").length,rejected=all.filter(x=>x.status==="REJECTED").length;
      $("leaveSummary").innerHTML=[["PENDING",pending,"Awaiting a decision"],["APPROVED",approved,"Approved requests"],["REJECTED",rejected,"Declined requests"]].map(x=>`<article class="session-stat"><span>▤</span><small>${x[0]}</small><b>${x[1]}</b><em>${x[2]}</em></article>`).join("");
      $("leaveTable").innerHTML=rows.length?'<table class="data-table leave-data-table"><thead><tr><th>STAFF MEMBER</th><th>DISCORD</th><th>DATES</th><th>REASON / HANDOVER</th><th>LAST APPROVED LEAVE</th><th>STATUS</th><th>REVIEWED BY</th><th>REVIEW NOTE</th><th>ACTIONS</th></tr></thead><tbody>'+rows.map(i=>'<tr data-leave-status="'+escapeHtml(i.status)+'"><td><b>'+escapeHtml(i.roblox_username)+'</b><small class="table-subtext">Submitted '+escapeHtml(formatDate(i.created_at))+'</small></td><td>'+escapeHtml(i.discord_username)+'</td><td><b>'+dateOnly(i.start_date)+'</b><small class="table-subtext">through '+dateOnly(i.end_date)+'</small></td><td class="reason-cell">'+escapeHtml(i.reason)+'</td><td>'+dateOnly(i.last_leave_at)+'</td><td><span class="status-pill status-'+escapeHtml(String(i.status).toLowerCase())+'">'+escapeHtml(i.status)+'</span></td><td>'+escapeHtml(i.decided_by_name||"—")+'</td><td class="reason-cell">'+escapeHtml(i.decision_note||"—")+(i.decided_at?'<small class="table-subtext">'+escapeHtml(formatDate(i.decided_at))+'</small>':"")+'</td><td>'+actionButtons("leave",i,d.rank,d.settings)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No leave requests match this filter.</div>';
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
 el.innerHTML='<option value="ALL">All teams</option><option value="UNASSIGNED">Unassigned</option>'+managementTeams.map(t=>'<option value="'+escapeHtml(t.id)+'">'+escapeHtml(t.department)+' / '+escapeHtml(t.name)+'</option>').join("");
 if([...el.options].some(o=>o.value===previous))el.value=previous;
 return el.value||"ALL";
}
async function loadTasks(){
  $("taskTable").textContent="Loading staff tasks…";
  try{if(!staffDirectory.length)await loadStaffDirectory();
    const d=await api("/api/management/tasks"),items=d.items||[],filter=$("taskStatusFilter").value,q=($("taskSearch").value||"").toLowerCase();const teamFilter=fillTeamFilter("taskTeamFilter");
    const select=$("taskAssignedTo"),previous=select.value;select.innerHTML='<option value="">Choose a staff member…</option>'+staffDirectory.filter(m=>Number(m.rank)>=Number(d.settings.task_view_rank)).map(m=>'<option value="'+escapeHtml(m.id)+'">'+escapeHtml(m.username)+' · '+escapeHtml(m.role)+'</option>').join("");if(previous)select.value=previous;
    const rows=items.filter(x=>(filter==="ALL"||x.status===filter)&&(teamFilter==="ALL"||(teamFilter==="UNASSIGNED"?!x.assigned_team_name:managementTeams.some(t=>String(t.id)===teamFilter&&t.name===x.assigned_team_name)))&&[x.title,x.description,x.assigned_to_name,x.assigned_team_name,x.assigned_department,x.created_by_name,x.priority,x.status].some(v=>String(v||"").toLowerCase().includes(q)));
    const counts=[["OPEN",items.filter(x=>x.status==="OPEN").length,"Needs attention"],["IN PROGRESS",items.filter(x=>x.status==="IN_PROGRESS").length,"Currently being worked on"],["BLOCKED",items.filter(x=>x.status==="BLOCKED").length,"Needs help"],["COMPLETED",items.filter(x=>x.status==="COMPLETED").length,"Finished tasks"]];
    $("taskSummary").innerHTML=counts.map(x=>`<article class="session-stat"><span>✓</span><small>${x[0]}</small><b>${x[1]}</b><em>${x[2]}</em></article>`).join("");
    $("taskAuditCard").classList.toggle("hidden",!d.canManage);
    $("taskTable").innerHTML=rows.length?'<table class="data-table task-data-table"><thead><tr><th>TASK</th><th>ASSIGNED TO</th><th>TEAM / DEPARTMENT</th><th>PRIORITY</th><th>DUE DATE</th><th>CREATED BY</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>'+rows.map(x=>'<tr><td><b>'+escapeHtml(x.title)+'</b><small class="table-subtext">'+escapeHtml(x.description||"No extra details") +'</small></td><td>'+escapeHtml(x.assigned_to_name)+'</td><td>'+escapeHtml(x.assigned_team_name?x.assigned_department+' · '+x.assigned_team_name:'Unassigned')+'</td><td><span class="priority-pill priority-'+escapeHtml(String(x.priority).toLowerCase())+'">'+escapeHtml(x.priority)+'</span></td><td>'+dateOnly(x.due_date)+'</td><td>'+escapeHtml(x.created_by_name)+'</td><td>'+(x.canUpdate?'<select class="task-status-select" data-task-status="'+escapeHtml(x.id)+'"><option value="OPEN"'+(x.status==="OPEN"?" selected":"")+ '>Open</option><option value="IN_PROGRESS"'+(x.status==="IN_PROGRESS"?" selected":"")+ '>In progress</option><option value="BLOCKED"'+(x.status==="BLOCKED"?" selected":"")+ '>Blocked</option><option value="COMPLETED"'+(x.status==="COMPLETED"?" selected":"")+ '>Completed</option></select>':'<span class="status-pill">'+escapeHtml(x.status)+'</span>')+'</td><td>'+(x.canDelete?'<button class="danger-btn" data-task-delete="'+escapeHtml(x.id)+'">Delete</button>':"—")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No tasks match this filter.</div>';
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
$("refreshTaskAudit")?.addEventListener("click",loadTaskAudit);
$("taskSearch")?.addEventListener("input",loadTasks);
$("taskStatusFilter")?.addEventListener("change",loadTasks);
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
  try{await api("/api/management/tasks/"+encodeURIComponent(del.dataset.taskDelete),{method:"DELETE"});notice("Task deleted and logged.","success");await loadTasks();}catch(err){notice(err.message,"error")}
});

$("submitLeave").addEventListener("click",async()=>{
  const btn=$("submitLeave");btn.disabled=true;btn.textContent="Submitting…";
  try{
    const d=await api("/api/management/leaves",{method:"POST",body:JSON.stringify({discordUsername:$("leaveDiscord").value.trim(),robloxUsername:$("leaveRoblox").value.trim(),startDate:$("leaveStart").value,endDate:$("leaveEnd").value,reason:$("leaveReason").value.trim(),timezoneOffset:new Date().getTimezoneOffset()})});
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
  if(!confirm("Delete this "+(type==="leave"?"time-off request":type==="session"?"shift":type)+"? This cannot be undone."))return;
  try{await api(`/api/management/${route}/${encodeURIComponent(id)}`,{method:"DELETE"});notice("Record deleted.","success");if(route==="sessions")loadSessions();else loadManagement(route);}
  catch(err){notice(err.message,"error")}
});


let staffDirectory=[], calendarCursor=new Date(), staffMinRank=230, staffDiagnostics=null;
function renderStaffDirectory(){
 const result=$("directoryResult"),status=$("directoryStatus"),search=$("directorySearch");if(!result)return;
 const q=(search?.value||"").trim().toLowerCase(),teamFilter=$("directoryTeamFilter")?.value||"ALL";
 const list=staffDirectory.filter(m=>{
  const teamId=teamAssignments.get(String(m.id))||"";
  const team=managementTeams.find(t=>String(t.id)===String(teamId));
  const matchesSearch=!q||[m.username,m.displayName,m.role,team?.name,team?.department].some(v=>String(v||"").toLowerCase().includes(q));
  const matchesTeam=teamFilter==="ALL"||(teamFilter==="UNASSIGNED"?!teamId:String(teamId)===teamFilter);
  return matchesSearch&&matchesTeam;
 }).sort((x,y)=>Number(y.rank)-Number(x.rank)||String(x.role).localeCompare(String(y.role))||String(x.username).localeCompare(String(y.username)));
 $("staffCount").textContent=staffDirectory.length+" staff members · Rank "+staffMinRank+"+";
 status.textContent=list.length?"Showing "+list.length+" staff members":"No staff match that search or team filter.";
 result.innerHTML=list.map(m=>{const teamId=teamAssignments.get(String(m.id)),team=managementTeams.find(t=>String(t.id)===String(teamId));return '<button class="staff-card" data-staff-id="'+escapeHtml(m.id)+'" type="button"><img class="staff-avatar" src="'+escapeHtml(m.avatarUrl||"")+'" alt="" loading="lazy"><span class="staff-card-copy"><b>'+escapeHtml(m.username)+'</b><small>'+escapeHtml(m.role)+'</small><small class="staff-team-label">'+(team?'<i style="background:'+escapeHtml(team.color)+'"></i>'+escapeHtml(team.department)+' · '+escapeHtml(team.name):'Unassigned')+'</small></span><span class="rank-pill">R'+m.rank+'</span></button>';}).join("");
}
async function loadStaffDirectory(force=false){
 const result=$("directoryResult"),status=$("directoryStatus");if(result)result.innerHTML="";
 if(status)status.textContent="Loading staff ranked "+staffMinRank+"+…";
 if(staffDirectory.length&&!force){renderStaffDirectory();return;}
 if($("directoryButton"))$("directoryButton").disabled=true;
 try{
  const d=await api("/api/staff");staffDirectory=Array.isArray(d.members)?d.members:[];staffMinRank=Number(d.minRank||d.diagnostics?.minRank||230);staffDiagnostics=d.diagnostics||null;
  try{
   const teams=await api("/api/management/teams");managementTeams=teams.teams||[];teamAssignments=new Map((teams.members||[]).map(x=>[String(x.user_id),String(x.team_id)]));
   const filter=$("directoryTeamFilter");
   if(filter){const old=filter.value;filter.innerHTML='<option value="ALL">All teams</option><option value="UNASSIGNED">Unassigned</option>'+managementTeams.map(t=>'<option value="'+escapeHtml(t.id)+'">'+escapeHtml(t.department)+' / '+escapeHtml(t.name)+'</option>').join("");if([...filter.options].some(o=>o.value===old))filter.value=old;}
  }catch{}

  renderStaffDirectory();if(!staffDirectory.length){const z=d.diagnostics||{};status.textContent="No staff at rank "+staffMinRank+"+ in group "+(z.groupId||"configured group")+". Source: "+(z.source||d.source||"unknown")+". Members scanned: "+(z.fetchedMembers??"unknown")+". Check STAFF_MIN_RANK and the group ID."; }
  const roleSelect=$("promotionRole");if(roleSelect)roleSelect.innerHTML='<option value="">Choose suggested role…</option>'+(d.roles||[]).map(r=>'<option value="'+escapeHtml(r.name)+'">'+escapeHtml(r.name)+' (Rank '+r.rank+')</option>').join("");
  const dl=document.getElementById("staffSuggestions")||document.createElement("datalist");dl.id="staffSuggestions";dl.innerHTML=staffDirectory.map(m=>'<option value="'+escapeHtml(m.username)+'"></option>').join("");document.body.appendChild(dl);
  ["punishUsername","promotionUsername","activityUsername","sessionHostSearch","sessionCoHostSearch","sessionPromoterSearch","sessionAttendeeSearch"].forEach(id=>{const el=$(id);if(el)el.setAttribute("list","staffSuggestions");});
  const configs=[["sessionHost","Choose host…",false],["sessionCoHost","No co-host",false],["sessionPromoter","Choose promoter…",true]];
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
$("directoryResult")?.addEventListener("click",e=>{const card=e.target.closest("[data-staff-id]");if(card)showStaffProfile(card.dataset.staffId);});

async function showStaffProfile(id){
  const panel=$("memberProfile");panel.classList.remove("hidden");panel.innerHTML="<p>Loading staff profile…</p>";
  try{
    const d=await api("/api/management/members/"+encodeURIComponent(id)),m=d.member;
    panel.innerHTML='<div class="profile-head"><img class="profile-avatar" src="'+escapeHtml(m.avatarUrl||"") + '" alt="Roblox avatar"><div><div class="eyebrow">STAFF PROFILE</div><h3>'+escapeHtml(m.username)+'</h3><p>'+escapeHtml(m.role)+' · Rank '+m.rank+'</p></div></div>'+
    '<div class="profile-stats"><div><b>'+d.sessions.length+'</b><small>Shifts attended</small></div><div><b>'+d.punishments.length+'</b><small>Punishments</small></div><div><b>'+Math.floor(Number(d.activity?.seconds||0)/3600)+'h</b><small>Recorded activity</small></div></div>'+
    '<div class="profile-columns"><section><h4>Shift history</h4>'+(d.sessions.length?'<ul class="history-list">'+d.sessions.map(s=>'<li><b>'+escapeHtml(s.title)+'</b><small>'+escapeHtml(String(s.session_date).slice(0,10))+' · '+escapeHtml(String(s.session_time||"").slice(0,5))+' · '+escapeHtml(s.member_role||"Attendee")+'</small></li>').join("")+'</ul>':'<p class="muted">No shifts recorded.</p>')+'</section><section><h4>Punishments</h4>'+(d.punishments.length?'<ul class="history-list">'+d.punishments.map(p=>'<li><b>'+escapeHtml(p.type)+' · '+escapeHtml(p.status)+'</b><small>'+escapeHtml(p.reason)+' · '+escapeHtml(formatDate(p.created_at))+'</small></li>').join("")+'</ul>':'<p class="muted">No punishment records.</p>')+'</section></div>';
    panel.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){panel.textContent=e.message;}
}
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
function renderSessionTable(items,el,searchText=""){
 const q=searchText.toLowerCase(),rows=items.filter(s=>!q||[s.title,s.session_type,s.status,s.status_note,s.host_name,s.cohost_name,s.host_team_name,s.host_department,s.session_date,s.promoter_name].some(v=>String(v||"").toLowerCase().includes(q)));
 el.innerHTML=rows.length?'<table class="data-table session-data-table"><thead><tr><th>SESSION</th><th>TYPE</th><th>DATE &amp; TIME</th><th>HOST / CO-HOST</th><th>TEAM / DEPARTMENT</th><th>OVERSEE / PROMOTER</th><th>ATTENDEES</th><th>STATUS</th><th></th></tr></thead><tbody>'+rows.map(s=>'<tr><td><b>'+escapeHtml(s.title)+'</b>'+(s.status_note?'<small class="table-subtext">'+escapeHtml(s.status_note)+'</small>':"")+'</td><td><span class="session-type-pill">'+sessionTypeLabel(s.session_type)+'</span></td><td>'+escapeHtml(String(s.session_date||"").slice(0,10))+'<small class="table-subtext">'+escapeHtml(String(s.session_time||"").slice(0,5))+'</small></td><td>'+escapeHtml(s.host_name||"—")+'<small class="table-subtext">'+escapeHtml(s.cohost_name||"")+'</small></td><td>'+escapeHtml(s.host_team_name?s.host_department+" · "+s.host_team_name:"Unassigned")+'</td><td>'+escapeHtml((s.oversee_names||[]).join(", ")||s.oversee_name||"—")+'<small class="table-subtext">'+escapeHtml(s.promoter_name||"")+'</small></td><td>'+escapeHtml((s.attendee_names||[]).join(", ")||"—")+'</td><td>'+sessionStatusControl(s)+'</td><td>'+(s.canDelete?'<button class="danger-btn" data-delete="session" data-id="'+s.id+'">Delete</button>':"")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No sessions match this view.</div>';
}
async function loadSessions(){
 try{
  if(!staffDirectory.length)await loadStaffDirectory();
  const d=await api("/api/management/sessions"),all=d.sessions||[];$("sessionCreateCard")?.classList.toggle("hidden",!d.canCreate);
  const now=new Date(),upcoming=all.filter(s=>s.status==="PLANNED"||s.status==="DELAYED").filter(s=>new Date(String(s.session_date).slice(0,10)+"T"+String(s.session_time||"00:00").slice(0,5)+":00")>=now).length;
  const counts=[["TOTAL SESSIONS",all.length,"All recorded events"],["UPCOMING",upcoming,"Planned or delayed"],["ON-GOING",all.filter(s=>s.status==="ONGOING").length,"Currently running"],["COMPLETED",all.filter(s=>s.status==="COMPLETED").length,"Successfully delivered"]];
  $("sessionSummary").innerHTML=counts.map(x=>'<article class="session-stat"><span>▦</span><small>'+x[0]+'</small><b>'+x[1]+'</b><em>'+x[2]+'</em></article>').join("");
  const items=all.filter(s=>String(s.session_date).slice(0,7)===calendarMonthKey(calendarCursor));
  $("calendarMonth").textContent=calendarCursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});drawSessionsCalendar(items);
  const q=$("sessionSearch")?.value||"",filter=$("sessionFilter")?.value||"all",teamFilter=fillTeamFilter("sessionTeamFilter");
  const visible=all.filter(s=>{const future=new Date(String(s.session_date).slice(0,10)+"T"+String(s.session_time||"00:00").slice(0,5)+":00")>=now;const teamMatch=teamFilter==="ALL"||(teamFilter==="UNASSIGNED"?!s.host_team_name:managementTeams.some(t=>String(t.id)===teamFilter&&t.name===s.host_team_name));return teamMatch&&(filter==="all"||(filter==="upcoming"&&future&&["PLANNED","DELAYED"].includes(s.status))||(filter==="past"&&(!future||["CANCELED","COMPLETED"].includes(s.status))));});
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
  el.innerHTML='<div class="request-summary"><span>'+items.length+' total requests</span><span>'+pending+' pending</span><span>'+approved+' approved</span></div>'+(items.length?'<table class="data-table"><thead><tr><th>REQUEST</th><th>TYPE</th><th>PREFERRED DATE</th><th>REQUESTED BY</th><th>STATUS</th><th>REVIEW NOTE</th><th>ACTIONS</th></tr></thead><tbody>'+items.map(x=>'<tr><td><b>'+escapeHtml(x.title)+'</b><small class="table-subtext">'+escapeHtml(x.details)+'</small></td><td>'+sessionTypeLabel(x.session_type)+'</td><td>'+dateOnly(x.preferred_date)+'<small class="table-subtext">'+escapeHtml(String(x.preferred_time||"").slice(0,5))+'</small></td><td>'+escapeHtml(x.requested_by_name)+'</td><td><span class="status-pill status-'+String(x.status).toLowerCase()+'">'+escapeHtml(x.status)+'</span></td><td>'+escapeHtml(x.review_note||"—")+'</td><td>'+((d.canReview&&x.status==="PENDING"?'<button class="quiet-btn" data-session-request-decision="'+x.id+'" data-status="APPROVED">Approve</button> <button class="quiet-btn" data-session-request-decision="'+x.id+'" data-status="REJECTED">Decline</button>':"")+(x.canCancel?' <button class="danger-btn" data-session-request-cancel="'+x.id+'">Cancel</button>':"")||"—")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No session requests have been submitted yet.</div>');
  $("sessionRequestAuditCard").classList.toggle("hidden",!d.canReview);if(d.canReview)await loadSessionRequestAudit();
 }catch(e){el.innerHTML='<div class="empty-state error-state">'+escapeHtml(e.message)+'</div>';}
}
async function loadSessionRequestAudit(){
 const el=$("sessionRequestAuditTable");if(!el)return;try{const d=await api("/api/management/session-requests/audit"),items=d.items||[];el.innerHTML=items.length?'<table class="data-table"><thead><tr><th>DATE</th><th>ACTION</th><th>REQUESTER</th><th>DETAILS</th><th>REVIEWED BY</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+escapeHtml(formatDate(x.created_at))+'</td><td>'+escapeHtml(x.action)+'</td><td>'+escapeHtml(x.target_username||"—")+'</td><td>'+escapeHtml(x.details||"—")+'</td><td>'+escapeHtml(x.actor_name||"—")+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">No session request actions logged yet.</div>';}catch(e){el.textContent=e.message;}
}
$("submitSessionRequest")?.addEventListener("click",async()=>{
 const b=$("submitSessionRequest");b.disabled=true;b.textContent="Sending…";
 try{await api("/api/management/session-requests",{method:"POST",body:JSON.stringify({sessionType:$("sessionRequestType").value,title:$("sessionRequestTitle").value.trim(),details:$("sessionRequestDetails").value.trim(),preferredDate:$("sessionRequestDate").value,preferredTime:$("sessionRequestTime").value})});["sessionRequestTitle","sessionRequestDetails","sessionRequestDate","sessionRequestTime"].forEach(id=>$(id).value="");notice("Session request submitted and logged.","success");await loadSessionRequests();}
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
 b.disabled=true;try{await api("/api/management/session-requests/"+encodeURIComponent(b.dataset.sessionRequestDecision)+"/decision",{method:"POST",body:JSON.stringify({status,note})});notice("Session request "+status.toLowerCase()+".","success");await loadSessionRequests();}catch(err){notice(err.message,"error");}
});
$("calendarPrev").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);loadSessions();});
$("calendarNext").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);loadSessions();});
$("refreshSessions")?.addEventListener("click",loadSessions);
$("sessionSearch")?.addEventListener("input",loadSessions);$("sessionFilter")?.addEventListener("change",loadSessions);
$("createSession").addEventListener("click",async()=>{
 const resolveTyped=(inputId,selectId,optional=false)=>{const value=$(inputId).value.trim();if(!value&&optional){$(selectId).value="";return "";}const match=staffDirectory.find(m=>m.username.toLowerCase()===value.toLowerCase());if(!match)throw new Error("Select an exact staff username for "+inputId.replace("session","").replace("Search","")+".");$(selectId).value=match.id;return match.id;};
 let hostId,cohostId,promoterId;try{hostId=resolveTyped("sessionHostSearch","sessionHost");cohostId=resolveTyped("sessionCoHostSearch","sessionCoHost",true);promoterId=resolveTyped("sessionPromoterSearch","sessionPromoter",true);}catch(e){notice(e.message,"error");return;}
 const attendees=[...$("sessionAttendees").selectedOptions].map(o=>o.value).filter(Boolean);
 const body={title:$("sessionTitle").value.trim(),sessionType:$("sessionType").value,date:$("sessionDate").value,time:$("sessionTime").value,hostId,cohostId,overseeIds:[...$("sessionOversee").selectedOptions].map(o=>o.value).filter(Boolean),promoterId,attendeeIds:attendees};
 if(!body.title||!body.date||!body.time){notice("Enter a shift name, date, and time.","error");return;}
 const btn=$("createSession");btn.disabled=true;
 try{await api("/api/management/sessions",{method:"POST",body:JSON.stringify(body)});notice("Shift created.","success");$("sessionTitle").value="";loadSessions();}catch(e){notice(e.message,"error");}finally{btn.disabled=false;}
});


// Resolve typed Roblox usernames to exact staff IDs before saving a shift.
function connectShiftSearch(inputId,selectId){
  const input=$(inputId),select=$(selectId);if(!input||!select)return;
  const resolve=()=>{const match=staffDirectory.find(m=>m.username.toLowerCase()===input.value.trim().toLowerCase());select.value=match?match.id:"";if(!match&&input.value.trim())notice("Choose an exact staff username from the suggestions.","error");};
  input.addEventListener("change",resolve);input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();resolve();}});
}
connectShiftSearch("sessionHostSearch","sessionHost");connectShiftSearch("sessionCoHostSearch","sessionCoHost");connectShiftSearch("sessionPromoterSearch","sessionPromoter");
$("addSessionAttendee")?.addEventListener("click",()=>{
  const input=$("sessionAttendeeSearch"),select=$("sessionAttendees"),match=staffDirectory.find(m=>m.username.toLowerCase()===input.value.trim().toLowerCase());
  if(!match){notice("Choose an exact staff username from the suggestions.","error");return;}
  if([...select.options].some(o=>o.value===match.id)){notice("That attendee is already added.");return;}
  const option=document.createElement("option");option.value=match.id;option.textContent=match.username+" — "+match.role;option.selected=true;select.appendChild(option);input.value="";
});
// Keep staff suggestions synchronized with the ID fields used by staff forms.
document.addEventListener("change",e=>{
 const pair={punishUsername:"punishUserId",promotionUsername:"promotionUserId",activityUsername:"activityUserId"};
 const idField=pair[e.target.id];if(!idField)return;
 const match=staffDirectory.find(m=>m.username.toLowerCase()===e.target.value.trim().toLowerCase());
 if(match)$(idField).value=match.id;
});
