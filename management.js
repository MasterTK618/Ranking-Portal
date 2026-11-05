const express = require("express");

function createManagementRouter({ pool, getIdentity, requireLogin, csrf, requireGameSecret }) {
  const router = express.Router();
  const defaults = {
    activity_view_rank:238, activity_edit_rank:245,
    punishment_view_rank:238, punishment_add_rank:245, punishment_request_rank:1, punishment_approve_rank:249,
    promotion_suggest_rank:238, promotion_approve_rank:249, leave_approve_rank:245, knowledge_manage_rank:245, session_create_rank:238, session_delete_rank:245, task_view_rank:238, task_manage_rank:245, session_approve_rank:245, session_status_rank:245
  };
  const columns = Object.keys(defaults);
  async function settings() {
    const r = await pool.query("SELECT * FROM management_settings WHERE id=1");
    return r.rows[0] || defaults;
  }
  async function writeAudit(action, item, actorId, actorName, details="") {
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES('PUNISHMENT',$1,$2,$3,$4,$5,$6)",
      [action,String(item?.id||""),String(item?.username||""),String(details||"").slice(0,1000),String(actorId||""),String(actorName||"")]);
  }
  async function identity(req) {
    if (!req.session.user) return null;
    return getIdentity(req.session.user.id);
  }
  async function gate(req, res, field) {
    const who = await identity(req);
    const s = await settings();
    if (!who || who.rank < Number(s[field])) {
      res.status(403).json({ error: "Your Lemonz rank does not have permission for this action." });
      return null;
    }
    req.identity = who;
    return who;
  }
  router.post("/activity/event", requireGameSecret, async (req,res,next) => {
    try {
      const {event,userId,username,jobId}=req.body||{};
      if(!["join","leave"].includes(event)||!/^\d+$/.test(String(userId||""))||!String(username||"").trim())
        return res.status(400).json({error:"Invalid activity event."});
      const key=String(jobId||"unknown")+":"+String(userId);
      if(event==="join") {
        await pool.query(
          "INSERT INTO activity_sessions(session_key,user_id,username,started_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(session_key) DO UPDATE SET username=EXCLUDED.username,started_at=NOW(),ended_at=NULL,seconds=0",
          [key,String(userId),String(username).slice(0,40)]
        );
      } else {
        await pool.query(
          "UPDATE activity_sessions SET ended_at=NOW(),seconds=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-started_at))::INTEGER) WHERE session_key=$1 AND ended_at IS NULL",
          [key]
        );
      }
      res.json({ok:true});
    } catch(e){next(e);}
  });
  router.use(requireLogin);
  router.get("/settings", async (req,res,next) => {
    try {
      const who=await identity(req);
      if (!who || who.rank<255) return res.status(403).json({error:"Only the group owner can view management permissions."});
      res.json({settings:await settings()});
    } catch(e){next(e);}
  });
  router.put("/settings", csrf, async (req,res,next) => {
    try {
      const who=await identity(req);
      if (!who || who.rank<255) return res.status(403).json({error:"Only the group owner can change management permissions."});
      const values=columns.map(k=>Number(req.body?.[k]));
      if(values.some(v=>!Number.isInteger(v)||v<1||v>255)) return res.status(400).json({error:"Every permission must be a whole rank from 1 to 255."});
      const sets=columns.map((k,i)=>k+"=$"+(i+1)).join(",");
      const result=await pool.query("UPDATE management_settings SET "+sets+",updated_at=NOW() WHERE id=1 RETURNING *",values);
      res.json({ok:true,settings:result.rows[0]});
    } catch(e){next(e);}
  });


  // Teams and departments are owner-managed. A team belongs to a department; staff can be assigned to one team.
  router.get("/teams",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const teams=await pool.query("SELECT t.*,COUNT(tm.user_id)::INTEGER AS member_count FROM management_teams t LEFT JOIN management_team_members tm ON tm.team_id=t.id GROUP BY t.id ORDER BY t.department,t.name");
    const members=await pool.query("SELECT user_id,team_id FROM management_team_members");
    res.json({teams:teams.rows,members:members.rows,canManage:Number(who.rank)>=255});
  }catch(e){next(e);}});
  router.post("/teams",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can manage teams and departments."});
    const b=req.body||{},name=String(b.name||"").trim(),department=String(b.department||"").trim(),description=String(b.description||"").trim(),color=String(b.color||"#f5c928"),groupRoleRank=b.groupRoleRank==null||b.groupRoleRank===""?null:Number(b.groupRoleRank);
    if(name.length<2||name.length>60||department.length<2||department.length>60||description.length>300||!/^#[0-9a-fA-F]{6}$/.test(color)||(groupRoleRank!==null&&(!Number.isInteger(groupRoleRank)||groupRoleRank<1||groupRoleRank>255)))return res.status(400).json({error:"Check the team name, department, description, color, and optional group-role rank."});
    const r=await pool.query("INSERT INTO management_teams(name,department,description,color,group_role_rank,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[name,department,description,color,groupRoleRank,String(req.session.user.id)]);
    res.json({ok:true,team:r.rows[0]});
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"That team already exists in this department."});next(e);}});
  router.put("/teams/:id",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can manage teams and departments."});
    const b=req.body||{},name=String(b.name||"").trim(),department=String(b.department||"").trim(),description=String(b.description||"").trim(),color=String(b.color||"#f5c928"),groupRoleRank=b.groupRoleRank==null||b.groupRoleRank===""?null:Number(b.groupRoleRank);
    if(name.length<2||name.length>60||department.length<2||department.length>60||description.length>300||!/^#[0-9a-fA-F]{6}$/.test(color)||(groupRoleRank!==null&&(!Number.isInteger(groupRoleRank)||groupRoleRank<1||groupRoleRank>255)))return res.status(400).json({error:"Check the team name, department, description, color, and optional group-role rank."});
    const r=await pool.query("UPDATE management_teams SET name=$1,department=$2,description=$3,color=$4,group_role_rank=$5,updated_at=NOW() WHERE id=$6 RETURNING *",[name,department,description,color,groupRoleRank,req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:"Team not found."});res.json({ok:true,team:r.rows[0]});
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"That team already exists in this department."});next(e);}});
  router.put("/teams/member/:userId",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can assign staff to teams."});
    const userId=String(req.params.userId);if(!/^\\d+$/.test(userId))return res.status(400).json({error:"Invalid Roblox user ID."});
    const teamId=req.body?.teamId==null||req.body.teamId===""?null:String(req.body.teamId);
    if(teamId!==null){const team=await pool.query("SELECT id FROM management_teams WHERE id=$1",[teamId]);if(!team.rowCount)return res.status(404).json({error:"Team not found."});}
    await pool.query("DELETE FROM management_team_members WHERE user_id=$1",[userId]);
    if(teamId!==null)await pool.query("INSERT INTO management_team_members(user_id,team_id,assigned_by) VALUES($1,$2,$3)",[userId,teamId,String(req.session.user.id)]);
    res.json({ok:true,userId,teamId});
  }catch(e){next(e);}});
  router.put("/teams/:id/members",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can assign staff to teams."});
    const ids=Array.isArray(req.body?.userIds)?[...new Set(req.body.userIds.map(String).filter(x=>/^\d+$/.test(x)))]:[];
    const team=await pool.query("SELECT id FROM management_teams WHERE id=$1",[req.params.id]);if(!team.rowCount)return res.status(404).json({error:"Team not found."});
    await pool.query("DELETE FROM management_team_members WHERE team_id=$1",[req.params.id]);
    for(const id of ids)await pool.query("INSERT INTO management_team_members(user_id,team_id,assigned_by) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET team_id=EXCLUDED.team_id,assigned_by=EXCLUDED.assigned_by,assigned_at=NOW()",[id,req.params.id,String(req.session.user.id)]);
    res.json({ok:true,assigned:ids.length});
  }catch(e){next(e);}});
  router.delete("/teams/:id",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can manage teams and departments."});
    const r=await pool.query("DELETE FROM management_teams WHERE id=$1 RETURNING id",[req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Team not found."});res.json({ok:true});
  }catch(e){next(e);}});
  router.get("/knowledge",async(req,res,next)=>{try{
    const who=await identity(req);const r=await pool.query("SELECT k.id,k.title,k.kind,k.url,k.content,k.min_rank,k.category,k.team_id,t.name AS team_name,t.department AS team_department,k.created_by_name,k.updated_by_name,k.created_at,k.updated_at FROM knowledge_hub_items k LEFT JOIN management_teams t ON t.id=k.team_id WHERE k.min_rank <= $1 AND (k.team_id IS NULL OR EXISTS(SELECT 1 FROM management_team_members tm WHERE tm.team_id=k.team_id AND tm.user_id=$2) OR $3=TRUE) ORDER BY k.category,k.title",[who?.rank||0,String(req.session.user.id),Number(who?.rank||0)>=255]);
    res.json({items:r.rows,rank:who?.rank||0,canManage:(who?.rank||0)>=Number((await settings()).knowledge_manage_rank)});
  }catch(e){next(e);}});
  router.post("/knowledge",csrf,async(req,res,next)=>{try{
    const who=await gate(req,res,"knowledge_manage_rank");if(!who)return;
    const b=req.body||{},title=String(b.title||"").trim(),kind=String(b.kind||"document"),category=String(b.category||"General").trim().slice(0,50),content=String(b.content||"").trim(),url=String(b.url||"").trim(),minRank=Number(b.minRank||1),teamId=b.teamId==null||b.teamId===""?null:Number(b.teamId);
    if(!title||title.length>120||!["link","document"].includes(kind)||!Number.isInteger(minRank)||minRank<1||minRank>255||!content||content.length>30000||(teamId!==null&&(!Number.isInteger(teamId)||teamId<1)))return res.status(400).json({error:"Enter a title, valid type, content, rank, and team."});
    if(kind==="link"){try{const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol))throw new Error();}catch{return res.status(400).json({error:"Enter a valid http or https link."});}}
    const r=await pool.query("INSERT INTO knowledge_hub_items(title,kind,url,content,min_rank,category,team_id,created_by,created_by_name,updated_by,updated_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$9) RETURNING *",[title,kind,kind==="link"?url:null,content,minRank,category,teamId,String(req.session.user.id),req.session.user.name]);
    res.json({ok:true,item:r.rows[0]});
  }catch(e){next(e);}});
  router.put("/knowledge/:id",csrf,async(req,res,next)=>{try{
    const who=await gate(req,res,"knowledge_manage_rank");if(!who)return;
    const b=req.body||{},title=String(b.title||"").trim(),kind=String(b.kind||"document"),category=String(b.category||"General").trim().slice(0,50),content=String(b.content||"").trim(),url=String(b.url||"").trim(),minRank=Number(b.minRank||1),teamId=b.teamId==null||b.teamId===""?null:Number(b.teamId);
    if(!title||title.length>120||!["link","document"].includes(kind)||!Number.isInteger(minRank)||minRank<1||minRank>255||!content||content.length>30000||(teamId!==null&&(!Number.isInteger(teamId)||teamId<1)))return res.status(400).json({error:"Enter a title, valid type, content, rank, and team."});
    if(kind==="link"){try{const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol))throw new Error();}catch{return res.status(400).json({error:"Enter a valid http or https link."});}}
    const r=await pool.query("UPDATE knowledge_hub_items SET title=$1,kind=$2,url=$3,content=$4,min_rank=$5,category=$6,team_id=$7,updated_by=$8,updated_by_name=$9,updated_at=NOW() WHERE id=$10 RETURNING *",[title,kind,kind==="link"?url:null,content,minRank,category,teamId,String(req.session.user.id),req.session.user.name,req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:"Knowledge item not found."});res.json({ok:true,item:r.rows[0]});
  }catch(e){next(e);}});
  router.delete("/knowledge/:id",csrf,async(req,res,next)=>{try{
    const who=await gate(req,res,"knowledge_manage_rank");if(!who)return;
    const r=await pool.query("DELETE FROM knowledge_hub_items WHERE id=$1 RETURNING id",[req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Knowledge item not found."});res.json({ok:true});
  }catch(e){next(e);}});
  router.get("/tasks",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const s=await settings();if(Number(who.rank)<Number(s.task_view_rank))return res.status(403).json({error:"Your rank cannot access staff tasks."});
    const r=await pool.query("SELECT t.*,mt.id AS assigned_team_id,mt.name AS assigned_team_name,mt.department AS assigned_department FROM management_tasks t LEFT JOIN management_team_members tm ON tm.user_id=t.assigned_to_id LEFT JOIN management_teams mt ON mt.id=tm.team_id ORDER BY CASE t.status WHEN $1 THEN 0 WHEN $2 THEN 1 WHEN $3 THEN 2 ELSE 3 END,t.due_date NULLS LAST,t.created_at DESC",["OPEN","IN_PROGRESS","BLOCKED"]);
    res.json({items:r.rows.map(x=>({...x,canUpdate:String(x.assigned_to_id)===String(req.session.user.id)||String(x.created_by)===String(req.session.user.id)||Number(who.rank)>=Number(s.task_manage_rank),canDelete:String(x.created_by)===String(req.session.user.id)||Number(who.rank)>=Number(s.task_manage_rank)})),rank:Number(who.rank),settings:s,canManage:Number(who.rank)>=Number(s.task_manage_rank)});
  }catch(e){next(e);}});
  router.get("/tasks/audit",async(req,res,next)=>{try{const who=await gate(req,res,"task_manage_rank");if(!who)return;const r=await pool.query("SELECT * FROM management_audit_logs WHERE category=$1 ORDER BY created_at DESC LIMIT 200",["TASK"]);res.json({items:r.rows});}catch(e){next(e);}});
  router.post("/tasks",csrf,async(req,res,next)=>{try{
    const who=await gate(req,res,"task_view_rank");if(!who)return;const b=req.body||{},title=String(b.title||"").trim(),description=String(b.description||"").trim(),assignedToId=String(b.assignedToId||""),priority=String(b.priority||"NORMAL"),dueDate=String(b.dueDate||"");
    if(!title||title.length>120||description.length>2000||!/^\d+$/.test(assignedToId)||!["LOW","NORMAL","HIGH","URGENT"].includes(priority))return res.status(400).json({error:"Enter a task title, assigned staff member, and valid priority."});
    const dueDateValue=dueDate?new Date(dueDate+"T00:00:00.000Z"):null;if(dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||Number.isNaN(dueDateValue.getTime())||dueDateValue.toISOString().slice(0,10)!==dueDate))return res.status(400).json({error:"Choose a valid due date."});
    const assigned=await getIdentity(assignedToId);if(!assigned?.inGroup||Number(assigned.rank)<Number((await settings()).task_view_rank))return res.status(400).json({error:"Assign the task to a staff member who can access the task board."});
    const profile=await fetch("https://users.roblox.com/v1/users/"+encodeURIComponent(assignedToId));const user=await profile.json().catch(()=>({}));const assignedName=user.name||assignedToId;
    const r=await pool.query("INSERT INTO management_tasks(title,description,assigned_to_id,assigned_to_name,priority,due_date,created_by,created_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[title,description,assignedToId,assignedName,priority,dueDate||null,String(req.session.user.id),req.session.user.name]);
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["TASK","CREATED",assignedToId,assignedName,"Task #"+r.rows[0].id+" | "+title,String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true,item:r.rows[0]});
  }catch(e){next(e);}});
  router.patch("/tasks/:id/status",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const status=String(req.body?.status||"");if(!["OPEN","IN_PROGRESS","BLOCKED","COMPLETED"].includes(status))return res.status(400).json({error:"Choose a valid task status."});
    const s=await settings(),found=await pool.query("SELECT * FROM management_tasks WHERE id=$1",[req.params.id]);if(!found.rowCount)return res.status(404).json({error:"Task not found."});const task=found.rows[0];
    if(String(task.assigned_to_id)!==String(req.session.user.id)&&String(task.created_by)!==String(req.session.user.id)&&Number(who.rank)<Number(s.task_manage_rank))return res.status(403).json({error:"Only the assigned staff member, task creator, or a task manager can update this task."});
    const r=await pool.query("UPDATE management_tasks SET status=$1,updated_at=NOW(),completed_at=CASE WHEN $1=$2 THEN NOW() ELSE NULL END WHERE id=$3 RETURNING *",[status,"COMPLETED",req.params.id]);
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["TASK",status,r.rows[0].assigned_to_id,r.rows[0].assigned_to_name,"Task #"+r.rows[0].id+" | "+r.rows[0].title,String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true,item:r.rows[0]});
  }catch(e){next(e);}});
  router.delete("/tasks/:id",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const s=await settings(),found=await pool.query("SELECT * FROM management_tasks WHERE id=$1",[req.params.id]);if(!found.rowCount)return res.status(404).json({error:"Task not found."});const task=found.rows[0];
    if(String(task.created_by)!==String(req.session.user.id)&&Number(who.rank)<Number(s.task_manage_rank))return res.status(403).json({error:"Only the task creator or a task manager can delete this task."});
    await pool.query("DELETE FROM management_tasks WHERE id=$1",[req.params.id]);await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["TASK","DELETED",task.assigned_to_id,task.assigned_to_name,"Task #"+task.id+" | "+task.title,String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true});
  }catch(e){next(e);}});
  router.get("/session-requests",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const cfg=await settings(),canReview=Number(who.rank)>=Number(cfg.session_approve_rank);
    const result=canReview?await pool.query("SELECT * FROM session_requests ORDER BY created_at DESC LIMIT 300"):await pool.query("SELECT * FROM session_requests WHERE requested_by=$1 ORDER BY created_at DESC LIMIT 100",[String(req.session.user.id)]);
    res.json({items:result.rows.map(x=>({...x,canCancel:x.status==="PENDING"&&(String(x.requested_by)===String(req.session.user.id)||canReview)})),canReview,rank:Number(who.rank),settings:cfg});
  }catch(e){next(e);}});
  router.post("/session-requests",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const b=req.body||{},type=String(b.sessionType||""),title=String(b.title||"").trim(),details=String(b.details||"").trim(),date=String(b.preferredDate||""),time=String(b.preferredTime||"");
    if(!["PROMOTIONAL","RECRUITMENT","MINI_GAMES"].includes(type)||title.length<3||title.length>100||details.length<10||details.length>2000)return res.status(400).json({error:"Choose a session type, enter a clear title, and provide at least 10 characters of details."});
    const parsedPreferredDate=date?new Date(date+"T00:00:00.000Z"):null;if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsedPreferredDate.getTime())||parsedPreferredDate.toISOString().slice(0,10)!==date))return res.status(400).json({error:"Choose a valid preferred date."});if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return res.status(400).json({error:"Choose a valid preferred time."});
    const result=await pool.query("INSERT INTO session_requests(session_type,title,details,preferred_date,preferred_time,requested_by,requested_by_name) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[type,title,details,date||null,time||null,String(req.session.user.id),String(req.session.user.name)]);
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION","REQUESTED",String(req.session.user.id),String(req.session.user.name),"Request #"+result.rows[0].id+" | "+type+" | "+title,String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true,item:result.rows[0]});
  }catch(e){next(e);}});
  router.post("/session-requests/:id/decision",csrf,async(req,res,next)=>{try{
    const who=await gate(req,res,"session_approve_rank");if(!who)return;const status=String(req.body?.status||""),note=String(req.body?.note||"").trim().slice(0,500);if(!["APPROVED","REJECTED"].includes(status))return res.status(400).json({error:"Choose approve or reject."});if(status==="REJECTED"&&!note)return res.status(400).json({error:"Add a reason when declining a session request."});
    const result=await pool.query("UPDATE session_requests SET status=$1,reviewed_by=$2,reviewed_by_name=$3,review_note=$4,reviewed_at=NOW() WHERE id=$5 AND status='PENDING' RETURNING *",[status,String(req.session.user.id),String(req.session.user.name),note,req.params.id]);if(!result.rowCount)return res.status(404).json({error:"Pending session request not found."});
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION",status,String(result.rows[0].requested_by),result.rows[0].requested_by_name,"Request #"+result.rows[0].id+" | "+result.rows[0].session_type+" | "+result.rows[0].title+(note?" | "+note:""),String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true,item:result.rows[0]});
  }catch(e){next(e);}});
  router.delete("/session-requests/:id",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const cfg=await settings(),canManage=Number(who.rank)>=Number(cfg.session_approve_rank);
    const result=await pool.query("DELETE FROM session_requests WHERE id=$1 AND status='PENDING' AND (requested_by=$2 OR $3=TRUE) RETURNING *",[req.params.id,String(req.session.user.id),canManage]);
    if(!result.rowCount)return res.status(403).json({error:"Only the requester or an authorized reviewer can cancel a pending session request."});
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION","REQUEST_CANCELED",String(result.rows[0].requested_by),result.rows[0].requested_by_name,"Request #"+result.rows[0].id+" | "+result.rows[0].title,String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true});
  }catch(e){next(e);}});
  router.get("/session-requests/audit",async(req,res,next)=>{try{const who=await gate(req,res,"session_approve_rank");if(!who)return;const result=await pool.query("SELECT * FROM management_audit_logs WHERE category='SESSION' ORDER BY created_at DESC LIMIT 300");res.json({items:result.rows});}catch(e){next(e);}});
  router.patch("/sessions/:id/status",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const status=String(req.body?.status||""),note=String(req.body?.note||"").trim().slice(0,500);if(!["PLANNED","ONGOING","DELAYED","CANCELED","COMPLETED"].includes(status))return res.status(400).json({error:"Choose a valid session status."});
    const cfg=await settings(),found=await pool.query("SELECT * FROM staff_shifts WHERE id=$1",[req.params.id]);if(!found.rowCount)return res.status(404).json({error:"Session not found."});const current=found.rows[0];if(String(current.created_by)!==String(req.session.user.id)&&Number(who.rank)<Number(cfg.session_status_rank))return res.status(403).json({error:"You cannot update this session."});
    const result=await pool.query("UPDATE staff_shifts SET status=$1,status_note=$2,updated_at=NOW() WHERE id=$3 RETURNING *",[status,note,req.params.id]);await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION",status,String(current.id),current.title,"Session #"+current.id+" | "+current.title+(note?" | "+note:""),String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true,session:result.rows[0]});
  }catch(e){next(e);}});
  router.get("/sessions",async(req,res,next)=>{try{
    let who=null;try{who=await identity(req);}catch{}const cfg=await settings();const result=await pool.query("SELECT sh.*,tm.id AS host_team_id,tm.name AS host_team_name,tm.department AS host_department FROM staff_shifts sh LEFT JOIN management_team_members tmem ON tmem.user_id=sh.host_id LEFT JOIN management_teams tm ON tm.id=tmem.team_id ORDER BY sh.session_date NULLS LAST,sh.session_time NULLS LAST,sh.created_at DESC");
    res.json({canCreate:Number(who?.rank||0)>=Number(cfg.session_create_rank),sessions:result.rows.map(row=>({...row,canDelete:String(row.created_by)===String(req.session.user.id)||Number(who?.rank||0)>=Number(cfg.session_delete_rank),canUpdate:String(row.created_by)===String(req.session.user.id)||Number(who?.rank||0)>=Number(cfg.session_status_rank)}))});
  }catch(e){next(e);}});
  router.post("/sessions",csrf,async(req,res,next)=>{try{
    const allowed=await gate(req,res,"session_create_rank");if(!allowed)return;
    const b=req.body||{},title=String(b.title||"").trim(),date=String(b.date||""),time=String(b.time||"");
    const attendeeIds=Array.isArray(b.attendeeIds)?b.attendeeIds.map(String):[];
    const overseeIds=Array.isArray(b.overseeIds)?b.overseeIds.map(String):(b.overseeId?[String(b.overseeId)]:[]);
    const ids=[b.hostId,b.cohostId,b.promoterId,...overseeIds,...attendeeIds].filter(Boolean).map(String);
    const parsedSessionDate=new Date(date+"T00:00:00.000Z");if(!title||title.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsedSessionDate.getTime())||parsedSessionDate.toISOString().slice(0,10)!==date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!b.hostId)return res.status(400).json({error:"Enter a valid session name, date, time, and host."});
    if(new Set(ids).size!==ids.length)return res.status(400).json({error:"A staff member can only be assigned one role per shift."});
    const identities=await Promise.all(ids.map(async id=>({id,who:await getIdentity(id)})));
    if(identities.some(x=>!x.who.inGroup))return res.status(400).json({error:"Every selected person must be a current Lemonz member."});
    const ranks=new Map(identities.map(x=>[x.id,x.who.rank]));
    if(overseeIds.some(id=>Number(ranks.get(id)||0)<245))return res.status(400).json({error:"Every Oversee must be rank 245 or higher."});
    if(b.promoterId&&Number(ranks.get(String(b.promoterId))||0)<245)return res.status(400).json({error:"Promoter must be rank 245 or higher."});
    const names=await Promise.all(ids.map(async id=>{const response=await fetch("https://users.roblox.com/v1/users/"+encodeURIComponent(id));const user=await response.json().catch(()=>({}));return [id,user.name||id];}));
    const nameMap=Object.fromEntries(names),host=String(b.hostId),cohost=b.cohostId?String(b.cohostId):null,promoter=b.promoterId?String(b.promoterId):null;
    const result=await pool.query("INSERT INTO staff_shifts(title,session_date,session_time,host_id,host_name,cohost_id,cohost_name,oversee_id,oversee_name,oversee_ids,oversee_names,promoter_id,promoter_name,attendee_ids,attendee_names,created_by,session_type,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *",
      [title,date,time,host,nameMap[host],cohost,cohost?nameMap[cohost]:null,overseeIds[0]||null,overseeIds.map(id=>nameMap[id]).join(", ")||null,overseeIds,overseeIds.map(id=>nameMap[id]),promoter,promoter?nameMap[promoter]:null,attendeeIds,attendeeIds.map(id=>nameMap[id]),req.session.user.id,["PROMOTIONAL","RECRUITMENT","MINI_GAMES"].includes(String(b.sessionType||""))?String(b.sessionType):"PROMOTIONAL","PLANNED"]);
    res.json({ok:true,session:result.rows[0]});
  }catch(e){next(e);}});
  router.get("/members/:id", async(req,res,next)=>{
    try{
      const userId=String(req.params.id||"");
      if(!/^\d+$/.test(userId))return res.status(400).json({error:"Invalid staff member."});
      let who;
      try{who=await getIdentity(userId);}catch{}
      if(!who?.inGroup||who.rank<230){
        const groupResponse=await fetch("https://groups.roblox.com/v1/users/"+encodeURIComponent(userId)+"/groups/roles");
        const groupData=await groupResponse.json().catch(()=>({}));
        const groupRole=(groupData.data||[]).filter(item=>String(item.group?.id)===String(process.env.ROBLOX_GROUP_ID||"16597698")).map(item=>item.role||{}).sort((a,b)=>Number(b.rank||0)-Number(a.rank||0))[0];
        who={inGroup:!!groupRole,rank:Number(groupRole?.rank||0),roleName:groupRole?.name||"Not in group"};
      }
      if(!who.inGroup||who.rank<230)return res.status(404).json({error:"Staff member not found."});
      const profile=await fetch("https://users.roblox.com/v1/users/"+encodeURIComponent(userId));
      const user=await profile.json().catch(()=>({}));
      const thumb=await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds="+encodeURIComponent(userId)+"&size=150x150&format=Png&isCircular=true");
      const thumbData=await thumb.json().catch(()=>({}));
      const avatarUrl=thumbData.data?.[0]?.imageUrl||"";
      const sessions=await pool.query("SELECT * FROM staff_shifts WHERE host_id=$1 OR cohost_id=$1 OR promoter_id=$1 OR $1=ANY(attendee_ids) OR oversee_id=$1 OR $1=ANY(oversee_ids) ORDER BY session_date DESC NULLS LAST,session_time DESC NULLS LAST",[userId]);
      const punishments=await pool.query("SELECT type,reason,duration,status,created_by_name,created_at FROM management_punishments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[userId]);
      const activity=await pool.query("SELECT COALESCE(SUM(CASE WHEN ended_at IS NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (NOW()-started_at))::INTEGER) ELSE seconds END),0)::BIGINT + COALESCE((SELECT SUM(minutes)*60 FROM activity_adjustments WHERE user_id=$1),0) AS seconds,COUNT(*)::INTEGER AS sessions,MAX(COALESCE(ended_at,NOW())) AS last_seen FROM activity_sessions WHERE user_id=$1",[userId]);
      res.json({member:{id:userId,username:user.name||"Staff member",role:who.roleName,rank:who.rank,avatarUrl},sessions:sessions.rows.map(s=>({...s,member_role:s.host_id===userId?"Host":s.cohost_id===userId?"Co-Host":s.promoter_id===userId?"Promoter":(s.oversee_id===userId||(s.oversee_ids||[]).includes(userId))?"Oversee":"Attendee"})),punishments:punishments.rows,activity:activity.rows[0]});
    }catch(e){next(e);}
  });

  router.get("/activity",async(req,res,next)=>{try{
    const who=await identity(req);
    if(!who)return res.status(401).json({error:"Sign in first."});
    const s=await settings(),canViewAll=Number(who.rank)>=Number(s.activity_view_rank),userId=String(req.session.user.id);
    const activityResult=canViewAll
      ? await pool.query("SELECT user_id,MAX(username) AS username,SUM(CASE WHEN ended_at IS NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (NOW()-started_at))::INTEGER) ELSE seconds END)::BIGINT AS seconds,MAX(COALESCE(ended_at,NOW())) AS last_seen,COUNT(*)::INTEGER AS game_sessions FROM activity_sessions GROUP BY user_id")
      : await pool.query("SELECT user_id,MAX(username) AS username,SUM(CASE WHEN ended_at IS NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (NOW()-started_at))::INTEGER) ELSE seconds END)::BIGINT AS seconds,MAX(COALESCE(ended_at,NOW())) AS last_seen,COUNT(*)::INTEGER AS game_sessions FROM activity_sessions WHERE user_id=$1 GROUP BY user_id",[userId]);
    const adjustmentResult=canViewAll
      ? await pool.query("SELECT user_id,MAX(username) AS username,SUM(minutes*60)::BIGINT AS seconds FROM activity_adjustments GROUP BY user_id")
      : await pool.query("SELECT user_id,MAX(username) AS username,SUM(minutes*60)::BIGINT AS seconds FROM activity_adjustments WHERE user_id=$1 GROUP BY user_id",[userId]);
    const stats=new Map();
    for(const row of activityResult.rows)stats.set(String(row.user_id),{user_id:String(row.user_id),username:row.username,seconds:Number(row.seconds||0),last_seen:row.last_seen,game_sessions:Number(row.game_sessions||0)});
    for(const row of adjustmentResult.rows){const id=String(row.user_id),existing=stats.get(id)||{user_id:id,username:row.username,seconds:0,last_seen:null,game_sessions:0};existing.seconds+=Number(row.seconds||0);if(row.username)existing.username=row.username;stats.set(id,existing);}
    const shiftSql="SELECT person_id,COUNT(*)::INTEGER AS shifts_attended FROM (SELECT id AS shift_id,host_id AS person_id FROM staff_shifts WHERE host_id IS NOT NULL UNION SELECT id,cohost_id FROM staff_shifts WHERE cohost_id IS NOT NULL UNION SELECT id,promoter_id FROM staff_shifts WHERE promoter_id IS NOT NULL UNION SELECT id,unnest(oversee_ids) FROM staff_shifts WHERE cardinality(oversee_ids)>0 UNION SELECT id,unnest(attendee_ids) FROM staff_shifts WHERE cardinality(attendee_ids)>0) AS assigned_people WHERE ($1::TEXT IS NULL OR person_id=$1) GROUP BY person_id";
    const shiftResult=await pool.query(shiftSql,[canViewAll?null:userId]);
    const shiftCounts=new Map(shiftResult.rows.map(row=>[String(row.person_id),Number(row.shifts_attended||0)]));
    if(canViewAll)for(const [id,count] of shiftCounts){const existing=stats.get(id)||{user_id:id,username:id,seconds:0,last_seen:null,game_sessions:0};existing.shifts_attended=count;stats.set(id,existing);}
    if(!canViewAll&&!stats.has(userId))stats.set(userId,{user_id:userId,username:req.session.user.name||"You",seconds:0,last_seen:null,game_sessions:0});
    const members=[...stats.values()].map(row=>({...row,shifts_attended:shiftCounts.get(row.user_id)||0,rank:row.user_id===userId?Number(who.rank):null,role:row.user_id===userId?(who.roleName||"—"):"—"}));
    const adjustments=canViewAll
      ? await pool.query("SELECT user_id,username,minutes,reason,actor_name,created_at FROM activity_adjustments ORDER BY created_at DESC LIMIT 100")
      : {rows:[]};
    res.json({members,adjustments:adjustments.rows,canEdit:Number(who.rank)>=Number(s.activity_edit_rank),canViewAll});
  }catch(e){next(e);}});
  router.post("/activity/adjust", csrf, async (req,res,next) => {
    try {
      const who=await gate(req,res,"activity_edit_rank"); if(!who)return;
      const userId=String(req.body?.userId||""), username=String(req.body?.username||"").trim();
      const minutes=Number(req.body?.minutes), reason=String(req.body?.reason||"").trim();
      if(!/^\d+$/.test(userId)||!username||!Number.isInteger(minutes)||minutes===0||Math.abs(minutes)>100000||!reason)
        return res.status(400).json({error:"Enter a Roblox user ID, username, non-zero minutes, and reason."});
      await pool.query("INSERT INTO activity_adjustments(user_id,username,minutes,reason,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6)",
        [userId,username,minutes,reason,req.session.user.id,req.session.user.name]);
      res.json({ok:true});
    } catch(e){next(e);}
  });

  router.get("/punishments",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const s=await settings(),canViewAll=who.rank>=Number(s.punishment_view_rank);
    const r=canViewAll?await pool.query("SELECT * FROM management_punishments ORDER BY created_at DESC LIMIT 250"):await pool.query("SELECT * FROM management_punishments WHERE created_by=$1 ORDER BY created_at DESC LIMIT 100",[String(req.session.user.id)]);
    res.json({items:r.rows.map(x=>({...x,canDelete:String(x.created_by)===String(req.session.user.id)||who.rank>=Number(s.punishment_approve_rank)})),rank:who.rank,settings:s,canViewAll});
  }catch(e){next(e);}});
  router.get("/punishments/audit",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const s=await settings(),all=who.rank>=Number(s.punishment_view_rank);
    const r=all
      ? await pool.query("SELECT * FROM management_audit_logs WHERE category='PUNISHMENT' ORDER BY created_at DESC LIMIT 300")
      : await pool.query("SELECT * FROM management_audit_logs WHERE category='PUNISHMENT' AND (actor_id=$1 OR target_id IN (SELECT id::TEXT FROM management_punishments WHERE created_by=$1)) ORDER BY created_at DESC LIMIT 100",[String(req.session.user.id)]);
    res.json({items:r.rows});
  }catch(e){next(e);}});
  router.post("/punishments", csrf, async(req,res,next)=>{
    try{
      const s=await settings(), who=await identity(req); if(!who)return res.status(401).json({error:"Sign in first."});
      const canAdd=who.rank>=s.punishment_add_rank, canRequest=who.rank>=s.punishment_request_rank;
      if(!canAdd&&!canRequest)return res.status(403).json({error:"You cannot submit punishment records."});
      const b=req.body||{}, userId=String(b.userId||""), username=String(b.username||"").trim(), type=String(b.type||"");
      const reason=String(b.reason||"").trim();
      if(!/^\d+$/.test(userId)||!username||!["Strike","Demotion","Termination","Ban","Suspension","Other"].includes(type)||!reason)
        return res.status(400).json({error:"Complete the member, punishment type, and reason."});
      const status=canAdd?"APPROVED":"PENDING";
      const r=await pool.query("INSERT INTO management_punishments(user_id,username,type,reason,duration,status,created_by,created_by_name,decided_by,decided_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [userId,username,type,reason,String(b.duration||"").slice(0,80),status,req.session.user.id,req.session.user.name,canAdd?req.session.user.id:null,canAdd?req.session.user.name:null]);
      await writeAudit(canAdd?"ISSUED":"REQUESTED",r.rows[0],req.session.user.id,req.session.user.name,reason);
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });
  router.post("/punishments/:id/decision", csrf, async(req,res,next)=>{
    try{const who=await gate(req,res,"punishment_approve_rank");if(!who)return;
      const status=String(req.body?.status||""); if(!["APPROVED","REJECTED"].includes(status))return res.status(400).json({error:"Choose approve or reject."});
      const r=await pool.query("UPDATE management_punishments SET status=$1,decided_by=$2,decided_by_name=$3,decision_note=$4,decided_at=NOW() WHERE id=$5 AND status='PENDING' RETURNING *",
        [status,req.session.user.id,req.session.user.name,String(req.body?.note||"").slice(0,500),req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:"Pending punishment not found."});
      await writeAudit(status,r.rows[0],req.session.user.id,req.session.user.name,req.body?.note||"");
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });

  router.delete("/punishments/:id",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const s=await settings(),canManage=Number(who.rank)>=Number(s.punishment_approve_rank);
    const found=await pool.query("SELECT * FROM management_punishments WHERE id=$1",[req.params.id]);
    if(!found.rowCount)return res.status(404).json({error:"Discipline record not found."});
    const item=found.rows[0];
    if(String(item.created_by)!==String(req.session.user.id)&&!canManage)return res.status(403).json({error:"Only the requester or an authorized discipline reviewer can delete this record."});
    await pool.query("DELETE FROM management_punishments WHERE id=$1",[req.params.id]);
    await writeAudit("DELETED",item,req.session.user.id,req.session.user.name,"Discipline record deleted");
    res.json({ok:true});
  }catch(e){next(e);}});
  router.get("/promotions",async(req,res,next)=>{
    try{const who=await gate(req,res,"promotion_suggest_rank");if(!who)return;
      const r=await pool.query("SELECT * FROM promotion_suggestions ORDER BY created_at DESC LIMIT 250"),s=await settings();
      res.json({items:r.rows.map(x=>({...x,canDelete:String(x.suggested_by)===String(req.session.user.id)||who.rank>=Number(s.promotion_approve_rank)})),rank:who.rank,settings:s});
    }catch(e){next(e);}
  });
  router.get("/promotions/audit",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const s=await settings(),all=Number(who.rank)>=Number(s.promotion_approve_rank);
    const r=all?await pool.query("SELECT * FROM management_audit_logs WHERE category='PROMOTION' ORDER BY created_at DESC LIMIT 300"):await pool.query("SELECT * FROM management_audit_logs WHERE category='PROMOTION' AND (actor_id=$1 OR target_id=$1) ORDER BY created_at DESC LIMIT 100",[String(req.session.user.id)]);res.json({items:r.rows});
  }catch(e){next(e);}});
  router.post("/promotions",csrf,async(req,res,next)=>{
    try{const who=await gate(req,res,"promotion_suggest_rank");if(!who)return;
      const b=req.body||{},userId=String(b.userId||""),username=String(b.username||"").trim(),role=String(b.suggestedRole||"").trim(),reason=String(b.reason||"").trim();
      if(!/^\d+$/.test(userId)||!username||!role||!reason)return res.status(400).json({error:"Complete the member, suggested role, and reason."});
      const r=await pool.query("INSERT INTO promotion_suggestions(user_id,username,suggested_role,reason,status,suggested_by,suggested_by_name) VALUES($1,$2,$3,$4,'PENDING',$5,$6) RETURNING *",
        [userId,username,role,reason,req.session.user.id,req.session.user.name]);
      await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["PROMOTION","REQUESTED",userId,username,"Suggested role: "+role+" | "+reason,String(req.session.user.id),String(req.session.user.name)]);
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });
  router.post("/promotions/:id/decision",csrf,async(req,res,next)=>{
    try{const who=await gate(req,res,"promotion_approve_rank");if(!who)return;
      const status=String(req.body?.status||"");if(!["APPROVED","REJECTED"].includes(status))return res.status(400).json({error:"Choose approve or reject."});
      const r=await pool.query("UPDATE promotion_suggestions SET status=$1,decided_by=$2,decided_by_name=$3,decision_note=$4,decided_at=NOW() WHERE id=$5 AND status='PENDING' RETURNING *",
        [status,req.session.user.id,req.session.user.name,String(req.body?.note||"").slice(0,500),req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:"Pending promotion suggestion not found."});
      await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["PROMOTION",status,String(r.rows[0].suggested_by),r.rows[0].suggested_by_name,"Suggestion #"+r.rows[0].id+" for "+r.rows[0].username+" | "+r.rows[0].suggested_role+(r.rows[0].decision_note?" | "+r.rows[0].decision_note:""),String(req.session.user.id),String(req.session.user.name)]);
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });

  router.get("/leaves",async(req,res,next)=>{
    try{
      const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
      const s=await settings(),canViewAll=Number(who.rank)>=Number(s.leave_approve_rank);
      const r=canViewAll?await pool.query("SELECT * FROM leave_requests ORDER BY created_at DESC LIMIT 300"):await pool.query("SELECT * FROM leave_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[String(req.session.user.id)]);
      res.json({items:r.rows.map(x=>({...x,canDelete:(String(x.user_id)===String(req.session.user.id)&&x.status==="PENDING")||Number(who.rank)>=Number(s.leave_approve_rank)})),rank:Number(who.rank),settings:s,canViewAll});
    }catch(e){next(e);}
  });
  router.get("/leaves/audit",async(req,res,next)=>{
    try{const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const s=await settings(),all=Number(who.rank)>=Number(s.leave_approve_rank);
      const r=all?await pool.query("SELECT * FROM management_audit_logs WHERE category=$1 ORDER BY created_at DESC LIMIT 300",["LEAVE"]):await pool.query("SELECT * FROM management_audit_logs WHERE category=$1 AND (actor_id=$2 OR target_id=$2) ORDER BY created_at DESC LIMIT 100",["LEAVE",String(req.session.user.id)]);res.json({items:r.rows});
    }catch(e){next(e);}
  });
  router.post("/leaves",csrf,async(req,res,next)=>{
    try{
      const b=req.body||{},roblox=String(b.robloxUsername||"").trim(),reason=String(b.reason||"").trim(),start=String(b.startDate||""),end=String(b.endDate||"");
      const parse=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(s+"T00:00:00.000Z");return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s?null:d;};
      const a=parse(start),z=parse(end),offset=Number(b.timezoneOffset),safeOffset=Number.isInteger(offset)&&Math.abs(offset)<=840?offset:0,now=new Date(Date.now()-safeOffset*60000);now.setUTCHours(0,0,0,0);
      if(roblox.length<3||roblox.length>40||reason.length<8||reason.length>2000||!a||!z||a<now||z<a||((z-a)/86400000)>29)return res.status(400).json({error:"Check your Roblox username, provide a reason of at least 8 characters, and choose valid dates within a 30-day period starting today or later."});
      const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
      const client=await pool.connect();let item;
      try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[String(req.session.user.id)]);
        const pending=await client.query("SELECT id FROM leave_requests WHERE user_id=$1 AND status=$2 LIMIT 1",[String(req.session.user.id),"PENDING"]);
        if(pending.rowCount){await client.query("ROLLBACK");return res.status(409).json({error:"You already have a pending time-off request. Wait for a decision or cancel it first."});}
        const member=await client.query("SELECT MAX(end_date) AS last_leave FROM leave_requests WHERE user_id=$1 AND status=$2",[String(req.session.user.id),"APPROVED"]);
        const result=await client.query("INSERT INTO leave_requests(user_id,roblox_username,start_date,end_date,reason,status,last_leave_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[String(req.session.user.id),roblox,start,end,reason,"PENDING",member.rows[0].last_leave]);item=result.rows[0];await client.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["LEAVE","REQUESTED",String(item.user_id),item.roblox_username,"Request #"+item.id+" | "+start+" to "+end+" | "+reason,String(req.session.user.id),String(req.session.user.name)]);await client.query("COMMIT");
      }catch(err){await client.query("ROLLBACK");throw err;}finally{client.release();}
      res.json({ok:true,item});
    }catch(e){next(e);}
  });
  router.post("/leaves/:id/decision",csrf,async(req,res,next)=>{
    try{const who=await gate(req,res,"leave_approve_rank");if(!who)return;const status=String(req.body?.status||"");
      if(!["APPROVED","REJECTED"].includes(status))return res.status(400).json({error:"Choose approve or reject."});const note=String(req.body?.note||"").trim().slice(0,500);
      if(status==="REJECTED"&&!note)return res.status(400).json({error:"Add a short reason when rejecting a leave request."});
      const r=await pool.query("UPDATE leave_requests SET status=$1,decided_by=$2,decided_by_name=$3,decision_note=$4,decided_at=NOW() WHERE id=$5 AND status=$6 RETURNING *",[status,req.session.user.id,req.session.user.name,note,req.params.id,"PENDING"]);
      if(!r.rowCount)return res.status(404).json({error:"Pending leave request not found."});
      await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["LEAVE",status,String(r.rows[0].user_id),r.rows[0].roblox_username,"Request #"+r.rows[0].id+(note?" | "+note:""),String(req.session.user.id),String(req.session.user.name)]);
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });

  router.delete("/sessions/:id",csrf,async(req,res,next)=>{try{const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const r=await pool.query("DELETE FROM staff_shifts WHERE id=$1 AND (created_by=$2 OR $3>=$4) RETURNING id,title,host_id,host_name",[req.params.id,String(req.session.user.id),who.rank,Number((await settings()).session_delete_rank)]);if(!r.rowCount)return res.status(403).json({error:"Only the shift creator or a member meeting the configured delete rank can delete this shift."});await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION","DELETED",String(r.rows[0].id),r.rows[0].title,"Session #"+r.rows[0].id+" | "+r.rows[0].title,String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true});}catch(e){next(e);}});
  for(const [path,table,ownerCol,rankField] of [["punishments","management_punishments","created_by","punishment_approve_rank"],["promotions","promotion_suggestions","suggested_by","promotion_approve_rank"],["leaves","leave_requests","user_id","leave_approve_rank"]]){
    router.delete("/"+path+"/:id",csrf,async(req,res,next)=>{try{const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const s=await settings(),canManage=who.rank>=Number(s[rankField]);const r=await pool.query("DELETE FROM "+table+" WHERE id=$1 AND ("+ownerCol+"=$2 OR $3=TRUE) AND ($4 IS NULL OR status=$4 OR $3=TRUE) RETURNING *",[req.params.id,String(req.session.user.id),canManage,path==="leaves"?"PENDING":null]);if(!r.rowCount)return res.status(403).json({error:"You do not have permission to delete this request."});if(path==="punishments")await writeAudit("DELETED",r.rows[0],req.session.user.id,req.session.user.name,"Record deleted");if(path==="promotions")await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["PROMOTION","DELETED",String(r.rows[0].suggested_by),r.rows[0].suggested_by_name,"Suggestion #"+r.rows[0].id+" for "+r.rows[0].username,String(req.session.user.id),String(req.session.user.name)]);if(path==="leaves")await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["LEAVE","CANCELLED",String(r.rows[0].user_id),r.rows[0].roblox_username,"Request #"+r.rows[0].id+" cancelled or removed",String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true});}catch(e){next(e);}});
  }
  return router;
}

