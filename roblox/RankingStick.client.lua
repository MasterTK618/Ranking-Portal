-- Lemonz Ranking Stick - LocalScript
-- Place this LocalScript inside the same RankingStick Tool.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local tool = script.Parent
local remote = tool:WaitForChild("RankRequest")
local mouse
local equipped = false
local hoveredPlayer
local highlight
local screenGui
local statusLabel

local function setStatus(message)
	if statusLabel then statusLabel.Text = message end
end

local function getPlayerFromPart(part)
	if not part then return nil end
	local model = part:FindFirstAncestorOfClass("Model")
	if not model then return nil end
	return Players:GetPlayerFromCharacter(model)
end

local function clearHighlight()
	if highlight then highlight:Destroy(); highlight = nil end
	hoveredPlayer = nil
end

local function createGui()
	local playerGui = player:WaitForChild("PlayerGui")
	local old = playerGui:FindFirstChild("LemonzRankingStickGui")
	if old then old:Destroy() end

	screenGui = Instance.new("ScreenGui")
	screenGui.Name = "LemonzRankingStickGui"
	screenGui.ResetOnSpawn = false
	screenGui.Parent = playerGui

	local frame = Instance.new("Frame")
	frame.Name = "Panel"
	frame.AnchorPoint = Vector2.new(0.5, 0)
	frame.Position = UDim2.new(0.5, 0, 0, 18)
	frame.Size = UDim2.fromOffset(310, 92)
	frame.BackgroundColor3 = Color3.fromRGB(28, 28, 25)
	frame.BorderSizePixel = 0
	frame.Parent = screenGui
	Instance.new("UICorner", frame).CornerRadius = UDim.new(0, 10)

	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Position = UDim2.fromOffset(12, 7)
	title.Size = UDim2.new(1, -24, 0, 20)
	title.Font = Enum.Font.GothamBold
	title.Text = "LEMONZ  •  RANKING STICK"
	title.TextColor3 = Color3.fromRGB(255, 218, 65)
	title.TextSize = 12
	title.Parent = frame


	statusLabel = Instance.new("TextLabel")
	statusLabel.BackgroundTransparency = 1
	statusLabel.Position = UDim2.fromOffset(12, 38)
	statusLabel.Size = UDim2.new(1, -24, 0, 42)
	statusLabel.Font = Enum.Font.Gotham
	statusLabel.Text = "Click a player to promote them, or type !promote username in chat."
	statusLabel.TextColor3 = Color3.fromRGB(235, 235, 230)
	statusLabel.TextSize = 10
	statusLabel.TextWrapped = true
	statusLabel.Parent = frame
end

tool.Equipped:Connect(function(equippedMouse)
	mouse = equippedMouse
	equipped = true
	createGui()
	setStatus("Click a player to promote them, or type !promote username in chat.")
end)

tool.Unequipped:Connect(function()
	equipped = false
	clearHighlight()
	if screenGui then screenGui:Destroy(); screenGui = nil end
	statusLabel = nil
end)

RunService.RenderStepped:Connect(function()
	if not equipped or not mouse then return end
	local targetPlayer = getPlayerFromPart(mouse.Target)
	if targetPlayer == player then targetPlayer = nil end
	if targetPlayer ~= hoveredPlayer then
		clearHighlight()
		hoveredPlayer = targetPlayer
		if hoveredPlayer and hoveredPlayer.Character then
			highlight = Instance.new("Highlight")
			highlight.FillColor = Color3.fromRGB(255, 218, 65)
			highlight.OutlineColor = Color3.fromRGB(255, 255, 255)
			highlight.FillTransparency = 0.65
			highlight.Adornee = hoveredPlayer.Character
			highlight.Parent = hoveredPlayer.Character
		end
	end
end)

tool.Activated:Connect(function()
	if not equipped then return end
	if not hoveredPlayer then
		setStatus("Aim at a player first.")
		return
	end
	local target = hoveredPlayer
	setStatus("Adding " .. target.Name .. " for promotion...")
	remote:FireServer(target, "promote")
end)

remote.OnClientEvent:Connect(function(state, message, position)
	if state == "queued" then
		setStatus("Queue position " .. tostring(position) .. ": " .. tostring(message))
	else
		setStatus(tostring(message))
	end
end)
