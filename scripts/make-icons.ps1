param([int[]]$Sizes = @(192, 512))
Add-Type -AssemblyName System.Drawing
$iconDir = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
foreach ($size in $Sizes) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(7, 29, 50))
  $yellow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 207, 50))
  $aqua = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(19, 185, 200))
  $red = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 92, 88))
  $darkPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(7, 29, 50), $size * .047)
  $whitePen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, $size * .052)
  $graphics.FillEllipse($yellow, $size * .14, $size * .14, $size * .72, $size * .72)
  $graphics.FillEllipse($aqua, $size * .23, $size * .23, $size * .54, $size * .54)
  $graphics.DrawEllipse($darkPen, $size * .23, $size * .23, $size * .54, $size * .54)
  $graphics.DrawEllipse($darkPen, $size * .19, $size * .51, $size * .25, $size * .25)
  $graphics.DrawEllipse($darkPen, $size * .56, $size * .51, $size * .25, $size * .25)
  $graphics.DrawLine($whitePen, $size * .30, $size * .55, $size * .50, $size * .36)
  $graphics.DrawLine($whitePen, $size * .50, $size * .36, $size * .69, $size * .55)
  $graphics.FillEllipse($red, $size * .43, $size * .21, $size * .14, $size * .14)
  $graphics.DrawEllipse($darkPen, $size * .43, $size * .21, $size * .14, $size * .14)
  $output = Join-Path $iconDir "icon-$size.png"
  $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
  $darkPen.Dispose(); $whitePen.Dispose(); $yellow.Dispose(); $aqua.Dispose(); $red.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
