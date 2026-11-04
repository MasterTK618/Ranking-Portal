-- Lemonz Ranking Stick - LocalScript
-- Place this LocalScript inside the same RankingStick Tool.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local tool = script.Parent
local remote = tool:WaitForChild("RankRequest")
local mouse
local equipped = false
local selectedAction = "promote"
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
	frame.Size = UDim2.fromOffset(310, 112)
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

	local function makeButton(name, text, x, action)
		local button = Instance.new("TextButton")
		button.Name = name
		button.Position = UDim2.fromOffset(x, 34)
		button.Size = UDim2.fromOffset(137, 27)
		button.BackgroundColor3 = action == selectedAction and Color3.fromRGB(245, 201, 40) or Color3.fromRGB(65, 64, 57)
		button.TextColor3 = Color3.fromRGB(255, 255, 255)
		button.Font = Enum.Font.GothamBold
		button.TextSize = 11
		button.Text = text
		button.Parent = frame
		Instance.new("UICorner", button).CornerRadius = UDim.new(0, 6)
		button.MouseButton1Click:Connect(function()
			selectedAction = action
			for _, child in ipairs(frame:GetChildren()) do
				if child:IsA("TextButton") then
					child.BackgroundColor3 = child.Name == (action == "promote" and "Promote" or "Demote")
						and Color3.fromRGB(245, 201, 40) or Color3.fromRGB(65, 64, 57)
					child.TextColor3 = child.Name == (action == "promote" and "Promote" or "Demote")
						and Color3.fromRGB(40, 34, 10) or Color3.fromRGB(255, 255, 255)
				end
			end
			setStatus(action == "promote" and "Click a player to promote them." or "Click a player to demote them.")
		end)
	end

	makeButton("Promote", "PROMOTE", 12, "promote")
	makeButton("Demote", "DEMOTE", 161, "demote")

	statusLabel = Instance.new("TextLabel")
	statusLabel.BackgroundTransparency = 1
	statusLabel.Position = UDim2.fromOffset(12, 68)
	statusLabel.Size = UDim2.new(1, -24, 0, 34)
	statusLabel.Font = Enum.Font.Gotham
	statusLabel.Text = "Click a player to add them to the queue."
	statusLabel.TextColor3 = Color3.fromRGB(235, 235, 230)
	statusLabel.TextSize = 10
	statusLabel.TextWrapped = true
	statusLabel.Parent = frame
end

tool.Equipped:Connect(function(equippedMouse)
	mouse = equippedMouse
	equipped = true
	createGui()
	setStatus("Select Promote or Demote, then click a player.")
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
	setStatus("Adding " .. target.Name .. " to the queue...")
	remote:FireServer(target, selectedAction)
end)

remote.OnClientEvent:Connect(function(state, message, position)
	if state == "queued" then
		setStatus("Queue position " .. tostring(position) .. ": " .. tostring(message))
	else
		setStatus(tostring(message))
	end
end)
