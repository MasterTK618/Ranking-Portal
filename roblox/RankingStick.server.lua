-- Lemonz Ranking Stick - Server Script
-- Place this Script inside the RankingStick Tool in StarterPack.
-- This is a server Script: keep GAME_SECRET here, never in a LocalScript.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local PORTAL_URL = "https://ranking-portal.onrender.com"
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
					local message = data.error or data.message
					if response.StatusCode == 404 and (not message or message == "") then
						message = "Portal returned HTTP 404. Check that PORTAL_URL is your exact Render service URL and that the latest server.js deployment is live."
					end
					sendStatus(actor, "result", message or ("Ranking failed (HTTP " .. tostring(response.StatusCode) .. ")."))
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

