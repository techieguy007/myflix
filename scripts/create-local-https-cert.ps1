param(
    [int]$HttpsPort = 5443,
    [int]$HttpPort = 5000,
    [int]$SessionDays = 180,
    [string[]]$DnsName = @(),
    [string[]]$IpAddress = @(),
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Unique-Values {
    param([string[]]$Values)
    $seen = @{}
    $result = @()
    foreach ($value in $Values) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        $trimmed = $value.Trim()
        $key = $trimmed.ToLowerInvariant()
        if (-not $seen.ContainsKey($key)) {
            $seen[$key] = $true
            $result += $trimmed
        }
    }
    return $result
}

function Write-Pem {
    param(
        [string]$Path,
        [string]$Label,
        [byte[]]$Bytes
    )

    $base64 = [Convert]::ToBase64String($Bytes)
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("-----BEGIN $Label-----")
    for ($i = 0; $i -lt $base64.Length; $i += 64) {
        $lines.Add($base64.Substring($i, [Math]::Min(64, $base64.Length - $i)))
    }
    $lines.Add("-----END $Label-----")
    Set-Content -LiteralPath $Path -Value $lines -Encoding ascii
}

function Ensure-Property {
    param([object]$Object, [string]$Name, [object]$Value)
    if ($null -eq $Object.PSObject.Properties[$Name]) {
        $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

function Get-PrimaryLanAddress {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.PrefixLength -le 30
        } |
        Sort-Object InterfaceMetric, InterfaceIndex

    return ($addresses | Select-Object -First 1).IPAddress
}

$repoDir = Split-Path -Parent $PSScriptRoot
$configDir = Join-Path $repoDir "config"
$certDir = Join-Path $configDir "certs"
$localConfigPath = Join-Path $configDir "myflix.local.json"
New-Item -ItemType Directory -Path $certDir -Force | Out-Null

$hostName = $env:COMPUTERNAME
$lanAddress = Get-PrimaryLanAddress
$allDnsNames = Unique-Values (@("localhost", $hostName) + $DnsName)
$allIpAddresses = Unique-Values (@("127.0.0.1", $lanAddress) + $IpAddress)

$rootSubject = "CN=MyFlix Local Root CA"
$serverSubject = "CN=MyFlix Local HTTPS"
$rootFriendlyName = "MyFlix Local Root CA"
$serverFriendlyName = "MyFlix Local HTTPS"

if ($Force) {
    Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -in @($rootSubject, $serverSubject) -or $_.FriendlyName -in @($rootFriendlyName, $serverFriendlyName) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -eq $rootSubject -or $_.FriendlyName -eq $rootFriendlyName } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

$root = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $rootSubject } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

if ($null -eq $root) {
    $root = New-SelfSignedCertificate `
        -Subject $rootSubject `
        -FriendlyName $rootFriendlyName `
        -Type Custom `
        -KeyExportPolicy Exportable `
        -KeyUsage CertSign, CRLSign, DigitalSignature `
        -KeyLength 4096 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(10) `
        -TextExtension @("2.5.29.19={critical}{text}ca=TRUE&pathlength=1")
}

$rootTrusted = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $root.Thumbprint } |
    Select-Object -First 1
if ($null -eq $rootTrusted) {
    $rootExportPath = Join-Path $certDir "myflix-local-root-ca.crt"
    Export-Certificate -Cert $root -FilePath $rootExportPath -Force | Out-Null
    Import-Certificate -FilePath $rootExportPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
}

$sanParts = @()
foreach ($name in $allDnsNames) { $sanParts += "DNS=$name" }
foreach ($ip in $allIpAddresses) { $sanParts += "IPAddress=$ip" }
$sanText = "2.5.29.17={text}$($sanParts -join '&')"

if ($Force) {
    Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -eq $serverSubject -or $_.FriendlyName -eq $serverFriendlyName } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

$serverCert = New-SelfSignedCertificate `
    -Subject $serverSubject `
    -FriendlyName $serverFriendlyName `
    -Type Custom `
    -Signer $root `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(3) `
    -TextExtension @($sanText, "2.5.29.37={text}1.3.6.1.5.5.7.3.1")

$serverCertPath = Join-Path $certDir "myflix-local.cert.pem"
$serverPfxPath = Join-Path $certDir "myflix-local.pfx"
$rootCaPath = Join-Path $certDir "myflix-local-root-ca.crt"
$rootCaPemPath = Join-Path $certDir "myflix-local-root-ca.pem"
$pfxPassphrasePath = Join-Path $certDir "myflix-local.pfx.passphrase.txt"
$pfxPassphrase = [Guid]::NewGuid().ToString("N")
$pfxPassword = ConvertTo-SecureString -String $pfxPassphrase -AsPlainText -Force

Write-Pem -Path $serverCertPath -Label "CERTIFICATE" -Bytes $serverCert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
Write-Pem -Path $rootCaPemPath -Label "CERTIFICATE" -Bytes $root.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
Export-Certificate -Cert $root -FilePath $rootCaPath -Force | Out-Null
Export-PfxCertificate -Cert $serverCert -FilePath $serverPfxPath -Password $pfxPassword -Force | Out-Null
Set-Content -LiteralPath $pfxPassphrasePath -Value $pfxPassphrase -Encoding ascii

if (Test-Path -LiteralPath $localConfigPath) {
    $localConfig = Get-Content -LiteralPath $localConfigPath -Raw | ConvertFrom-Json
} else {
    $localConfig = [pscustomobject]@{}
}

Ensure-Property $localConfig "server" ([pscustomobject]@{})
Ensure-Property $localConfig.server "https" ([pscustomobject]@{})
Ensure-Property $localConfig "auth" ([pscustomobject]@{})
Ensure-Property $localConfig.auth "sessionDays" $SessionDays

$localConfig.server.https = [pscustomobject]@{
    enabled = $true
    port = $HttpsPort
    pfxPath = "config/certs/myflix-local.pfx"
    passphrase = $pfxPassphrase
    certPath = "config/certs/myflix-local.cert.pem"
    caPath = "config/certs/myflix-local-root-ca.pem"
    redirectHttp = $true
}
$localConfig.auth.sessionDays = $SessionDays

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($localConfigPath, (($localConfig | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)

Write-Output "Created MyFlix local HTTPS certificate."
Write-Output "HTTPS URL: https://$($allIpAddresses | Where-Object { $_ -ne '127.0.0.1' } | Select-Object -First 1):$HttpsPort/"
Write-Output "Local URL: https://localhost:$HttpsPort/"
Write-Output "Trusted this CA for the current Windows user: $rootCaPath"
Write-Output "Install this CA on phones/TVs that should trust MyFlix: $rootCaPath"
