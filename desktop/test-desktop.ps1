<#
  End-to-end check of the desktop app: starts Aurora, checks every part of it,
  simulates the player crashing, and closes it again. Takes about a minute.

    powershell -ExecutionPolicy Bypass -File desktop\test-desktop.ps1

  Close Aurora first (tray icon -> Exit Aurora). Windows will open and close
  while it runs; leave them alone until it prints the result.
#>

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$launcher = Join-Path $here 'launch-aurora.ps1'
$dataDir = Join-Path $env:LOCALAPPDATA 'Aurora'
$logFile = Join-Path $dataDir 'launcher.log'
$profileDir = (Join-Path $dataDir 'Window-chrome').ToLower()

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AuroraTest {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromRect(ref RECT r, uint flags);

  public static IntPtr FindByTitle(int[] pids, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, (int)pid) < 0 || !IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString() == title) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static bool IsToolWindow(IntPtr h) { return (GetLong(h, -20).ToInt64() & 0x80) != 0; }
  public static bool OnScreen(IntPtr h) { RECT r; GetWindowRect(h, out r); return MonitorFromRect(ref r, 0) != IntPtr.Zero; }
}
'@

$results = New-Object System.Collections.Generic.List[object]
function Check($name, [bool]$ok, $detail = '') {
  $results.Add([pscustomobject]@{ Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Check = $name; Detail = $detail })
  Write-Host ("  {0}  {1} {2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $detail)
}
function BrowserPids {
  @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($profileDir) } | ForEach-Object { [int]$_.ProcessId })
}
function Launchers {
  @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'launch-aurora\.ps1' -and $_.CommandLine -notmatch '-Exit' })
}
function LogSince($start) {
  if (-not (Test-Path $logFile)) { return @() }
  @(Get-Content $logFile | Where-Object { $_.Length -ge 19 -and [datetime]$_.Substring(0, 19) -ge $start.AddSeconds(-1) })
}
function WaitFor($seconds, [scriptblock]$condition) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if (& $condition) { return $true }; Start-Sleep -Milliseconds 500 }
  return $false
}
function StartLauncher { Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$launcher`"" }

if (@(Launchers).Count -gt 0) {
  Write-Host 'Aurora is running. Close it first (tray icon -> Exit Aurora), then run this again.'
  exit 1
}

Write-Host 'Testing the Aurora desktop app...'
$start = Get-Date

# 1. A leftover window from a "crashed" run should be cleaned up at start.
$browser = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
Start-Process $browser -ArgumentList "--user-data-dir=`"$(Join-Path $dataDir 'Window-chrome')`"", '--no-first-run', '--app=about:blank'
WaitFor 10 { (BrowserPids).Count -gt 0 } | Out-Null

# 2. Start it.
StartLauncher
$started = WaitFor 90 { (LogSince $start) -match 'running in the tray' }
Check 'starts and reaches the tray' $started
if (-not $started) { Write-Host (LogSince $start | Out-String); exit 1 }
Check 'cleans up windows left over from an earlier run' ([bool]((LogSince $start) -match 'left over'))

$res = try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5173/engine?engine' -TimeoutSec 5 } catch { $null }
Check 'server answers on 127.0.0.1:5173' ($res -and $res.StatusCode -eq 200)

$pids = BrowserPids
$engine = [AuroraTest]::FindByTitle($pids, 'Aurora Engine')
Check 'engine window exists' ($engine -ne [IntPtr]::Zero)
Check 'engine is off screen' ($engine -ne [IntPtr]::Zero -and -not [AuroraTest]::OnScreen($engine))
Check 'engine has no taskbar button' ($engine -ne [IntPtr]::Zero -and [AuroraTest]::IsToolWindow($engine))
$app = [AuroraTest]::FindByTitle($pids, 'Aurora')
Check 'app window is open' ($app -ne [IntPtr]::Zero) "(windows: $((Get-Process -Id $pids -ErrorAction SilentlyContinue | Where-Object MainWindowTitle | ForEach-Object MainWindowTitle) -join ', '))"
Check 'app window is on screen' ($app -ne [IntPtr]::Zero -and [AuroraTest]::OnScreen($app))

# 3. Starting again must not start a second copy.
StartLauncher
Start-Sleep 4
$count = @(Launchers).Count
Check 'a second launch reuses the running copy' ($count -eq 1) "($count running)"

# 4. Simulate the player crashing: it should come back on its own.
$crash = Get-Date
[AuroraTest]::PostMessage($engine, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
$back = WaitFor 40 { (LogSince $crash) -match 'engine running' }
Check 'restarts the player after a crash' $back
$engine2 = [AuroraTest]::FindByTitle((BrowserPids), 'Aurora Engine')
Check 'restarted player is tucked away again' ($engine2 -ne [IntPtr]::Zero -and [AuroraTest]::IsToolWindow($engine2) -and -not [AuroraTest]::OnScreen($engine2))

# 5. CPU while idle (after the restarted player has finished loading).
Start-Sleep 15
$procs = @(Launchers | ForEach-Object { Get-Process -Id $_.ProcessId }) + @(BrowserPids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
$cpu = { param($list) ($list | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum }
$before = & $cpu $procs
$t0 = Get-Date
Start-Sleep 10
$after = & $cpu @($procs | ForEach-Object { Get-Process -Id $_.Id -ErrorAction SilentlyContinue })
$percent = [math]::Round(100 * ($after - $before) / ((Get-Date) - $t0).TotalMilliseconds / [Environment]::ProcessorCount, 2)
Check 'light on the CPU when idle (under 2%)' ($percent -lt 2) "($percent%)"

# 6. Exit cleanly.
& powershell -NoProfile -ExecutionPolicy Bypass -File $launcher -Exit
$gone = WaitFor 20 { @(Launchers).Count -eq 0 -and (BrowserPids).Count -eq 0 }
Check '-Exit closes everything' $gone

$failed = @($results | Where-Object Result -eq 'FAIL').Count
Write-Host ''
if ($failed -eq 0) { Write-Host "All $($results.Count) checks passed." } else { Write-Host "$failed of $($results.Count) checks failed. See $logFile" }
exit [int]($failed -gt 0)
