# RGD System

RGD System provides verification tickets, welcome and leave messages, and a private web dashboard for the welcome and leave messages.

Commands: `/verify`, `/welcome`, and `/leave`.

## Setup

1. Replace the old project's code with the contents of this folder and keep your existing `.env`.
2. Use Node.js 22.12 or newer. Run `npm ci`.
3. Create a `.env` file (or set environment variables in your host's panel) using the table below.
4. In the Discord Developer Portal, open your application → **Bot** → **Privileged Gateway Intents** and enable **Server Members Intent**. It is required for join/leave events. Message Content and Presence intents are not needed.
5. Make sure the bot is in your server with the `bot` and `applications.commands` scopes. Welcome/leave delivery needs **View Channel**, **Send Messages**, and **Embed Links** in its channels. Preserve the bot permissions required by the ticket system (manage channels, send messages).
6. Run `npm start`. Startup registers the three commands in `GUILD_ID`.
7. Run either command, select the channel and message format, edit your message, preview it, and click **Enable**. Configure welcome and leave separately; both start disabled.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `TOKEN` | Yes | Discord bot token |
| `GUILD_ID` | Yes | Your server ID |
| `TICKET_CATEGORY_ID` | For tickets | Category where ticket channels are created |
| `PING_ROLE_ID` | For tickets | Role that sees and is pinged in tickets |
| `LOG_CHANNEL_ID` | For tickets | Channel for ticket open/close logs |
| `TRANSCRIPT_CHANNEL_ID` | Optional | Used for ticket logs if `LOG_CHANNEL_ID` is not set |
| `DATA_FILE` | Optional | Settings file path (default `data/settings.json`) |
| `DASHBOARD_PASSWORD` | For dashboard | The dashboard is disabled when this is empty |
| `DASHBOARD_PORT` | Optional | Dashboard port (default 3000; `PORT` is used if the host sets it) |

## Panel controls

- **Channel picker:** choose a text or announcement channel.
- **Format:** normal message, embed only, or normal message + embed.
- **Edit text:** set the normal message, including multiline text and Discord formatting.
- **Edit embed:** set the title, description, hex color, and footer.
- **Images & author:** set a large image/GIF, thumbnail, author name, author icon, and clickable title link. Use direct public HTTP(S) image URLs. Local paths and uploaded files are not supported by the forms.
- **Preview:** privately displays the saved message using you as the sample member.
- **Send test:** posts the saved message in the configured channel using you as the sample member, even while disabled. It does not ping anyone.
- **Enable / Disable:** control automatic messages without deleting settings.
- **Ping:** allows mentioning only the joining/leaving member in normal text. Include `{user}` in that text. Mentions inside embeds do not produce notification pings; departed users cannot be notified in a server they have left. Everyone and role pings are blocked for welcome/leave messages.
- **Ignore bots:** skip bot joins/leaves when on.
- **Time:** show or hide the embed timestamp.

Changes save automatically. Empty editor fields clear the existing value. A color is required. Configure text before switching to a format that uses it. A usable message and channel are required before enabling.

Only members with **Manage Server** (or Administrator) can configure the bot. Setup panels and previews are private. Permission checks are repeated on every control and form submission.

## Placeholders

| Placeholder | Replaced with |
| --- | --- |
| `{user}` | Member mention |
| `{username}` | Discord username |
| `{displayName}` | Server display name, or the available user name |
| `{userId}` | Member's Discord ID |
| `{server}` | Server name |
| `{memberCount}` | Current server member count, including bots |
| `{avatar}` | Member avatar URL |
| `{serverIcon}` | Server icon URL, or blank if none |

Use placeholders in normal text, embed title, description, author name, or footer. Image/link fields accept an HTTP(S) URL, `{avatar}`, or `{serverIcon}`. Unknown placeholders remain unchanged. Text is shortened to Discord's limits after replacement. Dynamic names are escaped to avoid accidental Markdown formatting.

Leave messages also fire for members removed by a kick or ban. They do not distinguish the reason. A member's server nickname may be unavailable when Discord supplies an uncached departure; the bot falls back to the available user name. Events that happen while the bot is offline are not replayed.

## Saved configuration

Settings are written atomically to `data/settings.json`; they survive restarts when that file is retained. Keep that directory to retain settings. `DATA_FILE` can select a different persistent file path. Use one running bot process with this JSON storage. A damaged JSON file causes startup to fail visibly rather than overwriting your settings.

The ZIP includes no token or real server configuration. Do not commit `.env` or `data/`.

## Verification

Run `npm test` for the dependency-free checks of persistence, setting isolation, template replacement, limits, and validation. JavaScript syntax was also checked. Package installation and live Discord testing could not be completed in the build workspace because npm access was blocked. Test a real join and leave after enabling Server Members Intent and the panels.

If commands appear but no messages arrive, check that the relevant panel is enabled, its channel is correct, Server Members Intent is enabled, and the bot has channel permissions. Delivery failures are logged to the console.

Reference: https://docs.discord.com/developers/events/gateway#privileged-intents


## Private web dashboard

The bot now includes an optional private dashboard for the existing welcome and leave systems. It uses the same `DATA_FILE` settings store as the Discord slash commands, so changes made in either interface stay in sync.

1. Set `DASHBOARD_PASSWORD` to a long, unique password in your host environment. Do not commit the real password.
2. Start the bot normally with `npm start`. The dashboard listens on `PORT` when the host supplies one, otherwise `DASHBOARD_PORT`/port 3000.
3. Open the web-service URL, sign in, select Welcome or Leave, edit the embed with live preview, save, or send a test message.

For an internet-hosted deployment, use HTTPS (Render/Railway provide this on their public service URL). This first version intentionally uses a private password instead of Discord OAuth to avoid adding OAuth secrets and callback configuration. Sessions expire after 24 hours and are held in memory, so a bot restart signs the dashboard out.
