const express = require("express");

function createManagementRouter({ pool, getIdentity, requireLogin, csrf, requireGameSecret }) {
  const router = express.Router();
  const defaults = {
    activity_view_rank:238, activity_edit_rank:245,
    punishment_view_rank:238, punishment_add_rank:245, punishment_request_rank:1, punishment_approve_rank:249,
    promotion_suggest_rank:238, promotion_approve_rank:249, leave_approve_rank:245, knowledge_manage_rank:245, session_create_rank:238, session_delete_rank:245, task_view_rank:238, task_manage_rank:245, session_approve_rank:245, session_status_rank:245, notification_view_rank:238, analytics_view_rank:238, quota_hours_week:2, quota_sessions_week:2, quota_tasks_week:0, notifications_enabled:1, recurring_sessions_enabled:1
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
      const invalid=columns.some((k,i)=>k.endsWith("_rank")?(!Number.isInteger(values[i])||values[i]<1||values[i]>255):k==="quota_hours_week"?(!Number.isFinite(values[i])||values[i]<0||values[i]>168):k==="quota_start_day"?( !Number.isInteger(values[i])||values[i]<0||values[i]>6):k.endsWith("_enabled")?(![0,1].includes(values[i])):(!Number.isInteger(values[i])||values[i]<0||values[i]>100)); if(invalid)return res.status(400).json({error:"Check rank permissions, weekly quota targets, and feature toggles."});
      const sets=columns.map((k,i)=>k+"=$"+(i+1)).join(",");
      const result=await pool.query("UPDATE management_settings SET "+sets+",updated_at=NOW() WHERE id=1 RETURNING *",values);
      res.json({ok:true,settings:result.rows[0]});
    } catch(e){next(e);}
  });


  // Teams and departments are owner-managed. Staff can belong to multiple teams.
  router.get("/teams",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const teams=await pool.query("SELECT t.*,COUNT(DISTINCT tm.user_id)::INTEGER AS member_count FROM management_teams t LEFT JOIN management_team_members tm ON tm.team_id=t.id GROUP BY t.id ORDER BY t.department,t.name");
    const members=await pool.query("SELECT user_id,team_id FROM management_team_members ORDER BY user_id,team_id");
    res.json({teams:teams.rows,members:members.rows,canManage:Number(who.rank)>=255});
  }catch(e){next(e);}});
  router.post("/teams",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can manage teams."});
    const b=req.body||{},name=String(b.name||"").trim(),description=String(b.description||"").trim(),color=String(b.color||"#f5c928"),mode=String(b.autoAssignMode||"NONE").toUpperCase(),min=mode==="NONE"?null:(b.autoAssignMinRank==null?NaN:Number(b.autoAssignMinRank)),max=mode==="RANGE"?(b.autoAssignMaxRank==null?NaN:Number(b.autoAssignMaxRank)):null;
    if(name.length<2||name.length>60||description.length>300||!/^#[0-9a-fA-F]{6}$/.test(color)||!["NONE","ABOVE","RANGE"].includes(mode)||(mode!=="NONE"&&(!Number.isInteger(min)||min<1||min>255))||(mode==="RANGE"&&(!Number.isInteger(max)||max<min||max>255)))return res.status(400).json({error:"Enter a team name (2–60 characters), a valid color, and a valid rank assignment rule."});
    const row=await pool.query("INSERT INTO management_teams(name,department,description,color,group_role_ranks,entity_type,created_by,auto_assign_mode,auto_assign_min_rank,auto_assign_max_rank) VALUES($1,'General',$2,$3,ARRAY[]::INTEGER[],'TEAM',$4,$5,$6,$7) RETURNING *",[name,description,color,String(req.session.user.id),mode,min,max]);
    res.status(201).json({ok:true,team:row.rows[0]});
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"A team with that name already exists. Choose a different name."});next(e);}});
  router.put("/teams/:id",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can manage teams."});
    const b=req.body||{},name=String(b.name||"").trim(),description=String(b.description||"").trim(),color=String(b.color||"#f5c928"),mode=String(b.autoAssignMode||"NONE").toUpperCase(),min=mode==="NONE"?null:(b.autoAssignMinRank==null?NaN:Number(b.autoAssignMinRank)),max=mode==="RANGE"?(b.autoAssignMaxRank==null?NaN:Number(b.autoAssignMaxRank)):null;
    if(name.length<2||name.length>60||description.length>300||!/^#[0-9a-fA-F]{6}$/.test(color)||!["NONE","ABOVE","RANGE"].includes(mode)||(mode!=="NONE"&&(!Number.isInteger(min)||min<1||min>255))||(mode==="RANGE"&&(!Number.isInteger(max)||max<min||max>255)))return res.status(400).json({error:"Enter a team name (2–60 characters), a valid color, and a valid rank assignment rule."});
    const row=await pool.query("UPDATE management_teams SET name=$1,department='General',description=$2,color=$3,group_role_ranks=ARRAY[]::INTEGER[],entity_type='TEAM',auto_assign_mode=$4,auto_assign_min_rank=$5,auto_assign_max_rank=$6,updated_at=NOW() WHERE id=$7 RETURNING *",[name,description,color,mode,min,max,req.params.id]);
    if(!row.rowCount)return res.status(404).json({error:"Team not found."});res.json({ok:true,team:row.rows[0]});
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"A team with that name already exists. Choose a different name."});next(e);}});
  router.put("/teams/member/:userId",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can assign staff to teams."});
    const userId=String(req.params.userId);if(!/^\d+$/.test(userId))return res.status(400).json({error:"Invalid Roblox user ID."});
    const teamIds=Array.isArray(req.body?.teamIds)?[...new Set(req.body.teamIds.map(String))]:[];
    const valid=await pool.query("SELECT id FROM management_teams WHERE id=ANY($1::bigint[])",[teamIds]);if(valid.rowCount!==teamIds.length)return res.status(400).json({error:"One or more selected teams do not exist."});
    const client=await pool.connect();try{await client.query("BEGIN");await client.query("DELETE FROM management_team_members WHERE user_id=$1",[userId]);for(const id of teamIds)await client.query("INSERT INTO management_team_members(user_id,team_id,assigned_by) VALUES($1,$2,$3) ON CONFLICT(user_id,team_id) DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=NOW()",[userId,id,String(req.session.user.id)]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    res.json({ok:true,userId,teamIds});
  }catch(e){next(e);}});
  router.put("/teams/:id/members",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can assign staff to teams."});
    const ids=Array.isArray(req.body?.userIds)?[...new Set(req.body.userIds.map(String).filter(x=>/^\d+$/.test(x)))]:[];
    const team=await pool.query("SELECT id FROM management_teams WHERE id=$1",[req.params.id]);if(!team.rowCount)return res.status(404).json({error:"Team not found."});
    const client=await pool.connect();try{await client.query("BEGIN");await client.query("DELETE FROM management_team_members WHERE team_id=$1",[req.params.id]);for(const id of ids)await client.query("INSERT INTO management_team_members(user_id,team_id,assigned_by) VALUES($1,$2,$3) ON CONFLICT(user_id,team_id) DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=NOW()",[id,req.params.id,String(req.session.user.id)]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    res.json({ok:true,assigned:ids.length});
  }catch(e){next(e);}});
  router.delete("/teams/:id",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<255)return res.status(403).json({error:"Only the group owner can manage teams."});
    const r=await pool.query("DELETE FROM management_teams WHERE id=$1 RETURNING id",[req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Team not found."});res.json({ok:true});
  }catch(e){next(e);}});
  router.get("/knowledge",async(req,res,next)=>{try{
    const who=await identity(req),s=await settings(),canManage=(who?.rank||0)>=Number(s.knowledge_manage_rank);const r=await pool.query("SELECT k.id,k.title,k.kind,k.url,k.content,k.min_rank,k.category,k.team_id,t.name AS team_name,t.department AS team_department,k.created_by_name,k.updated_by_name,k.created_at,k.updated_at FROM knowledge_hub_items k LEFT JOIN management_teams t ON t.id=k.team_id WHERE k.min_rank <= $1 AND (k.team_id IS NULL OR EXISTS(SELECT 1 FROM management_team_members tm WHERE tm.team_id=k.team_id AND tm.user_id=$2) OR $3=TRUE) ORDER BY k.category,k.title",[who?.rank||0,String(req.session.user.id),canManage]);
    res.json({items:r.rows,rank:who?.rank||0,canManage});
  }catch(e){next(e);}});
  router.post("/knowledge",csrf,async(req,res,next)=>{try{
    const who=await gate(req,res,"knowledge_manage_rank");if(!who)return;
    const b=req.body||{},title=String(b.title||"").trim(),kind=String(b.kind||"document"),category=String(b.category||"General").trim().slice(0,50),content=String(b.content||"").trim(),url=String(b.url||"").trim(),minRank=Number(b.minRank||1),teamId=b.teamId==null||b.teamId===""?null:Number(b.teamId);
    if(!title||title.length>120||!["link","document"].includes(kind)||!Number.isInteger(minRank)||minRank<1||minRank>255||!content||content.length>30000||(teamId!==null&&(!Number.isInteger(teamId)||teamId<1)))return res.status(400).json({error:"Enter a title, valid type, content, rank, and team."});
    if(teamId!==null){const team=await pool.query("SELECT id FROM management_teams WHERE id=$1",[teamId]);if(!team.rowCount)return res.status(400).json({error:"Choose an existing team."});}
    if(kind==="link"){try{const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol))throw new Error();}catch{return res.status(400).json({error:"Enter a valid http or https link."});}}
    const r=await pool.query("INSERT INTO knowledge_hub_items(title,kind,url,content,min_rank,category,team_id,created_by,created_by_name,updated_by,updated_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$9) RETURNING *",[title,kind,kind==="link"?url:null,content,minRank,category,teamId,String(req.session.user.id),req.session.user.name]);
    res.json({ok:true,item:r.rows[0]});
  }catch(e){next(e);}});
  router.put("/knowledge/:id",csrf,async(req,res,next)=>{try{
    const who=await gate(req,res,"knowledge_manage_rank");if(!who)return;
    const b=req.body||{},title=String(b.title||"").trim(),kind=String(b.kind||"document"),category=String(b.category||"General").trim().slice(0,50),content=String(b.content||"").trim(),url=String(b.url||"").trim(),minRank=Number(b.minRank||1),teamId=b.teamId==null||b.teamId===""?null:Number(b.teamId);
    if(!title||title.length>120||!["link","document"].includes(kind)||!Number.isInteger(minRank)||minRank<1||minRank>255||!content||content.length>30000||(teamId!==null&&(!Number.isInteger(teamId)||teamId<1)))return res.status(400).json({error:"Enter a title, valid type, content, rank, and team."});
    if(teamId!==null){const team=await pool.query("SELECT id FROM management_teams WHERE id=$1",[teamId]);if(!team.rowCount)return res.status(400).json({error:"Choose an existing team."});}
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
    const r=await pool.query("SELECT t.*,team_info.assigned_team_ids,team_info.assigned_team_names,team_info.assigned_department_names FROM management_tasks t LEFT JOIN LATERAL (SELECT ARRAY_AGG(mt.id::text ORDER BY mt.department,mt.name) AS assigned_team_ids,STRING_AGG(mt.name, ', ' ORDER BY mt.department,mt.name) AS assigned_team_names,STRING_AGG(DISTINCT mt.department, ', ' ORDER BY mt.department) AS assigned_department_names FROM management_team_members tm JOIN management_teams mt ON mt.id=tm.team_id WHERE tm.user_id=t.assigned_to_id) team_info ON TRUE ORDER BY CASE t.status WHEN $1 THEN 0 WHEN $2 THEN 1 WHEN $3 THEN 2 ELSE 3 END,t.due_date NULLS LAST,t.created_at DESC",["OPEN","IN_PROGRESS","BLOCKED"]);
    res.json({items:r.rows.map(x=>({...x,canUpdate:String(x.assigned_to_id)===String(req.session.user.id)||String(x.created_by)===String(req.session.user.id)||Number(who.rank)>=Number(s.task_manage_rank),canDelete:String(x.created_by)===String(req.session.user.id)||Number(who.rank)>=Number(s.task_manage_rank)})),rank:Number(who.rank),settings:s,canManage:Number(who.rank)>=Number(s.task_manage_rank)});
  }catch(e){next(e);}});
  router.get("/tasks/audit",async(req,res,next)=>{try{const who=await gate(req,res,"task_manage_rank");if(!who)return;const r=await pool.query("SELECT * FROM management_audit_logs WHERE category=$1 ORDER BY created_at DESC LIMIT 200",["TASK"]);res.json({items:r.rows});}catch(e){next(e);}});
  router.post("/tasks",csrf,async(req,res,next)=>{try{
    const who=await gate(req,res,"task_view_rank");if(!who)return;const b=req.body||{},title=String(b.title||"").trim(),description=String(b.description||"").trim(),assignedToId=String(b.assignedToId||""),priority=String(b.priority||"NORMAL"),dueDate=String(b.dueDate||"");
    if(!title||title.length>120||description.length>2000||!/^\d+$/.test(assignedToId)||!["LOW","NORMAL","HIGH","URGENT"].includes(priority))return res.status(400).json({error:"Enter a task title, assigned staff member, and valid priority."});
    const dueDateValue=dueDate?new Date(dueDate+"T00:00:00.000Z"):null;if(dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||Number.isNaN(dueDateValue.getTime())||dueDateValue.toISOString().slice(0,10)!==dueDate))return res.status(400).json({error:"Choose a valid due date."});
    const assigned=await getIdentity(assignedToId);if(!assigned?.inGroup||Number(assigned.rank)<Number((await settings()).task_view_rank))return res.status(400).json({error:"Assign the task to a staff member who can access the task board."});
    const profile=await fetch("https://users.roblox.com/v1/users/"+encodeURIComponent(assignedToId));const user=await profile.json().catch(()=>({}));const assignedName=user.name||assignedToId;
    const client=await pool.connect();let item;try{await client.query("BEGIN");
      const r=await client.query("INSERT INTO management_tasks(title,description,assigned_to_id,assigned_to_name,priority,due_date,created_by,created_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[title,description,assignedToId,assignedName,priority,dueDate||null,String(req.session.user.id),req.session.user.name]);item=r.rows[0];
      await client.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["TASK","CREATED",assignedToId,assignedName,"Task #"+item.id+" | "+title,String(req.session.user.id),String(req.session.user.name)]);await client.query("COMMIT");
    }catch(err){await client.query("ROLLBACK");throw err;}finally{client.release();}res.json({ok:true,item});
  }catch(e){next(e);}});
  router.patch("/tasks/:id/status",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const status=String(req.body?.status||"");if(!["OPEN","IN_PROGRESS","BLOCKED","COMPLETED"].includes(status))return res.status(400).json({error:"Choose a valid task status."});
    const s=await settings(),found=await pool.query("SELECT * FROM management_tasks WHERE id=$1",[req.params.id]);if(!found.rowCount)return res.status(404).json({error:"Task not found."});const task=found.rows[0];
    if(String(task.assigned_to_id)!==String(req.session.user.id)&&String(task.created_by)!==String(req.session.user.id)&&Number(who.rank)<Number(s.task_manage_rank))return res.status(403).json({error:"Only the assigned staff member, task creator, or a task manager can update this task."});
    const client=await pool.connect();let item;try{await client.query("BEGIN");
      const r=await client.query("UPDATE management_tasks SET status=$1,updated_at=NOW(),completed_at=CASE WHEN $1=$2 THEN NOW() ELSE NULL END WHERE id=$3 RETURNING *",[status,"COMPLETED",req.params.id]);item=r.rows[0];
      await client.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["TASK",status,item.assigned_to_id,item.assigned_to_name,"Task #"+item.id+" | "+item.title,String(req.session.user.id),String(req.session.user.name)]);await client.query("COMMIT");
    }catch(err){await client.query("ROLLBACK");throw err;}finally{client.release();}res.json({ok:true,item});
  }catch(e){next(e);}});
  router.delete("/tasks/:id",csrf,async(req,res,next)=>{let client;try{
    if(!/^\d+$/.test(String(req.params.id||"")))return res.status(400).json({error:"Invalid task ID."});
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const s=await settings();client=await pool.connect();await client.query("BEGIN");
    const found=await client.query("SELECT * FROM management_tasks WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!found.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"This task may already have been deleted. Refresh the task board."});}
    const task=found.rows[0];
    if(String(task.created_by)!==String(req.session.user.id)&&Number(who.rank)<Number(s.task_manage_rank)){await client.query("ROLLBACK");return res.status(403).json({error:"Only the task creator or a task manager can delete this task."});}
    await client.query("DELETE FROM management_tasks WHERE id=$1",[req.params.id]);
    await client.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["TASK","DELETED",task.assigned_to_id,task.assigned_to_name,"Task #"+task.id+" | "+task.title,String(req.session.user.id),String(req.session.user.name)]);
    await client.query("COMMIT");res.json({ok:true});
  }catch(e){if(client)try{await client.query("ROLLBACK")}catch{};next(e);}finally{client?.release();}});
  router.get("/session-requests",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const cfg=await settings(),canReview=Number(who.rank)>=Number(cfg.session_approve_rank);
    const result=canReview?await pool.query("SELECT * FROM session_requests ORDER BY created_at DESC LIMIT 300"):await pool.query("SELECT * FROM session_requests WHERE requested_by=$1 ORDER BY created_at DESC LIMIT 100",[String(req.session.user.id)]);
    res.json({items:result.rows.map(x=>({...x,canCancel:x.status==="PENDING"&&(String(x.requested_by)===String(req.session.user.id)||canReview)})),canReview,rank:Number(who.rank),settings:cfg});
  }catch(e){next(e);}});
  router.post("/session-requests",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const b=req.body||{},type=String(b.sessionType||""),title=String(b.title||"").trim(),details=String(b.details||"").trim(),date=String(b.preferredDate||""),time=String(b.preferredTime||""),hostId=String(b.hostId||""),cohostId=String(b.cohostId||"");
    if(!["PROMOTIONAL","RECRUITMENT","MINI_GAMES"].includes(type)||title.length<3||title.length>100||details.length<10||details.length>2000)return res.status(400).json({error:"Choose a session type, enter a clear title, and provide at least 10 characters of details."});
    const parsedDate=new Date(date+"T00:00:00.000Z");if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return res.status(400).json({error:"Choose a valid proposed date and time."});
    if(!/^\d+$/.test(hostId)||cohostId&&!/^\d+$/.test(cohostId)||hostId===cohostId&&cohostId)return res.status(400).json({error:"Choose a valid host and a different co-host."});
    const staff=await Promise.all([hostId,...(cohostId?[cohostId]:[])].map(async id=>({id,who:await getIdentity(id)})));
    if(staff.some(x=>!x.who?.inGroup||Number(x.who.rank)<230))return res.status(400).json({error:"The host and co-host must be current Lemonz staff members."});
    const userNames=await Promise.all(staff.map(async x=>{const r=await fetch("https://users.roblox.com/v1/users/"+encodeURIComponent(x.id));const u=await r.json().catch(()=>({}));return [x.id,u.name||x.id];}));
    const names=Object.fromEntries(userNames);
    const result=await pool.query("INSERT INTO session_requests(session_type,title,details,preferred_date,preferred_time,host_id,host_name,cohost_id,cohost_name,requested_by,requested_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",[type,title,details,date,time,hostId,names[hostId],cohostId||null,cohostId?names[cohostId]:null,String(req.session.user.id),String(req.session.user.name)]);
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION","REQUESTED",String(req.session.user.id),String(req.session.user.name),"Request #"+result.rows[0].id+" | "+type+" | "+title,String(req.session.user.id),String(req.session.user.name)]);
    res.json({ok:true,item:result.rows[0]});
  }catch(e){next(e);}});
  router.post("/session-requests/:id/decision",csrf,async(req,res,next)=>{let client;try{
    const who=await gate(req,res,"session_approve_rank");if(!who)return;
    const status=String(req.body?.status||""),note=String(req.body?.note||"").trim().slice(0,500);
    if(!["APPROVED","REJECTED"].includes(status))return res.status(400).json({error:"Choose approve or reject."});
    if(status==="REJECTED"&&!note)return res.status(400).json({error:"Add a reason when declining a session request."});
    client=await pool.connect();await client.query("BEGIN");
    const found=await client.query("SELECT * FROM session_requests WHERE id=$1 AND status='PENDING' FOR UPDATE",[req.params.id]);
    if(!found.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Pending session request not found."});}
    const request=found.rows[0];let scheduled=null;
    if(status==="APPROVED"){
      if(!request.host_id||!request.preferred_date||!request.preferred_time){await client.query("ROLLBACK");return res.status(400).json({error:"This request is missing a host, date, or time. Ask the requester to submit it again with those details."});}
      const ids=[request.host_id,request.cohost_id].filter(Boolean);
      if(new Set(ids).size!==ids.length){await client.query("ROLLBACK");return res.status(400).json({error:"Host and co-host must be different people."});}
      const checks=await Promise.all(ids.map(async id=>({id,who:await getIdentity(id)})));
      if(checks.some(x=>!x.who?.inGroup)){await client.query("ROLLBACK");return res.status(400).json({error:"The proposed host or co-host is no longer in the group. Update the request before approving."});}
      const names=Object.fromEntries([[request.host_id,request.host_name],[request.cohost_id,request.cohost_name]].filter(x=>x[0]));
      const ins=await client.query("INSERT INTO staff_shifts(title,session_date,session_time,host_id,host_name,cohost_id,cohost_name,created_by,session_type,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PLANNED') RETURNING *",[request.title,request.preferred_date,request.preferred_time,request.host_id,names[request.host_id]||request.host_id,request.cohost_id||null,request.cohost_id?(names[request.cohost_id]||request.cohost_id):null,String(req.session.user.id),request.session_type]);
      scheduled=ins.rows[0];
    }
    const updated=await client.query("UPDATE session_requests SET status=$1,reviewed_by=$2,reviewed_by_name=$3,review_note=$4,reviewed_at=NOW(),scheduled_session_id=$5 WHERE id=$6 RETURNING *",[status,String(req.session.user.id),String(req.session.user.name),note,scheduled?.id||null,request.id]);
    await client.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION",status,String(request.requested_by),request.requested_by_name,"Request #"+request.id+" | "+request.session_type+" | "+request.title+(scheduled?" | Scheduled session #"+scheduled.id:"")+(note?" | "+note:""),String(req.session.user.id),String(req.session.user.name)]);
    await client.query("COMMIT");res.json({ok:true,item:updated.rows[0],session:scheduled});
  }catch(e){if(client)await client.query("ROLLBACK").catch(()=>{});next(e);}finally{client?.release();}});
  router.delete("/session-requests/:id",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const cfg=await settings(),canManage=Number(who.rank)>=Number(cfg.session_approve_rank);
    const result=await pool.query("DELETE FROM session_requests WHERE id=$1 AND status='PENDING' AND (requested_by=$2 OR $3=TRUE) RETURNING *",[req.params.id,String(req.session.user.id),canManage]);
    if(!result.rowCount)return res.status(403).json({error:"Only the requester or an authorized reviewer can cancel a pending session request."});
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION","REQUEST_CANCELED",String(result.rows[0].requested_by),result.rows[0].requested_by_name,"Request #"+result.rows[0].id+" | "+result.rows[0].title,String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true});
  }catch(e){next(e);}});
  router.get("/session-requests/audit",async(req,res,next)=>{try{const who=await gate(req,res,"session_approve_rank");if(!who)return;const result=await pool.query("SELECT * FROM management_audit_logs WHERE category='SESSION' ORDER BY created_at DESC LIMIT 300");res.json({items:result.rows});}catch(e){next(e);}});
  router.patch("/sessions/:id/roles",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const cfg=await settings(),found=await pool.query("SELECT * FROM staff_shifts WHERE id=$1",[req.params.id]);if(!found.rowCount)return res.status(404).json({error:"Session not found."});
    if(String(found.rows[0].created_by)!==String(req.session.user.id)&&Number(who.rank)<Number(cfg.session_status_rank))return res.status(403).json({error:"You cannot edit this session."});
    const b=req.body||{},title=String(b.title||"").trim(),date=String(b.date||""),time=String(b.time||""),status=String(b.status||"PLANNED"),statusNote=String(b.statusNote||"").trim().slice(0,500),sessionType=String(b.sessionType||"PROMOTIONAL");
    const hostId=String(b.hostId||""),cohostId=String(b.cohostId||""),promoterId=String(b.promoterId||"");
    const overseeIds=Array.isArray(b.overseeIds)?[...new Set(b.overseeIds.map(String).filter(Boolean))]:[],attendeeIds=Array.isArray(b.attendeeIds)?[...new Set(b.attendeeIds.map(String).filter(Boolean))]:[];
    const ids=[hostId,cohostId,promoterId,...overseeIds,...attendeeIds].filter(Boolean),parsed=new Date(date+"T00:00:00.000Z");
    if(!title||title.length>100||! /^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||! /^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!hostId||!["PLANNED","ONGOING","DELAYED","CANCELED","COMPLETED"].includes(status)||!["PROMOTIONAL","RECRUITMENT","MINI_GAMES"].includes(sessionType))return res.status(400).json({error:"Check the session name, date, time, type, status, and host."});
    if(new Set(ids).size!==ids.length)return res.status(400).json({error:"Each staff member can only have one session role."});
    const identities=await Promise.all(ids.map(async id=>({id,who:await getIdentity(id)})));
    if(identities.some(x=>!x.who?.inGroup||Number(x.who.rank)<230))return res.status(400).json({error:"All assigned people must be current Lemonz staff."});
    const ranks=new Map(identities.map(x=>[x.id,Number(x.who.rank)]));
    if([...overseeIds,...(promoterId?[promoterId]:[])].some(id=>Number(ranks.get(id)||0)<245))return res.status(400).json({error:"Oversee and Promoter must be rank 245 or higher."});
    const names=await Promise.all(ids.map(async id=>{const r=await fetch("https://users.roblox.com/v1/users/"+encodeURIComponent(id));const u=await r.json().catch(()=>({}));return [id,u.name||id];})),map=Object.fromEntries(names);
    const result=await pool.query("UPDATE staff_shifts SET title=$1,session_date=$2,session_time=$3,session_type=$4,status=$5,status_note=$6,host_id=$7,host_name=$8,cohost_id=$9,cohost_name=$10,promoter_id=$11,promoter_name=$12,oversee_id=$13,oversee_name=$14,oversee_ids=$15,oversee_names=$16,attendee_ids=$17,attendee_names=$18,updated_at=NOW() WHERE id=$19 RETURNING *",[title,date,time,sessionType,status,statusNote,hostId,map[hostId],cohostId||null,cohostId?map[cohostId]:null,promoterId||null,promoterId?map[promoterId]:null,overseeIds[0]||null,overseeIds.map(id=>map[id]).join(", ")||null,overseeIds,overseeIds.map(id=>map[id]),attendeeIds,attendeeIds.map(id=>map[id]),req.params.id]);
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION","UPDATED",String(req.params.id),title,"Session details and assignments updated",String(req.session.user.id),String(req.session.user.name)]);
    res.json({ok:true,session:result.rows[0]});
  }catch(e){next(e);}});
  router.patch("/sessions/:id/status",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const status=String(req.body?.status||""),note=String(req.body?.note||"").trim().slice(0,500);if(!["PLANNED","ONGOING","DELAYED","CANCELED","COMPLETED"].includes(status))return res.status(400).json({error:"Choose a valid session status."});
    const cfg=await settings(),found=await pool.query("SELECT * FROM staff_shifts WHERE id=$1",[req.params.id]);if(!found.rowCount)return res.status(404).json({error:"Session not found."});const current=found.rows[0];if(String(current.created_by)!==String(req.session.user.id)&&Number(who.rank)<Number(cfg.session_status_rank))return res.status(403).json({error:"You cannot update this session."});
    const result=await pool.query("UPDATE staff_shifts SET status=$1,status_note=$2,updated_at=NOW() WHERE id=$3 RETURNING *",[status,note,req.params.id]);await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["SESSION",status,String(current.id),current.title,"Session #"+current.id+" | "+current.title+(note?" | "+note:""),String(req.session.user.id),String(req.session.user.name)]);res.json({ok:true,session:result.rows[0]});
  }catch(e){next(e);}});
  router.get("/sessions",async(req,res,next)=>{try{
    let who=null;try{who=await identity(req);}catch{}const cfg=await settings();const result=await pool.query("SELECT sh.*,team_info.host_team_names,team_info.host_departments FROM staff_shifts sh LEFT JOIN LATERAL (SELECT STRING_AGG(mt.name, ', ' ORDER BY mt.department,mt.name) AS host_team_names,STRING_AGG(DISTINCT mt.department, ', ' ORDER BY mt.department) AS host_departments FROM management_team_members tmem JOIN management_teams mt ON mt.id=tmem.team_id WHERE tmem.user_id=sh.host_id) team_info ON TRUE ORDER BY sh.session_date NULLS LAST,sh.session_time NULLS LAST,sh.created_at DESC");
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
  router.post("/members/:id/notes",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who||Number(who.rank)<238)return res.status(403).json({error:"Rank 238 or higher is required to add staff notes."});
    const userId=String(req.params.id||""),body=String(req.body?.body||"").trim();
    if(!/^\d+$/.test(userId))return res.status(400).json({error:"Invalid staff member."});
    if(body.length<2||body.length>2000)return res.status(400).json({error:"Notes must be between 2 and 2,000 characters."});
    const target=await getIdentity(userId);if(!target?.inGroup||Number(target.rank)<230)return res.status(404).json({error:"Staff member not found."});
    const r=await pool.query("INSERT INTO management_member_notes(user_id,body,created_by,created_by_name) VALUES($1,$2,$3,$4) RETURNING *",[userId,body,String(req.session.user.id),String(req.session.user.name)]);
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["MEMBER_NOTE","CREATED",userId,target.username||userId,"Note #"+r.rows[0].id,String(req.session.user.id),String(req.session.user.name)]);
    res.json({ok:true,note:r.rows[0]});
  }catch(e){next(e);}});
  router.delete("/members/:id/notes/:noteId",csrf,async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const result=await pool.query("DELETE FROM management_member_notes WHERE id=$1 AND user_id=$2 AND (created_by=$3 OR $4>=245) RETURNING *",[req.params.noteId,req.params.id,String(req.session.user.id),Number(who.rank)]);
    if(!result.rowCount)return res.status(404).json({error:"Note not found, or you do not have permission to remove it."});
    await pool.query("INSERT INTO management_audit_logs(category,action,target_id,target_username,details,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7)",["MEMBER_NOTE","DELETED",String(req.params.id),"Staff member","Note #"+req.params.noteId,String(req.session.user.id),String(req.session.user.name)]);
    res.json({ok:true});
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
      const notes=await pool.query("SELECT id,body,created_by,created_by_name,created_at FROM management_member_notes WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[userId]);
      const tasks=await pool.query("SELECT id,title,priority,status,due_date,created_at,completed_at FROM management_tasks WHERE assigned_to_id=$1 ORDER BY created_at DESC LIMIT 100",[userId]);
      const promotions=await pool.query("SELECT id,suggested_role,reason,status,suggested_by_name,created_at,decided_at FROM promotion_suggestions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[userId]);
      const viewer=await identity(req);
      res.json({canAddNotes:Number(viewer?.rank||0)>=238,canModerateNotes:Number(viewer?.rank||0)>=245,member:{id:userId,username:user.name||"Staff member",role:who.roleName,rank:who.rank,avatarUrl},sessions:sessions.rows.map(s=>({...s,member_role:s.host_id===userId?"Host":s.cohost_id===userId?"Co-Host":s.promoter_id===userId?"Promoter":(s.oversee_id===userId||(s.oversee_ids||[]).includes(userId))?"Oversee":"Attendee"})),punishments:punishments.rows,activity:activity.rows[0],notes:notes.rows,tasks:tasks.rows,promotions:promotions.rows});
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

  router.get("/notifications",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const cfg=await settings();if(who.rank<Number(cfg.notification_view_rank))return res.status(403).json({error:"Your rank cannot access notifications."});
    const id=String(req.session.user.id),items=[];
    const [tasks,sessions,promotions,punishments,leaves]=await Promise.all([
      pool.query("SELECT id,title,priority,due_date,created_at FROM management_tasks WHERE assigned_to_id=$1 AND status IN ('OPEN','IN_PROGRESS','BLOCKED') ORDER BY created_at DESC LIMIT 30",[id]),
      pool.query("SELECT id,title,status,session_date,session_time,updated_at FROM staff_shifts WHERE host_id=$1 OR cohost_id=$1 OR promoter_id=$1 OR $1=ANY(attendee_ids) ORDER BY updated_at DESC LIMIT 20",[id]),
      pool.query("SELECT id,username,suggested_role,status,created_at FROM promotion_suggestions WHERE suggested_by=$1 OR (status='PENDING' AND $2 >= $3) ORDER BY created_at DESC LIMIT 30",[id,Number(who.rank),Number(cfg.promotion_approve_rank)]),
      pool.query("SELECT id,username,type,status,created_at FROM management_punishments WHERE created_by=$1 OR (status='PENDING' AND $2 >= $3) ORDER BY created_at DESC LIMIT 30",[id,Number(who.rank),Number(cfg.punishment_approve_rank)]),
      pool.query("SELECT id,roblox_username,status,start_date,end_date,created_at FROM leave_requests WHERE user_id=$1 OR (status='PENDING' AND $2 >= $3) ORDER BY created_at DESC LIMIT 30",[id,Number(who.rank),Number(cfg.leave_approve_rank)])
    ]);
    for(const x of tasks.rows)items.push({id:"task-"+x.id,title:"Task assigned: "+x.title,body:"Priority "+x.priority+(x.due_date?" · Due "+String(x.due_date).slice(0,10):""),kind:"TASK",href:"tasks",created_at:x.created_at});
    for(const x of sessions.rows)items.push({id:"session-"+x.id,title:"Session update: "+x.title,body:"Status: "+x.status+" · "+String(x.session_date||"")+" "+String(x.session_time||""),kind:"SESSION",href:"sessions",created_at:x.updated_at});
    for(const x of promotions.rows)items.push({id:"promotion-"+x.id,title:"Promotion "+x.status.toLowerCase(),body:x.username+" · "+x.suggested_role,kind:"APPROVAL",href:"promotions",created_at:x.created_at});
    for(const x of punishments.rows)items.push({id:"punishment-"+x.id,title:"Discipline "+x.status.toLowerCase(),body:x.username+" · "+x.type,kind:"APPROVAL",href:"punishments",created_at:x.created_at});
    for(const x of leaves.rows)items.push({id:"leave-"+x.id,title:"Leave "+x.status.toLowerCase(),body:x.roblox_username+" · "+String(x.start_date).slice(0,10)+" to "+String(x.end_date).slice(0,10),kind:"APPROVAL",href:"leaves",created_at:x.created_at});
    items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));res.json({items:items.slice(0,100),enabled:Number(cfg.notifications_enabled)!==0});
  }catch(e){next(e);}});
  router.get("/approvals",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const cfg=await settings(),rank=Number(who.rank),items=[];
    if(rank>=Number(cfg.promotion_approve_rank)){const r=await pool.query("SELECT id,'PROMOTION' AS type,username AS target,suggested_role AS detail,status,created_at FROM promotion_suggestions WHERE status='PENDING'");items.push(...r.rows);}
    if(rank>=Number(cfg.punishment_approve_rank)){const r=await pool.query("SELECT id,'PUNISHMENT' AS type,username AS target,type AS detail,status,created_at FROM management_punishments WHERE status='PENDING'");items.push(...r.rows);}
    if(rank>=Number(cfg.leave_approve_rank)){const r=await pool.query("SELECT id,'LEAVE' AS type,roblox_username AS target,reason AS detail,status,created_at FROM leave_requests WHERE status='PENDING'");items.push(...r.rows);}
    if(rank>=Number(cfg.session_approve_rank)){const r=await pool.query("SELECT id,'SESSION' AS type,title AS target,COALESCE(details,'Session request') AS detail,status,created_at FROM session_requests WHERE status='PENDING'");items.push(...r.rows);}
    items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));res.json({items});
  }catch(e){next(e);}});
  router.get("/calendar",async(req,res,next)=>{try{const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const r=await pool.query("SELECT id,title,session_date,session_time,status,host_id,host_name,cohost_id,cohost_name,attendee_ids,attendance,recurrence_rule,recurrence_until FROM staff_shifts WHERE session_date BETWEEN CURRENT_DATE-90 AND CURRENT_DATE+365 ORDER BY session_date,session_time");res.json({items:r.rows});}catch(e){next(e);}});
  router.patch("/sessions/:id/attendance",csrf,async(req,res,next)=>{try{const who=await gate(req,res,"session_status_rank");if(!who)return;const present=Array.isArray(req.body?.present)?[...new Set(req.body.present.map(String).filter(x=>/^\d+$/.test(x)))]:[];const r=await pool.query("UPDATE staff_shifts SET attendance=$1::jsonb,updated_at=NOW() WHERE id=$2 RETURNING id,attendance",[JSON.stringify(Object.fromEntries(present.map(id=>[id,true]))),req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Session not found."});res.json({ok:true,item:r.rows[0]});}catch(e){next(e);}});
  router.get("/analytics",async(req,res,next)=>{try{const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const cfg=await settings();if(who.rank<Number(cfg.analytics_view_rank))return res.status(403).json({error:"Your rank cannot access analytics."});const [weekly,teams,top]=await Promise.all([pool.query("SELECT date_trunc('week',started_at)::date AS week,ROUND(SUM(seconds)/3600.0,2) AS hours FROM activity_sessions WHERE started_at>=NOW()-INTERVAL '12 weeks' GROUP BY 1 ORDER BY 1"),pool.query("SELECT t.id,t.name,t.color,COUNT(DISTINCT tm.user_id)::INTEGER AS members,COALESCE(SUM(a.seconds),0)::BIGINT AS seconds FROM management_teams t LEFT JOIN management_team_members tm ON tm.team_id=t.id LEFT JOIN activity_sessions a ON a.user_id=tm.user_id GROUP BY t.id ORDER BY seconds DESC"),pool.query("SELECT user_id,username,SUM(seconds)::BIGINT AS seconds FROM activity_sessions WHERE started_at>=NOW()-INTERVAL '7 days' GROUP BY user_id,username ORDER BY seconds DESC LIMIT 10")]);res.json({weekly:weekly.rows,teams:teams.rows,top:top.rows});}catch(e){next(e);}});
  router.get("/quotas",async(req,res,next)=>{try{const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});const cfg=await settings(),rules=await pool.query("SELECT * FROM management_quotas WHERE enabled=TRUE ORDER BY scope,scope_id,min_rank");res.json({defaults:{hours:Number(cfg.quota_hours_week),sessions:Number(cfg.quota_sessions_week),tasks:Number(cfg.quota_tasks_week)},rules:rules.rows,canManage:Number(who.rank)>=255});}catch(e){next(e);}});
  router.put("/quotas",csrf,async(req,res,next)=>{try{const who=await identity(req);if(!who||who.rank<255)return res.status(403).json({error:"Only the group owner can configure quotas."});const b=req.body||{},scope=String(b.scope||"GLOBAL"),scopeId=String(b.scopeId||""),min=Number(b.minRank||1),max=Number(b.maxRank||255),hours=Number(b.hours),sessions=Number(b.sessions),tasks=Number(b.tasks);if(!["GLOBAL","TEAM","RANK"].includes(scope)||scope==="GLOBAL"&&scopeId||scope!=="GLOBAL"&&!scopeId||!Number.isInteger(min)||!Number.isInteger(max)||min<1||max>255||min>max||!Number.isFinite(hours)||hours<0||hours>168||![sessions,tasks].every(x=>Number.isInteger(x)&&x>=0&&x<=100))return res.status(400).json({error:"Check quota scope, rank range, and weekly targets."});const r=await pool.query("INSERT INTO management_quotas(scope,scope_id,min_rank,max_rank,hours_per_week,sessions_per_week,tasks_per_week,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(scope,scope_id,min_rank,max_rank) DO UPDATE SET hours_per_week=EXCLUDED.hours_per_week,sessions_per_week=EXCLUDED.sessions_per_week,tasks_per_week=EXCLUDED.tasks_per_week,enabled=TRUE,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *",[scope,scopeId,min,max,hours,sessions,tasks,String(req.session.user.id)]);res.json({ok:true,rule:r.rows[0]});}catch(e){next(e);}});


  router.get("/teams/:id/dashboard",async(req,res,next)=>{try{
    const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
    const team=await pool.query("SELECT id,name,color FROM management_teams WHERE id=$1",[req.params.id]);if(!team.rowCount)return res.status(404).json({error:"Team not found."});
    const members=await pool.query("SELECT user_id FROM management_team_members WHERE team_id=$1",[req.params.id]),ids=members.rows.map(x=>x.user_id);
    const activity=ids.length?await pool.query("SELECT user_id,COALESCE(SUM(seconds),0)::BIGINT AS seconds,COUNT(*)::INTEGER AS sessions FROM activity_sessions WHERE user_id=ANY($1::text[]) GROUP BY user_id",[ids]):{rows:[]};
    const tasks=ids.length?await pool.query("SELECT status,COUNT(*)::INTEGER AS count FROM management_tasks WHERE assigned_to_id=ANY($1::text[]) GROUP BY status",[ids]):{rows:[]};
    const shifts=ids.length?await pool.query("SELECT COUNT(*)::INTEGER AS count FROM staff_shifts WHERE host_id=ANY($1::text[]) OR cohost_id=ANY($1::text[]) OR promoter_id=ANY($1::text[])",[ids]):{rows:[{count:0}]};
    res.json({team:team.rows[0],members:ids,activity:activity.rows,tasks:tasks.rows,sessionCount:Number(shifts.rows[0]?.count||0)});
  }catch(e){next(e);}});
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
  await pool.query("ALTER TABLE management_settings ADD COLUMN IF NOT EXISTS notification_view_rank INTEGER NOT NULL DEFAULT 238, ADD COLUMN IF NOT EXISTS analytics_view_rank INTEGER NOT NULL DEFAULT 238, ADD COLUMN IF NOT EXISTS quota_hours_week NUMERIC(7,2) NOT NULL DEFAULT 2, ADD COLUMN IF NOT EXISTS quota_sessions_week INTEGER NOT NULL DEFAULT 2, ADD COLUMN IF NOT EXISTS quota_tasks_week INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS notifications_enabled INTEGER NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS recurring_sessions_enabled INTEGER NOT NULL DEFAULT 1");
  await pool.query(`CREATE TABLE IF NOT EXISTS management_quotas (id BIGSERIAL PRIMARY KEY,scope TEXT NOT NULL DEFAULT 'GLOBAL',scope_id TEXT NOT NULL DEFAULT '',min_rank INTEGER NOT NULL DEFAULT 1,max_rank INTEGER NOT NULL DEFAULT 255,hours_per_week NUMERIC(7,2) NOT NULL DEFAULT 2,sessions_per_week INTEGER NOT NULL DEFAULT 2,tasks_per_week INTEGER NOT NULL DEFAULT 0,enabled BOOLEAN NOT NULL DEFAULT TRUE,updated_by TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(scope,scope_id,min_rank,max_rank))`);
  await pool.query("ALTER TABLE staff_shifts ADD COLUMN IF NOT EXISTS attendance JSONB NOT NULL DEFAULT '{}'::jsonb, ADD COLUMN IF NOT EXISTS recurrence_rule TEXT, ADD COLUMN IF NOT EXISTS recurrence_until DATE");
  await pool.query(`CREATE TABLE IF NOT EXISTS management_teams (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,department TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT '#f5c928',created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(department,name))`);
  await pool.query("ALTER TABLE management_teams ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'TEAM'");
  await pool.query("ALTER TABLE management_teams ADD COLUMN IF NOT EXISTS auto_assign_mode TEXT NOT NULL DEFAULT 'NONE'");
  await pool.query("ALTER TABLE management_teams ADD COLUMN IF NOT EXISTS auto_assign_min_rank INTEGER");
  await pool.query("ALTER TABLE management_teams ADD COLUMN IF NOT EXISTS auto_assign_max_rank INTEGER");
  await pool.query("UPDATE management_teams SET entity_type='TEAM',department='General' WHERE entity_type='DEPARTMENT'");
  await pool.query(`CREATE TABLE IF NOT EXISTS management_team_members (user_id TEXT NOT NULL,team_id BIGINT NOT NULL REFERENCES management_teams(id) ON DELETE CASCADE,assigned_by TEXT NOT NULL,assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,team_id))`);
  await pool.query(`DO $migration$ DECLARE pk_name TEXT; cols name[]; BEGIN
    SELECT conname, ARRAY(SELECT a.attname::name FROM pg_attribute a WHERE a.attrelid='management_team_members'::regclass AND a.attnum=ANY(conkey)) INTO pk_name,cols FROM pg_constraint WHERE conrelid='management_team_members'::regclass AND contype='p';
    IF pk_name IS NOT NULL AND cols=ARRAY['user_id']::name[] THEN EXECUTE format('ALTER TABLE management_team_members DROP CONSTRAINT %I',pk_name); END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='management_team_members'::regclass AND contype='p') THEN ALTER TABLE management_team_members ADD PRIMARY KEY(user_id,team_id); END IF;
  END; $migration$`);
  await pool.query("ALTER TABLE management_teams ADD COLUMN IF NOT EXISTS group_role_rank INTEGER");
  await pool.query("ALTER TABLE management_teams ADD COLUMN IF NOT EXISTS group_role_ranks INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[]");
  await pool.query("UPDATE management_teams SET group_role_ranks=ARRAY[group_role_rank] WHERE group_role_rank IS NOT NULL AND cardinality(group_role_ranks)=0");
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
  await pool.query("ALTER TABLE session_requests ADD COLUMN IF NOT EXISTS host_id TEXT");
  await pool.query("ALTER TABLE session_requests ADD COLUMN IF NOT EXISTS host_name TEXT");
  await pool.query("ALTER TABLE session_requests ADD COLUMN IF NOT EXISTS cohost_id TEXT");
  await pool.query("ALTER TABLE session_requests ADD COLUMN IF NOT EXISTS cohost_name TEXT");
  await pool.query("ALTER TABLE session_requests ADD COLUMN IF NOT EXISTS scheduled_session_id BIGINT REFERENCES staff_shifts(id) ON DELETE SET NULL");

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
  await pool.query(`CREATE TABLE IF NOT EXISTS management_member_notes (
    id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,body TEXT NOT NULL,
    created_by TEXT NOT NULL,created_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query("CREATE INDEX IF NOT EXISTS management_member_notes_user_created_idx ON management_member_notes(user_id,created_at DESC)");
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
