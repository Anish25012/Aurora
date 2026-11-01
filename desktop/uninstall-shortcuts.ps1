# Removes the Aurora shortcuts made by install-shortcuts.ps1 (doesn't touch the project itself).
foreach ($path in @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Aurora.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Aurora.lnk')
  )) {
  if (Test-Path $path) {
    Remove-Item $path
    Write-Output "Removed $path"
  }
}
