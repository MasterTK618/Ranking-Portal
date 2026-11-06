-- Lemonz Portal notices. Place in StarterPlayer > StarterPlayerScripts.
local Players=game:GetService("Players")
local ReplicatedStorage=game:GetService("ReplicatedStorage")
local player=Players.LocalPlayer
local remote=ReplicatedStorage:WaitForChild("LemonzPortalNotice")
local gui=Instance.new("ScreenGui");gui.Name="LemonzPortalNotices";gui.ResetOnSpawn=false;gui.DisplayOrder=100;gui.Parent=player:WaitForChild("PlayerGui")
local function show(kind,message)
 local frame=Instance.new("Frame");frame.AnchorPoint=Vector2.new(.5,0);frame.Position=UDim2.new(.5,0,0,18);frame.Size=UDim2.new(.8,0,0,64);frame.BackgroundColor3=Color3.fromRGB(34,34,30);frame.BorderSizePixel=0;frame.Parent=gui
 local corner=Instance.new("UICorner");corner.CornerRadius=UDim.new(0,12);corner.Parent=frame
 local stroke=Instance.new("UIStroke");stroke.Color=Color3.fromRGB(245,201,40);stroke.Transparency=.25;stroke.Parent=frame
 local title=Instance.new("TextLabel");title.BackgroundTransparency=1;title.Position=UDim2.fromOffset(14,7);title.Size=UDim2.new(1,-28,0,16);title.Font=Enum.Font.GothamBold;title.TextSize=11;title.TextXAlignment=Enum.TextXAlignment.Left;title.TextColor3=Color3.fromRGB(245,201,40);title.Text=kind=="announcement" and "LEMONZ ANNOUNCEMENT" or "STAFF NOTICE";title.Parent=frame
 local body=Instance.new("TextLabel");body.BackgroundTransparency=1;body.Position=UDim2.fromOffset(14,26);body.Size=UDim2.new(1,-28,0,30);body.Font=Enum.Font.Gotham;body.TextSize=13;body.TextWrapped=true;body.TextXAlignment=Enum.TextXAlignment.Left;body.TextColor3=Color3.new(1,1,1);body.Text=tostring(message or "");body.Parent=frame
 task.delay(kind=="announcement" and 8 or 6,function() if frame.Parent then frame:Destroy() end end)
end
remote.OnClientEvent:Connect(function(data) if typeof(data)=="table" then show(data.kind,data.message) end end)

 
-- Reports this player's own accepted public General chat messages.
local TextChatService = game:GetService("TextChatService")
local chatLogRemote = ReplicatedStorage:WaitForChild("LemonzPortalChatLog")
local sentMessages = {}

TextChatService.MessageReceived:Connect(function(message)
    local source = message.TextSource
    local channel = message.TextChannel
    if not source or source.UserId ~= player.UserId or not channel then
        return
    end
    if channel.Name ~= "RBXGeneral" and channel.Name ~= "General" then
        return
    end

    local messageId = tostring(message.MessageId or "")
    local messageText = tostring(message.Text or "")
    if messageId == "" or messageText == "" or sentMessages[messageId] then
        return
    end

    sentMessages[messageId] = true
    task.delay(300, function()
        sentMessages[messageId] = nil
    end)

    chatLogRemote:FireServer(channel.Name, messageId, messageText)
end)
