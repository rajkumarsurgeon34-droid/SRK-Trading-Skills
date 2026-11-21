import csv
import datetime
import random


def make_ohlcv(path, n=300, start=1000.0, drift=0.0008, vol=0.012, seed=1, vbase=1e6):
    random.seed(seed)
    p = start
    d = datetime.date(2025, 8, 1)
    rows = []
    while len(rows) < n:
        d += datetime.timedelta(days=1)
        if d.weekday() > 4:
            continue
        o = p
        p = p * (1 + random.gauss(drift, vol))
        h = max(o, p) * (1 + abs(random.gauss(0, vol / 2)))
        lo = min(o, p) * (1 - abs(random.gauss(0, vol / 2)))
        rows.append([d.isoformat(), round(o, 2), round(h, 2), round(lo, 2), round(p, 2), int(vbase * random.uniform(0.5, 1.5))])
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Date", "Open", "High", "Low", "Close", "Volume"])
        w.writerows(rows)
    return path
