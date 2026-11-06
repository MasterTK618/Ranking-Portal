-- Lemonz Activity Tracker (server)
-- Place in ServerScriptService. Pair with ActivityTracker.client.lua in StarterPlayerScripts.
-- Keep this secret here only. Never copy it into the LocalScript.
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local PORTAL_URL = "https://ranking-portal.onrender.com"
local GROUP_ID = 16597698
local MIN_STAFF_RANK = 230
local GAME_SECRET = "PASTE_THE_SAME_INGAME_API_SECRET_HERE"
local REMOTE_NAME = "LemonzActivityMetrics"
local remote = ReplicatedStorage:FindFirstChild(REMOTE_NAME) or Instance.new("RemoteEvent")
remote.Name = REMOTE_NAME
remote.Parent = ReplicatedStorage
local sessions, pendingMessages, lastFlush = {}, {}, {}
local warnedSecret = false
local function isStaff(player)
    local ok, rank = pcall(function() return player:GetRankInGroup(GROUP_ID) end)
    return ok and rank >= MIN_STAFF_RANK
end
local function request(event, player, metrics)
    if not player or not isStaff(player) then return false end
    if GAME_SECRET == "" or GAME_SECRET == "PASTE_THE_SAME_INGAME_API_SECRET_HERE" then
        if not warnedSecret then warnedSecret = true; warn("[Lemonz Activity] Set GAME_SECRET to Render's INGAME_API_SECRET.") end
        return false
    end
    local ok, response = pcall(function()
        return HttpService:RequestAsync({
            Url = PORTAL_URL .. "/api/management/activity/event", Method = "POST",
            Headers = {["Content-Type"]="application/json",["x-lemonz-game-key"]=GAME_SECRET},
            Body = HttpService:JSONEncode({event=event,userId=tostring(player.UserId),username=player.Name,jobId=game.JobId~="" and game.JobId or tostring(game.PlaceId),metrics=metrics})
        })
    end)
    if not ok then warn("[Lemonz Activity] Request failed:",response); return false end
    if not response.Success then warn("[Lemonz Activity] Portal returned",response.StatusCode,response.Body); return false end
    return true
end
local function flush(player)
    local data=sessions[player]; if not data then return end
    local metrics={activeSeconds=math.clamp(math.floor(data.activeSeconds),0,30),afkSeconds=math.clamp(math.floor(data.afkSeconds),0,30),typingSeconds=math.clamp(math.floor(data.typingSeconds),0,30),messages=math.clamp(math.floor(pendingMessages[player] or 0),0,100)}
    if metrics.activeSeconds+metrics.afkSeconds+metrics.typingSeconds+metrics.messages==0 then return end
    if request("metrics",player,metrics) then data.activeSeconds=0;data.afkSeconds=0;data.typingSeconds=0;pendingMessages[player]=0 end
end
local function startTracking(player)
    if not isStaff(player) or sessions[player] then return end
    sessions[player]={activeSeconds=0,afkSeconds=0,typingSeconds=0};pendingMessages[player]=0;lastFlush[player]=os.clock()
    request("join",player)
    player.Chatted:Connect(function()
        if sessions[player] then pendingMessages[player]=math.min(100,(pendingMessages[player] or 0)+1) end
    end)
end
remote.OnServerEvent:Connect(function(player,payload)
    if typeof(payload)~="table" or not sessions[player] or not isStaff(player) then return end
    local function valid(v) return typeof(v)=="number" and v==v and v>=0 and v<=30 end
    if not valid(payload.activeSeconds) or not valid(payload.afkSeconds) or not valid(payload.typingSeconds) then return end
    local active,afk,typing=math.floor(payload.activeSeconds),math.floor(payload.afkSeconds),math.floor(payload.typingSeconds)
    if active+afk>30 or typing>30 then return end
    local data=sessions[player];data.activeSeconds=math.min(30,data.activeSeconds+active);data.afkSeconds=math.min(30,data.afkSeconds+afk);data.typingSeconds=math.min(30,data.typingSeconds+typing)
    if os.clock()-(lastFlush[player] or 0)>=25 then lastFlush[player]=os.clock();task.spawn(flush,player) end
end)
Players.PlayerAdded:Connect(startTracking)
for _,player in ipairs(Players:GetPlayers()) do task.spawn(startTracking,player) end
Players.PlayerRemoving:Connect(function(player)
    flush(player);request("leave",player);sessions[player]=nil;pendingMessages[player]=nil;lastFlush[player]=nil
end)
game:BindToClose(function() for player in pairs(sessions) do flush(player);request("leave",player) end end)
