param(
  [int]$Port = 5500,
  [string]$Root = ".",
  [string]$BindAddress = "",   # e.g. 192.168.1.23 — if empty, only localhost/127.0.0.1
  [switch]$Public               # shorthand: bind to all local IPv4 addresses (requires admin/urlacl)
)

$ErrorActionPreference = 'Stop'

function Get-ContentType($path) {
  switch -regex ([System.IO.Path]::GetExtension($path).ToLower()) {
    '\.html'  { 'text/html; charset=utf-8'; break }
    '\.css'   { 'text/css; charset=utf-8'; break }
    '\.js'    { 'text/javascript; charset=utf-8'; break }
    '\.mjs'   { 'text/javascript; charset=utf-8'; break }
    '\.json'  { 'application/json; charset=utf-8'; break }
    '\.png'   { 'image/png'; break }
    '\.jpg'   { 'image/jpeg'; break }
    '\.jpeg'  { 'image/jpeg'; break }
    '\.svg'   { 'image/svg+xml'; break }
    '\.gif'   { 'image/gif'; break }
    '\.mp3'   { 'audio/mpeg'; break }
    '\.wav'   { 'audio/wav'; break }
    '\.wasm'  { 'application/wasm'; break }
    '\.woff'  { 'font/woff'; break }
    '\.woff2' { 'font/woff2'; break }
    '\.ttf'   { 'font/ttf'; break }
    default   { 'application/octet-stream' }
  }
}

$rootPath = (Resolve-Path -LiteralPath $Root).Path

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:${Port}/") | Out-Null
$listener.Prefixes.Add("http://localhost:${Port}/") | Out-Null
if ($BindAddress) {
  $listener.Prefixes.Add("http://${BindAddress}:${Port}/") | Out-Null
}
elseif ($Public.IsPresent) {
  # Attempt to bind to all interfaces; may require URL ACL and admin rights
  $listener.Prefixes.Add("http://+:${Port}/") | Out-Null
}
$listener.Start()

Write-Host "Serving $rootPath" -ForegroundColor Green
Write-Host "  Local:     http://127.0.0.1:${Port}" -ForegroundColor Green
Write-Host "  Localhost: http://localhost:${Port}" -ForegroundColor Green
if ($BindAddress) { Write-Host "  LAN:       http://${BindAddress}:${Port}" -ForegroundColor Green }
elseif ($Public.IsPresent) { Write-Host "  Public:    http://+:${Port} (all interfaces)" -ForegroundColor Green }

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    try {
      $rel = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

      $unsafeFull = Join-Path $rootPath $rel
      $full = (Resolve-Path -LiteralPath $unsafeFull -ErrorAction SilentlyContinue).Path

      if (-not $full -or ($full -notlike "${rootPath}*")) {
        $response.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.Close()
        continue
      }

      if (Test-Path -LiteralPath $full -PathType Container) {
        $full = Join-Path $full 'index.html'
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
          $response.StatusCode = 403
          $bytes = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
          $response.OutputStream.Write($bytes, 0, $bytes.Length)
          $response.Close()
          continue
        }
      }

      if (Test-Path -LiteralPath $full -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $response.StatusCode = 200
        $response.ContentType = Get-ContentType $full
        $response.Headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.Close()
      } else {
        $response.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.Close()
      }
    } catch {
      try {
        $response.StatusCode = 500
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("Server Error")
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.Close()
      } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
