-- Lemonz Activity Tracker
-- Place this Script in ServerScriptService.
-- Set PORTAL_URL to your Render URL and GAME_SECRET to the same value as
-- Render's INGAME_API_SECRET. Never put this secret in a LocalScript.

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")

local PORTAL_URL = "https://ranking-portal.onrender.com"
local GAME_SECRET = "PASTE_THE_SAME_INGAME_API_SECRET_HERE"

local function report(event, player)
	if GAME_SECRET == "" or GAME_SECRET == "PASTE_THE_SAME_INGAME_API_SECRET_HERE" then
		warn("[Lemonz Activity] Set GAME_SECRET in this server Script.")
		return
	end

	local body = {
		event = event,
		userId = tostring(player.UserId),
		username = player.Name,
		jobId = game.JobId ~= "" and game.JobId or game.PlaceId
	}

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = PORTAL_URL .. "/api/management/activity/event",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["x-lemonz-game-key"] = GAME_SECRET
			},
			Body = HttpService:JSONEncode(body)
		})
	end)

	if not ok then
		warn("[Lemonz Activity] Request failed:", response)
	elseif not response.Success then
		warn("[Lemonz Activity] Portal returned", response.StatusCode, response.Body)
	end
end

Players.PlayerAdded:Connect(function(player)
	report("join", player)
end)

Players.PlayerRemoving:Connect(function(player)
	report("leave", player)
end)

for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(report, "join", player)
end
