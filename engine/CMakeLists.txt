cmake_minimum_required(VERSION 3.20)
project(grafo_engine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXECUTABLE_SUFFIX ".wasm")

file(GLOB GRAFO_ENGINE_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp)

set(GRAFO_EXPORTS
  _grafo_alloc _grafo_free _grafo_reset _grafo_heap_used
  _grafo_route_orthogonal _grafo_simplify _grafo_smooth _grafo_flatten
  _grafo_boolean _grafo_point_in_polygon _grafo_distance_to_polyline
  _grafo_layout_layered _grafo_index_build _grafo_index_query _grafo_index_size)
list(JOIN GRAFO_EXPORTS "," GRAFO_EXPORT_LIST)

add_executable(engine ${GRAFO_ENGINE_SOURCES})
target_include_directories(engine PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_compile_options(engine PRIVATE -O3 -fno-exceptions -fno-rtti -ffreestanding -fno-builtin -mbulk-memory -Wall -Wextra)
target_link_options(engine PRIVATE
  --no-entry
  -sSTANDALONE_WASM
  -sMALLOC=none
  -sFILESYSTEM=0
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=2MB
  -sSTACK_SIZE=1MB
  -sERROR_ON_UNDEFINED_SYMBOLS=1
  -sEXPORTED_FUNCTIONS=${GRAFO_EXPORT_LIST})
set_target_properties(engine PROPERTIES OUTPUT_NAME engine RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../web/assets)
