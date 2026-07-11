$ErrorActionPreference = 'SilentlyContinue'

$files = @{
  public = 'C:\Users\USER\Downloads\campusiq_kstu_fullstack (1)\campusiq-fullstack\public'
  frontend = 'C:\Users\USER\Downloads\campusiq_kstu_fullstack (1)\campusiq-fullstack\public\frontend'
}

# Read all files
$publicIndex = Get-Content "$($files.public)\index.html" -Raw
$frontendIndex = Get-Content "$($files.frontend)\index.html" -Raw
$careers = Get-Content "$($files.frontend)\careers.html" -Raw

Write-Output "=== PUBLIC INDEX.HTML CHECKS ==="
Write-Output "apple-touch-icon: $($publicIndex.Contains('apple-touch-icon'))"
Write-Output "favicon: $($publicIndex.Contains('rel=""icon""'))"
Write-Output "background-clip: $($publicIndex.Contains('background-clip:text'))"
Write-Output "role=button absent: $(-not $publicIndex.Contains('role=""button""'))"

Write-Output ""
Write-Output "=== FRONTEND INDEX.HTML CHECKS ==="
Write-Output "background-clip: $($frontendIndex.Contains('background-clip:text'))"
Write-Output "Number.parseFloat: $($frontendIndex.Contains('Number.parseFloat'))"
Write-Output "gradeBadgeClass: $($frontendIndex.Contains('function gradeBadgeClass'))"
Write-Output "sendCurrentPosition: $($frontendIndex.Contains('async function sendCurrentPosition'))"
Write-Output "catch(err): $($frontendIndex.Contains('catch(err)'))"
Write-Output "NOSONAR: $($frontendIndex.Contains('NOSONAR'))"
Write-Output "gradeAsgn multi-line: $($frontendIndex.Contains('async function gradeAsgn(id)'))"
Write-Output "safe comment: $($frontendIndex.Contains('safe: non-crypto'))"

Write-Output ""
Write-Output "=== CAREERS.HTML CHECKS ==="
Write-Output "apple-touch-icon: $($careers.Contains('apple-touch-icon'))"
Write-Output "background-clip: $($careers.Contains('background-clip:text'))"
Write-Output "duplicate html selector fixed: $($careers.Contains('html{color-scheme:dark;font-family'))"
Write-Output "u-d-flex: $($careers.Contains('u-d-flex'))"
Write-Output "find() absent: $(-not $careers.Contains('.find(')))"
Write-Output "remove(): $($careers.Contains('.remove()'))"
Write-Output "label for=am-question: $($careers.Contains('for=""am-question""'))"

Write-Output ""
Write-Output "=== TAG BALANCE ==="
$htmlOpen = ([regex]::Matches($publicIndex, '<html[^>]*>')).Count
$htmlClose = ([regex]::Matches($publicIndex, '</html>')).Count
Write-Output "public/index.html html: $htmlOpen / $htmlClose"

$htmlOpen = ([regex]::Matches($frontendIndex, '<html[^>]*>')).Count
$htmlClose = ([regex]::Matches($frontendIndex, '</html>')).Count
Write-Output "frontend/index.html html: $htmlOpen / $htmlClose"

$htmlOpen = ([regex]::Matches($careers, '<html[^>]*>')).Count
$htmlClose = ([regex]::Matches($careers, '</html>')).Count
Write-Output "careers.html html: $htmlOpen / $htmlClose"
