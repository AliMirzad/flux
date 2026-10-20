# Measured fixture benchmark

Measured 2026-10-19T11:50:02.505Z on Windows using Chrome 155.0.8059.82. 8 MiB deterministic file; 3 repeats per mode; HTTP/1.1 fixture emits 16 KiB with 16ms pacing per response. Fixture runs on loopback mapped to a public-looking test hostname. No user product networking bypass ships.

| Mode     | Median MiB/s | Failures | Median Chrome CPU seconds* | Peak manager JS heap MiB** |
| -------- | -----------: | -------: | -------------------------: | -------------------------: |
| native   |         0.57 |      0/3 |                       1.31 |                 unmeasured |
| 1        |         0.59 |      0/3 |                       4.25 |                        7.9 |
| 4        |         2.15 |      0/3 |                       1.63 |                        8.3 |
| 8        |         2.22 |      0/3 |                       1.58 |                        8.4 |
| 16       |         2.21 |      0/3 |                       1.74 |                       13.1 |
| adaptive |         0.77 |      0/3 |                       3.43 |                        9.5 |

Timing includes probe, UI admission, OPFS persistence and final checksum for Flux; native timing includes completion and independent disk SHA-256. It excludes Flux final user-file export, which requires another streamed copy. These are local fixture results, not Internet performance or IDM comparisons. Native Chrome may use different request/transport behavior. HTTP/1.1 connection pools limit useful concurrency; configured fetch counts are not guaranteed transport socket counts.

- CDP SystemInfo cumulative CPU delta across Chrome processes; processes created or exited during sampling can affect this estimate. Fixture Node CPU excluded.

** CDP Performance JSHeapUsedSize for the manager renderer, sampled every 100ms; excludes dedicated-worker heaps, browser native buffers, OPFS caches, GPU and total process RSS. Native heap not sampled. Total peak memory and idle CPU remain unverified. No IDM installation was used. Raw repetitions: [benchmark-data.json](benchmark-data.json).

Native OS Save As picker, macOS, real network variation, browser/OS crash durability, 5/10 GiB and real-world authenticated URLs are outside this benchmark.
