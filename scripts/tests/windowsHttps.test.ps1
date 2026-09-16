# Isolated OS command doubles: exercise the real script without administrator
# privileges or changes to Windows networking.
$ErrorActionPreference = 'Stop'
$global:SawotHttpsTestRule = $null
$global:SawotHttpsTestFirewallEnabled = $true
$global:SawotHttpsTestForwardCount = 0
$global:SawotHttpsTestWriteCount = 0
function Get-NetIPAddress { param($AddressFamily, $IPAddress)
    [pscustomobject]@{ InterfaceIndex = 7; InterfaceAlias = 'Wi-Fi' }
}
function Get-NetConnectionProfile { param($InterfaceIndex)
    [pscustomobject]@{ NetworkCategory = 'Private' }
}
function Get-NetFirewallProfile { param($PolicyStore, $Name)
    [pscustomobject]@{ Enabled = $global:SawotHttpsTestFirewallEnabled }
}
function Get-NetFirewallRule { [CmdletBinding()] param($Name, $PolicyStore)
    if ($global:SawotHttpsTestRule) { [pscustomobject]$global:SawotHttpsTestRule }
}
function Set-NetFirewallRule { [CmdletBinding()] param($Name, $NewDisplayName, $Enabled, $Direction, $Action,
    $Protocol, $LocalPort, $LocalAddress, $RemoteAddress, $Profile, $InterfaceAlias, $EdgeTraversalPolicy)
    if (-not $global:SawotHttpsTestRule) { throw 'Cannot update a missing rule' }
    $global:SawotHttpsTestRule = @{} + $PSBoundParameters
    $global:SawotHttpsTestWriteCount++
}
function New-NetFirewallRule { param($Name, $DisplayName, $Enabled, $Direction, $Action,
    $Protocol, $LocalPort, $LocalAddress, $RemoteAddress, $Profile, $InterfaceAlias, $EdgeTraversalPolicy)
    if ($global:SawotHttpsTestRule) { throw 'Cannot create a duplicate rule' }
    $global:SawotHttpsTestRule = @{} + $PSBoundParameters
    $global:SawotHttpsTestWriteCount++
}
function Get-NetFirewallAddressFilter { [pscustomobject]@{
    LocalAddress = $global:SawotHttpsTestRule.LocalAddress; RemoteAddress = $global:SawotHttpsTestRule.RemoteAddress
} }
function Get-NetFirewallPortFilter { [pscustomobject]@{
    LocalPort = $global:SawotHttpsTestRule.LocalPort; Protocol = $global:SawotHttpsTestRule.Protocol
} }
function Get-NetFirewallInterfaceFilter { [pscustomobject]@{ InterfaceAlias = $global:SawotHttpsTestRule.InterfaceAlias } }
function netsh { $global:SawotHttpsTestForwardCount++; $global:LASTEXITCODE = 0 }
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
$target = Join-Path $PSScriptRoot '../enable-windows-https.ps1'
$params = @{ LocalAddress = '192.0.2.11'; WslAddress = '198.51.100.56'; TrustedSubnet = '192.0.2.0/24'; Confirm = $false }

& $target @params
Assert ($global:SawotHttpsTestRule.Profile -eq 'Private') 'New rule must use Private profile'
Assert ($global:SawotHttpsTestRule.LocalAddress -eq '192.0.2.11') 'New rule must restrict destination'
Assert ($global:SawotHttpsTestRule.RemoteAddress -eq '192.0.2.0/24') 'New rule must restrict sources'
Assert ($global:SawotHttpsTestRule.InterfaceAlias -eq 'Wi-Fi') 'New rule must restrict interface'

$global:SawotHttpsTestRule.Profile = 'Any'
$global:SawotHttpsTestRule.RemoteAddress = 'Any'
$global:SawotHttpsTestRule.LocalPort = 'Any'
& $target @params
Assert ($global:SawotHttpsTestRule.Profile -eq 'Private') 'Rerun must repair broadened profile'
Assert ($global:SawotHttpsTestRule.RemoteAddress -eq '192.0.2.0/24') 'Rerun must repair broadened sources'
Assert ($global:SawotHttpsTestRule.LocalPort -eq 443) 'Rerun must repair broadened ports'
Assert ($global:SawotHttpsTestForwardCount -eq 2 -and $global:SawotHttpsTestWriteCount -eq 2) 'Both runs must configure networking'

$global:SawotHttpsTestFirewallEnabled = $false
$blocked = $false
try { & $target @params } catch {
    if ($_.Exception.Message -notlike '*firewall profile is disabled*') { throw }
    $blocked = $true
}
Assert $blocked 'Disabled firewall must block configuration'
Assert ($global:SawotHttpsTestForwardCount -eq 2 -and $global:SawotHttpsTestWriteCount -eq 2) 'Blocked run must not modify networking'
$global:SawotHttpsTestFirewallEnabled = $true
& $target @params -WhatIf
Assert ($global:SawotHttpsTestForwardCount -eq 2 -and $global:SawotHttpsTestWriteCount -eq 2) 'WhatIf must not modify networking'
Write-Host 'PASS: creation, restrictive reruns, disabled-firewall refusal, and WhatIf'
