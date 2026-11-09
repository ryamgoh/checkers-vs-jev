#!/usr/bin/env bash
# Assemble the 30 s promo: clip A + clip B, post supers + end card, score mixed under production SFX.
set -euo pipefail
# Run from anywhere: paths are relative to docs/promo.
cd "$(dirname "$0")/.."
A=clips/clip-1-your-move.mp4
B=${1:-clips/clip-2-jev-replies.mp4}
OUT=${2:-checkers-vs-jev-promo-30s.mp4}
mkdir -p build

# 1) 30 s music bed: main entrance (9.73 s) for 27 s, 1 s crossfade into the natural ending (56.6-60.6 s).
ffmpeg -y -loglevel error -i music/score-original.mp3 -filter_complex \
"[0:a]atrim=9.73:36.73,asetpts=PTS-STARTPTS[m1];\
 [0:a]atrim=56.6:60.6,asetpts=PTS-STARTPTS[m2];\
 [m1][m2]acrossfade=d=1:c1=tri:c2=tri,atrim=0:30,afade=t=out:st=29.3:d=0.7[m]" \
 -map "[m]" -ar 48000 -ac 2 build/bed30.wav

# 2) Picture + overlays + mix. Each clip trimmed to 15.0 s so the cut lands at 15.0.
ffmpeg -y -loglevel error -i "$A" -i "$B" -i build/bed30.wav \
 -loop 1 -t 30 -i source/overlays/super_yourmove.png -loop 1 -t 30 -i source/overlays/super_jev.png \
 -loop 1 -t 30 -i source/overlays/super_strike.png -loop 1 -t 30 -i source/overlays/endcard.png \
 -filter_complex "\
[0:v]trim=0:15,setpts=PTS-STARTPTS,fps=24,format=yuv420p[va];\
[1:v]trim=0:15,setpts=PTS-STARTPTS,fps=24,format=yuv420p[vb];\
[va][vb]concat=n=2:v=1:a=0,format=yuva420p[v0];\
[3:v]format=rgba,fade=t=in:st=5.4:d=0.25:alpha=1,fade=t=out:st=8.6:d=0.25:alpha=1[s1];\
[4:v]format=rgba,fade=t=in:st=15.5:d=0.25:alpha=1,fade=t=out:st=18.7:d=0.25:alpha=1[s2];\
[5:v]format=rgba,fade=t=in:st=19.4:d=0.25:alpha=1,fade=t=out:st=21.8:d=0.25:alpha=1[s3];\
[6:v]format=rgba,fade=t=in:st=26.2:d=0.6:alpha=1[ec];\
[v0][s1]overlay=0:0:shortest=1[v1];[v1][s2]overlay=0:0:shortest=1[v2];\
[v2][s3]overlay=0:0:shortest=1[v3];[v3][ec]overlay=0:0:shortest=1,format=yuv420p[v];\
[0:a]atrim=0:15,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=14.92:d=0.08[aa];\
[1:a]atrim=0:15,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0.05[ab];\
[aa][ab]concat=n=2:v=0:a=1[sfx];\
[2:a]volume=0.55[mus];\
[sfx][mus]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]" \
 -map "[v]" -map "[a]" -t 30 -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
 -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$OUT"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration -of compact "$OUT"
