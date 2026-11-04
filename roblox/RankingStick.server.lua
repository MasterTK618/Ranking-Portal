-- Lemonz Ranking Stick - Server Script
-- Place this Script inside the RankingStick Tool in StarterPack.
-- This is a server Script: keep GAME_SECRET here, never in a LocalScript.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local PORTAL_URL = "https://YOUR-RENDER-SERVICE.onrender.com"
local GAME_SECRET = "PASTE_THE_SAME_INGAME_API_SECRET_FROM_RENDER_HERE"

local tool = script.Parent
local remote = tool:FindFirstChild("RankRequest") or Instance.new("RemoteEvent")
remote.Name = "RankRequest"
remote.Parent = tool

local queue = {}
local processing = false
local lastRequest = {}

local function sendStatus(player, state, message, position)
	if player and player.Parent == Players then
		remote:FireClient(player, state, message, position)
	end
end

local function processQueue()
	if processing then return end
	processing = true

	while #queue > 0 do
		local item = table.remove(queue, 1)
		local actor = item.actor
		if actor and actor.Parent == Players then
			sendStatus(actor, "processing", "Processing " .. item.target.Name .. "...")

			local ok, response = pcall(function()
				return HttpService:RequestAsync({
					Url = PORTAL_URL .. "/api/game/rank",
					Method = "POST",
					Headers = {
						["Content-Type"] = "application/json",
						["x-lemonz-game-key"] = GAME_SECRET
					},
					Body = HttpService:JSONEncode({
						actorId = actor.UserId,
						targetId = item.target.UserId,
						action = "promote"
					})
				})
			end)

			if not ok then
				sendStatus(actor, "result", "Request failed: " .. tostring(response))
			else
				local data = {}
				pcall(function() data = HttpService:JSONDecode(response.Body) end)
				if response.Success and data.ok then
					sendStatus(actor, "result", data.message or "Ranking successful!")
				else
					sendStatus(actor, "result", data.error or ("Ranking failed (HTTP " .. tostring(response.StatusCode) .. ")."))
				end
			end
		end
	end

	processing = false
end

remote.OnServerEvent:Connect(function(actor, target, action)
	if typeof(target) ~= "Instance" or not target:IsA("Player") then return end
	if target == actor or target.Parent ~= Players then
		sendStatus(actor, "result", "You cannot rank yourself or a player who left.")
		return
	end
	if action ~= "promote" then return end
	if tool.Parent ~= actor.Character then
		sendStatus(actor, "result", "Equip the Ranking Stick first.")
		return
	end

	local now = os.clock()
	if lastRequest[actor.UserId] and now - lastRequest[actor.UserId] < 2 then
		sendStatus(actor, "result", "Please wait before adding another player.")
		return
	end
	lastRequest[actor.UserId] = now

	if #queue >= 25 then
		sendStatus(actor, "result", "The ranking queue is full. Try again shortly.")
		return
	end

	table.insert(queue, {actor = actor, target = target})
	local position = #queue
	sendStatus(actor, "queued", "Added " .. target.Name .. " to the ranking queue.", position)
	task.spawn(processQueue)
end)

Players.PlayerRemoving:Connect(function(player)
	lastRequest[player.UserId] = nil
end)


-- Chat command: !promote username
local function findTarget(actor, query)
	query = string.lower(string.gsub(query or "", "^%s*(.-)%s*$", "%1"))
	if query == "" then return nil, "Usage: !promote username" end

	local exact = {}
	local partial = {}
	for _, candidate in ipairs(Players:GetPlayers()) do
		if candidate ~= actor then
			local username = string.lower(candidate.Name)
			local display = string.lower(candidate.DisplayName)
			if username == query then
				table.insert(exact, candidate)
			elseif string.sub(username, 1, #query) == query or string.sub(display, 1, #query) == query then
				table.insert(partial, candidate)
			end
		end
	end

	local matches = #exact > 0 and exact or partial
	if #matches == 1 then return matches[1] end
	if #matches > 1 then return nil, "More than one player matches. Use their full username." end
	return nil, "Player not found in this server."
end

local function queuePromotion(actor, target)
	if not actor or actor.Parent ~= Players then return end
	if not target or target == actor or target.Parent ~= Players then
		sendStatus(actor, "result", "You cannot promote yourself or a player who left.")
		return
	end
	local now = os.clock()
	if lastRequest[actor.UserId] and now - lastRequest[actor.UserId] < 2 then
		sendStatus(actor, "result", "Please wait before adding another player.")
		return
	end
	lastRequest[actor.UserId] = now
	if #queue >= 25 then
		sendStatus(actor, "result", "The ranking queue is full. Try again shortly.")
		return
	end
	table.insert(queue, {actor = actor, target = target})
	sendStatus(actor, "queued", "Added " .. target.Name .. " for promotion.", #queue)
	task.spawn(processQueue)
end

local function connectChatCommand(player)
	player.Chatted:Connect(function(message)
		local command, query = string.match(message, "^%s*(%S+)%s*(.-)%s*$")
		if command and string.lower(command) == "!promote" then
			local target, err = findTarget(player, query)
			if not target then
				sendStatus(player, "result", err)
				return
			end
			queuePromotion(player, target)
		end
	end)
end

for _, player in ipairs(Players:GetPlayers()) do connectChatCommand(player) end
Players.PlayerAdded:Connect(connectChatCommand)
