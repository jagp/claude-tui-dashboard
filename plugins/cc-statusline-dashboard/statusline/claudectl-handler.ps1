# claudectl:// protocol handler — actuator verbs for statusline links.
# Invoked by the OS (via claudectl.vbs, see claudectl-register.ps1) when a
# claudectl:// link is clicked in any terminal, including VS Code's integrated
# terminal (which intercepts file:// links itself but must hand unknown
# schemes to the OS).
#
# URI shapes (produced by statusline.js from dashboard.json):
#   claudectl://open/C:/Users/jared/Some%20Dir        → Explorer window on the folder
#   claudectl://open/C:/Users/jared/Some%20Dir/f.txt  → Explorer with the file selected
#   claudectl://tip/<prose>                           → informational hover target, no-op
#   claudectl://tip/<prose>/do/<encoded-action>       → confirm, then re-dispatch <encoded-action>
#   claudectl://copy/<encoded-text>                   → put decoded text on the clipboard
#   claudectl://spawn/<encoded-dir>                   → confirm, then new Claude session in <dir>
#   claudectl://spawn/<encoded-dir>/prompt/<encoded>  → same, with an initial prompt
#
# SECURITY POSTURE (sacred): a registered scheme is invocable by ANY web page,
# so every verb must be safe against a drive-by click:
#   open  : shows an existing local path in Explorer. Read-only, no execution.
#           Drive-letter paths ONLY — a UNC target (\\host\share) would make
#           Test-Path open an outbound SMB/WebDAV connection that auto-sends
#           the user's NTLM credentials (a drive-by hash-leak primitive), so
#           UNC is rejected BEFORE any filesystem probe.
#   tip   : inert by design — the link exists to carry a hover tooltip; a
#           click exits 0 silently. If the tail carries "/do/<encoded-action>"
#           the decoded action must match ^claudectl://(open|copy|spawn)/ and
#           a Yes/No dialog naming the EXACT action gates the re-dispatch,
#           which goes back through this same allowlist (never a shell).
#   copy  : clipboard-only, capped at 4096 decoded chars (no clipboard bombs).
#           Writes text to the clipboard and nothing else — no UI, no exec.
#   spawn : launches a NEW interactive Claude session, so it is confirm-gated:
#           the target must be an existing drive-letter directory and a Yes/No
#           dialog naming the directory must be accepted. Arguments are passed
#           as arrays (never string-interpolated command lines) and the prompt
#           is stripped of quotes/control chars so it cannot break out of its
#           quoted argument.
# Nothing here may ever delete, write files, or execute attacker-controlled
# command lines (see the security notes in README.md). Rejects exit nonzero
# but never surface error UI — a stray click must be invisible, not scary.
#
# Every real (non-dryrun) invocation appends one line (timestamp, action,
# first 120 chars of the argument) to %LOCALAPPDATA%\claudectl\invocations.log;
# logging failures are swallowed.
#
# Set CLAUDECTL_DRYRUN=1 to print the resolved action (including what a
# tip//do/ WOULD dispatch) instead of doing it — no UI, no side effects.

param([Parameter(Mandatory = $true)][string]$Uri)

$script:DryRun = [bool]$env:CLAUDECTL_DRYRUN

# Dryrun prints go straight to stdout via [Console]::Out — Write-Output inside
# Invoke-Claudectl would land in the function's return pipeline (the caller
# captures it as the exit code) and never reach the terminal.
function Write-HandlerOut {
  param([string]$Text)
  [Console]::Out.WriteLine($Text)
}

# Append one line to %LOCALAPPDATA%\claudectl\invocations.log. Best-effort:
# creates the directory, truncates the arg to 120 chars, swallows all failures
# (a click handler must never die or show UI because a log write failed).
function Write-InvocationLog {
  param([string]$Action, [string]$Arg)
  if ($script:DryRun) { return }
  try {
    $logDir = Join-Path $env:LOCALAPPDATA 'claudectl'
    if (-not (Test-Path -LiteralPath $logDir)) {
      New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    }
    if ($null -eq $Arg) { $Arg = '' }
    $snippet = $Arg
    if ($snippet.Length -gt 120) { $snippet = $snippet.Substring(0, 120) }
    $line = '{0}  {1}  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Action, $snippet
    Add-Content -LiteralPath (Join-Path $logDir 'invocations.log') -Value $line -Encoding UTF8
  } catch { }
}

