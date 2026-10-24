#include "grafo.hpp"

using namespace grafo;

namespace {

struct Box {
    double l, t, r, b;
};

struct HeapItem {
    double f;
    int state;
};

const double kEps = 1e-7;

struct MinHeap {
    Vec<HeapItem> items;

    void init() {
        items.data = nullptr;
        items.init(256);
    }
    void push(HeapItem v) {
        items.push(v);
        int i = items.size - 1;
        while (i > 0) {
            int p = (i - 1) / 2;
            if (items[p].f <= items[i].f) break;
            HeapItem tmp = items[p];
            items[p] = items[i];
            items[i] = tmp;
            i = p;
        }
    }
    HeapItem pop() {
        HeapItem top = items[0];
        items[0] = items[items.size - 1];
        --items.size;
        int i = 0;
        for (;;) {
            int l = i * 2 + 1, r = l + 1, m = i;
            if (l < items.size && items[l].f < items[m].f) m = l;
            if (r < items.size && items[r].f < items[m].f) m = r;
            if (m == i) break;
            HeapItem tmp = items[m];
            items[m] = items[i];
            items[i] = tmp;
            i = m;
        }
        return top;
    }
};

int dedupe(double* v, int n) {
    sortArray(v, n, [](double a, double b) { return a < b; });
    int k = 0;
    for (int i = 0; i < n; ++i) {
        if (k == 0 || v[i] - v[k - 1] > 1e-6) v[k++] = v[i];
    }
    return k;
}

int indexOf(const double* v, int n, double x) {
    int lo = 0, hi = n - 1;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (v[mid] < x) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && absd(v[lo - 1] - x) < absd(v[lo] - x)) return lo - 1;
    return lo;
}

bool strictlyInside(const Box& b, double x, double y) {
    return x > b.l + kEps && x < b.r - kEps && y > b.t + kEps && y < b.b - kEps;
}

int firstAbove(const double* v, int n, double x) {
    int lo = 0, hi = n;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (v[mid] > x) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

int lastBelow(const double* v, int n, double x) {
    int lo = 0, hi = n;
    while (lo < hi) {
        int mid = (lo + hi) >> 1;
        if (v[mid] < x) lo = mid + 1;
        else hi = mid;
    }
    return lo - 1;
}

bool finite(double v) { return v == v && v - v == 0; }

const int DX[4] = {0, 1, 0, -1};
const int DY[4] = {-1, 0, 1, 0};

void step(double& x, double& y, int dir, double amount) {
    if (dir == 0) y -= amount;
    else if (dir == 1) x += amount;
    else if (dir == 2) y += amount;
    else if (dir == 3) x -= amount;
}

int writeFallback(double sx, double sy, double ax, double ay, double bx, double by, double tx, double ty, double* out, int maxPoints) {
    double pts[12];
    int k = 0;
    pts[k++] = sx; pts[k++] = sy;
    pts[k++] = ax; pts[k++] = ay;
    double mx = (ax + bx) * 0.5;
    pts[k++] = mx; pts[k++] = ay;
    pts[k++] = mx; pts[k++] = by;
    pts[k++] = bx; pts[k++] = by;
    pts[k++] = tx; pts[k++] = ty;
    int count = 0;
    for (int i = 0; i < 6 && count < maxPoints; ++i) {
        double x = pts[i * 2], y = pts[i * 2 + 1];
        if (count > 0 && absd(out[(count - 1) * 2] - x) < 1e-9 && absd(out[(count - 1) * 2 + 1] - y) < 1e-9) continue;
        out[count * 2] = x;
        out[count * 2 + 1] = y;
        ++count;
    }
    return count;
}

int compress(double* out, int count) {
    if (count < 3) return count;
    int k = 1;
    for (int i = 1; i < count; ++i) {
        double x = out[i * 2], y = out[i * 2 + 1];
        double px = out[(k - 1) * 2], py = out[(k - 1) * 2 + 1];
        if (absd(px - x) < 1e-9 && absd(py - y) < 1e-9) continue;
        if (k >= 2) {
            double qx = out[(k - 2) * 2], qy = out[(k - 2) * 2 + 1];
            bool sameX = absd(qx - px) < 1e-9 && absd(px - x) < 1e-9;
            bool sameY = absd(qy - py) < 1e-9 && absd(py - y) < 1e-9;
            if (sameX || sameY) {
                out[(k - 1) * 2] = x;
                out[(k - 1) * 2 + 1] = y;
                continue;
            }
        }
        out[k * 2] = x;
        out[k * 2 + 1] = y;
        ++k;
    }
    return k;
}

}

