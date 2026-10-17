param([Parameter(Mandatory=$true)][string]$BuildConfig,[switch]$Background,[switch]$ValidateOnly,[switch]$Execute)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$harness607=$PSScriptRoot
$receipt607=$null
$attached607=$false
$started607=$false
$startAttempted607=$false
function Hash607([string]$path607){
 $algorithm607=[Security.Cryptography.SHA256]::Create();$stream607=[IO.File]::OpenRead($path607)
 try{return [BitConverter]::ToString($algorithm607.ComputeHash($stream607)).Replace('-','').ToLowerInvariant()}
 finally{$stream607.Dispose();$algorithm607.Dispose()}
}
function Full607([string]$root607,[string]$value607){if([IO.Path]::IsPathRooted($value607)){return [IO.Path]::GetFullPath($value607)};return [IO.Path]::GetFullPath((Join-Path $root607 $value607))}
function Within607([string]$root607,[string]$path607){return $path607.StartsWith(($root607.TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)}
function Quote607([string]$argument607){
 if([string]::IsNullOrEmpty($argument607) -or $argument607 -match '["\x00-\x1f]'){throw 'Empty, quoted or control-character launch argument refused.'}
 if($argument607 -notmatch '\s'){return $argument607}
 $trailing607=[regex]::Match($argument607,'\\+$').Length
 return '"'+$argument607+('\' * $trailing607)+'"'
}
function Registry607([string[]]$arguments607){
 $response607=@(& $python607 (Join-Path $harness607 'runtime_lease607.py') '--config' (Join-Path $harness607 'runtime_config607.json') @arguments607 2>&1)
 if($LASTEXITCODE -ne 0){throw ($response607 -join [Environment]::NewLine)}
 return ($response607 -join [Environment]::NewLine)|ConvertFrom-Json
}
try {
 $build607=Get-Content -LiteralPath $BuildConfig -Raw|ConvertFrom-Json
 if($build607.schema -ne 1 -or $build607.parallelApproved -ne $true){throw 'Build configuration lacks approved parallel-runtime scope.'}
 $buildRoot607=[IO.Path]::GetFullPath($build607.buildRoot)
 $addon607=Full607 $buildRoot607 $build607.addonPath
 $manifest607=Full607 $buildRoot607 $build607.manifestPath
 $exe607=[IO.Path]::GetFullPath($build607.gameExe)
 $python607=[IO.Path]::GetFullPath($build607.pythonExe)
 if(!(Within607 $buildRoot607 $addon607) -or !(Within607 $buildRoot607 $manifest607)){throw 'Build files must stay inside the independent build root.'}
 if(!(Test-Path -LiteralPath $exe607 -PathType Leaf) -or !(Test-Path -LiteralPath $python607 -PathType Leaf)){throw 'Configured installed runtime is missing; no installation or game start attempted.'}
 if((Hash607 $manifest607) -ne $build607.manifestSHA256){throw 'Pinned build manifest differs.'}
 $manifestData607=Get-Content -LiteralPath $manifest607 -Raw|ConvertFrom-Json
 $entries607=@($manifestData607.psobject.Properties)
 if($entries607.Count -ne $build607.fileCount){throw 'Pinned manifest file count differs.'}
 foreach($entry607 in $entries607){
  $file607=Full607 $addon607 $entry607.Name
  if(!(Within607 $addon607 $file607) -or !(Test-Path -LiteralPath $file607 -PathType Leaf) -or (Hash607 $file607) -ne $entry607.Value){throw ('Pinned addon file differs: '+$entry607.Name)}
 }
 if(@(Get-ChildItem -LiteralPath $addon607 -Recurse -File).Count -ne $build607.fileCount){throw 'Unexpected addon files.'}
 $lane607='user-review';$width607=1920;$height607=1080;$fps607=60;$window607='Normal'
 if($Background){$lane607='background-qa';$width607=1280;$height607=720;$fps607=30;$window607='Hidden'}
 $runName607=$lane607+'-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
 $run607=Join-Path $buildRoot607 ('runs-v2\'+$runName607)
 $profile607=Join-Path $run607 'profile';$logs607=Join-Path $run607 'logs';$downloads607=Join-Path $run607 'downloads'
 $addons607=Split-Path -Parent $addon607
 $spec607=@{lane=$lane607;label=$build607.label;workRoot=$buildRoot607;exe=$exe607;profile=$profile607;logs=$logs607;downloads=$downloads607;addons=$addons607;parallelApproved=$true;noOSInput=[bool]$Background;noFocus=$true;hiddenWindow=[bool]$Background;maxFPS=$fps607;width=$width607;height=$height607}
 $nativeArgs607=@('-profile',$profile607,'-logsDir',$logs607,'-addonDownloadDir',$downloads607,'-addonsDir',$addons607,'-addons',$build607.addonId,'-world',$build607.world,'-worldSystemsConfig',$build607.worldSystemsConfig,'-window',('-screenWidth='+$width607),('-screenHeight='+$height607),'-forceUpdate','-noFocus','-noBackend','-maxFPS',([string]$fps607))
 foreach($field607 in @('addonId','world','worldSystemsConfig')){if($build607.$field607 -isnot [string] -or $build607.$field607.StartsWith('-')){throw 'Non-string or option-like resource value refused.'}}
 $quoted607=($nativeArgs607|ForEach-Object {Quote607 ([string]$_)}) -join ' '
 if($ValidateOnly -or -not $Execute){@{status='harness607_validate_only_no_launch';files=$entries607.Count;lane=$lane607;manifestSHA256=Hash607 $manifest607;arguments=$nativeArgs607;windowStyle=$window607;registryMutated=$false;legacySlotMutated=$false;profileCreated=$false;gameStarted=$false;migrationEnabled=(Get-Content -LiteralPath (Join-Path $harness607 'runtime_config607.json') -Raw|ConvertFrom-Json).migrationEnabled}|ConvertTo-Json -Depth 5;exit 0}
 if((Get-Content -LiteralPath (Join-Path $harness607 'runtime_config607.json') -Raw|ConvertFrom-Json).migrationEnabled -ne $true){throw 'Runtime migration is disabled; coordinate legacy release before enabling a successor.'}
 # Source helper may create an owner receipt/run directory, but never launches
 # until its claim has also safely bridged the old global slot.
 New-Item -ItemType Directory -Path $run607 -Force|Out-Null
 $specPath607=Join-Path $run607 'launch-spec.json';$spec607|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $specPath607 -Encoding UTF8
 $receipt607=Join-Path $run607 'owner-lease-private.json'
 $controllerExe607=(Get-Process -Id $PID).Path
 $claim607=Registry607 @('claim','--spec',$specPath607,'--controller-id',([string]$PID),'--controller-exe',$controllerExe607,'--receipt-output',$receipt607)
 New-Item -ItemType Directory -Path (Join-Path $profile607 'profile'),$logs607,$downloads607 -Force|Out-Null
 $starting607=Registry607 @('starting','--receipt',$receipt607)
 $startAttempted607=$true
 $game607=Start-Process -FilePath $exe607 -WorkingDirectory (Split-Path -Parent $exe607) -ArgumentList $quoted607 -WindowStyle $window607 -PassThru
 $started607=$true
 $attach607=Registry607 @('attach','--receipt',$receipt607,'--process-id',([string]$game607.Id));$attached607=$true
 @{process=$attach607.result.process;exe=$exe607;run=$run607;profile=$profile607;arguments=$nativeArgs607;leaseId=$claim607.result.leaseId;noOSInput=[bool]$Background;windowStyle=$window607}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $run607 'owner.json') -Encoding UTF8
 $game607.WaitForExit()
 $release607=Registry607 @('release','--receipt',$receipt607)
 Write-Host ('Owned instance closed; lease released. Logs: '+$logs607)
 exit 0
} catch {
 Write-Host ('Harness607: '+$_.Exception.Message) -ForegroundColor Red
 if($receipt607 -and (Test-Path -LiteralPath $receipt607) -and !$startAttempted607){
  try {$cleanup607=Registry607 @('release','--receipt',$receipt607)}catch{Write-Host 'Reservation retained for ownership inspection.'}
 }
 if($started607 -and !$attached607){Write-Host 'Process attachment was not confirmed. Reservation and owner receipt are retained; no process was stopped.'}
 # No Stop-Process, input helper, focus API or broad process cleanup exists here.
 exit 1
}
