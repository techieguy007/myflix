param(
    [ValidateSet("install", "uninstall", "start", "stop", "status", "run")]
    [string]$Action = "status",
    [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "config\myflix.config.json"),
    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

function Resolve-ExistingPath {
    param([string]$PathValue)
    return (Resolve-Path -LiteralPath $PathValue).Path
}

function Get-ConfigValue {
    param([object]$Config, [string]$Name, [object]$DefaultValue)
    $property = $Config.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value -or "$($property.Value)" -eq "") {
        return $DefaultValue
    }
    return $property.Value
}

function Get-NestedValue {
    param([object]$Config, [string]$Section, [string]$Name, [object]$DefaultValue)
    $sectionValue = Get-ConfigValue $Config $Section $null
    if ($null -eq $sectionValue) {
        return $DefaultValue
    }
    return Get-ConfigValue $sectionValue $Name $DefaultValue
}

function Resolve-ServicePath {
    param([string]$PathValue, [string]$BaseDirectory)
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }
    return Join-Path $BaseDirectory $PathValue
}

function Resolve-NodeExecutable {
    param([string]$NodeExe)
    if ([string]::IsNullOrWhiteSpace($NodeExe)) {
        $NodeExe = "node"
    }

    if ([System.IO.Path]::IsPathRooted($NodeExe)) {
        if (Test-Path -LiteralPath $NodeExe) {
            return (Resolve-Path -LiteralPath $NodeExe).Path
        }
        throw "Configured Node executable was not found: $NodeExe"
    }

    $fromPath = Get-Command $NodeExe -ErrorAction SilentlyContinue
    if ($fromPath) {
        return $fromPath.Source
    }

    $candidatePaths = @(
        (Join-Path $env:APPDATA "npm\node.cmd"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"),
        (Join-Path $env:ProgramFiles "nodejs\node.exe")
    )

    $programFilesX86 = ${env:ProgramFiles(x86)}
    if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
        $candidatePaths += (Join-Path $programFilesX86 "nodejs\node.exe")
    }

    foreach ($candidate in $candidatePaths) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "Node.js was not found. Install Node.js or set service.nodeExe in config\myflix.config.json."
}

function Get-MyFlixConfig {
    param([string]$ResolvedConfigPath)
    if (-not (Test-Path -LiteralPath $ResolvedConfigPath)) {
        throw "Config file not found: $ResolvedConfigPath"
    }
    return Get-Content -LiteralPath $ResolvedConfigPath -Raw | ConvertFrom-Json
}

function Get-Runtime {
    param([object]$Config, [string]$RepoDir)
    $hostName = [string](Get-NestedValue $Config "server" "host" "0.0.0.0")
    $port = [int](Get-NestedValue $Config "server" "port" 5000)
    return [pscustomobject]@{
        Host = $hostName
        Port = $port
        Url = if ($hostName -eq "0.0.0.0") { "http://127.0.0.1:$port/" } else { "http://$($hostName):$port/" }
        NodeExe = Resolve-NodeExecutable ([string](Get-NestedValue $Config "service" "nodeExe" "node"))
        LogDirectory = Resolve-ServicePath ([string](Get-NestedValue $Config "service" "logDirectory" "logs")) $RepoDir
        OpenBrowserOnStart = [bool](Get-NestedValue $Config "service" "openBrowserOnStart" $false)
        StopExistingOnPort = [bool](Get-NestedValue $Config "service" "stopExistingOnPort" $false)
        NodeEnv = [string](Get-NestedValue $Config "server" "nodeEnv" "production")
        MediaRoot = [string](Get-NestedValue $Config "media" "root" "D:\movies")
        AutoScan = [bool](Get-NestedValue $Config "media" "autoScanOnStart" $true)
        RenameMode = [string](Get-NestedValue $Config "media" "renameMode" "suggest")
        OmdbApiKey = [string](Get-NestedValue $Config "metadata" "omdbApiKey" "")
    }
}

