#include "grafo.hpp"

extern "C" unsigned char __heap_base;

namespace {

struct Header {
    u32 size;
    u32 free;
};

const usize kAlign = 16;
const usize kPage = 65536;

usize heapStart = 0;
usize heapTop = 0;

usize alignUp(usize v, usize a) { return (v + a - 1) & ~(a - 1); }

void ensureInit() {
    if (heapStart != 0) return;
    heapStart = alignUp(reinterpret_cast<usize>(&__heap_base), kAlign);
    heapTop = heapStart;
}

bool ensureCapacity(usize end) {
    usize current = static_cast<usize>(__builtin_wasm_memory_size(0)) * kPage;
    if (end <= current) return true;
    usize pages = (end - current + kPage - 1) / kPage;
    return __builtin_wasm_memory_grow(0, pages) != static_cast<usize>(-1);
}

Header* headerAt(usize addr) { return reinterpret_cast<Header*>(addr); }

usize blockPayload(usize addr) { return addr + kAlign; }

usize blockEnd(usize addr) { return addr + kAlign + headerAt(addr)->size; }

}

namespace grafo {

void copyBytes(void* dst, const void* src, usize n) {
    u8* d = static_cast<u8*>(dst);
    const u8* s = static_cast<const u8*>(src);
    if (d == s || n == 0) return;
    __builtin_memmove(d, s, n);
}

void zeroBytes(void* dst, usize n) {
    if (n == 0) return;
    __builtin_memset(dst, 0, n);
}

void* alloc(usize bytes) {
    ensureInit();
    usize need = alignUp(bytes == 0 ? 1 : bytes, kAlign);
    usize addr = heapStart;
    while (addr < heapTop) {
        Header* h = headerAt(addr);
        if (h->free) {
            usize next = blockEnd(addr);
            while (next < heapTop && headerAt(next)->free) {
                h->size += static_cast<u32>(kAlign + headerAt(next)->size);
                next = blockEnd(addr);
            }
            if (next >= heapTop) {
                heapTop = addr;
                break;
            }
            if (h->size >= need) {
                if (h->size >= need + kAlign + kAlign) {
                    usize rest = addr + kAlign + need;
                    Header* r = headerAt(rest);
                    r->size = static_cast<u32>(h->size - need - kAlign);
                    r->free = 1;
                    h->size = static_cast<u32>(need);
                }
                h->free = 0;
                return reinterpret_cast<void*>(blockPayload(addr));
            }
        }
        addr = blockEnd(addr);
    }
    usize end = heapTop + kAlign + need;
    if (!ensureCapacity(end)) return nullptr;
    Header* h = headerAt(heapTop);
    h->size = static_cast<u32>(need);
    h->free = 0;
    usize payload = blockPayload(heapTop);
    heapTop = end;
    return reinterpret_cast<void*>(payload);
}

void release(void* ptr) {
    if (!ptr) return;
    usize addr = reinterpret_cast<usize>(ptr) - kAlign;
    if (addr < heapStart || addr >= heapTop) return;
    Header* h = headerAt(addr);
    h->free = 1;
    usize next = blockEnd(addr);
    while (next < heapTop && headerAt(next)->free) {
        h->size += static_cast<u32>(kAlign + headerAt(next)->size);
        next = blockEnd(addr);
    }
    if (next >= heapTop) heapTop = addr;
}

}

GRAFO_API(grafo_alloc) void* grafo_alloc(u32 bytes) { return grafo::alloc(bytes); }

GRAFO_API(grafo_free) void grafo_free(void* ptr) { grafo::release(ptr); }

GRAFO_API(grafo_reset) void grafo_reset() {
    ensureInit();
    grafo::indexForget();
    heapTop = heapStart;
}

GRAFO_API(grafo_heap_used) u32 grafo_heap_used() {
    ensureInit();
    return static_cast<u32>(heapTop - heapStart);
}
