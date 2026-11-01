<#
  Adds "Aurora" shortcuts, with the Aurora icon, to the Desktop and Start menu.
  Run it again any time (it just overwrites them). To remove them, run
  uninstall-shortcuts.ps1.
#>

$here = $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Aurora.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Aurora.lnk')
)

foreach ($path in $targets) {
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $link.Arguments = "`"$(Join-Path $here 'Aurora.vbs')`""
  $link.WorkingDirectory = $here
  $link.IconLocation = "$(Join-Path $here 'aurora-app.ico'),0"
  $link.Description = 'Aurora: every song, beautifully played'
  $link.Save()
  Write-Output "Created $path"
}
