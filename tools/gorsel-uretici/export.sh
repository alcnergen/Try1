#!/usr/bin/env bash
# png/ klasöründeki render'ları "önce" efektiyle birlikte ../../img/ altına WebP olarak aktarır.
set -euo pipefail
cd "$(dirname "$0")/png"
D=../../../img
bad() { convert "$1" -resize 104% -gravity center -rotate -1.6 -crop 1000x1250+0+0 +repage \
  -modulate 97,82,100 -fill "#ffc96b" -colorize 9% -level 4%,97%,0.93 -attenuate 0.55 +noise Gaussian -blur 0x0.7 "$2"; }
tmp=$(mktemp -d)
bad hero-before.png "$tmp/hb.png" && convert "$tmp/hb.png" -quality 80 $D/hero-once.webp
for v in studio warm lifestyle ghost; do convert hero-$v.png -quality 82 $D/hero-$v.webp; done
for n in elbise kazak canta sneaker ceket esarp; do
  convert g-$n.png -resize 800x1000 -quality 80 $D/ornek-$n.webp
  bad b-$n.png "$tmp/b.png" && convert "$tmp/b.png" -resize 320x400 -quality 74 $D/ornek-$n-once.webp
done
rm -rf "$tmp"
