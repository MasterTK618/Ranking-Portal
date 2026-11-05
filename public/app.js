const $ = (id) => document.getElementById(id);
let sessionData = null, selectedMember = null, roles = [];
const pageNames = {overview:"Overview",rank:"Ranking",members:"Members",logs:"Ranking Logs",sessions:"Sessions",activity:"Activity",punishments:"Punishments",promotions:"Promotion Suggestions",leaves:"Time Off",settings:"Settings"};
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
  if(page==="sessions") loadSessions();\n  if(page==="activity") loadManagement("activity");\n  if(page==="punishments") loadManagement("punishments");\n  if(page==="promotions") loadManagement("promotions");\n  if(page==="leaves") loadManagement("leaves");
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.go)));
$("themeToggle").addEventListener("click",()=>{
  const dark=document.body.classList.toggle("dark");
  $("themeIcon").textContent=dark?"☀":"☾"; $("themeText").textContent=dark?"Light mode":"Dark mode";
  try{localStorage.setItem("lemonz-theme",dark?"dark":"light")}catch{}
});
try { if(localStorage.getItem("lemonz-theme")==="dark"){document.body.classList.add("dark");$("themeIcon").textContent="☀";$("themeText").textContent="Light mode";}}catch{}
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
async function directorySearch(){
  const name=$("directorySearch").value.trim();if(!name)return;
  $("directoryButton").disabled=true;
  try{
    const d=await api("/api/member/"+encodeURIComponent(name));
    $("directoryResult").innerHTML=`<table class="data-table"><thead><tr><th>USERNAME</th><th>DISPLAY NAME</th><th>GROUP ROLE</th><th>RANK</th></tr></thead><tbody><tr><td>${escapeHtml(d.user.name)}</td><td>${escapeHtml(d.user.displayName)}</td><td>${escapeHtml(d.role?.name||"—")}</td><td>${d.role?.rank??"—"}</td></tr></tbody></table>`;
  }catch(e){$("directoryResult").textContent=e.message}
  finally{$("directoryButton").disabled=false}
}
$("directoryButton").addEventListener("click",directorySearch);$("directorySearch").addEventListener("keydown",e=>{if(e.key==="Enter")directorySearch()});
function formatDate(s){try{return new Date(s).toLocaleString()}catch{return s||"—"}}
async function loadLogs(){
  $("logsTable").textContent="Loading logs…";
  try{
    const d=await api("/api/logs");
    $("recentCount").textContent=d.logs.length;
    if(!d.logs.length){$("logsTable").textContent="No ranking actions have been recorded yet.";return}
    $("logsTable").innerHTML=`<table class="data-table"><thead><tr><th>DATE</th><th>RANKED BY</th><th>MEMBER</th><th>CHANGE</th><th>ACTION</th><th>STATUS</th></tr></thead><tbody>${d.logs.map(l=>`<tr><td>${escapeHtml(formatDate(l.created_at))}</td><td>${escapeHtml(l.actor_name)}</td><td>${escapeHtml(l.target_name)}</td><td>${escapeHtml(l.previous_role||"—")} → ${escapeHtml(l.new_role||"—")}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.status)}</td></tr>`).join("")}</tbody></table>`;
  }catch(e){$("logsTable").textContent=e.message}
}
$("refreshLogs").addEventListener("click",loadLogs);

