const express = require("express");

function createManagementRouter({ pool, getIdentity, requireLogin, csrf, requireGameSecret }) {
  const router = express.Router();
  const defaults = {
    activity_view_rank:238, activity_edit_rank:245,
    punishment_view_rank:238, punishment_add_rank:245, punishment_request_rank:1, punishment_approve_rank:249,
    promotion_suggest_rank:238, promotion_approve_rank:249, leave_approve_rank:245
  };
  const columns = Object.keys(defaults);
  async function settings() {
    const r = await pool.query("SELECT * FROM management_settings WHERE id=1");
    return r.rows[0] || defaults;
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


  router.get("/sessions", async(req,res,next)=>{
    try{
      const result=await pool.query("SELECT * FROM portal_sessions ORDER BY session_date,session_time");
      res.json({sessions:result.rows});
    }catch(e){next(e);}
  });
  router.post("/sessions", csrf, async(req,res,next)=>{
    try{
      const b=req.body||{},title=String(b.title||"").trim(),date=String(b.date||""),time=String(b.time||"");
      const attendeeIds=Array.isArray(b.attendeeIds)?b.attendeeIds.map(String):[];
      const ids=[b.hostId,b.cohostId,b.overseeId,b.promoterId,...attendeeIds].filter(Boolean).map(String);
      if(!title||title.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!b.hostId)
        return res.status(400).json({error:"Enter a session name, date, time, and host."});
      if(new Set(ids).size!==ids.length)
        return res.status(400).json({error:"A staff member can only be assigned one role per session."});
      const identities=await Promise.all(ids.map(async id=>({id,who:await getIdentity(id)})));
      if(identities.some(x=>!x.who.inGroup))return res.status(400).json({error:"Every selected person must be a current Lemonz member."});
      const ranks=new Map(identities.map(x=>[x.id,x.who.rank]));
      if(b.overseeId&&ranks.get(String(b.overseeId))<245)return res.status(400).json({error:"Oversee must be rank 245 or higher."});
      if(b.promoterId&&ranks.get(String(b.promoterId))<245)return res.status(400).json({error:"Promoter must be rank 245 or higher."});
      const names=await Promise.all(ids.map(async id=>{
        const response=await fetch("https://users.roblox.com/v1/users/"+encodeURIComponent(id));
        const user=await response.json().catch(()=>({}));return [id,user.name||id];
      }));
      const nameMap=Object.fromEntries(names),host=String(b.hostId),cohost=b.cohostId?String(b.cohostId):null,oversee=b.overseeId?String(b.overseeId):null,promoter=b.promoterId?String(b.promoterId):null;
      const result=await pool.query("INSERT INTO portal_sessions(title,session_date,session_time,host_id,host_name,cohost_id,cohost_name,oversee_id,oversee_name,promoter_id,promoter_name,attendee_ids,attendee_names,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *",
        [title,date,time,host,nameMap[host],cohost,cohost?nameMap[cohost]:null,oversee,oversee?nameMap[oversee]:null,promoter,promoter?nameMap[promoter]:null,attendeeIds,attendeeIds.map(id=>nameMap[id]),req.session.user.id]);
      res.json({ok:true,session:result.rows[0]});
    }catch(e){next(e);}
  });

  router.get("/members/:id", async(req,res,next)=>{
    try{
      const userId=String(req.params.id||"");
      if(!/^\d+$/.test(userId))return res.status(400).json({error:"Invalid staff member."});
      const who=await getIdentity(userId);
      if(!who.inGroup||who.rank<230)return res.status(404).json({error:"Staff member not found."});
      const profile=await fetch("https://users.roblox.com/v1/users/"+encodeURIComponent(userId));
      const user=await profile.json().catch(()=>({}));
      const thumb=await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds="+encodeURIComponent(userId)+"&size=150x150&format=Png&isCircular=true");
      const thumbData=await thumb.json().catch(()=>({}));
      const avatarUrl=thumbData.data?.[0]?.imageUrl||"";
      const sessions=await pool.query("SELECT * FROM portal_sessions WHERE host_id=$1 OR cohost_id=$1 OR promoter_id=$1 OR $1=ANY(attendee_ids) OR oversee_id=$1 ORDER BY session_date DESC,session_time DESC",[userId]);
      const punishments=await pool.query("SELECT type,reason,duration,status,created_by_name,created_at FROM management_punishments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[userId]);
      const activity=await pool.query("SELECT COALESCE(SUM(seconds),0)::BIGINT AS seconds,COUNT(*)::INTEGER AS sessions,MAX(ended_at) AS last_seen FROM activity_sessions WHERE user_id=$1 AND ended_at IS NOT NULL",[userId]);
      res.json({member:{id:userId,username:user.name||"Staff member",role:who.roleName,rank:who.rank,avatarUrl},sessions:sessions.rows.map(s=>({...s,member_role:s.host_id===userId?"Host":s.cohost_id===userId?"Co-Host":s.promoter_id===userId?"Promoter":s.oversee_id===userId?"Oversee":"Attendee"})),punishments:punishments.rows,activity:activity.rows[0]});
    }catch(e){next(e);}
  });

  router.get("/activity", async (req,res,next) => {
    try {
      const who=await gate(req,res,"activity_view_rank"); if(!who)return;
      const r=await pool.query(
        "SELECT user_id,username,SUM(seconds)::BIGINT AS seconds,MAX(started_at) AS last_seen,COUNT(*)::INTEGER AS sessions FROM activity_sessions WHERE ended_at IS NOT NULL GROUP BY user_id,username ORDER BY SUM(seconds) DESC LIMIT 250"
      );
      const adjustments=await pool.query("SELECT user_id,username,minutes,reason,actor_name,created_at FROM activity_adjustments ORDER BY created_at DESC LIMIT 100");
      res.json({members:r.rows,adjustments:adjustments.rows,canEdit:who.rank >= (await settings()).activity_edit_rank});
    } catch(e){next(e);}
  });
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

  router.get("/punishments", async(req,res,next)=>{
    try{const who=await gate(req,res,"punishment_view_rank");if(!who)return;
      const r=await pool.query("SELECT * FROM management_punishments ORDER BY created_at DESC LIMIT 250");
      res.json({items:r.rows,rank:who.rank,settings:await settings()});
    }catch(e){next(e);}
  });
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
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });
  router.post("/punishments/:id/decision", csrf, async(req,res,next)=>{
    try{const who=await gate(req,res,"punishment_approve_rank");if(!who)return;
      const status=String(req.body?.status||""); if(!["APPROVED","REJECTED"].includes(status))return res.status(400).json({error:"Choose approve or reject."});
      const r=await pool.query("UPDATE management_punishments SET status=$1,decided_by=$2,decided_by_name=$3,decision_note=$4,decided_at=NOW() WHERE id=$5 AND status='PENDING' RETURNING *",
        [status,req.session.user.id,req.session.user.name,String(req.body?.note||"").slice(0,500),req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:"Pending punishment not found."});
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });

  router.get("/promotions",async(req,res,next)=>{
    try{const who=await gate(req,res,"promotion_suggest_rank");if(!who)return;
      const r=await pool.query("SELECT * FROM promotion_suggestions ORDER BY created_at DESC LIMIT 250");
      res.json({items:r.rows,rank:who.rank,settings:await settings()});
    }catch(e){next(e);}
  });
  router.post("/promotions",csrf,async(req,res,next)=>{
    try{const who=await gate(req,res,"promotion_suggest_rank");if(!who)return;
      const b=req.body||{},userId=String(b.userId||""),username=String(b.username||"").trim(),role=String(b.suggestedRole||"").trim(),reason=String(b.reason||"").trim();
      if(!/^\d+$/.test(userId)||!username||!role||!reason)return res.status(400).json({error:"Complete the member, suggested role, and reason."});
      const r=await pool.query("INSERT INTO promotion_suggestions(user_id,username,suggested_role,reason,status,suggested_by,suggested_by_name) VALUES($1,$2,$3,$4,'PENDING',$5,$6) RETURNING *",
        [userId,username,role,reason,req.session.user.id,req.session.user.name]);
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });
  router.post("/promotions/:id/decision",csrf,async(req,res,next)=>{
    try{const who=await gate(req,res,"promotion_approve_rank");if(!who)return;
      const status=String(req.body?.status||"");if(!["APPROVED","REJECTED"].includes(status))return res.status(400).json({error:"Choose approve or reject."});
      const r=await pool.query("UPDATE promotion_suggestions SET status=$1,decided_by=$2,decided_by_name=$3,decision_note=$4,decided_at=NOW() WHERE id=$5 AND status='PENDING' RETURNING *",
        [status,req.session.user.id,req.session.user.name,String(req.body?.note||"").slice(0,500),req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:"Pending promotion suggestion not found."});
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });

  router.get("/leaves",async(req,res,next)=>{
    try{
      const who=await identity(req); if(!who)return res.status(401).json({error:"Sign in first."});
      const s=await settings();
      const r=await pool.query("SELECT * FROM leave_requests WHERE user_id=$1 OR $2 >= $3 ORDER BY created_at DESC LIMIT 250",
        [req.session.user.id,who.rank,s.leave_approve_rank]);
      res.json({items:r.rows,rank:who.rank,settings:s});
    }catch(e){next(e);}
  });
  router.post("/leaves",csrf,async(req,res,next)=>{
    try{
      const b=req.body||{},discord=String(b.discordUsername||"").trim(),roblox=String(b.robloxUsername||"").trim(),reason=String(b.reason||"").trim();
      const start=String(b.startDate||""),end=String(b.endDate||"");
      const parse=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)?new Date(s+"T00:00:00Z"):null;
      const a=parse(start),z=parse(end),now=new Date();now.setUTCHours(0,0,0,0);
      if(!discord||!roblox||!reason||!a||!z||a<now||z<a||((z-a)/86400000)>29)
        return res.status(400).json({error:"Enter all fields. Leave must start today or later and last no more than 30 days."});
      const who=await identity(req);if(!who)return res.status(401).json({error:"Sign in first."});
      const pending=await pool.query("SELECT id FROM leave_requests WHERE user_id=$1 AND status='PENDING'",[req.session.user.id]);
      if(pending.rowCount)return res.status(409).json({error:"You already have a pending time-off request."});
      const member=await pool.query("SELECT MAX(end_date) AS last_leave FROM leave_requests WHERE user_id=$1 AND status='APPROVED'",[req.session.user.id]);
      const r=await pool.query("INSERT INTO leave_requests(user_id,roblox_username,discord_username,start_date,end_date,reason,status,last_leave_at) VALUES($1,$2,$3,$4,$5,$6,'PENDING',$7) RETURNING *",
        [req.session.user.id,roblox,discord,a.toISOString().slice(0,10),z.toISOString().slice(0,10),reason,member.rows[0].last_leave]);
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });
  router.post("/leaves/:id/decision",csrf,async(req,res,next)=>{
    try{const who=await gate(req,res,"leave_approve_rank");if(!who)return;
      const status=String(req.body?.status||"");if(!["APPROVED","REJECTED"].includes(status))return res.status(400).json({error:"Choose approve or reject."});
      const r=await pool.query("UPDATE leave_requests SET status=$1,decided_by=$2,decided_by_name=$3,decision_note=$4,decided_at=NOW() WHERE id=$5 AND status='PENDING' RETURNING *",
        [status,req.session.user.id,req.session.user.name,String(req.body?.note||"").slice(0,500),req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:"Pending leave request not found."});
      res.json({ok:true,item:r.rows[0]});
    }catch(e){next(e);}
  });
  return router;
}

async function ensureManagementSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS management_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    activity_view_rank INTEGER NOT NULL DEFAULT 238, activity_edit_rank INTEGER NOT NULL DEFAULT 245,
    punishment_view_rank INTEGER NOT NULL DEFAULT 238, punishment_add_rank INTEGER NOT NULL DEFAULT 245,
    punishment_request_rank INTEGER NOT NULL DEFAULT 1, punishment_approve_rank INTEGER NOT NULL DEFAULT 249,
    promotion_suggest_rank INTEGER NOT NULL DEFAULT 238, promotion_approve_rank INTEGER NOT NULL DEFAULT 249,
    leave_approve_rank INTEGER NOT NULL DEFAULT 245, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query("INSERT INTO management_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING");
  await pool.query("CREATE TABLE IF NOT EXISTS portal_sessions (id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,session_date DATE NOT NULL,session_time TIME NOT NULL,host_id TEXT NOT NULL,host_name TEXT NOT NULL,cohost_id TEXT,cohost_name TEXT,oversee_id TEXT,oversee_name TEXT,promoter_id TEXT,promoter_name TEXT,attendee_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],attendee_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
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
  await pool.query(`CREATE TABLE IF NOT EXISTS promotion_suggestions (
    id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,username TEXT NOT NULL,suggested_role TEXT NOT NULL,reason TEXT NOT NULL,
    status TEXT NOT NULL,suggested_by TEXT NOT NULL,suggested_by_name TEXT NOT NULL,decided_by TEXT,decided_by_name TEXT,
    decision_note TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),decided_at TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS leave_requests (
    id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,roblox_username TEXT NOT NULL,discord_username TEXT NOT NULL,
    start_date DATE NOT NULL,end_date DATE NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,last_leave_at DATE,
    decided_by TEXT,decided_by_name TEXT,decision_note TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),decided_at TIMESTAMPTZ)`);
}
module.exports = { createManagementRouter, ensureManagementSchema };
