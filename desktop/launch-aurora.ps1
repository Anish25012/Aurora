<#
  Starts Aurora as a desktop app (run through Aurora.vbs, so no console flashes):

  1. rebuilds the player if any of its source changed since the last build;
  2. starts Aurora's local server on http://127.0.0.1:5173 (player/server/aurora-server.mjs),
     or reuses one already running;
  3. opens the engine: an off-screen Chrome app window (/engine?engine) that is
     the "Aurora" Spotify device and plays the music;
  4. opens the window you use (/?desktop), a remote control for the engine;
  5. sits in the system tray: click to open Aurora, right-click -> Exit Aurora.

  Closing the window keeps the music playing; Exit Aurora closes everything.
  Starting it again while it runs just brings the window back.

  Built to recover on its own:
  - windows left over from a run that crashed or was killed are closed at
    start, so hidden players can't pile up;
  - if the engine dies, it's restarted (up to 3 times), not left silent;
  - the engine page checks in with the server every 5 s; if it goes quiet for
    45 s (Chrome froze or crashed it but left its window open), it's restarted too;
  - only this profile's Chrome windows are ever touched, never your own Chrome.

  Nothing here polls in a tight loop: the tray waits for Windows messages, and
  a 1-second timer only checks a few cheap flags (open/exit requests, engine alive).

    launch-aurora.ps1         start Aurora (or bring its window back)
    launch-aurora.ps1 -Exit   close a running Aurora cleanly

  Set AURORA_DEBUG_PORT (e.g. 9333) to inspect the browser via DevTools/CDP.
  desktop/test-desktop.ps1 checks all of this end to end.
#>
param([switch]$Exit)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$player = Join-Path (Split-Path $here) 'player'
$dataDir = Join-Path $env:LOCALAPPDATA 'Aurora'
$profileDir = Join-Path $dataDir 'Window-chrome'
$logFile = Join-Path $dataDir 'launcher.log'
$origin = 'http://127.0.0.1:5173'
New-Item -ItemType Directory -Force $dataDir | Out-Null

function Log($msg) { Add-Content -Path $logFile -Value "$(Get-Date -Format s)  $msg" }