async function loadManagementSettings(){
  try{
    const d=await api("/api/management/settings");
    const map={activity_view_rank:"activityViewRank",activity_edit_rank:"activityEditRank",punishment_view_rank:"punishmentViewRank",punishment_add_rank:"punishmentAddRank",punishment_request_rank:"punishmentRequestRank",punishment_approve_rank:"punishmentApproveRank",promotion_suggest_rank:"promotionSuggestRank",promotion_approve_rank:"promotionApproveRank",leave_approve_rank:"leaveApproveRank"};
    Object.entries(map).forEach(([key,id])=>$(id).value=d.settings[key]);
  }catch(e){if(!e.message.includes("Only the group owner"))notice(e.message,"error")}
}
$("saveManagementSettings").addEventListener("click",async()=>{
  const btn=$("saveManagementSettings");btn.disabled=true;btn.textContent="Saving…";
  try{
    const map={activity_view_rank:"activityViewRank",activity_edit_rank:"activityEditRank",punishment_view_rank:"punishmentViewRank",punishment_add_rank:"punishmentAddRank",punishment_request_rank:"punishmentRequestRank",punishment_approve_rank:"punishmentApproveRank",promotion_suggest_rank:"promotionSuggestRank",promotion_approve_rank:"promotionApproveRank",leave_approve_rank:"leaveApproveRank"};
    const values={};Object.entries(map).forEach(([key,id])=>values[key]=Number($(id).value));
    await api("/api/management/settings",{method:"PUT",body:JSON.stringify(values)});
    notice("Management permissions saved.","success");
  }catch(e){notice(e.message,"error")}
  finally{btn.disabled=false;btn.textContent="Save management permissions"}
});

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
  if(item.status!=="PENDING"||rank<Number(settings[field]))return "";
  return `<button class="quiet-btn" data-decision="${type}" data-id="${item.id}" data-status="APPROVED">Approve</button> <button class="quiet-btn" data-decision="${type}" data-id="${item.id}" data-status="REJECTED">Reject</button>`;
}
async function loadManagement(tab){
  if(tab==="activity"){
    $("activityTable").textContent="Loading activity…";
    try{
      const d=await api("/api/management/activity");
      $("activityAdjustCard").classList.toggle("hidden",!d.canEdit);
      $("activityTable").innerHTML=d.members.length?`<table class="data-table"><thead><tr><th>USERNAME</th><th>USER ID</th><th>TOTAL TIME</th><th>SESSIONS</th><th>LAST SEEN</th></tr></thead><tbody>${d.members.map(m=>`<tr><td>${escapeHtml(m.username)}</td><td>${escapeHtml(m.user_id)}</td><td>${Math.floor(Number(m.seconds)/3600)}h ${Math.floor(Number(m.seconds)%3600/60)}m</td><td>${m.sessions}</td><td>${escapeHtml(formatDate(m.last_seen))}</td></tr>`).join("")}</tbody></table>`:"No completed game sessions yet.";
    }catch(e){$("activityTable").textContent=e.message}
  }
  if(tab==="punishments"){
    $("punishmentTable").textContent="Loading records…";
    try{
      const d=await api("/api/management/punishments");
      $("punishmentTable").innerHTML=d.items.length?`<table class="data-table"><thead><tr><th>MEMBER</th><th>TYPE</th><th>REASON</th><th>STATUS</th><th>SUBMITTED BY</th><th>ACTION</th></tr></thead><tbody>${d.items.map(i=>`<tr><td>${escapeHtml(i.username)}</td><td>${escapeHtml(i.type)} ${escapeHtml(i.duration||"")}</td><td>${escapeHtml(i.reason)}</td><td>${escapeHtml(i.status)}</td><td>${escapeHtml(i.created_by_name)}</td><td>${actionButtons("punishment",i,d.rank,d.settings)}</td></tr>`).join("")}</tbody></table>`:"No punishment records yet.";
    }catch(e){$("punishmentTable").textContent=e.message}
  }
  if(tab==="promotions"){
    $("promotionTable").textContent="Loading suggestions…";
    try{
      const d=await api("/api/management/promotions");
      $("promotionTable").innerHTML=d.items.length?`<table class="data-table"><thead><tr><th>MEMBER</th><th>SUGGESTED ROLE</th><th>REASON</th><th>STATUS</th><th>SUGGESTED BY</th><th>ACTION</th></tr></thead><tbody>${d.items.map(i=>`<tr><td>${escapeHtml(i.username)}</td><td>${escapeHtml(i.suggested_role)}</td><td>${escapeHtml(i.reason)}</td><td>${escapeHtml(i.status)}</td><td>${escapeHtml(i.suggested_by_name)}</td><td>${actionButtons("promotion",i,d.rank,d.settings)}</td></tr>`).join("")}</tbody></table>`:"No promotion suggestions yet.";
    }catch(e){$("promotionTable").textContent=e.message}
  }
  if(tab==="leaves"){
    $("leaveRoblox").value=sessionData?.user?.name||"";
    $("leaveTable").textContent="Loading requests…";
    try{
      const d=await api("/api/management/leaves");
      $("leaveTable").innerHTML=d.items.length?`<table class="data-table"><thead><tr><th>DISCORD USERNAME</th><th>ROBLOX USERNAME</th><th>START DATE</th><th>END DATE</th><th>REASON</th><th>LAST LEAVE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${d.items.map(i=>`<tr><td>${escapeHtml(i.discord_username)}</td><td>${escapeHtml(i.roblox_username)}</td><td>${dateOnly(i.start_date)}</td><td>${dateOnly(i.end_date)}</td><td>${escapeHtml(i.reason)}</td><td>${dateOnly(i.last_leave_at)}</td><td>${escapeHtml(i.status)}</td><td>${actionButtons("leave",i,d.rank,d.settings)}</td></tr>`).join("")}</tbody></table>`:"No time-off requests yet.";
    }catch(e){$("leaveTable").textContent=e.message}
  }
}
$("refreshActivity").addEventListener("click",()=>loadManagement("activity"));
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
  const b=e.target.closest("[data-decision]");if(!b)return;
  const type=b.dataset.decision,id=b.dataset.id,status=b.dataset.status;
  const route=type==="punishment"?"punishments":type==="promotion"?"promotions":"leaves";
  try{
    await api(`/api/management/${route}/${encodeURIComponent(id)}/decision`,{method:"POST",body:JSON.stringify({status})});
    notice(`${type[0].toUpperCase()+type.slice(1)} ${status.toLowerCase()}.`,"success");loadManagement(route);
  }catch(err){notice(err.message,"error")}
});


