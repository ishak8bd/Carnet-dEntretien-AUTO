Add-Type -AssemblyName System.Drawing

$darkSource = "C:\Users\pc\.gemini\antigravity\brain\3f7564d1-125e-4e6e-8c2b-b323c6dc6ccd\.user_uploaded\media_1791593757355_558fad61.jpg"
$blueSource = "C:\Users\pc\.gemini\antigravity\brain\3f7564d1-125e-4e6e-8c2b-b323c6dc6ccd\.user_uploaded\media_1791593757460_3390361f.jpg"

function Resize-And-Save($srcPath, $dstPath, $width, $height) {
    $srcImg = [System.Drawing.Image]::FromFile($srcPath)
    $newImg = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($newImg)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($srcImg, 0, 0, $width, $height)
    $newImg.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $newImg.Dispose()
    $srcImg.Dispose()
}

# Ensure icons directory exists
if (-not (Test-Path "icons")) {
    New-Item -ItemType Directory -Path "icons"
}

# Save full logos
Resize-And-Save $darkSource "icons\logo-dark.png" 512 512
Resize-And-Save $blueSource "icons\logo-blue.png" 512 512

# Save specific sizes
Resize-And-Save $darkSource "icons\icon-dark-192.png" 192 192
Resize-And-Save $darkSource "icons\icon-dark-512.png" 512 512
Resize-And-Save $blueSource "icons\icon-blue-192.png" 192 192
Resize-And-Save $blueSource "icons\icon-blue-512.png" 512 512

# Overwrite default PWA icons with dark version
Resize-And-Save $darkSource "icons\icon-192.png" 192 192
Resize-And-Save $darkSource "icons\icon-512.png" 512 512
Resize-And-Save $darkSource "icons\icon-maskable.png" 512 512

Write-Host "Icons processed successfully!"
