[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [System.Net.IPAddress] $LocalAddress,
    [Parameter(Mandatory)] [System.Net.IPAddress] $WslAddress,
    [Parameter(Mandatory)] [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}/(8|9|[12]\d|3[0-2])$')] [string] $TrustedSubnet
)

$ErrorActionPreference = 'Stop'
if ($LocalAddress.AddressFamily -ne 'InterNetwork' -or $WslAddress.AddressFamily -ne 'InterNetwork') {
    throw 'Only IPv4 addresses are supported by this forwarding rule.'
}
$address = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LocalAddress.IPAddressToString
if (@($address).Count -ne 1) { throw 'The LAN address must identify exactly one local interface.' }
$connection = Get-NetConnectionProfile -InterfaceIndex $address.InterfaceIndex
if ($connection.NetworkCategory -ne 'Private') {
    throw 'The selected LAN interface must already be marked Private.'
}
if (-not (Get-NetFirewallProfile -PolicyStore ActiveStore -Name Private).Enabled) {
    throw 'The Private firewall profile is disabled. Enable it before configuring restricted HTTPS forwarding.'
}

$ruleName = 'SAWOT-Local-HTTPS'
$rule = @{
    Name = $ruleName
    DisplayName = 'SAWOT local HTTPS'
    Enabled = 'True'
    Direction = 'Inbound'
    Action = 'Allow'
    Protocol = 'TCP'
    LocalPort = 443
    LocalAddress = $LocalAddress.IPAddressToString
    RemoteAddress = $TrustedSubnet
    Profile = 'Private'
    InterfaceAlias = $address.InterfaceAlias
    EdgeTraversalPolicy = 'Block'
}

if ($PSCmdlet.ShouldProcess("$LocalAddress`:443", 'Enforce restricted SAWOT firewall rule and WSL forwarding')) {
    # Apply the same restrictions on every run, including to an existing rule.
    if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
        $update = @{} + $rule
        $update.Remove('DisplayName')
        $update.NewDisplayName = $rule.DisplayName
        Set-NetFirewallRule @update | Out-Null
    } else {
        New-NetFirewallRule @rule | Out-Null
    }
    & netsh interface portproxy add v4tov4 "listenaddress=$LocalAddress" listenport=443 "connectaddress=$WslAddress" connectport=443
    if ($LASTEXITCODE -ne 0) { throw 'Unable to add SAWOT HTTPS forwarding.' }

    $actual = Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName
    $addresses = $actual | Get-NetFirewallAddressFilter
    $ports = $actual | Get-NetFirewallPortFilter
    $interfaces = $actual | Get-NetFirewallInterfaceFilter
    if ($actual.Enabled -ne 'True' -or $actual.Profile -ne 'Private' -or
        $actual.Direction -ne 'Inbound' -or $actual.Action -ne 'Allow' -or
        (@($addresses.LocalAddress) -join ',') -ne $LocalAddress.IPAddressToString -or
        (@($addresses.RemoteAddress) -join ',') -ne $TrustedSubnet -or
        (@($ports.LocalPort) -join ',') -ne '443' -or $ports.Protocol -ne 'TCP' -or
        (@($interfaces.InterfaceAlias) -join ',') -ne $address.InterfaceAlias) {
        throw 'The effective SAWOT firewall rule does not match the requested restrictions.'
    }
    Write-Host 'SAWOT HTTPS forwarding is configured for the selected private interface and subnet.'
    Write-Warning 'Other firewall rules and existing port forwards are independent; review them separately.'
}
