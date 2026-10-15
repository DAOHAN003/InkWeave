$output = & cargo check 2>&1 | Out-String
$output | Out-File -FilePath "E:\万象\cargo_full.txt" -Encoding utf8
Write-Host "DONE"
Write-Host $output
