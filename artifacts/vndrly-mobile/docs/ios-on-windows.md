# Mobile app on a Windows PC

**Important:** Apple’s **iOS Simulator does not run on Windows**. It only exists on macOS (Xcode). There is no install, VM workaround, or Expo command that opens a simulator on Windows.

On Windows, use one of the paths below.

---

## Path 1 — TestFlight on your iPhone (recommended)

Uses the real app against **production** (`https://vndrly.ai`). Same build customers/foremen get.

1. On your iPhone, install **TestFlight** from the App Store (if needed).
2. Open **TestFlight** → **VNDRLY Field Mobile**.
3. If you don’t see the latest build yet, wait for Apple processing (often 5–15 minutes after a ship) or check email from App Store Connect.
4. Tap **Install** or **Update** (latest production builds are submitted via `pnpm run "ship it"`).
5. Open the app → sign in as foreman → test **Today**, **Schedule**, etc.

No Windows commands required after the build is in TestFlight.

---

## Path 2 — Foreman web portal in the browser (Windows)

Good for testing **web** foreman chrome (nav, AskV, schedule on desktop) without the phone.

1. Open **PowerShell** in the repo root (`C:\Users\JohnElerick\VNDRLY.ai`).

2. Start local API + web:

   ```powershell
   .\scripts\ensure-local-dev.ps1 -RefreshApi -OpenBrowser
   ```

3. Browser opens **http://localhost:5173/** (or open it manually).

4. Log in as a **foreman** user → go to **/foreman**.

Uses your local API on port **8080** and local Vite on **5173**.

---

## Path 3 — Dev server + iPhone on the same Wi‑Fi (code changes, pre‑TestFlight)

Use this only when you’re **changing mobile code** and want to see updates before the next TestFlight build.

The phone cannot use `localhost` — it must reach your PC’s **LAN IP**.

### One-time: find your PC’s IP

In PowerShell:

```powershell
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.' } | Select-Object -First 1).IPAddress
```

Example result: `192.168.1.42`

### Each dev session

1. In repo root, edit **`.env.local`** (create if missing):

   ```env
   EXPO_PUBLIC_DOMAIN=http://192.168.1.42:8080
   ```

   Replace with **your** IP from above.

2. Start API + web:

   ```powershell
   .\scripts\ensure-local-dev.ps1 -RefreshApi
   ```

3. Start the Expo dev server (new PowerShell window, repo root):

   ```powershell
   pnpm --filter @workspace/vndrly-mobile run dev:local
   ```

4. On the iPhone you still need a **dev or TestFlight build** of VNDRLY (not Expo Go — this app uses native modules TestFlight/dev builds provide).

5. For day‑to‑day foreman UX testing, **Path 1 (TestFlight)** is simpler than wiring LAN dev.

---

## What not to use on Windows

| Command / idea | Why skip on Windows |
|----------------|---------------------|
| `pnpm run ios:sim:local` | Requires Mac + Xcode |
| `pnpm run ios:sim:install` | Installs into **Mac** Simulator only |
| `pnpm run ios:sim:eas` | Builds a **simulator** `.app` — still needs a **Mac** to run it |
| iOS Simulator in Expo | Not available on Windows |

---

## Ship a new iPhone build (from Windows)

When mobile code changes and TestFlight needs updating:

```powershell
cd C:\Users\JohnElerick\VNDRLY.ai
pnpm run "ship it"
```

That typechecks, deploys web/API, builds iOS on EAS, and submits to TestFlight. Then repeat **Path 1** on your phone.

---

## Quick reference

| Goal | What to do on Windows |
|------|------------------------|
| Test foreman **mobile** UI | TestFlight on iPhone (Path 1) |
| Test foreman **web** UI | Browser → localhost:5173/foreman (Path 2) |
| Test mobile **code you just edited** | Path 3 + new TestFlight via `ship it` |
| iOS Simulator | Not on Windows — use iPhone or Mac |
