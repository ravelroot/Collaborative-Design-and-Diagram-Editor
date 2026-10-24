#include "grafo.hpp"

using namespace grafo;

namespace {

struct Vertex {
    double x, y, alpha;
    int next, prev, neighbor;
    u8 intersect, entry, visited, pad;
};

struct Clipper {
    Vec<Vertex> pool;
    int headA;
    int headB;
    int countA;
    int countB;
    bool degenerate;
};

int cleanPolygon(const double* src, int n, double* dst) {
    int k = 0;
    for (int i = 0; i < n; ++i) {
        double x = src[i * 2], y = src[i * 2 + 1];
        if (!(x == x && x - x == 0 && y == y && y - y == 0)) continue;
        if (k > 0 && absd(dst[(k - 1) * 2] - x) < 1e-12 && absd(dst[(k - 1) * 2 + 1] - y) < 1e-12) continue;
        dst[k * 2] = x;
        dst[k * 2 + 1] = y;
        ++k;
    }
    while (k > 1 && absd(dst[0] - dst[(k - 1) * 2]) < 1e-12 && absd(dst[1] - dst[(k - 1) * 2 + 1]) < 1e-12) --k;
    return k;
}

int buildRing(Clipper& c, const double* pts, int n) {
    int head = c.pool.size;
    for (int i = 0; i < n; ++i) {
        Vertex v;
        v.x = pts[i * 2];
        v.y = pts[i * 2 + 1];
        v.alpha = 0;
        v.next = head + (i + 1) % n;
        v.prev = head + (i + n - 1) % n;
        v.neighbor = -1;
        v.intersect = 0;
        v.entry = 0;
        v.visited = 0;
        v.pad = 0;
        c.pool.push(v);
    }
    return head;
}

void insertBetween(Clipper& c, int vIndex, int start, int end) {
    int cur = start;
    double alpha = c.pool[vIndex].alpha;
    while (c.pool[cur].next != end && c.pool[c.pool[cur].next].intersect && c.pool[c.pool[cur].next].alpha < alpha) cur = c.pool[cur].next;
    int after = c.pool[cur].next;
    c.pool[vIndex].next = after;
    c.pool[vIndex].prev = cur;
    c.pool[cur].next = vIndex;
    c.pool[after].prev = vIndex;
}

void findIntersections(Clipper& c, const double* a, int na, const double* b, int nb, double scale) {
    double eps = 1e-10;
    double lenEps = 1e-9 * scale;
    for (int i = 0; i < na; ++i) {
        double a1x = a[i * 2], a1y = a[i * 2 + 1];
        double a2x = a[((i + 1) % na) * 2], a2y = a[((i + 1) % na) * 2 + 1];
        for (int j = 0; j < nb; ++j) {
            double b1x = b[j * 2], b1y = b[j * 2 + 1];
            double b2x = b[((j + 1) % nb) * 2], b2y = b[((j + 1) % nb) * 2 + 1];
            double rx = a2x - a1x, ry = a2y - a1y;
            double sx = b2x - b1x, sy = b2y - b1y;
            double d = cross(rx, ry, sx, sy);
            double qx = b1x - a1x, qy = b1y - a1y;
            double rl = sqrtd(rx * rx + ry * ry), sl = sqrtd(sx * sx + sy * sy);
            if (absd(d) <= eps * rl * sl) {
                double off = absd(cross(qx, qy, rx, ry)) / (rl > 0 ? rl : 1);
                if (off < lenEps) {
                    double t0 = (qx * rx + qy * ry) / (rl * rl > 0 ? rl * rl : 1);
                    double t1 = ((b2x - a1x) * rx + (b2y - a1y) * ry) / (rl * rl > 0 ? rl * rl : 1);
                    if (maxd(t0, t1) >= -eps && mind(t0, t1) <= 1 + eps) c.degenerate = true;
                }
                continue;
            }
            double alpha = cross(qx, qy, sx, sy) / d;
            double beta = cross(qx, qy, rx, ry) / d;
            double ea = 1e-9;
            if (alpha < -ea || alpha > 1 + ea || beta < -ea || beta > 1 + ea) continue;
            if (alpha <= ea || alpha >= 1 - ea || beta <= ea || beta >= 1 - ea) {
                c.degenerate = true;
                continue;
            }
            Vertex va;
            va.x = a1x + alpha * rx;
            va.y = a1y + alpha * ry;
            va.alpha = alpha;
            va.intersect = 1;
            va.entry = 0;
            va.visited = 0;
            va.pad = 0;
            va.neighbor = -1;
            va.next = va.prev = -1;
            Vertex vb = va;
            vb.alpha = beta;
            int ia = c.pool.size;
            c.pool.push(va);
            int ib = c.pool.size;
            c.pool.push(vb);
            c.pool[ia].neighbor = ib;
            c.pool[ib].neighbor = ia;
            int startA = c.headA + i;
            int endA = c.headA + (i + 1) % na;
            insertBetween(c, ia, startA, endA);
            int startB = c.headB + j;
            int endB = c.headB + (j + 1) % nb;
            insertBetween(c, ib, startB, endB);
        }
    }
}

void markEntries(Clipper& c, int head, bool forward) {
    int v = head;
    bool status = forward;
    do {
        Vertex& cur = c.pool[v];
        if (cur.intersect) {
            cur.entry = status ? 1 : 0;
            status = !status;
        }
        v = cur.next;
    } while (v != head);
}

void visit(Clipper& c, int v) {
    c.pool[v].visited = 1;
    int n = c.pool[v].neighbor;
    if (n >= 0 && !c.pool[n].visited) c.pool[n].visited = 1;
}

struct Output {
    double* out;
    int maxOut;
    int* ringSizes;
    int maxRings;
    int points;
    int rings;
    bool overflow;
};

void emitRing(Output& o, const double* pts, int n) {
    if (n < 3) return;
    if (o.rings >= o.maxRings || o.points + n > o.maxOut) {
        o.overflow = true;
        return;
    }
    for (int i = 0; i < n * 2; ++i) o.out[o.points * 2 + i] = pts[i];
    o.points += n;
    o.ringSizes[o.rings++] = n;
}

int traverse(Clipper& c, Output& o) {
    int produced = 0;
    Vec<double> ring;
    ring.data = nullptr;
    ring.init(64);
    for (;;) {
        int start = -1;
        int v = c.headA;
        do {
            if (c.pool[v].intersect && !c.pool[v].visited) {
                start = v;
                break;
            }
            v = c.pool[v].next;
        } while (v != c.headA);
        if (start < 0) break;
        ring.size = 0;
        int current = start;
        ring.push(c.pool[current].x);
        ring.push(c.pool[current].y);
        int guard = c.pool.size * 4 + 16;
        do {
            visit(c, current);
            if (c.pool[current].entry) {
                do {
                    current = c.pool[current].next;
                    ring.push(c.pool[current].x);
                    ring.push(c.pool[current].y);
                } while (!c.pool[current].intersect && --guard > 0);
            } else {
                do {
                    current = c.pool[current].prev;
                    ring.push(c.pool[current].x);
                    ring.push(c.pool[current].y);
                } while (!c.pool[current].intersect && --guard > 0);
            }
            current = c.pool[current].neighbor;
        } while (!c.pool[current].visited && --guard > 0);
        int n = ring.size / 2;
        if (n > 1 && absd(ring[0] - ring[(n - 1) * 2]) < 1e-9 && absd(ring[1] - ring[(n - 1) * 2 + 1]) < 1e-9) --n;
        emitRing(o, ring.data, n);
        ++produced;
        if (guard <= 0) break;
    }
    ring.destroy();
    return produced;
}

bool clipOnce(const double* a, int na, const double* b, int nb, bool forwardA, bool forwardB, int mode, Output& o, double scale) {
    Clipper c;
    c.pool.data = nullptr;
    c.pool.init(na + nb + 16);
    c.degenerate = false;
    c.headA = buildRing(c, a, na);
    c.headB = buildRing(c, b, nb);
    c.countA = na;
    c.countB = nb;
    findIntersections(c, a, na, b, nb, scale);
    if (c.degenerate) {
        c.pool.destroy();
        return false;
    }
    bool aInB = pointInPolygon(b, nb, a[0], a[1]) != 0;
    bool bInA = pointInPolygon(a, na, b[0], b[1]) != 0;
    bool any = c.pool.size > na + nb;
    if (!any) {
        if (mode == 0) {
            if (aInB) emitRing(o, b, nb);
            else if (bInA) emitRing(o, a, na);
            else {
                emitRing(o, a, na);
                emitRing(o, b, nb);
            }
        } else if (mode == 2) {
            if (aInB) emitRing(o, a, na);
            else if (bInA) emitRing(o, b, nb);
        } else {
            if (aInB) {
            } else if (bInA) {
                emitRing(o, a, na);
                emitRing(o, b, nb);
            } else {
                emitRing(o, a, na);
            }
        }
        c.pool.destroy();
        return true;
    }
    markEntries(c, c.headA, forwardA != aInB);
    markEntries(c, c.headB, forwardB != bInA);
    traverse(c, o);
    c.pool.destroy();
    return true;
}

bool run(const double* a, int na, const double* b, int nb, int op, Output& o, double scale) {
    if (op == 0) return clipOnce(a, na, b, nb, false, false, 0, o, scale);
    if (op == 1) return clipOnce(a, na, b, nb, false, true, 1, o, scale);
    if (op == 2) return clipOnce(a, na, b, nb, true, true, 2, o, scale);
    Output first = o;
    if (!clipOnce(a, na, b, nb, false, true, 1, o, scale)) return false;
    Output second = o;
    if (!clipOnce(b, nb, a, na, false, true, 1, second, scale)) {
        o = first;
        return false;
    }
    o = second;
    return true;
}

}

