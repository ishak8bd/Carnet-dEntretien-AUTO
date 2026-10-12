param(
    [string]$Title = "Carnet d'Entretien",
    [string]$Message = "Alerte d'entretien détectée !"
)

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    
    # Émission d'un son discret d'alerte système
    try {
        [System.Media.SystemSounds]::Exclamation.Play()
    } catch {}

    $balloon = New-Object System.Windows.Forms.NotifyIcon
    $balloon.Icon = [System.Drawing.SystemIcons]::Information
    $balloon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
    $balloon.BalloonTipTitle = $Title
    $balloon.BalloonTipText = $Message
    $balloon.Visible = $true
    $balloon.ShowBalloonTip(10000)

    # Laisser le temps à Windows d'enregistrer la bulle dans la barre des tâches
    Start-Sleep -Milliseconds 3000
    $balloon.Dispose()
} catch {
    Write-Host "Erreur notification Windows: $_"
}
