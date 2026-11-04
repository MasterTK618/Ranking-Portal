# Lemonz Ranking Portal

A Roblox account-ownership-verified ranking portal for Lemonz group **16597698**.

## Included

- Lemonz yellow branding, with a dark/light theme toggle (no green theme).
- Roblox profile-code verification: users prove account control by temporarily placing a one-time code in their public Roblox profile description.
- Server-side group role lookup. Browser-submitted IDs/ranks are never trusted for authorization.
- Rank access restricted to group rank **245 and above**.
- Member username lookup, current role display, promote/demote/set-role actions.
- The backend only offers roles strictly below the signed-in rank.
- Demotions require a reason.
- PostgreSQL-backed sessions and ranking audit logs, including in-game actions.
- In-game Ranking Stick API with server-side rank checks and owner-configurable rank locks.
- API rate limiting, secure session cookies, CSRF header checks, and security headers.

## Important

This is a backend-backed application, not a static GitHub Pages site. The Roblox API key, session secret, and database credentials must only be stored as private environment variables on the backend host. Never add real credentials to this repository.

The Roblox Open Cloud Groups API supports assigning and unassigning group roles. The backend assigns the destination role first, then removes the member's previous role assignments, and finally checks the member's resulting role. If a multi-step role update fails partway through, inspect the member's role in Roblox and the backend logs before retrying.

## 1. Create a PostgreSQL database and deploy the backend

One straightforward hosting option is Render:

1. Create a PostgreSQL database in your Render dashboard.
2. Create a **Web Service** connected to this GitHub repository.
3. Runtime: **Node**.
4. Build command: `npm install`.
5. Start command: `npm start`.
6. Add the environment variables below in the Render service settings.
7. Use the database's **internal** connection string for `DATABASE_URL` when the web service and database are both on Render.
8. Deploy the service. The app serves its own frontend from the `public` folder.

Hosting and database plans can have charges. Check the current plan and pricing before creating resources.

## 3. Environment variables

Set these privately in the backend host dashboard. Use `.env.example` as the checklist.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | A long, random secret (at least 32 random bytes) |
| `DATABASE_URL` | PostgreSQL connection string |
| `ROBLOX_API_KEY` | Your Roblox Open Cloud API key |
| `INGAME_API_SECRET` | A long random shared secret used only between Roblox server scripts and this backend |
| `ROBLOX_GROUP_ID` | `16597698` |
| `MIN_RANK` | `245` |

For the Open Cloud API key, grant only the Groups permissions required to read group roles, read group memberships, and assign/unassign member roles. Restrict the key to group 16597698 if the dashboard offers that restriction.

Redeploy after changing environment variables. `APP_URL` is not used by the profile-code login flow.

## 4. Verify it

1. Open the backend URL.
2. Choose **Verify with Roblox**, enter your username, and place the temporary code in your public Roblox profile description.
3. Return to the portal and complete verification. The server checks the public profile description, then fetches the account's current Lemonz group rank from Roblox.
4. A rank below 245 can sign in but cannot access ranking tools.
5. A rank of 245 or above can search a member and assign only roles below their own rank.
6. Check Ranking logs after a test action.


## In-game Ranking Stick

The repository includes two Roblox scripts:

- `roblox/RankingStick.server.lua` — server-side queue and secure request to the portal.
- `roblox/RankingStick.client.lua` — player highlighting, Promote/Demote selector, and queue status display.

### Configure the game connection

1. In Render, open the web service's **Environment** settings and add `INGAME_API_SECRET`. Use a long, random value (at least 32 characters). Do not send it to anyone or commit it to GitHub.
2. Copy your Render service's public URL (for example, `https://your-service.onrender.com`).
3. In `roblox/RankingStick.server.lua`, replace `PORTAL_URL` with that exact URL and `GAME_SECRET` with the same secret you entered in Render.
4. In Roblox Studio, create a Tool named `RankingStick` in `StarterPack`.
5. Add a Part named `Handle` inside the Tool.
6. Add a normal **Script** and paste the contents of `roblox/RankingStick.server.lua`.
7. Add a **LocalScript** and paste the contents of `roblox/RankingStick.client.lua`.
8. In Studio, open **Game Settings → Security** and enable **Allow HTTP Requests**.
9. Publish the experience and test with two players in a private server.

Keep the shared secret only in the normal server Script and Render's private environment settings. Never put it in the LocalScript, ReplicatedStorage, a client-visible ModuleScript, or chat.

### Dashboard rank locks

The group owner (rank 255) sees **Settings** in the portal. These controls configure:
- Minimum staff rank required to use the in-game stick.
- Minimum current rank a target must have before the stick can promote or demote them.
- Whether in-game ranking, promotions, and demotions are enabled.

Each in-game request is checked again by the portal against the live Roblox group ranks and settings. Successful and failed ranking requests are recorded in the same **Ranking logs** page as website rankings. The stick processes requests in queue order and shows the queue position and result to the staff member.

## Local development

1. Install Node.js 20 or newer and PostgreSQL.
2. Copy `.env.example` to `.env` and fill in the values.
4. Run `npm install`.
5. Run `npm start`.
6. Visit `http://localhost:3000`.

## Security notes

- This profile-code check is a custom account-ownership challenge, not Roblox OAuth. The code is temporary and should be removed from the profile after login.
- Do not publish secrets in GitHub issues, commits, screenshots, or chat.
- If an API key or OAuth secret is exposed, revoke/rotate it in the Roblox dashboard immediately.
- The portal checks the actor's live Roblox rank before exposing ranking tools and again before every ranking operation.
- Roblox itself remains the final authority and may reject role changes if the API key owner lacks the necessary group permissions.
- Keep the database private and enable backups where available.