GRAFO_API(grafo_boolean) int grafo_boolean(int op, const double* a, int na, const double* b, int nb, double* out, int maxOut, int* ringSizes, int maxRings) {
    if (op < 0 || op > 3) return -1;
    double* ca = allocArray<double>(na * 2 + 2);
    double* cb = allocArray<double>(nb * 2 + 2);
    double* pb = allocArray<double>(nb * 2 + 2);
    na = cleanPolygon(a, na, ca);
    nb = cleanPolygon(b, nb, cb);
    Output o{out, maxOut, ringSizes, maxRings, 0, 0, false};
    if (na < 3 || nb < 3) {
        if (op == 0 || op == 1 || op == 3) emitRing(o, ca, na);
        if (op == 0 || op == 3) emitRing(o, cb, nb);
        release(pb);
        release(cb);
        release(ca);
        return o.overflow ? -1 : o.rings;
    }
    double minX = 1e300, minY = 1e300, maxX = -1e300, maxY = -1e300;
    for (int i = 0; i < na; ++i) {
        minX = mind(minX, ca[i * 2]); maxX = maxd(maxX, ca[i * 2]);
        minY = mind(minY, ca[i * 2 + 1]); maxY = maxd(maxY, ca[i * 2 + 1]);
    }
    for (int i = 0; i < nb; ++i) {
        minX = mind(minX, cb[i * 2]); maxX = maxd(maxX, cb[i * 2]);
        minY = mind(minY, cb[i * 2 + 1]); maxY = maxd(maxY, cb[i * 2 + 1]);
    }
    double scale = maxd(maxd(maxX - minX, maxY - minY), 1e-9);
    const double dirs[12] = {0.7548776662, 0.5698402910, -0.6180339887, 0.7861513778, 0.4142135624, -0.9101797211, -0.8191520443, -0.5735764364, 0.2588190451, 0.9659258263, 0.9238795325, -0.3826834324};
    bool done = false;
    for (int attempt = 0; attempt < 7 && !done; ++attempt) {
        double amount = attempt == 0 ? 0 : scale * 1e-7 * static_cast<double>(attempt * attempt);
        double dx = attempt == 0 ? 0 : dirs[((attempt - 1) % 6) * 2] * amount;
        double dy = attempt == 0 ? 0 : dirs[((attempt - 1) % 6) * 2 + 1] * amount;
        for (int i = 0; i < nb; ++i) {
            pb[i * 2] = cb[i * 2] + dx;
            pb[i * 2 + 1] = cb[i * 2 + 1] + dy;
        }
        Output trial = o;
        if (run(ca, na, pb, nb, op, trial, scale)) {
            o = trial;
            done = true;
        }
    }
    release(pb);
    release(cb);
    release(ca);
    if (!done) return -2;
    return o.overflow ? -1 : o.rings;
}
