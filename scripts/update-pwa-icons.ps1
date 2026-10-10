Add-Type -AssemblyName System.Drawing

$darkSource = "C:\Users\pc\.gemini\antigravity\brain\3f7564d1-125e-4e6e-8c2b-b323c6dc6ccd\.user_uploaded\media_1791593757355_558fad61.jpg"
$blueSource = "C:\Users\pc\.gemini\antigravity\brain\3f7564d1-125e-4e6e-8c2b-b323c6dc6ccd\.user_uploaded\media_1791593757460_3390361f.jpg"
$glassSource = "C:\Users\pc\.gemini\antigravity\brain\3f7564d1-125e-4e6e-8c2b-b323c6dc6ccd\.user_uploaded\media_1791599082209_9c0ad3a4.jpg"
$liquidSource = "C:\Users\pc\.gemini\antigravity\brain\3f7564d1-125e-4e6e-8c2b-b323c6dc6ccd\liquid_glass_icon_1791600860711.jpg"

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

# Create maskable icon with safe zone padding
function Create-Maskable-Icon($srcPath, $dstPath, $bgColorHex) {
    $srcImg = [System.Drawing.Image]::FromFile($srcPath)
    $newImg = New-Object System.Drawing.Bitmap 512, 512
    $graphics = [System.Drawing.Graphics]::FromImage($newImg)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    
    # Fill background
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($bgColorHex))
    $graphics.FillRectangle($brush, 0, 0, 512, 512)
    $brush.Dispose()
    
    # Inner safe size: 420x420 centered (safe circle diameter is 410px, so 410-420 is ideal)
    $innerSize = 416
    $offset = [int]((512 - $innerSize) / 2) # 48
    $graphics.DrawImage($srcImg, $offset, $offset, $innerSize, $innerSize)
    
    $newImg.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $newImg.Dispose()
    $srcImg.Dispose()
}

# 1. Standard PNGs
Resize-And-Save $darkSource "icons\icon-192.png" 192 192
Resize-And-Save $darkSource "icons\icon-512.png" 512 512
Resize-And-Save $darkSource "icons\logo-dark.png" 512 512
Resize-And-Save $darkSource "icons\icon-dark-192.png" 192 192
Resize-And-Save $darkSource "icons\icon-dark-512.png" 512 512

Resize-And-Save $blueSource "icons\logo-blue.png" 512 512
Resize-And-Save $blueSource "icons\icon-blue-192.png" 192 192
Resize-And-Save $blueSource "icons\icon-blue-512.png" 512 512

Resize-And-Save $glassSource "icons\logo-glass.png" 512 512
Resize-And-Save $glassSource "icons\icon-glass-192.png" 192 192
Resize-And-Save $glassSource "icons\icon-glass-512.png" 512 512

Resize-And-Save $liquidSource "icons\logo-liquid.png" 512 512
Resize-And-Save $liquidSource "icons\icon-liquid-192.png" 192 192
Resize-And-Save $liquidSource "icons\icon-liquid-512.png" 512 512

# 2. Maskable Icons
Create-Maskable-Icon $darkSource "icons\icon-maskable.png" "#0b0f19"

# 3. Create SVG embedding the dark logo base64
$bytes = [System.IO.File]::ReadAllBytes("icons\icon-512.png")
$b64 = [Convert]::ToBase64String($bytes)
$svgContent = @"
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0b0f19" rx="112" />
  <image href="data:image/png;base64,$b64" width="512" height="512" preserveAspectRatio="xMidYMid slice" />
</svg>
"@
[System.IO.File]::WriteAllText("icons\icon.svg", $svgContent, [System.Text.Encoding]::UTF8)

Write-Host "All icons including glass theme icons updated successfully!"