function Get-MyFlixListeners {
    param([int]$Port, [string]$ServerPath)
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    $rows = @()
    foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
        $commandLine = if ($process) { [string]$process.CommandLine } else { "" }
        $isMyFlix = -not [string]::IsNullOrWhiteSpace($commandLine) -and $commandLine.IndexOf($ServerPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
        $rows += [pscustomobject]@{
            Port = $listener.LocalPort
            ProcessId = $listener.OwningProcess
            ProcessName = if ($process) { Split-Path -Leaf $process.ExecutablePath } else { "" }
            IsMyFlix = $isMyFlix
            CommandLine = $commandLine
        }
    }
    return $rows
}

function Get-AppReadinessErrors {
    param([string]$RepoDir, [object]$Runtime)
    $errors = @()
    $serverDeps = Join-Path $RepoDir "node_modules"
    if (-not (Test-Path -LiteralPath $serverDeps)) {
        $errors += "Server dependencies are missing. Run 'npm install' in $RepoDir."
    }

    $clientBuild = Join-Path $RepoDir "client\build\index.html"
    if ($Runtime.NodeEnv -eq "production" -and -not (Test-Path -LiteralPath $clientBuild)) {
        $errors += "Production client build is missing. Run 'npm run build' in $RepoDir."
    }

    return $errors
}

function Show-TaskStatus {
    param([string]$TaskName, [object]$Runtime, [string]$ServerPath)
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        Write-Output "Task '$TaskName' is not installed."
    } else {
        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        [pscustomobject]@{
            TaskName = $task.TaskName
            State = $task.State
            LastRunTime = $info.LastRunTime
            LastTaskResult = $info.LastTaskResult
            NextRunTime = $info.NextRunTime
        } | Format-List
    }

    Write-Output "MyFlix URL: $($Runtime.Url)"
    $listeners = Get-MyFlixListeners $Runtime.Port $ServerPath
    if (-not $listeners) {
        Write-Output "No listener on port $($Runtime.Port)."
        return
    }
    $listeners | Select-Object Port, ProcessId, ProcessName, IsMyFlix | Format-Table -AutoSize
}

function Stop-MyFlixListeners {
    param([object]$Runtime, [string]$ServerPath)
    $listeners = Get-MyFlixListeners $Runtime.Port $ServerPath
    foreach ($listener in ($listeners | Sort-Object ProcessId -Unique)) {
        if (-not $listener.IsMyFlix) {
            Write-Warning "Skipping process $($listener.ProcessId) on port $($Runtime.Port) because it does not look like MyFlix."
            continue
        }
        Stop-Process -Id $listener.ProcessId -Force
        Write-Output "Stopped MyFlix process $($listener.ProcessId) on port $($Runtime.Port)."
    }
}

function Stop-MyFlixChildProcesses {
    param([string]$RepoDir)
    $transcodeDir = [System.IO.Path]::GetFullPath((Join-Path $RepoDir "transcodes"))
    $mediaProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match '^(ffmpeg|ffprobe)(\.exe)?$' -and
            -not [string]::IsNullOrWhiteSpace([string]$_.CommandLine) -and
            ([string]$_.CommandLine).IndexOf($transcodeDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
        } |
        Sort-Object ProcessId -Unique

    foreach ($process in $mediaProcesses) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output "Stopped MyFlix media process $($process.ProcessId) ($($process.Name))."
    }
}

$ConfigPath = Resolve-ExistingPath $ConfigPath
$ServiceDir = Split-Path -Parent $PSCommandPath
$RepoDir = Split-Path -Parent $ServiceDir
$ServerPath = Join-Path $RepoDir "server.js"
$Config = Get-MyFlixConfig $ConfigPath
$TaskName = [string](Get-ConfigValue $Config "taskName" "MyFlixLocalStreaming")
$Runtime = Get-Runtime $Config $RepoDir

