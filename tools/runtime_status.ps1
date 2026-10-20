param(
 [Parameter(Mandatory=$true)][string]$Lease,
 [string]$OwnerReceipt
)
# Read-only. Never claims, repairs, releases, focuses, closes or kills a session.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$report=@{schema=1;utc=[DateTime]::UtcNow.ToString('o');status='NOT_TESTED';reason='Inventory pending';leasePath=[IO.Path]::GetFullPath($Lease);processes=@();lease=$null;owner=$null;mutated=$false}
function Field($value,[string]$name) {if($null -ne $value -and $value.PSObject.Properties.Name -contains $name){return $value.$name};return $null}
try {
 $report.lease=Get-Content -LiteralPath $Lease -Raw|ConvertFrom-Json
 if($OwnerReceipt){$report.owner=Get-Content -LiteralPath $OwnerReceipt -Raw|ConvertFrom-Json}
 $native=@(Get-CimInstance Win32_Process -OperationTimeoutSec 3 | Where-Object {$_.Name -match '^(ArmaReforger|Workbench|workbenchApp)'})
 $report.processes=@($native|ForEach-Object {@{pid=[int]$_.ProcessId;exe=$_.ExecutablePath;creationUtc=$_.CreationDate.ToUniversalTime().ToString('o')}})
 $leasePid=Field $report.lease 'pid'
 $active=Field $report.lease 'activeRuntime'
 $state=Field $report.lease 'status'
 $parallel=Field $report.lease 'parallelCaptures'
 if($state -match '^released' -and !$leasePid -and !$active -and !$parallel -and !$native.Count) {
  $report.status='PASS';$report.reason='Released lease and fresh native inventory empty; admission remains the adapter responsibility'
 } elseif($parallel) {$report.reason='Coordinated parallel owners present; preserve all sessions'}
 elseif(!$leasePid -and ($active -or $state -notmatch '^released')) {$report.reason='Reserved/starting or malformed lease; age alone cannot release it'}
 elseif($leasePid) {
  $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$leasePid) -OperationTimeoutSec 3
  if(!$current){$report.reason='Lease PID absent in successful fresh query; stale candidate requires owner reconciliation, never automatic release'}
  elseif(!$report.owner){$report.reason='Native session present; owner receipt required for exact identity check'}
  else {
   $expectedPid=Field $report.owner 'pid';$expectedExe=Field $report.owner 'exe';$created=Field $report.owner 'creationUtc'
   $profile=Field $report.owner 'profile'
   if($expectedPid -ne $leasePid -or !$expectedExe -or !$created -or !$profile){$report.reason='Owner receipt incomplete/different; preserve session'}
   elseif($current.ExecutablePath -ne $expectedExe -or $current.CreationDate.ToUniversalTime().Ticks -ne ([DateTime]$created).ToUniversalTime().Ticks -or !$current.CommandLine -or !$current.CommandLine.Contains($profile)){$report.reason='PID/executable/creation/profile identity mismatch; preserve session'}
   else {$report.reason='Owner identity present; session busy. This read-only diagnostic does not authorize control or full argv equivalence'}
  }
 } else {$report.reason='Native process exists outside released lease; reconcile owner before launch'}
} catch {$report.reason='Read/query unavailable: '+$_.Exception.Message}
$report|ConvertTo-Json -Depth 15
if($report.status -eq 'PASS'){exit 0};exit 2
