# Running Pratibimb on Windows

## 1. Install Node.js

Install **Node.js 22 LTS** from [nodejs.org](https://nodejs.org/en/download). Node 22 is the safest choice because `better-sqlite3` ships prebuilt binaries for it.

Check it in PowerShell:

```powershell
node --version   # should start with v22.
```

## 2. Start the app

Double-click `start-pratibimb.cmd` in the project folder. The first run installs the dependencies, which takes a minute or two. After that, open http://localhost:5173.

Or, from PowerShell in the project folder:

```powershell
npm.cmd ci
npm.cmd run dev
```

Use `npm.cmd` rather than `npm` if PowerShell says running scripts is disabled.

The first start creates the demo database (`data\pratibimb.db`) and fits six synthetic patients' twins. This takes about 10 seconds.

## 3. Turn on the AI features (optional)

Forecasts, what-ifs and the care-team view work without any key. For meal photos, chat and lab-report reading:

1. Create a key in [Google AI Studio](https://aistudio.google.com/apikey).
2. Copy `.env.example` to `.env` in the project folder (the name must be exactly `.env`, not `.env.txt`).
3. Set `GEMINI_API_KEY=your-key` in `.env`.
4. Restart the app.

http://127.0.0.1:8787/api/health shows `"ai": true` once the key is picked up.

## 4. Sign in

| Role | Email | Password |
| --- | --- | --- |
| Patient | `suresh@pratibimb.demo` | `pratibimb` |
| Care team | `doctor@pratibimb.demo` | `pratibimb` |

## Production build on one port

```powershell
npm.cmd run build
npm.cmd start
```

Then open http://localhost:8787.

## Troubleshooting

- **`better-sqlite3` or `node-gyp` errors during install:** check that `node --version` starts with `v22.`, delete `node_modules`, and run `npm.cmd ci` again.
- **Port 8787 is busy:** close the other copy of the app. The web dev server forwards `/api` to port 8787.
- **AI stays off:** make sure the file is called `.env`, the key line has no `#` in front, and the app was restarted.
- **"AI is busy":** the Gemini free tier has low rate limits. Wait a minute, or set `AI_MODEL=gemini-3.5-flash-lite` in `.env`.
- **Start over:** stop the app, delete the `data` folder, and start it again.
