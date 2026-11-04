# Offline stand-in voice for the VSL. Reads [{id, text, out}] and writes one WAV
# per item, then prints [{id, out, voice, words:[{w,s,e}]}] as JSON on stdout.
param([Parameter(Mandatory)][string]$InputPath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$items = Get-Content -Raw -Path $InputPath | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft David Desktop')
$synth.Rate = -1
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

$results = foreach ($item in $items) {
  Register-ObjectEvent -InputObject $synth -EventName SpeakProgress -SourceIdentifier 'vo' | Out-Null
  $synth.SetOutputToWaveFile($item.out, $format)
  $synth.Speak($item.text)
  $synth.SetOutputToNull()
  $events = @(Get-Event -SourceIdentifier 'vo' | Sort-Object { $_.SourceEventArgs.AudioPosition })
  Unregister-Event -SourceIdentifier 'vo'
  Remove-Event -SourceIdentifier 'vo' -ErrorAction SilentlyContinue

  # SAPI reports each word's start; a word ends where the next begins.
  $words = for ($i = 0; $i -lt $events.Count; $i++) {
    $a = $events[$i].SourceEventArgs
    $start = $a.AudioPosition.TotalSeconds
    $end = if ($i + 1 -lt $events.Count) { $events[$i + 1].SourceEventArgs.AudioPosition.TotalSeconds } else { $start + 0.45 }
    # Take the word from the source text so punctuation stays attached for captions.
    $rest = $item.text.Substring($a.CharacterPosition)
    $word = ($rest -split '\s+')[0]
    [pscustomobject]@{ w = $word; s = $start; e = $end }
  }
  [pscustomobject]@{ id = $item.id; out = $item.out; voice = 'Microsoft David Desktop'; words = @($words) }
}

$synth.Dispose()
ConvertTo-Json -InputObject @($results) -Depth 5 -Compress
