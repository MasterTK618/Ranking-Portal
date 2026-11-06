-- Lemonz Activity Tracker (client telemetry)
-- Place this LocalScript in StarterPlayer > StarterPlayerScripts.
-- It contains no API key or portal secret.
local Players=game:GetService("Players")
local ReplicatedStorage=game:GetService("ReplicatedStorage")
local UserInputService=game:GetService("UserInputService")
local TextChatService=game:GetService("TextChatService")
local RunService=game:GetService("RunService")
local player=Players.LocalPlayer
local remote=ReplicatedStorage:WaitForChild("LemonzActivityMetrics")
local AFK_AFTER_SECONDS=60
local SEND_EVERY_SECONDS=30
local lastActivity=os.clock()
local focused=true
local activeSeconds,afkSeconds,typingSeconds,messages=0,0,0,0
local humanoid,rootPart,lastPosition
local function markActivity() lastActivity=os.clock() end
UserInputService.InputBegan:Connect(function() markActivity() end)
UserInputService.WindowFocusReleased:Connect(function() focused=false end)
UserInputService.WindowFocused:Connect(function() focused=true;markActivity() end)
local function bindCharacter(char)
    humanoid=char:WaitForChild("Humanoid",10);rootPart=char:WaitForChild("HumanoidRootPart",10)
    lastPosition=rootPart and rootPart.Position or nil
end
player.CharacterAdded:Connect(bindCharacter)
if player.Character then task.spawn(bindCharacter,player.Character) end
local integratedChat = false
pcall(function() integratedChat = TextChatService.PlatformIntegratedChat == Enum.RolloutState.Enabled end)
if integratedChat then
    TextChatService.MessageReceived:Connect(function(message)
        local source = message.TextSource
        if source and source.UserId == player.UserId then
            messages = math.min(100, messages + 1)
            markActivity()
        end
    end)
end
local function chatFocused()
    local ok,value=pcall(function() return TextChatService.ChatInputBarConfiguration.IsFocused end)
    return ok and value==true
end
local function flush()
    if activeSeconds+afkSeconds<=0 and typingSeconds<=0 then return end
    remote:FireServer({activeSeconds=activeSeconds,afkSeconds=afkSeconds,typingSeconds=typingSeconds,messages=messages})
    activeSeconds,afkSeconds,typingSeconds,messages=0,0,0
end
local sendElapsed,moveElapsed=0,0
RunService.Heartbeat:Connect(function(dt)
    moveElapsed+=dt
    if moveElapsed>=1 then
        moveElapsed=0
        if humanoid and humanoid.Parent and humanoid.MoveDirection.Magnitude>0.05 then markActivity() end
        if rootPart and rootPart.Parent then
            local pos=rootPart.Position
            if lastPosition and (pos-lastPosition).Magnitude>0.15 then markActivity() end
            lastPosition=pos
        end
    end
    local isAfk=(not focused) or (os.clock()-lastActivity>=AFK_AFTER_SECONDS)
    if isAfk then afkSeconds+=dt else activeSeconds+=dt;if chatFocused() then typingSeconds+=dt end end
    sendElapsed+=dt
    if sendElapsed>=SEND_EVERY_SECONDS then sendElapsed=0;flush() end
end)
