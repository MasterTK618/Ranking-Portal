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

	statusLabel = Instance.new("TextLabel")
	statusLabel.Name = "Status"
	statusLabel.AnchorPoint = Vector2.new(0.5, 0)
	statusLabel.Position = UDim2.new(0.5, 0, 0, 8)
	statusLabel.Size = UDim2.fromOffset(270, 24)
	statusLabel.BackgroundColor3 = Color3.fromRGB(25, 25, 25)
	statusLabel.BackgroundTransparency = 0.25
	statusLabel.BorderSizePixel = 0
	statusLabel.Font = Enum.Font.Gotham
	statusLabel.Text = "Aim at a player and click to promote"
	statusLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
	statusLabel.TextSize = 11
	statusLabel.TextTruncate = Enum.TextTruncate.AtEnd
	statusLabel.Parent = screenGui
	Instance.new("UICorner", statusLabel).CornerRadius = UDim.new(0, 5)
end

tool.Equipped:Connect(function(equippedMouse)
	mouse = equippedMouse
	equipped = true
	createGui()
	setStatus("Aim at a player and click to promote.")
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
	if not screenGui then createGui() end
	if state == "queued" then
		setStatus("Queue position " .. tostring(position) .. ": " .. tostring(message))
	else
		setStatus(tostring(message))
	end
end)
