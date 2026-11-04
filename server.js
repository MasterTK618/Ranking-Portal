require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const GROUP_ID = process.env.ROBLOX_GROUP_ID || "16597698";
const MIN_RANK = Number(process.env.MIN_RANK || 245);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });

const required = ["SESSION_SECRET","DATABASE_URL","ROBLOX_API_KEY","INGAME_API_SECRET"];
const missing = required.filter(k => !process.env[k]);
if (missing.length) console.warn("Missing environment variables:", missing.join(", "));

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"], fontSrc:["'self'","https://fonts.gstatic.com","data:"], imgSrc:["'self'","https://*.rbxcdn.com","https://tr.rbxcdn.com","data:"], connectSrc:["'self'"], frameAncestors:["'none'"] } } }));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new PgSession({ pool, tableName: "portal_sessions", createTableIfMissing: true }),
  name: "lemonz.sid", secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use("/api", rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: "draft-7", legacyHeaders: false }));
app.use("/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false }));

const random = n => crypto.randomBytes(n).toString("base64url");
const sha256 = s => crypto.createHash("sha256").update(s).digest("base64url");
const apiBase = "https://apis.roblox.com/cloud/v2";
async function roblox(path, options = {}) {
  const response = await fetch(apiBase + path, {
    ...options,
    headers: { "x-api-key": process.env.ROBLOX_API_KEY, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.text();
  let data = {};
  try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body }; }
  if (!response.ok) {
    const error = new Error(data.message || data.error || "Roblox API request failed");
    error.status = response.status;
    error.roblox = data;
    throw error;
  }
  return data;
}
async function getRoles() {
  const roles = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({ maxPageSize: "20" });
    if (pageToken) q.set("pageToken", pageToken);
    const data = await roblox(`/groups/${GROUP_ID}/roles?${q}`);
    roles.push(...(data.groupRoles || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken && roles.length < 500);
  return roles.map(r => ({ id: String(r.id || r.path?.split("/").pop()), name: r.displayName, rank: Number(r.rank), path: r.path })).sort((a,b) => a.rank - b.rank);
}
async function getMembership(userId) {
  const filter = `user == 'users/${userId}'`;
  const q = new URLSearchParams({ maxPageSize: "10", filter });
  const data = await roblox(`/groups/${GROUP_ID}/memberships?${q}`);
  return (data.groupMemberships || []).find(m => m.user === `users/${userId}`) || null;
}
async function getMember(userId) {
  const membership = await getMembership(userId);
  if (!membership) return null;
  const roles = await getRoles();
  const paths = membership.roles?.length ? membership.roles : membership.role ? [membership.role] : [];
  const memberRoles = paths.map(p => roles.find(r => r.path === p)).filter(Boolean).sort((a,b) => b.rank-a.rank);
  const role = memberRoles[0] || roles.find(r => r.path === membership.role) || null;
  return { userId: String(userId), membershipId: membership.path?.split("/").pop() || String(userId), role, roles: memberRoles, membership };
}
async function getIdentity(userId) {
  const member = await getMember(userId);
  return { userId: String(userId), inGroup: !!member, rank: member?.role?.rank || 0, roleName: member?.role?.name || "Not in group", canRank: !!member && member.role.rank >= MIN_RANK, role: member?.role || null };
}
async function logAction({ actorId, actorName, targetId, targetName, previousRole, newRole, action, reason, status, details }) {
  await pool.query(
    `INSERT INTO ranking_logs(actor_id,actor_name,target_id,target_name,previous_role,new_role,action,reason,status,details)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [String(actorId),actorName,String(targetId),targetName,previousRole,newRole,action,reason,status,details || null]
  );
}
async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS game_ranking_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), enabled BOOLEAN NOT NULL DEFAULT TRUE,
    min_actor_rank INTEGER NOT NULL DEFAULT 245, min_target_rank INTEGER NOT NULL DEFAULT 1,
    allow_promote BOOLEAN NOT NULL DEFAULT TRUE, allow_demote BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO game_ranking_settings(id) VALUES(1) ON CONFLICT (id) DO NOTHING`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ranking_logs (
    id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
    target_id TEXT NOT NULL, target_name TEXT NOT NULL, previous_role TEXT,
    new_role TEXT, action TEXT NOT NULL, reason TEXT, status TEXT NOT NULL,
    details TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
async function getGameSettings() {
  const result = await pool.query("SELECT enabled,min_actor_rank,min_target_rank,allow_promote,allow_demote,updated_at FROM game_ranking_settings WHERE id=1");
  return result.rows[0];
}
async function getPublicUser(userId) {
  const response = await fetch("https://users.roblox.com/v1/users/" + encodeURIComponent(userId));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Could not verify a Roblox user.");
  return { id:String(data.id), name:data.name || String(userId) };
}
function requirePortalOwner(req,res,next) {
  if (!req.identity || req.identity.rank < 255) return res.status(403).json({error:"Only the Lemonz group owner (rank 255) can change in-game ranking settings."});
  next();
}
function requireGameSecret(req,res,next) {
  const expected = process.env.INGAME_API_SECRET || "";
  const supplied = req.get("x-lemonz-game-key") || "";
  if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) {
    return res.status(401).json({error:"Invalid game server credential."});
  }
  next();
}
function requireLogin(req,res,next) {
  if (!req.session.user) return res.status(401).json({ error:"Sign in with Roblox first." });
  next();
}
function csrf(req,res,next) {
  if (!req.session.csrfToken || req.get("x-csrf-token") !== req.session.csrfToken) return res.status(403).json({ error:"Security token expired. Refresh and try again." });
  next();
}
async function requireRanker(req,res,next) {
  try {
    const identity = await getIdentity(req.session.user.id);
    req.identity = identity;
    if (!identity.canRank) return res.status(403).json({ error:`Your current Lemonz rank must be ${MIN_RANK} or higher to use ranking tools.` });
    next();
  } catch (e) { next(e); }
}

app.get("/auth/login", (req,res) => {
  res.sendFile(require("node:path").join(process.cwd(),"public","auth.html"));
});
app.post("/auth/challenge", async (req,res,next) => {
  try {
    const username = String(req.body?.username || "").trim();
    if (!/^[\w]{3,20}$/.test(username)) return res.status(400).json({error:"Enter a valid Roblox username."});
    const lookup = await fetch("https://users.roblox.com/v1/usernames/users", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({usernames:[username],excludeBannedUsers:true})
    });
    const data = await lookup.json();
    const found = data.data?.[0];
    if (!lookup.ok || !found) return res.status(404).json({error:"Roblox username not found."});
    const code = "LEMONZ-" + random(5).toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,7);
    req.session.pendingVerification = { id:String(found.id), name:found.name, code, expiresAt:Date.now()+10*60*1000, attempts:0 };
    req.session.save(err => {
      if (err) return next(err);
      res.json({ok:true, username:found.name, code, expiresInMinutes:10});
    });
  } catch(e) { next(e); }
});
app.post("/auth/verify", async (req,res,next) => {
  try {
    const pending = req.session.pendingVerification;
    if (!pending || Date.now() > pending.expiresAt) {
      delete req.session.pendingVerification;
      return res.status(400).json({error:"Your verification code expired. Start again to get a new one."});
    }
    pending.attempts += 1;
    if (pending.attempts > 5) {
      delete req.session.pendingVerification;
      return res.status(429).json({error:"Too many attempts. Start again for a new code."});
    }
    const profileResponse = await fetch("https://users.roblox.com/v1/users/" + encodeURIComponent(pending.id));
    const profile = await profileResponse.json();
    if (!profileResponse.ok || String(profile.id) !== pending.id) return res.status(502).json({error:"Could not check that Roblox profile right now. Try again."});
    if (!String(profile.description || "").includes(pending.code)) {
      req.session.save(() => {});
      return res.status(400).json({error:"We couldn't find your code in that Roblox profile description yet. Add the exact code, save your profile, and try again."});
    }
    const verifiedUser = { id:pending.id, name:pending.name, picture:null };
    delete req.session.pendingVerification;
    await new Promise((resolve,reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = verifiedUser;
    req.session.csrfToken = random(32);
    await new Promise((resolve,reject) => req.session.save(err => err ? reject(err) : resolve()));
    res.json({ok:true,redirect:"/"});
  } catch(e) { next(e); }
});
app.post("/auth/logout", requireLogin, csrf, (req,res) => req.session.destroy(err => err ? res.status(500).json({error:"Could not sign out."}) : res.clearCookie("lemonz.sid").json({ok:true})));

app.get("/api/me", requireLogin, async (req,res) => {
  try {
    const identity = await getIdentity(req.session.user.id);
    res.json({ user:req.session.user, identity, csrfToken:req.session.csrfToken, groupId:GROUP_ID, minRank:MIN_RANK });
  } catch(e) {
    // Keep profile-description sign-in independent from the separate Roblox Groups API credential.
    console.error("Roblox Groups API unavailable during profile sign-in:", e.message, e.roblox || "");
    res.json({
      user:req.session.user,
      identity:{ userId:req.session.user.id, inGroup:false, rank:0, roleName:"Group connection unavailable", canRank:false, apiUnavailable:true },
      apiError:"Your Roblox profile is verified, but the portal cannot access Lemonz group data yet. A valid user-owned Roblox Open Cloud API key with Groups permissions is required for ranking.",
      csrfToken:req.session.csrfToken,
      groupId:GROUP_ID,
      minRank:MIN_RANK
    });
  }
});
app.get("/api/roles", requireLogin, requireRanker, async (req,res,next) => {
  try {
    const roles = await getRoles();
    res.json({ roles:roles.filter(r => r.rank < req.identity.rank), actorRank:req.identity.rank });
  } catch(e) { next(e); }
});
app.get("/api/member/:username", requireLogin, requireRanker, async (req,res,next) => {
  try {
    const username = String(req.params.username || "").trim();
    if (!/^[\w]{3,20}$/.test(username)) return res.status(400).json({error:"Enter a valid Roblox username."});
    const lookup = await fetch("https://users.roblox.com/v1/usernames/users", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({usernames:[username],excludeBannedUsers:true}) });
    const lookupData = await lookup.json();
    const found = lookupData.data?.[0];
    if (!lookup.ok || !found) return res.status(404).json({error:"Roblox username not found."});
    const member = await getMember(found.id);
    if (!member) return res.status(404).json({error:"That user is not a member of Lemonz."});
    const roles = await getRoles();
    res.json({ user:{id:String(found.id),name:found.name,displayName:found.displayName}, role:member.role, roles:member.roles, eligibleRoles:roles.filter(r=>r.rank < req.identity.rank), actorRank:req.identity.rank });
  } catch(e) { next(e); }
});
app.post("/api/rank", requireLogin, csrf, requireRanker, async (req,res,next) => {
  const { targetId, targetName, roleId, action, reason } = req.body || {};
  let before = null, target = null;
  try {
    if (!/^\d+$/.test(String(targetId || ""))) return res.status(400).json({error:"Invalid target user."});
    if (!["set","promote","demote"].includes(action)) return res.status(400).json({error:"Choose a valid ranking action."});
    if (action === "demote" && !String(reason || "").trim()) return res.status(400).json({error:"A reason is required for demotions."});
    target = await getMember(String(targetId));
    if (!target) return res.status(404).json({error:"That user is no longer in the group."});
    if (String(targetId) === req.session.user.id) return res.status(400).json({error:"You cannot change your own role."});
    const roles = await getRoles();
    before = target.role;
    const permitted = roles.filter(r => r.rank < req.identity.rank);
    let desired;
    if (action === "promote") desired = permitted.filter(r=>r.rank>before.rank).sort((a,b)=>a.rank-b.rank)[0];
    else if (action === "demote") desired = permitted.filter(r=>r.rank<before.rank).sort((a,b)=>b.rank-a.rank)[0];
    else desired = permitted.find(r=>r.id===String(roleId));
    if (!desired) return res.status(400).json({error:action==="promote"?"No promotable role below your own rank was found.":action==="demote"?"No lower role is available below your current role.":"That role is not available to your account."});
    if (desired.rank >= req.identity.rank) return res.status(403).json({error:"You cannot assign a role equal to or above your own."});
    if (desired.rank === before.rank) return res.status(400).json({error:"The member already has that role."});
    const membershipId = target.membershipId;
    const currentPaths = (target.membership.roles?.length ? target.membership.roles : target.membership.role ? [target.membership.role] : []);
    const newPath = desired.path || `groups/${GROUP_ID}/roles/${desired.id}`;
    // Assign the destination first. If this fails, the member's existing role remains untouched.
    await roblox(`/groups/${GROUP_ID}/memberships/${membershipId}:assignRole`, {method:"POST",body:JSON.stringify({role:newPath})});
    // Then remove all other assigned roles so this remains a conventional single-role group rank.
    for (const path of currentPaths) {
      if (path !== newPath) await roblox(`/groups/${GROUP_ID}/memberships/${membershipId}:unassignRole`, {method:"POST",body:JSON.stringify({role:path})});
    }
    const verified = await getMember(String(targetId));
    const succeeded = verified?.role?.id === desired.id;
    if (!succeeded) throw new Error("Roblox accepted the request, but the resulting role could not be verified. Check the member's roles in Roblox.");
    await logAction({actorId:req.session.user.id,actorName:req.session.user.name,targetId,targetName:targetName || String(targetId),previousRole:before?.name || "Unknown",newRole:desired.name,action,reason:String(reason||"").trim(),status:"SUCCESS"});
    res.json({ok:true,message:`${targetName || "Member"} is now ${desired.name}.`,previousRole:before?.name,newRole:desired.name});
  } catch(e) {
    try { await logAction({actorId:req.session.user.id,actorName:req.session.user.name,targetId:String(targetId||"unknown"),targetName:String(targetName||targetId||"Unknown"),previousRole:before?.name||null,newRole:null,action:String(action||"unknown"),reason:String(reason||"").trim(),status:"FAILED",details:e.message}); } catch {}
    next(e);
  }
});
app.get("/api/settings/game-ranking", requireLogin, requireRanker, async (req,res,next) => {
  try { const settings=await getGameSettings(); res.json({settings,canConfigure:req.identity.rank>=255}); }
  catch(e){next(e);}
});
app.put("/api/settings/game-ranking", requireLogin, csrf, requireRanker, async (req,res,next) => {
  try {
    if (req.identity.rank < 255) return res.status(403).json({error:"Only the Lemonz group owner (rank 255) can change these settings."});
    const b=req.body||{};
    const enabled=!!b.enabled, allowPromote=!!b.allowPromote, allowDemote=!!b.allowDemote;
    const minActorRank=Number(b.minActorRank), minTargetRank=Number(b.minTargetRank);
    if (!Number.isInteger(minActorRank)||minActorRank<1||minActorRank>255||!Number.isInteger(minTargetRank)||minTargetRank<1||minTargetRank>255)
      return res.status(400).json({error:"Rank requirements must be whole numbers from 1 to 255."});
    const result=await pool.query("UPDATE game_ranking_settings SET enabled=$1,min_actor_rank=$2,min_target_rank=$3,allow_promote=$4,allow_demote=$5,updated_at=NOW() WHERE id=1 RETURNING enabled,min_actor_rank,min_target_rank,allow_promote,allow_demote,updated_at",
      [enabled,minActorRank,minTargetRank,allowPromote,allowDemote]);
    res.json({ok:true,settings:result.rows[0]});
  } catch(e){next(e);}
});
app.get("/api/game/config", requireGameSecret, async (req,res,next) => {
  try { res.json({groupId:GROUP_ID,settings:await getGameSettings()}); } catch(e){next(e);}
});
app.post("/api/game/rank", requireGameSecret, async (req,res,next) => {
  const actorId=String(req.body?.actorId||""), targetId=String(req.body?.targetId||""), action=String(req.body?.action||"");
  let actorName=actorId, targetName=targetId, before=null;
  try {
    const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
    if(!/^\d+$/.test(actorId)||!/^\d+$/.test(targetId)||action!=="promote")
      fail(400,"Invalid in-game ranking request.");
    const settings=await getGameSettings();
    if(!settings.enabled) fail(403,"In-game ranking is disabled by Lemonz management.");
    if(!settings.allow_promote) fail(403,"In-game promotions are disabled.");
    const [actor,targetUser]=await Promise.all([getPublicUser(actorId),getPublicUser(targetId)]);
    actorName=actor.name; targetName=targetUser.name;
    const [actorIdentity,target]=await Promise.all([getIdentity(actorId),getMember(targetId)]);
    if(!actorIdentity.inGroup||actorIdentity.rank<settings.min_actor_rank)
      fail(403,"You do not meet the in-game ranking rank requirement.");
    if(!target) fail(404,"That player is not in Lemonz.");
    before=target.role;
    if(target.role.rank<settings.min_target_rank)
      fail(403,"That player's current rank is below the configured target rank requirement.");
    if(actorId===targetId) fail(400,"You cannot rank yourself.");
    const allRoles=await getRoles();
    const allowed=allRoles.filter(r=>r.rank<actorIdentity.rank);
    const desired=allowed.filter(r=>r.rank>before.rank).sort((a,b)=>a.rank-b.rank)[0];
    if(!desired) fail(400,"No higher role below your own rank is available.");
    const membershipId=target.membershipId;
    const currentPaths=(target.membership.roles?.length?target.membership.roles:target.membership.role?[target.membership.role]:[]);
    const newPath=desired.path||`groups/${GROUP_ID}/roles/${desired.id}`;
    await roblox(`/groups/${GROUP_ID}/memberships/${membershipId}:assignRole`,{method:"POST",body:JSON.stringify({role:newPath})});
    for(const path of currentPaths) if(path!==newPath) await roblox(`/groups/${GROUP_ID}/memberships/${membershipId}:unassignRole`,{method:"POST",body:JSON.stringify({role:path})});
    const verified=await getMember(targetId);
    if(verified?.role?.id!==desired.id) throw new Error("Roblox accepted the request, but the new role could not be verified.");
    await logAction({actorId,actorName,targetId,targetName,previousRole:before?.name||"Unknown",newRole:desired.name,action,reason:"In-game Ranking Stick",status:"SUCCESS"});
    res.json({ok:true,message:`${targetName} was promoted to ${desired.name}.`,newRole:desired.name});
  } catch(e) {
    try { await logAction({actorId:actorId||"unknown",actorName,targetId:targetId||"unknown",targetName,previousRole:before?.name||null,newRole:null,action:action||"unknown",reason:"In-game Ranking Stick",status:"FAILED",details:e.message}); } catch {}
    next(e);
  }
});
app.get("/api/logs", requireLogin, requireRanker, async (req,res,next) => {
  try {
    const result = await pool.query("SELECT id,actor_id,actor_name,target_id,target_name,previous_role,new_role,action,reason,status,details,created_at FROM ranking_logs ORDER BY created_at DESC LIMIT 100");
    res.json({logs:result.rows});
  } catch(e) { next(e); }
});

app.use(express.static("public", { extensions:["html"] }));
app.get("*", (req,res) => res.sendFile(require("node:path").join(process.cwd(),"public","index.html")));
app.use((err,req,res,next) => {
  console.error("Portal error:", err.message, err.roblox || "");
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({error:status===500?"Something went wrong while contacting Roblox or the database. Check the backend logs for details.":err.message});
});
ensureSchema().then(() => {
  app.listen(PORT, () => console.log(`Lemonz Ranking Portal listening on ${PORT}`));
}).catch(err => {
  console.error("Database setup failed:",err);
  process.exit(1);
});
