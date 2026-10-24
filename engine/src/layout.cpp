#include "grafo.hpp"

using namespace grafo;

namespace {

struct Edge {
    int from;
    int to;
};

struct LNode {
    int layer;
    int order;
    double breadth;
    double depth;
    double pos;
    double bary;
    int real;
};

struct Frame {
    int node;
    int edge;
};

}

GRAFO_API(grafo_layout_layered) int grafo_layout_layered(int nNodes, const double* sizes, int nEdges, const int* edges, int direction, double gapX, double gapY, double* outXY) {
    if (nNodes <= 0) return 0;
    bool lr = direction == 1;
    if (!(gapX == gapX && gapX - gapX == 0) || gapX < 0) gapX = 0;
    if (!(gapY == gapY && gapY - gapY == 0) || gapY < 0) gapY = 0;
    double gapAcross = lr ? gapY : gapX;
    double gapAlong = lr ? gapX : gapY;

    Vec<Edge> es;
    es.data = nullptr;
    es.init(nEdges + 4);
    for (int i = 0; i < nEdges; ++i) {
        int a = edges[i * 2], b = edges[i * 2 + 1];
        if (a < 0 || b < 0 || a >= nNodes || b >= nNodes || a == b) continue;
        es.push(Edge{a, b});
    }

    int* outStart = allocArray<int>(nNodes + 1);
    int* outList = allocArray<int>(es.size);
    fillArray<int>(outStart, nNodes + 1, 0);
    for (int i = 0; i < es.size; ++i) outStart[es[i].from + 1]++;
    for (int i = 0; i < nNodes; ++i) outStart[i + 1] += outStart[i];
    int* fillPos = allocArray<int>(nNodes);
    for (int i = 0; i < nNodes; ++i) fillPos[i] = outStart[i];
    for (int i = 0; i < es.size; ++i) outList[fillPos[es[i].from]++] = i;

    u8* state = allocArray<u8>(nNodes);
    fillArray<u8>(state, nNodes, 0);
    u8* reversed = allocArray<u8>(es.size);
    fillArray<u8>(reversed, es.size, 0);
    Vec<Frame> stack;
    stack.data = nullptr;
    stack.init(64);
    for (int root = 0; root < nNodes; ++root) {
        if (state[root]) continue;
        state[root] = 1;
        stack.size = 0;
        stack.push(Frame{root, outStart[root]});
        while (stack.size > 0) {
            Frame& f = stack[stack.size - 1];
            if (f.edge >= outStart[f.node + 1]) {
                state[f.node] = 2;
                --stack.size;
                continue;
            }
            int ei = outList[f.edge++];
            int to = es[ei].to;
            if (state[to] == 1) {
                reversed[ei] = 1;
            } else if (state[to] == 0) {
                state[to] = 1;
                stack.push(Frame{to, outStart[to]});
            }
        }
    }
    for (int i = 0; i < es.size; ++i) {
        if (!reversed[i]) continue;
        int t = es[i].from;
        es[i].from = es[i].to;
        es[i].to = t;
    }

    int* indeg = allocArray<int>(nNodes);
    fillArray<int>(indeg, nNodes, 0);
    fillArray<int>(outStart, nNodes + 1, 0);
    for (int i = 0; i < es.size; ++i) {
        indeg[es[i].to]++;
        outStart[es[i].from + 1]++;
    }
    for (int i = 0; i < nNodes; ++i) outStart[i + 1] += outStart[i];
    for (int i = 0; i < nNodes; ++i) fillPos[i] = outStart[i];
    for (int i = 0; i < es.size; ++i) outList[fillPos[es[i].from]++] = i;

    int* layer = allocArray<int>(nNodes);
    fillArray<int>(layer, nNodes, 0);
    int* queue = allocArray<int>(nNodes);
    int qh = 0, qt = 0;
    for (int i = 0; i < nNodes; ++i) if (indeg[i] == 0) queue[qt++] = i;
    while (qh < qt) {
        int v = queue[qh++];
        for (int k = outStart[v]; k < outStart[v + 1]; ++k) {
            int to = es[outList[k]].to;
            if (layer[v] + 1 > layer[to]) layer[to] = layer[v] + 1;
            if (--indeg[to] == 0) queue[qt++] = to;
        }
    }

    Vec<LNode> nodes;
    nodes.data = nullptr;
    nodes.init(nNodes * 2 + 4);
    int maxLayer = 0;
    for (int i = 0; i < nNodes; ++i) {
        double w = sizes[i * 2], h = sizes[i * 2 + 1];
        if (!(w == w && w - w == 0) || w < 0) w = 0;
        if (!(h == h && h - h == 0) || h < 0) h = 0;
        LNode n;
        n.layer = layer[i];
        n.order = 0;
        n.breadth = lr ? h : w;
        n.depth = lr ? w : h;
        n.pos = 0;
        n.bary = 0;
        n.real = 1;
        nodes.push(n);
        if (layer[i] > maxLayer) maxLayer = layer[i];
    }
    Vec<Edge> segs;
    segs.data = nullptr;
    segs.init(es.size + 4);
    for (int i = 0; i < es.size; ++i) {
        int a = es[i].from, b = es[i].to;
        int la = nodes[a].layer, lb = nodes[b].layer;
        int prev = a;
        for (int l = la + 1; l < lb; ++l) {
            LNode d;
            d.layer = l;
            d.order = 0;
            d.breadth = 0;
            d.depth = 0;
            d.pos = 0;
            d.bary = 0;
            d.real = 0;
            int di = nodes.size;
            nodes.push(d);
            segs.push(Edge{prev, di});
            prev = di;
        }
        segs.push(Edge{prev, b});
    }

    int total = nodes.size;
    int layers = maxLayer + 1;
    int* layerCount = allocArray<int>(layers + 1);
    fillArray<int>(layerCount, layers + 1, 0);
    for (int i = 0; i < total; ++i) layerCount[nodes[i].layer + 1]++;
    for (int l = 0; l < layers; ++l) layerCount[l + 1] += layerCount[l];
    int* slots = allocArray<int>(total);
    int* cursor = allocArray<int>(layers);
    for (int l = 0; l < layers; ++l) cursor[l] = layerCount[l];
    for (int i = 0; i < total; ++i) {
        int l = nodes[i].layer;
        nodes[i].order = cursor[l] - layerCount[l];
        slots[cursor[l]++] = i;
    }

    int* nbStart = allocArray<int>(total + 1);
    int* nbList = allocArray<int>(segs.size * 2 + 1);
    fillArray<int>(nbStart, total + 1, 0);
    for (int i = 0; i < segs.size; ++i) {
        nbStart[segs[i].from + 1]++;
        nbStart[segs[i].to + 1]++;
    }
    for (int i = 0; i < total; ++i) nbStart[i + 1] += nbStart[i];
    int* nbFill = allocArray<int>(total);
    for (int i = 0; i < total; ++i) nbFill[i] = nbStart[i];
    for (int i = 0; i < segs.size; ++i) {
        nbList[nbFill[segs[i].from]++] = segs[i].to;
        nbList[nbFill[segs[i].to]++] = segs[i].from;
    }

    for (int iter = 0; iter < 12; ++iter) {
        bool down = (iter % 2) == 0;
        for (int step = 1; step < layers; ++step) {
            int l = down ? step : layers - 1 - step;
            int ref = down ? l - 1 : l + 1;
            int begin = layerCount[l], end = layerCount[l + 1];
            for (int s = begin; s < end; ++s) {
                int v = slots[s];
                double sum = 0;
                int cnt = 0;
                for (int k = nbStart[v]; k < nbStart[v + 1]; ++k) {
                    int u = nbList[k];
                    if (nodes[u].layer != ref) continue;
                    sum += nodes[u].order;
                    ++cnt;
                }
                nodes[v].bary = cnt > 0 ? sum / cnt : static_cast<double>(nodes[v].order);
            }
            LNode* base = nodes.data;
            sortArray(slots + begin, end - begin, [base](int a, int b) { return base[a].bary < base[b].bary; });
            for (int s = begin; s < end; ++s) nodes[slots[s]].order = s - begin;
        }
    }

    double* layerDepth = allocArray<double>(layers);
    fillArray<double>(layerDepth, layers, 0);
    for (int i = 0; i < total; ++i) {
        if (nodes[i].depth > layerDepth[nodes[i].layer]) layerDepth[nodes[i].layer] = nodes[i].depth;
    }
    for (int l = 0; l < layers; ++l) {
        double at = 0;
        for (int s = layerCount[l]; s < layerCount[l + 1]; ++s) {
            LNode& n = nodes[slots[s]];
            double b = n.real ? n.breadth : 0;
            n.pos = at + b * 0.5;
            at += b + (n.real ? gapAcross : gapAcross * 0.5);
        }
        double width = at;
        for (int s = layerCount[l]; s < layerCount[l + 1]; ++s) nodes[slots[s]].pos -= width * 0.5;
    }
    double* desired = allocArray<double>(total);
    for (int iter = 0; iter < 8; ++iter) {
        bool down = (iter % 2) == 0;
        for (int step = 0; step < layers; ++step) {
            int l = down ? step : layers - 1 - step;
            int begin = layerCount[l], end = layerCount[l + 1];
            if (end - begin == 0) continue;
            for (int s = begin; s < end; ++s) {
                int v = slots[s];
                double sum = 0;
                int cnt = 0;
                for (int k = nbStart[v]; k < nbStart[v + 1]; ++k) {
                    int u = nbList[k];
                    sum += nodes[u].pos;
                    ++cnt;
                }
                desired[s] = cnt > 0 ? sum / cnt : nodes[v].pos;
            }
            double prevEdge = -1e300;
            for (int s = begin; s < end; ++s) {
                LNode& n = nodes[slots[s]];
                double half = (n.real ? n.breadth : 0) * 0.5;
                double gap = n.real ? gapAcross : gapAcross * 0.5;
                double p = desired[s];
                if (prevEdge > -1e299 && p - half < prevEdge + gap) p = prevEdge + gap + half;
                n.pos = p;
                prevEdge = p + half;
            }
            double shift = 0;
            for (int s = begin; s < end; ++s) shift += nodes[slots[s]].pos - desired[s];
            shift /= static_cast<double>(end - begin);
            for (int s = begin; s < end; ++s) nodes[slots[s]].pos -= shift;
        }
    }

    double along = 0;
    double* layerStart = allocArray<double>(layers);
    for (int l = 0; l < layers; ++l) {
        layerStart[l] = along;
        along += layerDepth[l] + gapAlong;
    }
    double minA = 1e300, minB = 1e300;
    for (int i = 0; i < nNodes; ++i) {
        LNode& n = nodes[i];
        double across = n.pos - n.breadth * 0.5;
        double alongPos = layerStart[n.layer] + (layerDepth[n.layer] - n.depth) * 0.5;
        double x = lr ? alongPos : across;
        double y = lr ? across : alongPos;
        outXY[i * 2] = x;
        outXY[i * 2 + 1] = y;
        if (x < minA) minA = x;
        if (y < minB) minB = y;
    }
    for (int i = 0; i < nNodes; ++i) {
        outXY[i * 2] -= minA;
        outXY[i * 2 + 1] -= minB;
    }

    release(layerStart);
    release(desired);
    release(layerDepth);
    release(nbFill);
    release(nbList);
    release(nbStart);
    release(cursor);
    release(slots);
    release(layerCount);
    segs.destroy();
    nodes.destroy();
    release(queue);
    release(layer);
    release(indeg);
    stack.destroy();
    release(reversed);
    release(state);
    release(fillPos);
    release(outList);
    release(outStart);
    es.destroy();
    return nNodes;
}