switch ($Action) {
    "install" {
        $runner = Resolve-ExistingPath $PSCommandPath
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Action run -ConfigPath `"$ConfigPath`""

        $taskAction = New-ScheduledTaskAction `
            -Execute "powershell.exe" `
            -Argument $arguments `
            -WorkingDirectory $RepoDir
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
        $principal = New-ScheduledTaskPrincipal `
            -UserId $currentUser `
            -LogonType Interactive `
            -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet `
            -MultipleInstances IgnoreNew `
            -RestartCount 3 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable

        Register-ScheduledTask `
            -TaskName $TaskName `
            -Action $taskAction `
            -Trigger $trigger `
            -Principal $principal `
            -Settings $settings `
            -Description "Starts MyFlix local streaming at Windows logon." `
            -Force | Out-Null

        Write-Output "Installed logon task '$TaskName' for $currentUser."
        if ($StartNow) {
            Start-ScheduledTask -TaskName $TaskName
            Write-Output "Started task '$TaskName'."
        }
        Show-TaskStatus $TaskName $Runtime $ServerPath
        break
    }

    "uninstall" {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Output "Uninstalled task '$TaskName'."
        } else {
            Write-Output "Task '$TaskName' is not installed."
        }
        break
    }

    "start" {
        $existing = Get-MyFlixListeners $Runtime.Port $ServerPath | Where-Object { $_.IsMyFlix }
        if ($existing) {
            Write-Output "MyFlix is already running at $($Runtime.Url)."
            Show-TaskStatus $TaskName $Runtime $ServerPath
            break
        }
        Start-ScheduledTask -TaskName $TaskName
        Write-Output "Started task '$TaskName'."
        Start-Sleep -Seconds 2
        Show-TaskStatus $TaskName $Runtime $ServerPath
        break
    }

    "stop" {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task -and $task.State -eq "Running") {
            Stop-ScheduledTask -TaskName $TaskName
        }
        Stop-MyFlixListeners $Runtime $ServerPath
        Stop-MyFlixChildProcesses $RepoDir
        Show-TaskStatus $TaskName $Runtime $ServerPath
        break
    }

    "status" {
        Show-TaskStatus $TaskName $Runtime $ServerPath
        break
    }

    "run" {
        New-Item -ItemType Directory -Path $Runtime.LogDirectory -Force | Out-Null
        $outLog = Join-Path $Runtime.LogDirectory "myflix-service.out.log"
        $errLog = Join-Path $Runtime.LogDirectory "myflix-service.err.log"

        $listeners = Get-NetTCPConnection -LocalPort $Runtime.Port -State Listen -ErrorAction SilentlyContinue
        if ($listeners) {
            if (-not $Runtime.StopExistingOnPort) {
                $owners = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
                throw "Port $($Runtime.Port) is already in use by process id(s): $owners. Change config port or set stopExistingOnPort to true."
            }
            foreach ($owner in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
                Stop-Process -Id $owner -Force
            }
            Start-Sleep -Seconds 1
        }

        $env:MYFLIX_CONFIG = $ConfigPath
        $env:NODE_ENV = $Runtime.NodeEnv
        $env:HOST = $Runtime.Host
        $env:PORT = "$($Runtime.Port)"
        $env:MYFLIX_MEDIA_ROOT = $Runtime.MediaRoot
        $env:MYFLIX_AUTO_SCAN = if ($Runtime.AutoScan) { "true" } else { "false" }
        $env:MYFLIX_RENAME_MODE = $Runtime.RenameMode
        $env:MYFLIX_DISABLE_DEMO_SEED = "true"
        if (-not [string]::IsNullOrWhiteSpace($Runtime.OmdbApiKey)) {
            $env:OMDB_API_KEY = $Runtime.OmdbApiKey
        }

        Add-Content -Path $outLog -Value "[$(Get-Date -Format o)] Starting MyFlix at $($Runtime.Url)"
        Add-Content -Path $outLog -Value "[$(Get-Date -Format o)] Media root: $($Runtime.MediaRoot)"
        Add-Content -Path $outLog -Value "[$(Get-Date -Format o)] Config: $ConfigPath"

        $readinessErrors = Get-AppReadinessErrors $RepoDir $Runtime
        if ($readinessErrors.Count -gt 0) {
            foreach ($readinessError in $readinessErrors) {
                Add-Content -Path $errLog -Value "[$(Get-Date -Format o)] $readinessError"
                Write-Warning $readinessError
            }
            exit 1
        }

        if ($Runtime.OpenBrowserOnStart) {
            Start-Process $Runtime.Url
        }

        & $Runtime.NodeExe $ServerPath 1>> $outLog 2>> $errLog
        $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
        Add-Content -Path $outLog -Value "[$(Get-Date -Format o)] MyFlix exited with code $exitCode"
        exit $exitCode
    }
}