let staffDirectory=[], calendarCursor=new Date();
async function loadStaffDirectory(){
  const d=await api("/api/staff");staffDirectory=d.members||[];
  const configs=[["sessionHost","Choose host…",false],["sessionCoHost","No co-host",false],["sessionOversee","Choose oversee…",true],["sessionPromoter","Choose promoter…",true],["sessionAttendees","",false]];
  configs.forEach(([id,placeholder,senior])=>{const el=$(id);if(!el)return;el.innerHTML=(placeholder?'<option value="">'+placeholder+'</option>':'')+staffDirectory.filter(m=>!senior||m.rank>=245).map(m=>'<option value="'+escapeHtml(m.id)+'">'+escapeHtml(m.username)+' — '+escapeHtml(m.role)+' (Rank '+m.rank+')</option>').join("");});
  const dl=document.getElementById("staffSuggestions")||document.createElement("datalist");dl.id="staffSuggestions";dl.innerHTML=staffDirectory.map(m=>'<option value="'+escapeHtml(m.username)+'"></option>').join("");document.body.appendChild(dl);
  ["punishUsername","promotionUsername","activityUsername"].forEach(id=>{const el=$(id);if(el)el.setAttribute("list","staffSuggestions");});
}
function calendarMonthKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}
function drawSessionsCalendar(items){
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),first=new Date(y,m,1),offset=first.getDay(),days=new Date(y,m+1,0).getDate(),cells=[];
  for(let i=0;i<offset;i++)cells.push('<div class="calendar-day outside"></div>');
  for(let day=1;day<=days;day++){const date=y+"-"+String(m+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");const events=items.filter(s=>String(s.session_date).slice(0,10)===date);cells.push('<div class="calendar-day"><b>'+day+'</b>'+events.map(s=>'<div class="calendar-event">'+escapeHtml(s.title)+' · '+escapeHtml(String(s.session_time||"").slice(0,5))+'</div>').join("")+'</div>');}
  $("sessionsCalendar").innerHTML='<div class="calendar-weekdays">'+["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>'<b>'+d+'</b>').join("")+'</div><div class="calendar-grid">'+cells.join("")+'</div>';
}
async function loadSessions(){
  try{if(!staffDirectory.length)await loadStaffDirectory();const d=await api("/api/sessions");const items=(d.sessions||[]).filter(s=>String(s.session_date).slice(0,7)===calendarMonthKey(calendarCursor));$("calendarMonth").textContent=calendarCursor.toLocaleDateString(undefined,{month:"long",year:"numeric"});drawSessionsCalendar(items);$("sessionList").innerHTML=(d.sessions||[]).length?'<table class="data-table"><thead><tr><th>DATE</th><th>SESSION</th><th>TIME</th><th>HOST</th><th>CO-HOST</th><th>OVERSEE</th><th>PROMOTER</th><th>ATTENDEES</th></tr></thead><tbody>'+d.sessions.map(s=>'<tr><td>'+escapeHtml(String(s.session_date).slice(0,10))+'</td><td>'+escapeHtml(s.title)+'</td><td>'+escapeHtml(String(s.session_time||"").slice(0,5))+'</td><td>'+escapeHtml(s.host_name)+'</td><td>'+escapeHtml(s.cohost_name||"—")+'</td><td>'+escapeHtml(s.oversee_name||"—")+'</td><td>'+escapeHtml(s.promoter_name||"—")+'</td><td>'+escapeHtml((s.attendee_names||[]).join(", "))+'</td></tr>').join("")+'</tbody></table>':'No sessions scheduled yet.';}catch(e){$("sessionList").textContent=e.message;}
}
$("calendarPrev").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);loadSessions();});
$("calendarNext").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);loadSessions();});
$("createSession").addEventListener("click",async()=>{
 const attendees=[...$("sessionAttendees").selectedOptions].map(o=>o.value).filter(Boolean);
 const body={title:$("sessionTitle").value.trim(),date:$("sessionDate").value,time:$("sessionTime").value,hostId:$("sessionHost").value,cohostId:$("sessionCoHost").value,overseeId:$("sessionOversee").value,promoterId:$("sessionPromoter").value,attendeeIds:attendees};
 const btn=$("createSession");btn.disabled=true;
 try{await api("/api/sessions",{method:"POST",body:JSON.stringify(body)});notice("Session created.","success");$("sessionTitle").value="";loadSessions();}catch(e){notice(e.message,"error");}finally{btn.disabled=false;}
});


// Keep staff suggestions synchronized with the ID fields used by staff forms.
document.addEventListener("change",e=>{
 const pair={punishUsername:"punishUserId",promotionUsername:"promotionUserId",activityUsername:"activityUserId"};
 const idField=pair[e.target.id];if(!idField)return;
 const match=staffDirectory.find(m=>m.username.toLowerCase()===e.target.value.trim().toLowerCase());
 if(match)$(idField).value=match.id;
});