# --- Single instance: a second launch asks the first to show its window. ------
$isFirst = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\AuroraDesktop', [ref]$isFirst)
$showRequest = New-Object System.Threading.EventWaitHandle($false, 'AutoReset', 'Local\AuroraDesktopShow')
$exitRequest = New-Object System.Threading.EventWaitHandle($false, 'AutoReset', 'Local\AuroraDesktopExit')
if (-not $isFirst) {
  if ($Exit) { $exitRequest.Set() | Out-Null } else { $showRequest.Set() | Out-Null }
  exit
}
if ($Exit) { $mutex.ReleaseMutex(); exit } # not running: nothing to close

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AuroraWin {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetLong(IntPtr hwnd, int index, IntPtr value);

  // Visible, titled top-level windows owned by these processes (Chrome also
  // keeps invisible helper windows, which this skips). With `title`, only
  // windows with exactly that title. (PowerShell passes $null as "", so an
  // empty title means "any".)
  public static IntPtr[] Find(int[] pids, string title) {
    var set = new HashSet<uint>();
    foreach (var p in pids) set.Add((uint)p);
    var found = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!set.Contains(pid) || !IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      var text = sb.ToString();
      if (string.IsNullOrEmpty(title) ? text.Length > 0 : text == title) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  // Keep a window running but out of sight: off screen, with no taskbar button
  // and no Alt+Tab entry. It must stay *shown*: Chrome never starts audio in a
  // hidden (SW_HIDE) window.
  public static void Tuck(IntPtr hwnd) {
    const int GWL_EXSTYLE = -20;
    const long WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
    ShowWindow(hwnd, 0); // the taskbar only notices the style change across a hide/show
    long ex = GetLong(hwnd, GWL_EXSTYLE).ToInt64();
    SetLong(hwnd, GWL_EXSTYLE, new IntPtr((ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW));
    SetWindowPos(hwnd, IntPtr.Zero, -32000, -32000, 420, 300, 0x0010 /* SWP_NOACTIVATE */);
    ShowWindow(hwnd, 4); // SW_SHOWNOACTIVATE
  }

  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromRect(ref RECT r, uint flags);

  // Chrome remembers where a window was, even somewhere no longer on any
  // screen (an unplugged monitor, or an older Aurora that hid it off screen).
  // Bring such a window back to the middle of the main screen.
  public static bool Rescue(IntPtr hwnd) {
    RECT r; GetWindowRect(hwnd, out r);
    if (MonitorFromRect(ref r, 0 /* MONITOR_DEFAULTTONULL */) != IntPtr.Zero) return false;
    var area = System.Windows.Forms.Screen.PrimaryScreen.WorkingArea;
    int w = Math.Min(1280, area.Width - 80), h = Math.Min(820, area.Height - 80);
    SetWindowPos(hwnd, IntPtr.Zero, area.Left + (area.Width - w) / 2, area.Top + (area.Height - h) / 2, w, h, 0x0004 /* SWP_NOZORDER */);
    return true;
  }
}
'@ -ReferencedAssemblies System.Windows.Forms, System.Drawing

# --- Browser: Chrome, or Edge (both include the DRM Spotify needs). -----------
$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

function Fail($msg) {
  Log "ERROR: $msg"
  [System.Windows.Forms.MessageBox]::Show($msg, 'Aurora', 'OK', 'Error') | Out-Null
  exit 1
}

if (-not $browser) { Fail 'Aurora needs Google Chrome or Microsoft Edge to play music. Install one, then try again.' }

Log '--- launching Aurora'

function Get-BrowserPids {
  # Only this Aurora profile's processes, never your everyday Chrome.
  $needle = $profileDir.ToLower()
  @(Get-CimInstance Win32_Process -Filter "Name='$([IO.Path]::GetFileName($browser))'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($needle) } |
    ForEach-Object { [int]$_.ProcessId })
}

# Close politely first, so the engine can disconnect from Spotify (otherwise a
# ghost "Aurora" device lingers in Spotify's device list for a while), then
# make sure.
function Close-Browser {
  foreach ($h in [AuroraWin]::Find((Get-BrowserPids), $null)) { [AuroraWin]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
  $deadline = (Get-Date).AddSeconds(4)
  while ((Get-BrowserPids).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
  Get-BrowserPids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

# We hold the single-instance lock, so any Aurora windows still open belong to
# a run that crashed or was killed. Start clean rather than adding a second engine.
if ((Get-BrowserPids).Count -gt 0) {
  Log 'closing windows left over from an earlier run'
  Close-Browser
}

# --- Build (only when something changed). -------------------------------------
$dist = Join-Path $player 'dist\index.html'
$sources = @('src', 'public', 'index.html', 'vite.config.ts', 'package.json', '.env.local') |
  ForEach-Object { Join-Path $player $_ } | Where-Object { Test-Path $_ }
$newest = Get-ChildItem $sources -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $dist) -or $newest.LastWriteTime -gt (Get-Item $dist).LastWriteTime) {
  Log "building (changed: $($newest.Name))"
  $build = Start-Process cmd.exe -ArgumentList '/c', 'npm run build' -WorkingDirectory $player -WindowStyle Hidden -Wait -PassThru `
    -RedirectStandardOutput (Join-Path $dataDir 'npm-out.log') -RedirectStandardError (Join-Path $dataDir 'npm-err.log')
  if ($build.ExitCode -ne 0) {
    if (Test-Path $dist) { Log 'build failed; using the previous build (see npm-out.log)' }
    else { Fail "Aurora couldn't be built. Details are in $dataDir\npm-out.log" }
  }
}

# --- Server. ------------------------------------------------------------------
function Test-Server {
  $client = New-Object System.Net.Sockets.TcpClient
  try { return $client.ConnectAsync('127.0.0.1', 5173).Wait(300) -and $client.Connected } catch { return $false } finally { $client.Dispose() }
}

$server = $null
if (Test-Server) {
  Log 'server already running; reusing it'
} else {
  Log 'starting server'
  # Aurora's local server: serves the built app.
  $serverScript = Join-Path $player 'server\aurora-server.mjs'
  if (-not (Test-Path $serverScript)) { Fail "Aurora's server is missing: $serverScript" }
  $server = Start-Process node -ArgumentList "`"$serverScript`"" -WorkingDirectory $player -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $dataDir 'server-out.log') -RedirectStandardError (Join-Path $dataDir 'server-err.log')
  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Test-Server)) {
    if ($server.HasExited -or (Get-Date) -gt $deadline) { Fail "Aurora's server didn't start. Details are in $dataDir\server-err.log" }
    Start-Sleep -Milliseconds 200
  }
}

# --- Browser windows. ---------------------------------------------------------
$commonArgs = @(
  "--user-data-dir=`"$profileDir`"",
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  # The engine is off screen; don't let Chrome treat it as hidden and slow it down.
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding'
)
if ($env:AURORA_DEBUG_PORT) { $commonArgs += "--remote-debugging-port=$($env:AURORA_DEBUG_PORT)" }

function Open-AppWindow($path, $extra = @()) {
  Start-Process $browser -ArgumentList ($commonArgs + $extra + "--app=$origin$path")
}

# The engine names its window "Aurora Engine" (src/Engine.tsx), which is how
# it's told apart from the window you use. Returns the window, or Zero.
#
# No --window-position here: Chrome applies the first launch's position and
# size to every later window too, which would put the window you use off
# screen as well. The engine opens normally and Tuck moves it away at once.
function Start-Engine {
  Log "opening engine ($browser)"
  Open-AppWindow '/engine?engine'
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $found = @([AuroraWin]::Find((Get-BrowserPids), 'Aurora Engine'))[0]
    if ($found) {
      [AuroraWin]::Tuck($found)
      Log 'engine running (off screen)'
      return $found
    }
  }
  return [IntPtr]::Zero
}

$script:engine = Start-Engine
if ($script:engine -eq [IntPtr]::Zero) { Fail "Aurora's player didn't start. Try again, or restart your PC if it keeps happening." }
$script:engineRestarts = 0

# The window you use: any of Aurora's windows that isn't the engine. (Not found
# by title, since the page may change its title.)
function Find-AppWindow {
  @([AuroraWin]::Find((Get-BrowserPids), $null) | Where-Object { $_ -ne $script:engine })[0]
}

function Show-Aurora {
  $win = Find-AppWindow
  if (-not $win) {
    Open-AppWindow '/?desktop' @('--window-size=1280,820')
    # Wait for it to appear (briefly), so a remembered off-screen spot can be fixed.
    $deadline = (Get-Date).AddSeconds(10)
    while (-not $win -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 200
      $win = Find-AppWindow
    }
    if (-not $win) { return }
  }
  if ([AuroraWin]::IsIconic($win)) { [AuroraWin]::ShowWindow($win, 9) | Out-Null } # SW_RESTORE
  if ([AuroraWin]::Rescue($win)) { Log 'moved the window back on screen' }
  [AuroraWin]::SetForegroundWindow($win) | Out-Null
}
Show-Aurora

# --- Tray. --------------------------------------------------------------------
$script:quitting = $false
function Exit-Aurora {
  if ($script:quitting) { return }
  $script:quitting = $true
  Log 'exiting'
  $timer.Stop()
  $tray.Visible = $false
  Close-Browser
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue; Log 'server stopped' }
  $tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-Object System.Drawing.Icon((Join-Path $here 'aurora-app.ico'), [System.Windows.Forms.SystemInformation]::SmallIconSize)
$tray.Text = 'Aurora'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open Aurora')
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Show-Aurora })
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Exit Aurora').add_Click({ Exit-Aurora })
$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({ if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Show-Aurora } })
$tray.Visible = $true

# --- Engine health. -----------------------------------------------------------
# The engine page checks in with the server every 5 seconds (src/Engine.tsx).
# Its window can outlive the page: Chrome may freeze or crash the page and
# leave the window open, and then the window you use waits on "Connecting to
# Spotify..." forever. So the window existing isn't enough; it must check in.
$staleAfterMs = 45000
$graceSeconds = 60 # time for a new engine to load before it has to check in

# Milliseconds since the engine last checked in, or $null if the server can't
# say (e.g. it's the Vite dev server, which doesn't keep track).
function Get-EngineSilence {
  try {
    $req = [System.Net.WebRequest]::Create("$origin/engine-alive")
    $req.Timeout = 1000
    $res = $req.GetResponse()
    try { $body = (New-Object System.IO.StreamReader($res.GetResponseStream())).ReadToEnd() } finally { $res.Close() }
    if ($body -match '^\{"ageMs":(\d+)\}$') { return [long]$Matches[1] }
  } catch {}
  return $null
}

# Start a new engine, so the music can carry on. Give up after a few tries
# close together, rather than loop forever on something that keeps failing
# (restarts spread over days don't count against each other).
function Restart-Engine($reason) {
  if (((Get-Date) - $script:lastRestart).TotalMinutes -gt 10) { $script:engineRestarts = 0 }
  $script:engineRestarts++
  $script:lastRestart = Get-Date
  if ($script:engineRestarts -gt 3) { Log "engine $reason again; giving up"; Exit-Aurora; return }
  Log "engine $reason; restarting it (try $($script:engineRestarts) of 3)"
  $timer.Stop()
  if ([AuroraWin]::IsWindow($script:engine)) {
    [AuroraWin]::PostMessage($script:engine, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null # WM_CLOSE
    $deadline = (Get-Date).AddSeconds(5)
    while ([AuroraWin]::IsWindow($script:engine) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if ([AuroraWin]::IsWindow($script:engine)) {
      # The whole browser is stuck: start it again, window and all.
      Log 'browser not responding; reopening it'
      Close-Browser
      $script:reopenWindow = $true
    }
  }
  $script:engine = Start-Engine
  if ($script:engine -eq [IntPtr]::Zero) { Log 'engine restart failed'; Exit-Aurora; return }
  if ($script:reopenWindow) { $script:reopenWindow = $false; Show-Aurora }
  $script:checkAt = (Get-Date).AddSeconds($graceSeconds)
  $timer.Start()
}

$script:lastRestart = [datetime]::MinValue
$script:reopenWindow = $false
$script:checkAt = (Get-Date).AddSeconds($graceSeconds)
$script:lastTick = Get-Date

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.add_Tick({
  if ($exitRequest.WaitOne(0)) { Exit-Aurora; return }
  if ($showRequest.WaitOne(0)) { Show-Aurora }
  $now = Get-Date
  # A long gap between ticks means the PC was asleep: everything was paused,
  # not stuck, so give the engine time to check in again.
  if (($now - $script:lastTick).TotalSeconds -gt 30) { $script:checkAt = $now.AddSeconds($graceSeconds) }
  $script:lastTick = $now
  # The engine went away (it crashed, or Chrome was closed or updated).
  if (-not [AuroraWin]::IsWindow($script:engine)) { Restart-Engine 'closed'; return }
  # Its window is there, but is the page inside still working?
  if ($now -ge $script:checkAt) {
    $script:checkAt = $now.AddSeconds(10)
    $silence = Get-EngineSilence
    if ($null -ne $silence -and $silence -gt $staleAfterMs) { Restart-Engine "stopped responding ($([int]($silence / 1000)) s)" }
  }
})
$timer.Start()

Log 'running in the tray'
[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
