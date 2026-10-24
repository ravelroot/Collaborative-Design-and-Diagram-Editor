#include "grafo.hpp"

namespace grafo {

double cross(double ax, double ay, double bx, double by) { return ax * by - ay * bx; }

int pointInPolygon(const double* pts, int n, double x, double y) {
    if (n < 3) return 0;
    int inside = 0;
    for (int i = 0, j = n - 1; i < n; j = i++) {
        double xi = pts[i * 2], yi = pts[i * 2 + 1];
        double xj = pts[j * 2], yj = pts[j * 2 + 1];
        if ((yi > y) != (yj > y)) {
            double t = (y - yi) / (yj - yi);
            if (x < xi + t * (xj - xi)) inside = !inside;
        }
    }
    return inside;
}

double distanceToSegment(double px, double py, double ax, double ay, double bx, double by) {
    double dx = bx - ax, dy = by - ay;
    double len2 = dx * dx + dy * dy;
    double t = 0;
    if (len2 > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / len2;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
    }
    double cx = ax + t * dx - px, cy = ay + t * dy - py;
    return sqrtd(cx * cx + cy * cy);
}

}

using namespace grafo;

namespace {

struct Range {
    int a;
    int b;
};

struct Curve {
    double x0, y0, x1, y1, x2, y2, x3, y3;
    int depth;
};

}

GRAFO_API(grafo_point_in_polygon) int grafo_point_in_polygon(const double* pts, int n, double x, double y) {
    return pointInPolygon(pts, n, x, y);
}

GRAFO_API(grafo_distance_to_polyline) double grafo_distance_to_polyline(const double* pts, int n, double x, double y) {
    if (n <= 0) return 1e300;
    if (n == 1) {
        double dx = pts[0] - x, dy = pts[1] - y;
        return sqrtd(dx * dx + dy * dy);
    }
    double best = 1e300;
    for (int i = 0; i + 1 < n; ++i) {
        double d = distanceToSegment(x, y, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]);
        if (d < best) best = d;
    }
    return best;
}

GRAFO_API(grafo_simplify) int grafo_simplify(const double* pts, int n, double eps, double* out) {
    if (n <= 2) {
        for (int i = 0; i < n * 2; ++i) out[i] = pts[i];
        return n;
    }
    u8* keep = allocArray<u8>(n);
    fillArray<u8>(keep, n, 0);
    keep[0] = 1;
    keep[n - 1] = 1;
    Vec<Range> stack;
    stack.data = nullptr;
    stack.init(32);
    stack.push(Range{0, n - 1});
    while (stack.size > 0) {
        Range r = stack[--stack.size];
        double best = -1;
        int index = -1;
        for (int i = r.a + 1; i < r.b; ++i) {
            double d = distanceToSegment(pts[i * 2], pts[i * 2 + 1], pts[r.a * 2], pts[r.a * 2 + 1], pts[r.b * 2], pts[r.b * 2 + 1]);
            if (d > best) {
                best = d;
                index = i;
            }
        }
        if (index >= 0 && best > eps) {
            keep[index] = 1;
            stack.push(Range{r.a, index});
            stack.push(Range{index, r.b});
        }
    }
    int count = 0;
    for (int i = 0; i < n; ++i) {
        if (!keep[i]) continue;
        out[count * 2] = pts[i * 2];
        out[count * 2 + 1] = pts[i * 2 + 1];
        ++count;
    }
    stack.destroy();
    release(keep);
    return count;
}

GRAFO_API(grafo_smooth) int grafo_smooth(const double* pts, int n, double* out, int maxOut) {
    if (n <= 0 || maxOut <= 0) return 0;
    int count = mini(n, maxOut);
    for (int i = 0; i < count; ++i) {
        double x = pts[i * 2], y = pts[i * 2 + 1];
        double* o = out + i * 6;
        o[0] = x;
        o[1] = y;
        if (i == 0) {
            o[2] = x;
            o[3] = y;
            o[4] = x;
            o[5] = y;
            continue;
        }
        int a = i - 2 < 0 ? 0 : i - 2;
        int b = i - 1;
        int c = i;
        int d = i + 1 >= n ? n - 1 : i + 1;
        double bx = pts[b * 2], by = pts[b * 2 + 1];
        o[2] = bx + (pts[c * 2] - pts[a * 2]) / 6.0;
        o[3] = by + (pts[c * 2 + 1] - pts[a * 2 + 1]) / 6.0;
        o[4] = x - (pts[d * 2] - bx) / 6.0;
        o[5] = y - (pts[d * 2 + 1] - by) / 6.0;
    }
    return count;
}

GRAFO_API(grafo_flatten) int grafo_flatten(const double* pts, int n, int closed, double tol, double* out, int maxOut) {
    if (n <= 0 || maxOut <= 0) return 0;
    if (tol <= 0) tol = 0.25;
    int count = 0;
    out[0] = pts[0];
    out[1] = pts[1];
    count = 1;
    int segments = closed ? n : n - 1;
    Vec<Curve> stack;
    stack.data = nullptr;
    stack.init(64);
    for (int s = 0; s < segments; ++s) {
        const double* p = pts + s * 6;
        const double* q = pts + ((s + 1) % n) * 6;
        Curve root{p[0], p[1], p[4], p[5], q[2], q[3], q[0], q[1], 0};
        stack.size = 0;
        stack.push(root);
        while (stack.size > 0) {
            Curve c = stack[--stack.size];
            double d1 = distanceToSegment(c.x1, c.y1, c.x0, c.y0, c.x3, c.y3);
            double d2 = distanceToSegment(c.x2, c.y2, c.x0, c.y0, c.x3, c.y3);
            double flat = maxd(d1, d2);
            if (flat <= tol || c.depth >= 18) {
                if (s == segments - 1 && closed && stack.size == 0) break;
                if (count >= maxOut) {
                    stack.destroy();
                    return count;
                }
                out[count * 2] = c.x3;
                out[count * 2 + 1] = c.y3;
                ++count;
                continue;
            }
            double ax = (c.x0 + c.x1) * 0.5, ay = (c.y0 + c.y1) * 0.5;
            double bx = (c.x1 + c.x2) * 0.5, by = (c.y1 + c.y2) * 0.5;
            double cx = (c.x2 + c.x3) * 0.5, cy = (c.y2 + c.y3) * 0.5;
            double dx = (ax + bx) * 0.5, dy = (ay + by) * 0.5;
            double ex = (bx + cx) * 0.5, ey = (by + cy) * 0.5;
            double mx = (dx + ex) * 0.5, my = (dy + ey) * 0.5;
            stack.push(Curve{mx, my, ex, ey, cx, cy, c.x3, c.y3, c.depth + 1});
            stack.push(Curve{c.x0, c.y0, ax, ay, dx, dy, mx, my, c.depth + 1});
        }
    }
    stack.destroy();
    return count;
}
