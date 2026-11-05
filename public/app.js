const $ = (id) => document.getElementById(id);
let sessionData = null, selectedMember = null, roles = [];
const pageNames = {overview:"Overview",rank:"Ranking",members:"Members",logs:"Ranking Logs",sessions:"Shifts",activity:"Activity",punishments:"Punishments",promotions:"Promotion Suggestions",leaves:"Time Off",knowledge:"Knowledge Hub",settings:"Settings"};
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
function showPage(page) {
  Object.keys(pageNames).forEach(k=>$(`${k}Page`).classList.toggle("hidden",k!==page));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $("pageTitle").textContent=pageNames[page]; $("crumb").textContent=page.toUpperCase();
  clearNotice();
  if(page==="logs") loadLogs();
  if(page==="rank") loadRoles();
  if(page==="settings") loadGameSettings();
  if(page==="sessions") loadSessions();
  if(page==="members") loadStaffDirectory();
  if(page==="activity") loadManagement("activity");
  if(page==="punishments") loadManagement("punishments");
  if(page==="promotions") loadManagement("promotions");
  if(page==="leaves") loadManagement("leaves");
  if(page==="knowledge") loadKnowledge();
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
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
    const map={activity_view_rank:"activityViewRank",activity_edit_rank:"activityEditRank",punishment_view_rank:"punishmentViewRank",punishment_add_rank:"punishmentAddRank",punishment_request_rank:"punishmentRequestRank",punishment_approve_rank:"punishmentApproveRank",promotion_suggest_rank:"promotionSuggestRank",promotion_approve_rank:"promotionApproveRank",leave_approve_rank:"leaveApproveRank",knowledge_manage_rank:"knowledgeManageRank",session_create_rank:"sessionCreateRank",session_delete_rank:"sessionDeleteRank"};
    Object.entries(map).forEach(([key,id])=>$(id).value=d.settings[key]);
  }catch(e){if(!e.message.includes("Only the group owner"))notice(e.message,"error")}
}
$("saveManagementSettings").addEventListener("click",async()=>{
  const btn=$("saveManagementSettings");btn.disabled=true;btn.textContent="Saving…";
  try{
    const map={activity_view_rank:"activityViewRank",activity_edit_rank:"activityEditRank",punishment_view_rank:"punishmentViewRank",punishment_add_rank:"punishmentAddRank",punishment_request_rank:"punishmentRequestRank",punishment_approve_rank:"punishmentApproveRank",promotion_suggest_rank:"promotionSuggestRank",promotion_approve_rank:"promotionApproveRank",leave_approve_rank:"leaveApproveRank",knowledge_manage_rank:"knowledgeManageRank",session_create_rank:"sessionCreateRank",session_delete_rank:"sessionDeleteRank"};
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
    try{const d=await api("/api/management/punishments"),rows=searchRows(d.items,"punishmentSearch",["username","type","reason","status","created_by_name"]);
      $("punishmentTable").innerHTML=rows.length?'<table class="data-table"><thead><tr><th>MEMBER</th><th>TYPE</th><th>REASON</th><th>STATUS</th><th>SUBMITTED BY</th><th>ACTIONS</th></tr></thead><tbody>'+rows.map(i=>'<tr><td>'+escapeHtml(i.username)+'</td><td>'+escapeHtml(i.type)+' '+escapeHtml(i.duration||"")+'</td><td>'+escapeHtml(i.reason)+'</td><td><span class="status-pill">'+escapeHtml(i.status)+'</span></td><td>'+escapeHtml(i.created_by_name)+'</td><td>'+actionButtons("punishment",i,d.rank,d.settings)+'</td></tr>').join("")+'</tbody></table>':"No matching punishment records.";
    }catch(e){$("punishmentTable").textContent=e.message}
  }
  if(tab==="promotions"){
    $("promotionTable").textContent="Loading suggestions…";
    try{const d=await api("/api/management/promotions"),rows=searchRows(d.items,"promotionSearch",["username","suggested_role","reason","status","suggested_by_name"]);
      $("promotionTable").innerHTML=rows.length?'<table class="data-table"><thead><tr><th>MEMBER</th><th>SUGGESTED ROLE</th><th>REASON</th><th>STATUS</th><th>SUGGESTED BY</th><th>ACTIONS</th></tr></thead><tbody>'+rows.map(i=>'<tr><td>'+escapeHtml(i.username)+'</td><td>'+escapeHtml(i.suggested_role)+'</td><td>'+escapeHtml(i.reason)+'</td><td><span class="status-pill">'+escapeHtml(i.status)+'</span></td><td>'+escapeHtml(i.suggested_by_name)+'</td><td>'+actionButtons("promotion",i,d.rank,d.settings)+'</td></tr>').join("")+'</tbody></table>':"No matching promotion suggestions.";
    }catch(e){$("promotionTable").textContent=e.message}
  }
  if(tab==="leaves"){
    $("leaveRoblox").value=sessionData?.user?.name||"";$("leaveTable").textContent="Loading requests…";
    try{const d=await api("/api/management/leaves"),rows=searchRows(d.items,"leaveSearch",["discord_username","roblox_username","start_date","end_date","reason","status"]);
      $("leaveTable").innerHTML=rows.length?'<table class="data-table"><thead><tr><th>DISCORD</th><th>ROBLOX</th><th>START</th><th>END</th><th>REASON</th><th>LAST LEAVE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>'+rows.map(i=>'<tr><td>'+escapeHtml(i.discord_username)+'</td><td>'+escapeHtml(i.roblox_username)+'</td><td>'+dateOnly(i.start_date)+'</td><td>'+dateOnly(i.end_date)+'</td><td>'+escapeHtml(i.reason)+'</td><td>'+dateOnly(i.last_leave_at)+'</td><td><span class="status-pill">'+escapeHtml(i.status)+'</span></td><td>'+actionButtons("leave",i,d.rank,d.settings)+'</td></tr>').join("")+'</tbody></table>':"No matching time-off requests.";
    }catch(e){$("leaveTable").textContent=e.message}
  }
}
$("refreshActivity").addEventListener("click",()=>loadManagement("activity"));
$("leaveSearch")?.addEventListener("input",()=>{const q=$("leaveSearch").value.toLowerCase();document.querySelectorAll("#leaveTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));});
$("promotionSearch")?.addEventListener("input",()=>{const q=$("promotionSearch").value.toLowerCase();document.querySelectorAll("#promotionTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));});
$("punishmentSearch")?.addEventListener("input",()=>{const q=$("punishmentSearch").value.toLowerCase();document.querySelectorAll("#punishmentTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));});
$("activitySearch")?.addEventListener("input",()=>{const q=$("activitySearch").value.toLowerCase();document.querySelectorAll("#activityTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));});
$("saveActivityAdjust").addEventListener("click",async()=>{
  try{
    await api("/api/management/activity/adjust",{method:"POST",body:JSON.stringify({userId:$("activityUserId").value.trim(),username:$("activityUsername").value.trim(),minutes:Number($("activityMinutes").value),reason:$("activityReason").value.trim()})});
    notice("Activity adjustment saved.","success");["activityUserId","activityUsername","activityMinutes","activityReason"].forEach(id=>$(id).value="");loadManagement("activity");
  }catch(e){notice(e.message,"error")}
});
$("submitPunishment").addEventListener("click",async()=>{
  try{
    const d=await api("/api/management/punishments",{method:"POST",body:JSON.stringify({userId:$("punishUserId").value.trim(),username:$("punishUsername").value.trim(),type:$("punishType").value,duration:$("punishDuration").value.trim(),reason:$("punishReason").value.trim()})});
    notice(d.item.status==="PENDING"?"Punishment request submitted for approval.":"Punishment record added.","success");loadManagement("punishments");
  }catch(e){notice(e.message,"error")}
});
$("submitPromotion").addEventListener("click",async()=>{
  try{
    await api("/api/management/promotions",{method:"POST",body:JSON.stringify({userId:$("promotionUserId").value.trim(),username:$("promotionUsername").value.trim(),suggestedRole:$("promotionRole").value.trim(),reason:$("promotionReason").value.trim()})});
    notice("Promotion suggestion submitted.","success");loadManagement("promotions");
  }catch(e){notice(e.message,"error")}
});
$("submitLeave").addEventListener("click",async()=>{
  try{
    const d=await api("/api/management/leaves",{method:"POST",body:JSON.stringify({discordUsername:$("leaveDiscord").value.trim(),robloxUsername:$("leaveRoblox").value.trim(),startDate:$("leaveStart").value,endDate:$("leaveEnd").value,reason:$("leaveReason").value.trim()})});
    notice("Time-off request submitted. Last approved leave: "+dateOnly(d.item.last_leave_at)+".","success");loadManagement("leaves");
  }catch(e){notice(e.message,"error")}
});
document.addEventListener("click",async e=>{
  const decision=e.target.closest("[data-decision]");
  if(decision){
    const type=decision.dataset.decision,id=decision.dataset.id,status=decision.dataset.status,route=type==="punishment"?"punishments":type==="promotion"?"promotions":"leaves";
    try{await api(`/api/management/${route}/${encodeURIComponent(id)}/decision`,{method:"POST",body:JSON.stringify({status})});notice(type+" "+status.toLowerCase()+".","success");loadManagement(route);}
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
 const q=(search?.value||"").trim().toLowerCase();
 const list=staffDirectory.filter(m=>!q||[m.username,m.displayName,m.role].some(v=>String(v||"").toLowerCase().includes(q))).sort((x,y)=>Number(y.rank)-Number(x.rank)||String(x.role).localeCompare(String(y.role))||String(x.username).localeCompare(String(y.username)));
 $("staffCount").textContent=staffDirectory.length+" staff members · Rank "+staffMinRank+"+";
 status.textContent=list.length?"Showing "+list.length+" staff members":"No staff match that search.";
 result.innerHTML=list.map(m=>'<button class="staff-card" data-staff-id="'+escapeHtml(m.id)+'" type="button"><img class="staff-avatar" src="'+escapeHtml(m.avatarUrl||"")+'" alt="" loading="lazy"><span class="staff-card-copy"><b>'+escapeHtml(m.username)+'</b><small>'+escapeHtml(m.role)+'</small></span><span class="rank-pill">R'+m.rank+'</span></button>').join("");
}
async function loadStaffDirectory(force=false){
 const result=$("directoryResult"),status=$("directoryStatus");if(result)result.innerHTML="";
 if(status)status.textContent="Loading staff ranked "+staffMinRank+"+…";
 if(staffDirectory.length&&!force){renderStaffDirectory();return;}
 if($("directoryButton"))$("directoryButton").disabled=true;
 try{
  const d=await api("/api/staff");staffDirectory=Array.isArray(d.members)?d.members:[];staffMinRank=Number(d.minRank||d.diagnostics?.minRank||230);staffDiagnostics=d.diagnostics||null;
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
  for(let day=1;day<=days;day++){const date=y+"-"+String(m+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");const events=items.filter(s=>String(s.session_date).slice(0,10)===date);cells.push('<div class="calendar-day"><b>'+day+'</b>'+events.map(s=>'<div class="calendar-event">'+escapeHtml(s.title)+' · '+escapeHtml(String(s.session_time||"").slice(0,5))+'</div>').join("")+'</div>');}
  $("sessionsCalendar").innerHTML='<div class="calendar-weekdays">'+["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>'<b>'+d+'</b>').join("")+'</div><div class="calendar-grid">'+cells.join("")+'</div>';
}
async function loadSessions(){
  try{
    if(!staffDirectory.length)await loadStaffDirectory();
    const d=await api("/api/management/sessions"),all=d.sessions||[],items=all.filter(s=>String(s.session_date).slice(0,7)===calendarMonthKey(calendarCursor));
    $("calendarMonth").textContent=calendarCursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});drawSessionsCalendar(items);
    const q=($("sessionSearch")?.value||"").trim().toLowerCase(),filter=$("sessionFilter")?.value||"all",visible=all.filter(s=>{const future=new Date(String(s.session_date).slice(0,10)+"T"+String(s.session_time||"00:00").slice(0,5)+":00")>=new Date();const textMatch=!q||[s.title,s.session_date,s.session_time,s.host_name,s.cohost_name,s.oversee_name,(s.oversee_names||[]).join(" "),s.promoter_name,(s.attendee_names||[]).join(" ")].some(v=>String(v||"").toLowerCase().includes(q));return textMatch&&(filter==="all"||(filter==="upcoming"&&future)||(filter==="past"&&!future));});
    $("sessionList").innerHTML=visible.length?'<table class="data-table"><thead><tr><th>DATE</th><th>SHIFT</th><th>TIME</th><th>HOST</th><th>CO-HOST</th><th>OVERSEE</th><th>PROMOTER</th><th>ATTENDEES</th><th>STATUS</th><th></th></tr></thead><tbody>'+visible.map(s=>'<tr><td>'+escapeHtml(String(s.session_date||"").slice(0,10))+'</td><td><b>'+escapeHtml(s.title)+'</b></td><td>'+escapeHtml(String(s.session_time||"").slice(0,5))+'</td><td>'+escapeHtml(s.host_name||"—")+'</td><td>'+escapeHtml(s.cohost_name||"—")+'</td><td>'+escapeHtml((s.oversee_names||[]).join(", ")||s.oversee_name||"—")+'</td><td>'+escapeHtml(s.promoter_name||"—")+'</td><td>'+escapeHtml((s.attendee_names||[]).join(", "))+'</td><td><span class="status-pill">'+(new Date(String(s.session_date).slice(0,10)+"T"+String(s.session_time||"00:00").slice(0,5)+":00")>=new Date()?"Upcoming":"Past")+'</span></td><td>'+(s.canDelete?'<button class="danger-btn" data-delete="session" data-id="'+s.id+'">Delete</button>':"")+'</td></tr>').join("")+'</tbody></table>':(all.length?"No shifts match your search.":"No shifts scheduled yet.");
  }catch(e){$("sessionList").textContent=e.message;}
}
$("calendarPrev").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);loadSessions();});
$("calendarNext").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);loadSessions();});
$("sessionSearch")?.addEventListener("input",loadSessions);$("sessionFilter")?.addEventListener("change",loadSessions);
$("createSession").addEventListener("click",async()=>{
 const resolveTyped=(inputId,selectId,optional=false)=>{const value=$(inputId).value.trim();if(!value&&optional){$(selectId).value="";return "";}const match=staffDirectory.find(m=>m.username.toLowerCase()===value.toLowerCase());if(!match)throw new Error("Select an exact staff username for "+inputId.replace("session","").replace("Search","")+".");$(selectId).value=match.id;return match.id;};
 let hostId,cohostId,promoterId;try{hostId=resolveTyped("sessionHostSearch","sessionHost");cohostId=resolveTyped("sessionCoHostSearch","sessionCoHost",true);promoterId=resolveTyped("sessionPromoterSearch","sessionPromoter",true);}catch(e){notice(e.message,"error");return;}
 const attendees=[...$("sessionAttendees").selectedOptions].map(o=>o.value).filter(Boolean);
 const body={title:$("sessionTitle").value.trim(),date:$("sessionDate").value,time:$("sessionTime").value,hostId,cohostId,overseeIds:[...$("sessionOversee").selectedOptions].map(o=>o.value).filter(Boolean),promoterId,attendeeIds:attendees};
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