# Yes/No confirm dialog. Returns $true only on an explicit Yes; any failure to
# show the dialog counts as No (never proceed unconfirmed, never surface errors).
function Show-ClaudectlConfirm {
  param([string]$Message)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $answer = [System.Windows.Forms.MessageBox]::Show(
      $Message, 'claudectl',
      [System.Windows.Forms.MessageBoxButtons]::YesNo,
      [System.Windows.Forms.MessageBoxIcon]::Question)
    return ($answer -eq [System.Windows.Forms.DialogResult]::Yes)
  } catch { return $false }
}

# Decode a percent-encoded path segment into a local filesystem path, or $null
# if it fails the drive-letter guard. The guard runs BEFORE any filesystem
# probe (see the UNC/NTLM rationale in the header).
function ConvertTo-LocalPath {
  param([string]$Raw)
  $p = [uri]::UnescapeDataString($Raw) -replace '/', '\'
  $p = $p.TrimEnd('\')
  if ($p -match '^[A-Za-z]:$') { $p += '\' }  # bare drive letter → its root
  if ($p -notmatch '^[A-Za-z]:\\') { return $null }
  return $p
}

# Parse and dispatch one claudectl:// URI. Returns the process exit code.
# tip//do/ re-dispatches by recursing here, so the allowlist and every guard
# apply to the inner action exactly as they would to a directly clicked link.
function Invoke-Claudectl {
  param([string]$Uri, [int]$Depth = 0)

  if ($Depth -gt 1) { return 1 }  # tip/do targets cannot themselves recurse

  # Tolerate 0-3 slashes after the colon (URI normalizers vary) and a
  # percent-encoded drive colon (C%3A) — UnescapeDataString restores it.
  $m = [regex]::Match($Uri, '^claudectl:/{0,3}(?<action>[A-Za-z]+)/(?<rest>.+)$')
  if (-not $m.Success) {
    if ($script:DryRun) { Write-HandlerOut "rejected malformed uri=$Uri" }
    return 1
  }
  $action = $m.Groups['action'].Value.ToLower()
  $rest = $m.Groups['rest'].Value

  switch ($action) {

    'open' {
      $path = ConvertTo-LocalPath $rest
      if (-not $path) {
        if ($script:DryRun) { Write-HandlerOut "rejected action=open path=$([uri]::UnescapeDataString($rest) -replace '/', '\')" }
        Write-InvocationLog 'reject-open' $rest
        return 1
      }
      $isDir = Test-Path -LiteralPath $path -PathType Container
      $isFile = Test-Path -LiteralPath $path -PathType Leaf
      if ($script:DryRun) {
        Write-HandlerOut "action=open path=$path dir=$isDir file=$isFile"
        return 0
      }
      Write-InvocationLog 'open' $path
      if ($isDir) {
        Start-Process explorer.exe -ArgumentList "`"$path`""
      } elseif ($isFile) {
        Start-Process explorer.exe -ArgumentList "/select,`"$path`""
      }
      # Nonexistent path: do nothing (never surface an error UI from a click).
      return 0
    }

    'tip' {
      $doIdx = $rest.LastIndexOf('/do/')
      if ($doIdx -lt 0) {
        # Pure hover target — the tooltip is the payload; a click is a no-op.
        if ($script:DryRun) { Write-HandlerOut "action=tip tooltip=$rest" }
        Write-InvocationLog 'tip' $rest
        return 0
      }
      # The encoded action is encodeURIComponent output (contains no raw "/"),
      # so the segment after the LAST "/do/" is exactly the action even when
      # the prose itself contains "/do/".
      $target = [uri]::UnescapeDataString($rest.Substring($doIdx + 4))
      if ($target -notmatch '^claudectl://(open|copy|spawn)/') {
        if ($script:DryRun) { Write-HandlerOut "rejected action=tip do=$target" }
        Write-InvocationLog 'reject-tip' $rest
        return 1
      }
      if ($script:DryRun) {
        Write-HandlerOut "action=tip do=$target"
        return (Invoke-Claudectl -Uri $target -Depth ($Depth + 1))
      }
      Write-InvocationLog 'tip' $rest
      $msg = "Run this action?`n`n$target"
      if (Show-ClaudectlConfirm $msg) {
        return (Invoke-Claudectl -Uri $target -Depth ($Depth + 1))
      }
      return 0  # declined is not an error
    }

    'copy' {
      $text = [uri]::UnescapeDataString($rest)
      if ($text.Length -gt 4096) {
        if ($script:DryRun) { Write-HandlerOut "rejected action=copy reason=too-long chars=$($text.Length)" }
        Write-InvocationLog 'reject-copy' $rest
        return 1
      }
      if ($script:DryRun) {
        Write-HandlerOut "action=copy chars=$($text.Length)"
        return 0
      }
      Write-InvocationLog 'copy' $text
      try { Set-Clipboard -Value $text } catch { return 1 }
      return 0  # no UI on success
    }

    'spawn' {
      # Optional trailing "/prompt/<encoded-prompt>". The encoded prompt is
      # encodeURIComponent output (no raw "/"), so a slash after the last
      # "/prompt/" means that segment was part of the directory path.
      $encDir = $rest
      $prompt = $null
      $pIdx = $rest.LastIndexOf('/prompt/')
      if ($pIdx -ge 0) {
        $tail = $rest.Substring($pIdx + 8)
        if ($tail -notmatch '/') {
          $encDir = $rest.Substring(0, $pIdx)
          $prompt = [uri]::UnescapeDataString($tail)
        }
      }
      $dir = ConvertTo-LocalPath $encDir
      if (-not $dir) {
        if ($script:DryRun) { Write-HandlerOut "rejected action=spawn path=$([uri]::UnescapeDataString($encDir) -replace '/', '\')" }
        Write-InvocationLog 'reject-spawn' $rest
        return 1
      }
      if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        if ($script:DryRun) { Write-HandlerOut "rejected action=spawn reason=no-such-dir path=$dir" }
        Write-InvocationLog 'reject-spawn' $rest
        return 1
      }
      # Defang the prompt: strip quotes and control chars so it can never
      # break out of its quoted argument or smuggle a second command.
      if ($prompt) { $prompt = ($prompt -replace '[\x00-\x1f"]', ' ').Trim() }
      $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
      if ($script:DryRun) {
        $pShown = '(none)'
        if ($prompt) { $pShown = $prompt }
        $launcher = 'powershell'
        if ($wt) { $launcher = 'wt' }
        Write-HandlerOut "action=spawn dir=$dir prompt=$pShown launcher=$launcher"
        return 0
      }
      if (-not (Show-ClaudectlConfirm "Start a new Claude session in $dir`?")) {
        return 0  # declined is not an error
      }
      Write-InvocationLog 'spawn' $dir
      if ($wt) {
        $argList = @('-w', '0', 'nt', '-d', ('"{0}"' -f $dir), 'claude')
        if ($prompt) { $argList += ('"{0}"' -f $prompt) }
        Start-Process -FilePath 'wt.exe' -ArgumentList $argList
      } else {
        # PowerShell fallback: the prompt rides inside a single-quoted PS
        # string (embedded single quotes doubled) so nothing interpolates.
        $cmd = 'claude'
        if ($prompt) { $cmd = "claude '{0}'" -f ($prompt -replace "'", "''") }
        Start-Process -FilePath 'powershell.exe' -WorkingDirectory $dir -ArgumentList @('-NoExit', '-Command', $cmd)
      }
      return 0
    }

    default {
      if ($script:DryRun) { Write-HandlerOut "rejected action=$action" }
      Write-InvocationLog "reject-$action" $rest
      return 1
    }
  }
}

# Top-level: never let an exception surface UI from a stray click.
try {
  $code = Invoke-Claudectl -Uri $Uri
} catch {
  $code = 1
}
exit $code
