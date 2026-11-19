"""Extra pulls: chapter 99 and the listed exempt products (HS4/HS6) used to net out Section 301 exemptions."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import fetch_comtrade, IMPOSERS, YEARS
from current_tariffs import FL_EXEMPT_HS
for iso, code in IMPOSERS.items():
    for y in YEARS:
        for cmd in ["99"] + list(FL_EXEMPT_HS):
            rows = fetch_comtrade(code, y, cmd)
            print(iso, y, cmd, len(rows))
