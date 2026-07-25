#!/usr/bin/env python3
# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.
"""
Resource Monitor — samples REAL RSS/CPU of the running AgriSense API and ML
processes via /proc, once per second, for the duration of a load test.

This does not estimate or simulate memory usage — it reads the actual
kernel-reported figures for the actual running processes. Output is a CSV
time series plus a summary, used by hw_sim/report.py to build the hardware
simulation report against thoth-parthenon's real spec (see HARDWARE_PROFILE.md).
"""
import os
import re
import sys
import time
import json
import subprocess

SAMPLE_INTERVAL_SEC = 1.0


def find_pid(pattern: str) -> int | None:
    """Find a running process PID by command-line substring match."""
    try:
        out = subprocess.check_output(['ps', 'aux'], text=True)
    except Exception:
        return None
    for line in out.splitlines():
        if pattern in line and 'grep' not in line and 'find_pid' not in line:
            parts = line.split()
            try:
                return int(parts[1])
            except (IndexError, ValueError):
                continue
    return None


def read_proc_status(pid: int) -> dict:
    """Read VmRSS (resident memory) and process state from /proc/<pid>/status."""
    try:
        with open(f'/proc/{pid}/status') as f:
            content = f.read()
    except FileNotFoundError:
        return {}
    rss_match = re.search(r'VmRSS:\s+(\d+)\s+kB', content)
    return {'rss_kb': int(rss_match.group(1)) if rss_match else 0}


def read_proc_cpu_ticks(pid: int) -> int | None:
    """Read total CPU ticks (utime+stime) for a process from /proc/<pid>/stat."""
    try:
        with open(f'/proc/{pid}/stat') as f:
            fields = f.read().split()
    except FileNotFoundError:
        return None
    # utime is field 14 (1-indexed), stime is field 15
    return int(fields[13]) + int(fields[14])


def cpu_pct_between(pid: int, ticks_before: int, ticks_after: int, elapsed_sec: float) -> float:
    hz = os.sysconf('SC_CLK_TCK')
    delta_ticks = ticks_after - ticks_before
    return round((delta_ticks / hz) / elapsed_sec * 100, 1)


def monitor(duration_sec: int, targets: dict, out_csv: str):
    """targets: {'api': pid_or_None, 'ml': pid_or_None}"""
    rows = []
    prev_ticks = {name: (read_proc_cpu_ticks(pid) if pid else None) for name, pid in targets.items()}
    start = time.time()

    while time.time() - start < duration_sec:
        time.sleep(SAMPLE_INTERVAL_SEC)
        t = round(time.time() - start, 1)
        row = {'t': t}
        for name, pid in targets.items():
            if not pid:
                row[f'{name}_rss_mb'] = None
                row[f'{name}_cpu_pct'] = None
                continue
            status = read_proc_status(pid)
            rss_mb = round(status.get('rss_kb', 0) / 1024, 1)
            ticks_now = read_proc_cpu_ticks(pid)
            cpu_pct = None
            if ticks_now is not None and prev_ticks[name] is not None:
                cpu_pct = cpu_pct_between(pid, prev_ticks[name], ticks_now, SAMPLE_INTERVAL_SEC)
            prev_ticks[name] = ticks_now
            row[f'{name}_rss_mb'] = rss_mb
            row[f'{name}_cpu_pct'] = cpu_pct
        rows.append(row)
        print(f"t={t:>5}s  " + "  ".join(
            f"{k}={v}" for k, v in row.items() if k != 't'
        ))

    # Write CSV
    if rows:
        keys = list(rows[0].keys())
        with open(out_csv, 'w') as f:
            f.write(','.join(keys) + '\n')
            for r in rows:
                f.write(','.join(str(r[k]) for k in keys) + '\n')

    # Summary
    summary = {}
    for name in targets:
        rss_vals = [r[f'{name}_rss_mb'] for r in rows if r.get(f'{name}_rss_mb') is not None]
        cpu_vals = [r[f'{name}_cpu_pct'] for r in rows if r.get(f'{name}_cpu_pct') is not None]
        if rss_vals:
            summary[name] = {
                'rss_mb_min': min(rss_vals), 'rss_mb_max': max(rss_vals),
                'rss_mb_avg': round(sum(rss_vals) / len(rss_vals), 1),
                'cpu_pct_avg': round(sum(cpu_vals) / len(cpu_vals), 1) if cpu_vals else None,
                'cpu_pct_max': max(cpu_vals) if cpu_vals else None,
            }
    return summary


if __name__ == '__main__':
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    out_csv = sys.argv[2] if len(sys.argv) > 2 else '/tmp/hw_sim_monitor.csv'

    api_pid = find_pid('loader.mjs src/index.ts')
    ml_pid = find_pid('uvicorn main:app')

    print(f"Monitoring API pid={api_pid}, ML pid={ml_pid} for {duration}s...")
    summary = monitor(duration, {'api': api_pid, 'ml': ml_pid}, out_csv)
    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2))

    with open(out_csv.replace('.csv', '_summary.json'), 'w') as f:
        json.dump(summary, f, indent=2)
