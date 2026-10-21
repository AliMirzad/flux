# Measured fixture benchmark

Measured 2026-10-21T05:58:26.101Z on Windows using Chrome 155.0.8059.85. 16 MiB deterministic file; 2 repeats per mode; HTTP/1.1 fixture emits 16 KiB with 32ms pacing per response. Fixture runs on loopback mapped to a public-looking test hostname. No user product networking bypass ships.

| Mode     | Median MiB/s | Failures | Median Chrome CPU seconds* | Peak manager JS heap MiB** |
| -------- | -----------: | -------: | -------------------------: | -------------------------: |
| native   |         0.40 |      0/2 |                       3.73 |                 unmeasured |
| 1        |         0.41 |      0/2 |                      12.07 |                        9.8 |
| 4        |         1.53 |      0/2 |                       3.66 |                       10.0 |
| 8        |         2.05 |      0/2 |                       3.35 |                       11.9 |
| 16       |         2.10 |      0/2 |                       3.18 |                       13.0 |
| adaptive |         2.03 |      0/2 |                       3.08 |                       11.7 |

Timing includes probe, UI admission, OPFS persistence and final checksum for Flux; native timing includes completion and independent disk SHA-256. It excludes Flux final user-file export, which requires another streamed copy. These are local fixture results, not Internet performance or IDM comparisons. Native Chrome may use different request/transport behavior. HTTP/1.1 connection pools limit useful concurrency; configured fetch counts are not guaranteed transport socket counts.

- CDP SystemInfo cumulative CPU delta across Chrome processes; processes created or exited during sampling can affect this estimate. Fixture Node CPU excluded.

** CDP Performance JSHeapUsedSize for the manager renderer, sampled every 100ms; excludes dedicated-worker heaps, browser native buffers, OPFS caches, GPU and total process RSS. Native heap not sampled. Total peak memory and idle CPU remain unverified. No IDM installation was used. Raw repetitions: [benchmark-data.json](benchmark-data.json).

Native OS Save As picker, macOS, real network variation, browser/OS crash durability, 5/10 GiB and real-world authenticated URLs are outside this benchmark.
