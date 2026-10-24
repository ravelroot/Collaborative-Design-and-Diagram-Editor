#pragma once

typedef __SIZE_TYPE__ usize;
typedef __UINT32_TYPE__ u32;
typedef __INT32_TYPE__ i32;
typedef __UINT8_TYPE__ u8;

#define GRAFO_API(name) extern "C" __attribute__((used, export_name(#name)))

namespace grafo {

void* alloc(usize bytes);
void release(void* ptr);
void copyBytes(void* dst, const void* src, usize n);
void zeroBytes(void* dst, usize n);

inline double sqrtd(double v) { return __builtin_sqrt(v); }
inline double absd(double v) { return __builtin_fabs(v); }
inline double floord(double v) { return __builtin_floor(v); }
inline double mind(double a, double b) { return a < b ? a : b; }
inline double maxd(double a, double b) { return a > b ? a : b; }
inline int mini(int a, int b) { return a < b ? a : b; }
inline int maxi(int a, int b) { return a > b ? a : b; }

template <class T>
struct Vec {
    T* data;
    int size;
    int cap;

    void init(int initial) {
        size = 0;
        cap = initial > 4 ? initial : 4;
        data = static_cast<T*>(alloc(sizeof(T) * static_cast<usize>(cap)));
    }
    void reserve(int wanted) {
        if (wanted <= cap) return;
        int next = cap * 2;
        if (next < wanted) next = wanted;
        T* fresh = static_cast<T*>(alloc(sizeof(T) * static_cast<usize>(next)));
        if (data && size > 0) copyBytes(fresh, data, sizeof(T) * static_cast<usize>(size));
        if (data) release(data);
        data = fresh;
        cap = next;
    }
    void push(const T& value) {
        if (size == cap) reserve(size + 1);
        data[size++] = value;
    }
    T& operator[](int i) { return data[i]; }
    const T& operator[](int i) const { return data[i]; }
    void destroy() {
        if (data) release(data);
        data = nullptr;
        size = 0;
        cap = 0;
    }
};

template <class T>
T* allocArray(int n) {
    return static_cast<T*>(alloc(sizeof(T) * static_cast<usize>(n > 0 ? n : 1)));
}

template <class T>
void fillArray(T* data, int n, T value) {
    for (int i = 0; i < n; ++i) data[i] = value;
}

template <class T, class Less>
void sortArray(T* data, int n, Less less) {
    if (n < 2) return;
    if (n <= 16) {
        for (int i = 1; i < n; ++i) {
            T v = data[i];
            int j = i - 1;
            while (j >= 0 && less(v, data[j])) {
                data[j + 1] = data[j];
                --j;
            }
            data[j + 1] = v;
        }
        return;
    }
    T* tmp = allocArray<T>(n);
    for (int width = 1; width < n; width *= 2) {
        for (int lo = 0; lo < n; lo += 2 * width) {
            int mid = mini(lo + width, n);
            int hi = mini(lo + 2 * width, n);
            int a = lo, b = mid, k = lo;
            while (a < mid && b < hi) tmp[k++] = less(data[b], data[a]) ? data[b++] : data[a++];
            while (a < mid) tmp[k++] = data[a++];
            while (b < hi) tmp[k++] = data[b++];
        }
        for (int i = 0; i < n; ++i) data[i] = tmp[i];
    }
    release(tmp);
}

struct Point {
    double x;
    double y;
};

double cross(double ax, double ay, double bx, double by);
int pointInPolygon(const double* pts, int n, double x, double y);
double distanceToSegment(double px, double py, double ax, double ay, double bx, double by);
void indexForget();

}
