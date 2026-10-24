#include "grafo.hpp"

using namespace grafo;

namespace {

bool finite(double v) { return v == v && v - v == 0; }

struct Grid {
    double* boxes;
    int count;
    double originX;
    double originY;
    double cell;
    int cols;
    int rows;
    int* cellStart;
    int* items;
    u32* stamp;
    u32 tick;
};

Grid grid = {nullptr, 0, 0, 0, 1, 0, 0, nullptr, nullptr, nullptr, 0};

void clearGrid() {
    if (grid.boxes) release(grid.boxes);
    if (grid.cellStart) release(grid.cellStart);
    if (grid.items) release(grid.items);
    if (grid.stamp) release(grid.stamp);
    grid.boxes = nullptr;
    grid.cellStart = nullptr;
    grid.items = nullptr;
    grid.stamp = nullptr;
    grid.count = 0;
    grid.cols = 0;
    grid.rows = 0;
    grid.tick = 0;
}

int cellX(double x) {
    int c = static_cast<int>(floord((x - grid.originX) / grid.cell));
    return c < 0 ? 0 : (c >= grid.cols ? grid.cols - 1 : c);
}

int cellY(double y) {
    int c = static_cast<int>(floord((y - grid.originY) / grid.cell));
    return c < 0 ? 0 : (c >= grid.rows ? grid.rows - 1 : c);
}

}

namespace grafo {

void indexForget() {
    grid.boxes = nullptr;
    grid.cellStart = nullptr;
    grid.items = nullptr;
    grid.stamp = nullptr;
    grid.count = 0;
    grid.cols = 0;
    grid.rows = 0;
    grid.tick = 0;
}

}

GRAFO_API(grafo_index_build) int grafo_index_build(const double* boxes, int n) {
    clearGrid();
    if (n <= 0) return 0;
    grid.count = n;
    grid.boxes = allocArray<double>(n * 4);
    double minX = 1e300, minY = 1e300, maxX = -1e300, maxY = -1e300, area = 0;
    for (int i = 0; i < n; ++i) {
        double x = boxes[i * 4], y = boxes[i * 4 + 1], w = boxes[i * 4 + 2], h = boxes[i * 4 + 3];
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) {
            grid.boxes[i * 4] = 0;
            grid.boxes[i * 4 + 1] = 0;
            grid.boxes[i * 4 + 2] = -1;
            grid.boxes[i * 4 + 3] = -1;
            continue;
        }
        grid.boxes[i * 4] = x;
        grid.boxes[i * 4 + 1] = y;
        grid.boxes[i * 4 + 2] = w;
        grid.boxes[i * 4 + 3] = h;
        minX = mind(minX, x);
        minY = mind(minY, y);
        maxX = maxd(maxX, x + w);
        maxY = maxd(maxY, y + h);
        area += (w + 1) * (h + 1);
    }
    if (minX > maxX) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
    double spanX = maxd(maxX - minX, 1), spanY = maxd(maxY - minY, 1);
    double cell = sqrtd(area / n) * 2.0;
    double minCell = maxd(spanX, spanY) / 256.0;
    if (cell < minCell) cell = minCell;
    if (cell < 1) cell = 1;
    grid.cell = cell;
    grid.originX = minX;
    grid.originY = minY;
    grid.cols = static_cast<int>(spanX / cell) + 1;
    grid.rows = static_cast<int>(spanY / cell) + 1;
    int cells = grid.cols * grid.rows;
    grid.cellStart = allocArray<int>(cells + 1);
    fillArray<int>(grid.cellStart, cells + 1, 0);
    for (int i = 0; i < n; ++i) {
        const double* b = grid.boxes + i * 4;
        if (b[2] < 0) continue;
        int c0 = cellX(b[0]), c1 = cellX(b[0] + b[2]), r0 = cellY(b[1]), r1 = cellY(b[1] + b[3]);
        for (int r = r0; r <= r1; ++r)
            for (int c = c0; c <= c1; ++c) grid.cellStart[r * grid.cols + c + 1]++;
    }
    for (int i = 0; i < cells; ++i) grid.cellStart[i + 1] += grid.cellStart[i];
    int totalItems = grid.cellStart[cells];
    grid.items = allocArray<int>(totalItems);
    int* fill = allocArray<int>(cells);
    for (int i = 0; i < cells; ++i) fill[i] = grid.cellStart[i];
    for (int i = 0; i < n; ++i) {
        const double* b = grid.boxes + i * 4;
        if (b[2] < 0) continue;
        int c0 = cellX(b[0]), c1 = cellX(b[0] + b[2]), r0 = cellY(b[1]), r1 = cellY(b[1] + b[3]);
        for (int r = r0; r <= r1; ++r)
            for (int c = c0; c <= c1; ++c) grid.items[fill[r * grid.cols + c]++] = i;
    }
    release(fill);
    grid.stamp = allocArray<u32>(n);
    fillArray<u32>(grid.stamp, n, 0);
    grid.tick = 0;
    return cells;
}

GRAFO_API(grafo_index_query) int grafo_index_query(double x, double y, double w, double h, int* out, int maxOut) {
    if (grid.count == 0 || !grid.items) return 0;
    if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return 0;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    if (++grid.tick == 0) {
        fillArray<u32>(grid.stamp, grid.count, 0);
        grid.tick = 1;
    }
    int c0 = cellX(x), c1 = cellX(x + w), r0 = cellY(y), r1 = cellY(y + h);
    int found = 0;
    for (int r = r0; r <= r1; ++r) {
        for (int c = c0; c <= c1; ++c) {
            int cellIndex = r * grid.cols + c;
            for (int k = grid.cellStart[cellIndex]; k < grid.cellStart[cellIndex + 1]; ++k) {
                int i = grid.items[k];
                if (grid.stamp[i] == grid.tick) continue;
                grid.stamp[i] = grid.tick;
                const double* b = grid.boxes + i * 4;
                if (b[0] > x + w || b[0] + b[2] < x || b[1] > y + h || b[1] + b[3] < y) continue;
                if (found < maxOut) out[found] = i;
                ++found;
            }
        }
    }
    return found < maxOut ? found : maxOut;
}

GRAFO_API(grafo_index_size) int grafo_index_size() { return grid.count; }
