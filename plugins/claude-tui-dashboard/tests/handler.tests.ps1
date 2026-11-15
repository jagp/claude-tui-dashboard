# handler.tests.ps1 — dryrun contract tests for claudectl-handler.ps1.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File handler.tests.ps1
# Each case invokes the handler in a child powershell.exe with
# CLAUDECTL_DRYRUN=1 (no UI, no side effects) and asserts stdout patterns and
# the exit code. Prints PASS/FAIL per case; exits 0 only if every case passed.

$ErrorActionPreference = 'Stop'
$handler = Join-Path (Split-Path $PSScriptRoot -Parent) 'statusline\claudectl-handler.ps1'
if (-not (Test-Path -LiteralPath $handler)) {
  Write-Output "FATAL handler not found: $handler"
  exit 2
}

# Fixture: a real directory + a file with a space in its name (exercises %20).
$fixtureDir = Join-Path $env:TEMP ('claudectl-tests-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $fixtureDir | Out-Null
$fixtureFile = Join-Path $fixtureDir 'hello world.txt'
Set-Content -LiteralPath $fixtureFile -Value 'x' -Encoding ASCII
$dirUri = $fixtureDir -replace '\\', '/'
$fileUri = ($fixtureFile -replace '\\', '/') -replace ' ', '%20'

$script:pass = 0
$script:fail = 0

function Invoke-Case {
  param([string]$Name, [string]$CaseUri, [int]$ExpectExit, [string[]]$ExpectPatterns)
  $env:CLAUDECTL_DRYRUN = '1'
  $out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $handler $CaseUri
  $code = $LASTEXITCODE
  $stdout = ($out | Out-String).Trim()
  $ok = ($code -eq $ExpectExit)
  foreach ($p in $ExpectPatterns) {
    if ($stdout -notmatch $p) { $ok = $false }
  }
  if ($ok) {
    $script:pass++
    Write-Output ('PASS  {0}' -f $Name)
  } else {
    $script:fail++
    Write-Output ('FAIL  {0}' -f $Name)
    Write-Output ('      uri     : {0}' -f $CaseUri)
    Write-Output ('      exit    : got {0}, want {1}' -f $code, $ExpectExit)
    Write-Output ('      stdout  : {0}' -f ($stdout -replace "`r`n", ' | '))
    Write-Output ('      patterns: {0}' -f ($ExpectPatterns -join '  AND  '))
  }
}

$escDir = [regex]::Escape($fixtureDir)
$escFile = [regex]::Escape($fixtureFile)

# --- open ---------------------------------------------------------------
Invoke-Case 'open dir' "claudectl://open/$dirUri" 0 @(
  "^action=open path=$escDir dir=True file=False$")

Invoke-Case 'open file' "claudectl://open/$fileUri" 0 @(
  "^action=open path=$escFile dir=False file=True$")

# --- tip ----------------------------------------------------------------
Invoke-Case 'tip plain (inert)' 'claudectl://tip/cache+hot+4:12+left' 0 @(
  '^action=tip tooltip=cache\+hot\+4:12\+left$')

$doTarget = "claudectl://open/$dirUri"
$doEnc = [uri]::EscapeDataString($doTarget)
Invoke-Case 'tip with /do/ (would dispatch open)' "claudectl://tip/open+this+project/do/$doEnc" 0 @(
  ('action=tip do=' + [regex]::Escape($doTarget)),
  "action=open path=$escDir dir=True file=False")

$badTarget = 'claudectl://delete/C:/x'
$badEnc = [uri]::EscapeDataString($badTarget)
Invoke-Case 'tip /do/ target outside allowlist rejected' "claudectl://tip/nice+try/do/$badEnc" 1 @(
  ('rejected action=tip do=' + [regex]::Escape($badTarget)))

# --- copy ---------------------------------------------------------------
Invoke-Case 'copy decodes and reports length' 'claudectl://copy/hello%20world' 0 @(
  '^action=copy chars=11$')

$big = 'a' * 4097
Invoke-Case 'copy over 4096-char cap rejected' "claudectl://copy/$big" 1 @(
  '^rejected action=copy reason=too-long chars=4097$')

# --- spawn --------------------------------------------------------------
Invoke-Case 'spawn dir (no prompt)' "claudectl://spawn/$dirUri" 0 @(
  "^action=spawn dir=$escDir prompt=\(none\) launcher=(wt|powershell)$")

Invoke-Case 'spawn dir with prompt' "claudectl://spawn/$dirUri/prompt/fix%20the%20bug" 0 @(
  "^action=spawn dir=$escDir prompt=fix the bug launcher=(wt|powershell)$")

Invoke-Case 'spawn nonexistent dir rejected' 'claudectl://spawn/C:/claudectl-no-such-dir-a1b2c3' 1 @(
  '^rejected action=spawn reason=no-such-dir')

# --- guards -------------------------------------------------------------
Invoke-Case 'UNC path rejected (encoded backslashes)' 'claudectl://open/%5C%5Cevil%5Cshare' 1 @(
  '^rejected action=open path=\\\\evil\\share$')

Invoke-Case 'UNC path rejected (slash form)' 'claudectl://open//evil/share' 1 @(
  '^rejected action=open')

Invoke-Case 'spawn UNC rejected' 'claudectl://spawn/%5C%5Cevil%5Cshare' 1 @(
  '^rejected action=spawn')

Invoke-Case 'unknown verb rejected' 'claudectl://delete/C:/Windows' 1 @(
  '^rejected action=delete$')

Invoke-Case 'malformed URI (no rest) rejected' 'claudectl://open' 1 @(
  '^rejected malformed')

Invoke-Case 'malformed URI (wrong scheme) rejected' 'https://evil.example/x' 1 @(
  '^rejected malformed')

# --- teardown -----------------------------------------------------------
Remove-Item -LiteralPath $fixtureDir -Recurse -Force -Confirm:$false
Remove-Item Env:\CLAUDECTL_DRYRUN -ErrorAction SilentlyContinue

Write-Output ''
Write-Output ('{0} passed, {1} failed' -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