async function ensureManagementSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS management_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    activity_view_rank INTEGER NOT NULL DEFAULT 238, activity_edit_rank INTEGER NOT NULL DEFAULT 245,
    punishment_view_rank INTEGER NOT NULL DEFAULT 238, punishment_add_rank INTEGER NOT NULL DEFAULT 245,
    punishment_request_rank INTEGER NOT NULL DEFAULT 1, punishment_approve_rank INTEGER NOT NULL DEFAULT 249,
    promotion_suggest_rank INTEGER NOT NULL DEFAULT 238, promotion_approve_rank INTEGER NOT NULL DEFAULT 249,
    leave_approve_rank INTEGER NOT NULL DEFAULT 245, knowledge_manage_rank INTEGER NOT NULL DEFAULT 245, session_create_rank INTEGER NOT NULL DEFAULT 238, session_delete_rank INTEGER NOT NULL DEFAULT 245, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query("ALTER TABLE management_settings ADD COLUMN IF NOT EXISTS knowledge_manage_rank INTEGER NOT NULL DEFAULT 245, ADD COLUMN IF NOT EXISTS session_create_rank INTEGER NOT NULL DEFAULT 238, ADD COLUMN IF NOT EXISTS session_delete_rank INTEGER NOT NULL DEFAULT 245, ADD COLUMN IF NOT EXISTS task_view_rank INTEGER NOT NULL DEFAULT 238, ADD COLUMN IF NOT EXISTS task_manage_rank INTEGER NOT NULL DEFAULT 245, ADD COLUMN IF NOT EXISTS session_approve_rank INTEGER NOT NULL DEFAULT 245, ADD COLUMN IF NOT EXISTS session_status_rank INTEGER NOT NULL DEFAULT 245");
  await pool.query(`CREATE TABLE IF NOT EXISTS management_teams (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,department TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT '#f5c928',created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(department,name))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS management_team_members (user_id TEXT PRIMARY KEY,team_id BIGINT NOT NULL REFERENCES management_teams(id) ON DELETE CASCADE,assigned_by TEXT NOT NULL,assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query("ALTER TABLE management_teams ADD COLUMN IF NOT EXISTS group_role_rank INTEGER");
  await pool.query("CREATE INDEX IF NOT EXISTS management_team_members_team_idx ON management_team_members(team_id)");
  await pool.query("INSERT INTO management_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING");
  await pool.query("CREATE TABLE IF NOT EXISTS staff_shifts (id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL DEFAULT 'Shift',session_date DATE,session_time TIME,host_id TEXT,host_name TEXT,cohost_id TEXT,cohost_name TEXT,oversee_id TEXT,oversee_name TEXT,oversee_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],oversee_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],promoter_id TEXT,promoter_name TEXT,attendee_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],attendee_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],created_by TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("ALTER TABLE staff_shifts ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'Shift', ADD COLUMN IF NOT EXISTS session_date DATE, ADD COLUMN IF NOT EXISTS session_time TIME, ADD COLUMN IF NOT EXISTS host_id TEXT, ADD COLUMN IF NOT EXISTS host_name TEXT, ADD COLUMN IF NOT EXISTS cohost_id TEXT, ADD COLUMN IF NOT EXISTS cohost_name TEXT, ADD COLUMN IF NOT EXISTS oversee_id TEXT, ADD COLUMN IF NOT EXISTS oversee_name TEXT, ADD COLUMN IF NOT EXISTS oversee_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN IF NOT EXISTS oversee_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN IF NOT EXISTS promoter_id TEXT, ADD COLUMN IF NOT EXISTS promoter_name TEXT, ADD COLUMN IF NOT EXISTS attendee_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN IF NOT EXISTS attendee_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN IF NOT EXISTS created_by TEXT, ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  const legacyColumns=new Set((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='portal_sessions'")).rows.map(r=>r.column_name));
  const legacyRequired=["id","title","session_date","session_time","host_id","host_name","cohost_id","cohost_name","oversee_id","oversee_name","oversee_ids","oversee_names","promoter_id","promoter_name","attendee_ids","attendee_names","created_by","created_at"];
  if(legacyRequired.every(name=>legacyColumns.has(name))){
    await pool.query("INSERT INTO staff_shifts(id,title,session_date,session_time,host_id,host_name,cohost_id,cohost_name,oversee_id,oversee_name,oversee_ids,oversee_names,promoter_id,promoter_name,attendee_ids,attendee_names,created_by,created_at) SELECT id,title,session_date,session_time,host_id,host_name,cohost_id,cohost_name,oversee_id,oversee_name,oversee_ids,oversee_names,promoter_id,promoter_name,attendee_ids,attendee_names,created_by,created_at FROM portal_sessions ON CONFLICT(id) DO NOTHING");
    await pool.query("SELECT setval(pg_get_serial_sequence('staff_shifts','id'),GREATEST(COALESCE((SELECT MAX(id) FROM staff_shifts),1),1))");
  }
  const sessionColumns=new Set((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='staff_shifts'")).rows.map(r=>r.column_name));
  for(const [target,candidates] of [["session_date",["date","shift_date","scheduled_date"]],["session_time",["time","start_time"]],["host_id",["host_user_id","host_userid","hostId"]],["host_name",["host_username","hostName"]],["cohost_id",["cohost_user_id","co_host_user_id"]],["cohost_name",["cohost_username","co_host_username"]]]){
    const source=candidates.find(name=>sessionColumns.has(name));
    if(source)await pool.query('UPDATE staff_shifts SET "'+target+'"=COALESCE("'+target+'","'+source+'")');
  }
  await pool.query("UPDATE staff_shifts SET session_date=COALESCE(session_date,created_at::date,CURRENT_DATE),session_time=COALESCE(session_time,TIME '00:00'),title=COALESCE(NULLIF(title,''),'Shift'),oversee_ids=CASE WHEN cardinality(oversee_ids)=0 AND oversee_id IS NOT NULL THEN ARRAY[oversee_id]::TEXT[] ELSE oversee_ids END,oversee_names=CASE WHEN cardinality(oversee_names)=0 AND oversee_name IS NOT NULL THEN ARRAY[oversee_name]::TEXT[] ELSE oversee_names END");
  await pool.query("ALTER TABLE staff_shifts ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'PROMOTIONAL', ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PLANNED', ADD COLUMN IF NOT EXISTS status_note TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await pool.query("CREATE INDEX IF NOT EXISTS staff_shifts_status_date_idx ON staff_shifts(status,session_date)");
  await pool.query("CREATE TABLE IF NOT EXISTS session_requests (id BIGSERIAL PRIMARY KEY,session_type TEXT NOT NULL,title TEXT NOT NULL,details TEXT NOT NULL DEFAULT '',preferred_date DATE,preferred_time TIME,requested_by TEXT NOT NULL,requested_by_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reviewed_by TEXT,reviewed_by_name TEXT,review_note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),reviewed_at TIMESTAMPTZ)");
  await pool.query("CREATE INDEX IF NOT EXISTS session_requests_status_created_idx ON session_requests(status,created_at DESC)");
  await pool.query(`CREATE TABLE IF NOT EXISTS knowledge_hub_items (
    id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL,url TEXT,content TEXT NOT NULL DEFAULT '',
    min_rank INTEGER NOT NULL DEFAULT 1,category TEXT NOT NULL DEFAULT 'General',team_id BIGINT REFERENCES management_teams(id) ON DELETE SET NULL,
    created_by TEXT NOT NULL,created_by_name TEXT NOT NULL,updated_by TEXT NOT NULL,updated_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query("ALTER TABLE knowledge_hub_items ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES management_teams(id) ON DELETE SET NULL");
  await pool.query(`CREATE TABLE IF NOT EXISTS activity_sessions (
    id BIGSERIAL PRIMARY KEY, session_key TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ, seconds INTEGER NOT NULL DEFAULT 0)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS activity_adjustments (
    id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,username TEXT NOT NULL,minutes INTEGER NOT NULL,reason TEXT NOT NULL,
    actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS management_punishments (
    id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,username TEXT NOT NULL,type TEXT NOT NULL,reason TEXT NOT NULL,duration TEXT,
    status TEXT NOT NULL,created_by TEXT NOT NULL,created_by_name TEXT NOT NULL,decided_by TEXT,decided_by_name TEXT,
    decision_note TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),decided_at TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS management_audit_logs (
    id BIGSERIAL PRIMARY KEY,category TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT,target_username TEXT,
    details TEXT NOT NULL DEFAULT '',actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query("CREATE INDEX IF NOT EXISTS management_audit_category_created_idx ON management_audit_logs(category,created_at DESC)");
  await pool.query("CREATE TABLE IF NOT EXISTS management_tasks (id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',assigned_to_id TEXT NOT NULL,assigned_to_name TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'NORMAL',status TEXT NOT NULL DEFAULT 'OPEN',due_date DATE,created_by TEXT NOT NULL,created_by_name TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ)");
  await pool.query("CREATE INDEX IF NOT EXISTS management_tasks_status_due_idx ON management_tasks(status,due_date)");
  await pool.query(`CREATE TABLE IF NOT EXISTS promotion_suggestions (
    id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,username TEXT NOT NULL,suggested_role TEXT NOT NULL,reason TEXT NOT NULL,
    status TEXT NOT NULL,suggested_by TEXT NOT NULL,suggested_by_name TEXT NOT NULL,decided_by TEXT,decided_by_name TEXT,
    decision_note TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),decided_at TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS leave_requests (
    id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,roblox_username TEXT NOT NULL,discord_username TEXT NOT NULL,
    start_date DATE NOT NULL,end_date DATE NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,last_leave_at DATE,
    decided_by TEXT,decided_by_name TEXT,decision_note TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),decided_at TIMESTAMPTZ)`);
  await pool.query("ALTER TABLE leave_requests ALTER COLUMN discord_username DROP NOT NULL");
}
module.exports = { createManagementRouter, ensureManagementSchema };