GRAFO_API(grafo_route_orthogonal) int grafo_route_orthogonal(const double* obstacles, int nObstacles, double sx, double sy, int sdir, double tx, double ty, int tdir, double margin, double* out, int maxPoints) {
    if (maxPoints < 2 || nObstacles < 0) return 0;
    if (!finite(sx) || !finite(sy) || !finite(tx) || !finite(ty)) return 0;
    if (!finite(margin)) margin = 0;
    if (margin < 0) margin = 0;
    if (sdir < -1 || sdir > 3) sdir = -1;
    if (tdir < -1 || tdir > 3) tdir = -1;
    double ax = sx, ay = sy, bx = tx, by = ty;
    if (sdir >= 0) step(ax, ay, sdir, margin);
    if (tdir >= 0) step(bx, by, tdir, margin);

    Box* boxes = allocArray<Box>(nObstacles);
    int nb = 0;
    for (int i = 0; i < nObstacles; ++i) {
        double x = obstacles[i * 4], y = obstacles[i * 4 + 1], w = obstacles[i * 4 + 2], h = obstacles[i * 4 + 3];
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) continue;
        Box raw{x, y, x + w, y + h};
        Box inf{x - margin, y - margin, x + w + margin, y + h + margin};
        bool hitsA = strictlyInside(inf, ax, ay) || strictlyInside(inf, bx, by);
        if (!hitsA) {
            boxes[nb++] = inf;
            continue;
        }
        bool hitsRaw = strictlyInside(raw, ax, ay) || strictlyInside(raw, bx, by);
        if (!hitsRaw) boxes[nb++] = raw;
    }

    int cap = nb * 2 + 8;
    double* xs = allocArray<double>(cap);
    double* ys = allocArray<double>(cap);
    int nx = 0, ny = 0;
    double minX = mind(ax, bx), maxX = maxd(ax, bx), minY = mind(ay, by), maxY = maxd(ay, by);
    for (int i = 0; i < nb; ++i) {
        xs[nx++] = boxes[i].l;
        xs[nx++] = boxes[i].r;
        ys[ny++] = boxes[i].t;
        ys[ny++] = boxes[i].b;
        minX = mind(minX, boxes[i].l);
        maxX = maxd(maxX, boxes[i].r);
        minY = mind(minY, boxes[i].t);
        maxY = maxd(maxY, boxes[i].b);
    }
    double pad = margin > 0 ? margin : 10;
    xs[nx++] = ax; xs[nx++] = bx; xs[nx++] = (ax + bx) * 0.5;
    xs[nx++] = minX - pad; xs[nx++] = maxX + pad;
    ys[ny++] = ay; ys[ny++] = by; ys[ny++] = (ay + by) * 0.5;
    ys[ny++] = minY - pad; ys[ny++] = maxY + pad;
    nx = dedupe(xs, nx);
    ny = dedupe(ys, ny);

    int nodes = nx * ny;
    int states = nodes * 4;
    u8* blocked = allocArray<u8>(nodes);
    u8* hBlocked = allocArray<u8>(nodes);
    u8* vBlocked = allocArray<u8>(nodes);
    fillArray<u8>(blocked, nodes, 0);
    fillArray<u8>(hBlocked, nodes, 0);
    fillArray<u8>(vBlocked, nodes, 0);
    for (int k = 0; k < nb; ++k) {
        const Box& bx = boxes[k];
        int x0 = firstAbove(xs, nx, bx.l + kEps), x1 = lastBelow(xs, nx, bx.r - kEps);
        int y0 = firstAbove(ys, ny, bx.t + kEps), y1 = lastBelow(ys, ny, bx.b - kEps);
        int sx0 = lastBelow(xs, nx, bx.l + kEps) < 0 ? 0 : lastBelow(xs, nx, bx.l + kEps);
        int sy0 = lastBelow(ys, ny, bx.t + kEps) < 0 ? 0 : lastBelow(ys, ny, bx.t + kEps);
        for (int iy = y0; iy <= y1; ++iy) {
            for (int ix = x0; ix <= x1; ++ix) blocked[iy * nx + ix] = 1;
            for (int ix = sx0; ix <= x1 && ix + 1 < nx; ++ix) {
                if (xs[ix + 1] > bx.l + kEps && xs[ix] < bx.r - kEps) hBlocked[iy * nx + ix] = 1;
            }
        }
        for (int ix = x0; ix <= x1; ++ix) {
            for (int iy = sy0; iy <= y1 && iy + 1 < ny; ++iy) {
                if (ys[iy + 1] > bx.t + kEps && ys[iy] < bx.b - kEps) vBlocked[iy * nx + ix] = 1;
            }
        }
    }
    int sIndex = indexOf(ys, ny, ay) * nx + indexOf(xs, nx, ax);
    int tIndex = indexOf(ys, ny, by) * nx + indexOf(xs, nx, bx);
    blocked[sIndex] = 0;
    blocked[tIndex] = 0;

    double* g = allocArray<double>(states);
    int* from = allocArray<int>(states);
    u8* closed = allocArray<u8>(states);
    fillArray<double>(g, states, 1e300);
    fillArray<int>(from, states, -1);
    fillArray<u8>(closed, states, 0);

    double span = absd(ax - bx) + absd(ay - by);
    double bend = margin * 2.0 + 16.0 + span * 0.02;
    int goalDir = tdir >= 0 ? (tdir + 2) % 4 : -1;

    MinHeap heap;
    heap.init();
    for (int d = 0; d < 4; ++d) {
        if (sdir >= 0 && d != sdir) continue;
        int st = sIndex * 4 + d;
        g[st] = 0;
        double h = absd(ax - bx) + absd(ay - by);
        heap.push(HeapItem{h, st});
    }

    int bestGoal = -1;
    double bestCost = 1e300;
    while (heap.items.size > 0) {
        HeapItem item = heap.pop();
        int st = item.state;
        if (closed[st]) continue;
        if (item.f >= bestCost) break;
        closed[st] = 1;
        int node = st >> 2;
        int dir = st & 3;
        if (node == tIndex) {
            double extra = 0;
            if (goalDir >= 0 && dir != goalDir) extra = (dir == (goalDir + 2) % 4) ? bend * 2.0 : bend;
            if (g[st] + extra < bestCost) {
                bestCost = g[st] + extra;
                bestGoal = st;
            }
            continue;
        }
        int ix = node % nx, iy = node / nx;
        for (int nd = 0; nd < 4; ++nd) {
            if (nd == (dir + 2) % 4) continue;
            int jx = ix + DX[nd], jy = iy + DY[nd];
            if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
            int next = jy * nx + jx;
            if (blocked[next]) continue;
            double x1 = xs[ix], y1 = ys[iy], x2 = xs[jx], y2 = ys[jy];
            if (nd == 1 && hBlocked[node]) continue;
            if (nd == 3 && hBlocked[next]) continue;
            if (nd == 2 && vBlocked[node]) continue;
            if (nd == 0 && vBlocked[next]) continue;
            double cost = g[st] + absd(x2 - x1) + absd(y2 - y1) + (nd != dir ? bend : 0);
            int ns = next * 4 + nd;
            if (closed[ns] || cost >= g[ns]) continue;
            g[ns] = cost;
            from[ns] = st;
            double h = absd(x2 - bx) + absd(y2 - by);
            heap.push(HeapItem{cost + h, ns});
        }
    }

    int count = 0;
    if (bestGoal < 0) {
        count = writeFallback(sx, sy, ax, ay, bx, by, tx, ty, out, maxPoints);
    } else {
        int length = 0;
        for (int st = bestGoal; st >= 0; st = from[st]) ++length;
        int total = length + 2;
        double* tmp = allocArray<double>(total * 2);
        int k = 0;
        tmp[k * 2] = sx;
        tmp[k * 2 + 1] = sy;
        ++k;
        int pos = k + length - 1;
        for (int st = bestGoal; st >= 0; st = from[st]) {
            int node = st >> 2;
            tmp[pos * 2] = xs[node % nx];
            tmp[pos * 2 + 1] = ys[node / nx];
            --pos;
        }
        k += length;
        tmp[k * 2] = tx;
        tmp[k * 2 + 1] = ty;
        ++k;
        k = compress(tmp, k);
        count = mini(k, maxPoints);
        for (int i = 0; i < count * 2; ++i) out[i] = tmp[i];
        release(tmp);
    }

    heap.items.destroy();
    release(closed);
    release(from);
    release(g);
    release(vBlocked);
    release(hBlocked);
    release(blocked);
    release(ys);
    release(xs);
    release(boxes);
    return count;
}
