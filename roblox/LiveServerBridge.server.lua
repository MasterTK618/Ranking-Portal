-- Lemonz Live Server Bridge. Place in ServerScriptService.
-- Reports every player and runs only the portal's allowlisted moderation actions.
local Players=game:GetService("Players")
local HttpService=game:GetService("HttpService")
local TextChatService=game:GetService("TextChatService")
local TeleportService=game:GetService("TeleportService")
local TextService=game:GetService("TextService")
local ReplicatedStorage=game:GetService("ReplicatedStorage")
local URL="https://ranking-portal.onrender.com"
local GAME_SECRET="PASTE_THE_SAME_INGAME_API_SECRET_HERE"
local SERVER_ID=game.JobId~="" and game.JobId or ("studio-"..game.PlaceId)
local joined,muted,ranks={},{},{}
local loggedMessages={}
local remote=ReplicatedStorage:FindFirstChild("LemonzPortalNotice") or Instance.new("RemoteEvent")
remote.Name="LemonzPortalNotice";remote.Parent=ReplicatedStorage
local function call(path,method,data)
 if GAME_SECRET=="" or GAME_SECRET=="PASTE_THE_SAME_INGAME_API_SECRET_HERE" then return nil end
 local ok,r=pcall(function() return HttpService:RequestAsync({Url=URL..path,Method=method,Headers={["Content-Type"]="application/json",["x-lemonz-game-key"]=GAME_SECRET},Body=data and HttpService:JSONEncode(data) or nil}) end)
 if not ok or not r.Success then warn("[Lemonz Portal] Request failed",r and r.StatusCode);return nil end
 local good,result=pcall(function() return HttpService:JSONDecode(r.Body) end);return good and result or {}
end
local function report()
 local list={}
 for _,p in ipairs(Players:GetPlayers()) do
  table.insert(list,{userId=tostring(p.UserId),username=p.Name,displayName=p.DisplayName,staffRank=ranks[p] or 0,joinedAt=joined[p]})
 end
 call("/api/management/live/heartbeat","POST",{serverId=SERVER_ID,placeId=tostring(game.PlaceId),players=list})
end
local function filter(channel)
 if channel:IsA("TextChannel") then pcall(function()
  channel.ShouldDeliverCallback=function(message)
   local source=message.TextSource
   if source and (channel.Name=="RBXGeneral" or channel.Name=="General") then
    local userId=source.UserId
    local messageId=tostring(message.MessageId or "")
    if messageId~="" and not loggedMessages[messageId] then
     loggedMessages[messageId]=true
     local sender=Players:GetPlayerByUserId(userId)
     local rawText=tostring(message.Text or ""):sub(1,500)
     if sender and rawText~="" then
      task.spawn(function()
       -- ShouldDeliverCallback runs before Roblox's normal delivery filtering.
       -- Apply Roblox's broadcast filter ourselves and never store raw chat text.
       local ok,filtered=pcall(function()
        local result=TextService:FilterStringAsync(rawText,userId)
        return result:GetNonChatStringForBroadcastAsync()
       end)
       if ok and filtered and filtered~="" then
        call("/api/management/chat-log","POST",{serverId=SERVER_ID,placeId=tostring(game.PlaceId),userId=tostring(userId),username=sender.Name,displayName=sender.DisplayName,channel=channel.Name,messageId=messageId,message=filtered:sub(1,500)})
       else
        warn("[Lemonz Portal] Chat log message was skipped because Roblox filtering failed.")
       end
      end)
     end
     task.delay(300,function() loggedMessages[messageId]=nil end)
    end
   end
   return not(source and muted[source.UserId])
  end
 end) end
end
for _,v in ipairs(TextChatService:GetDescendants()) do filter(v) end
TextChatService.DescendantAdded:Connect(filter)
local function execute(c)
 local action=c.action;local payload=c.payload or {};local target
 if c.target_user_id then for _,p in ipairs(Players:GetPlayers()) do if tostring(p.UserId)==tostring(c.target_user_id) then target=p end end;if not target then return false,"Player left the server." end end
 if action=="kick" then target:Kick(payload.reason or "Removed by Lemonz staff.")
 elseif action=="warn" then
  remote:FireClient(target,{kind="warning",message="You have received a staff warning. The reason is recorded in the Lemonz portal."})
 elseif action=="respawn" then target:LoadCharacterAsync()
 elseif action=="mute" then muted[target.UserId]=true;remote:FireClient(target,{kind="warning",message="You have been muted by staff."})
 elseif action=="unmute" then muted[target.UserId]=nil;remote:FireClient(target,{kind="success",message="Your mute has been removed."})
 elseif action=="announce" then
  local author=Players:GetPlayerByUserId(tonumber(c.requested_by))
  if not author then return false,"The staff member sending this announcement must be in this server so Roblox can filter the message." end
  local filtered=TextService:FilterStringAsync(tostring(payload.message or ""),author.UserId)
  local broadcast=filtered:GetNonChatStringForBroadcastAsync()
  if not broadcast or broadcast=="" then return false,"Announcement was blocked by Roblox text filtering." end
  remote:FireAllClients({kind="announcement",message=broadcast})
 elseif action=="shutdown" then for _,p in ipairs(Players:GetPlayers()) do p:Kick("This server was shut down by Lemonz management.") end
 elseif action=="restart" then TeleportService:TeleportAsync(game.PlaceId,Players:GetPlayers())
 else return false,"Unsupported command." end
 return true,"Executed "..action
end
local function addPlayer(p)
 joined[p]=tostring(DateTime.now().UnixTimestamp)
 local rank=0;pcall(function() rank=p:GetRankInGroup(16597698) end);ranks[p]=rank
end
Players.PlayerAdded:Connect(function(p) addPlayer(p);task.defer(report) end)
Players.PlayerRemoving:Connect(function(p) call("/api/management/live/leave","POST",{serverId=SERVER_ID,userId=tostring(p.UserId)});joined[p]=nil;muted[p.UserId]=nil;ranks[p]=nil end)
for _,p in ipairs(Players:GetPlayers()) do addPlayer(p) end
task.spawn(function() while task.wait(25) do report() end end)
task.spawn(function()
 while task.wait(4) do
  local data=call("/api/management/game-commands/pending?serverId="..HttpService:UrlEncode(SERVER_ID),"GET")
  for _,c in ipairs(data and data.commands or {}) do
   local ok,success,message=pcall(execute,c);local done=ok and success==true
   call("/api/management/game-commands/"..c.id.."/result","POST",{serverId=SERVER_ID,ok=done,result=tostring(done and message or (ok and message or success))})
  end
 end
end)
task.defer(report)
