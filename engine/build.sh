#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/web/assets/engine.wasm}"
mkdir -p "$(dirname "$OUT")"
SOURCES=("$ROOT"/engine/src/*.cpp)
EXPORTS=(grafo_alloc grafo_free grafo_reset grafo_heap_used grafo_route_orthogonal grafo_simplify grafo_smooth grafo_flatten grafo_boolean grafo_point_in_polygon grafo_distance_to_polyline grafo_layout_layered grafo_index_build grafo_index_query grafo_index_size)
CXXFLAGS=(-std=c++17 -O3 -fno-exceptions -fno-rtti -ffreestanding -fno-builtin -mbulk-memory -Wall -Wextra -I"$ROOT/engine/include")
if command -v emcc >/dev/null 2>&1; then
  LIST=""
  for name in "${EXPORTS[@]}"; do LIST="$LIST,_$name"; done
  emcc "${CXXFLAGS[@]}" "${SOURCES[@]}" -o "$OUT" --no-entry -sSTANDALONE_WASM -sMALLOC=none -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=2MB -sSTACK_SIZE=1MB -sEXPORTED_FUNCTIONS="${LIST#,}" -sERROR_ON_UNDEFINED_SYMBOLS=1
else
  CXX="${CXX:-clang++}"
  LINK=(-Wl,--no-entry -Wl,--strip-all -Wl,--gc-sections -Wl,-z,stack-size=1048576 -Wl,--initial-memory=2097152)
  for name in "${EXPORTS[@]}"; do LINK+=("-Wl,--export=$name"); done
  "$CXX" --target=wasm32 -nostdlib "${CXXFLAGS[@]}" "${SOURCES[@]}" "${LINK[@]}" -o "$OUT"
fi
echo "engine: $OUT ($(wc -c < "$OUT") bytes)"
