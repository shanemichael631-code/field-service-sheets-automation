"""Generate FAKE demo data for a fictional company ("Clearwell Water Co. (demo)").

Every name, job, and dollar here is made up. Never put real customer data in demo/.
Run:  python tools/make_sample_data.py
"""
import csv
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "demo" / "sample-data"
rng = random.Random(42)

FIRST_WEEK = date(2026, 8, 24)   # Monday
LAST_DONE = date(2026, 10, 18)   # last completed day (Sunday)
TODAY = date(2026, 10, 19)

TECHS = ["Marcus R.", "Dana S.", "Luis P.", "Kelly T."]
LAST_NAMES = ["Alvarez", "Brooks", "Chen", "Dawson", "Ellis", "Foster", "Garcia", "Hughes", "Ingram",
              "Jensen", "Keller", "Lopez", "Morgan", "Nguyen", "Owens", "Patel", "Quinn", "Reyes",
              "Sullivan", "Turner", "Vaughn", "Walsh", "Young", "Zimmerman"]
SYSTEMS = [("Softener", 2400, 3600), ("Whole-Home Carbon", 1900, 3200), ("Reverse Osmosis", 650, 1400),
           ("UV System", 900, 1600), ("Iron Filter", 2600, 4200)]
CAUSES = ["Loose fitting", "O-ring not seated", "Cracked housing", "Bypass valve", "Customer plumbing"]
# (job type, weekly count range, price range)
TYPES = [("Filter Change", (14, 24), (89, 189)), ("Service Call", (5, 10), (125, 275)),
         ("Water Test", (4, 9), (0, 0)), ("Salt Delivery", (3, 7), (35, 60))]


def customer():
    return f"{rng.choice('ABCDEFGHJKLMNPRSTW')}. {rng.choice(LAST_NAMES)}"


def money(lo, hi):
    return f"{rng.randint(lo, hi)}.00" if lo != hi else "0.00"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs, quotes = [], []
    job_id, quote_id = 5001, 801

    def add_job(day, jtype, amount, tech, status, systems="", system_type="", callback="", cause="", orig=""):
        nonlocal job_id
        booked = day - timedelta(days=rng.randint(1, 21))
        jobs.append({
            "Job ID": job_id, "Customer": customer(), "Job Type": jtype, "Tech": tech, "Status": status,
            "Booked Date": booked.isoformat(), "Scheduled Date": day.isoformat(),
            "Completed Date": day.isoformat() if status == "Completed" else "",
            "Amount": amount, "Systems Installed": systems, "System Type": system_type,
            "Callback": callback, "Callback Cause": cause, "Original Tech": orig,
        })
        job_id += 1

    week = FIRST_WEEK
    while week <= LAST_DONE:
        growth = (week - FIRST_WEEK).days // 7  # gentle upward trend
        for jtype, (lo_n, hi_n), (lo_p, hi_p) in TYPES:
            for _ in range(rng.randint(lo_n, hi_n) + growth // 3):
                day = week + timedelta(days=rng.randint(0, 5))
                status = "Cancelled" if rng.random() < 0.04 else "Completed"
                add_job(day, jtype, money(lo_p, hi_p), rng.choice(TECHS), status)
        for _ in range(rng.randint(3, 7)):
            stype, lo_p, hi_p = rng.choice(SYSTEMS)
            n = 2 if rng.random() < 0.15 else 1
            add_job(week + timedelta(days=rng.randint(0, 4)), "Install", money(lo_p * n, hi_p * n),
                    rng.choice(TECHS), "Completed", str(n), stype)
        for _ in range(rng.choice([0, 1, 1, 2, 3])):
            orig = rng.choice(TECHS)
            add_job(week + timedelta(days=rng.randint(0, 5)), "Callback", "0.00", rng.choice(TECHS),
                    "Completed", callback="Yes", cause=rng.choice(CAUSES), orig=orig)
        for _ in range(rng.randint(8, 14)):
            sent = week + timedelta(days=rng.randint(0, 5))
            amount = money(1500, 6000)
            age = (TODAY - sent).days
            roll = rng.random()
            decided_share = 0.92 if age > 21 else 0.70  # older quotes have mostly been decided
            if age > 3 and roll < decided_share * 0.45:
                status, decided = "Approved", sent + timedelta(days=rng.randint(1, min(age, 12)))
            elif age > 3 and roll < decided_share:
                status, decided = "Declined", sent + timedelta(days=rng.randint(1, min(age, 12)))
            else:
                status, decided = "Open", None
            quotes.append({"Quote ID": f"Q-{quote_id}", "Customer": customer(), "Sent Date": sent.isoformat(),
                           "Amount": amount, "Status": status,
                           "Decided Date": decided.isoformat() if decided else ""})
            quote_id += 1
        week += timedelta(days=7)

    # Upcoming filter changes already on the schedule (next ~5 weeks).
    for _ in range(70):
        day = TODAY + timedelta(days=rng.randint(1, 35))
        jobs.append({
            "Job ID": job_id, "Customer": customer(), "Job Type": "Filter Change", "Tech": rng.choice(TECHS),
            "Status": "Scheduled", "Booked Date": (TODAY - timedelta(days=rng.randint(0, 20))).isoformat(),
            "Scheduled Date": day.isoformat(), "Completed Date": "", "Amount": money(89, 189),
            "Systems Installed": "", "System Type": "", "Callback": "", "Callback Cause": "", "Original Tech": "",
        })
        job_id += 1

    for name, rows in (("jobs.csv", jobs), ("quotes.csv", quotes)):
        with open(OUT / name, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
    with open(OUT / "settings.csv", "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([["Setting", "Value"], ["Company Name", "Clearwell Water Co. (demo)"],
                                 ["Report Recipients", "owner@example.com"],
                                 ["Filter Change Job Type", "Filter Change"],
                                 ["Report Week", "2026-10-12"]])
    print(f"Wrote {len(jobs)} jobs and {len(quotes)} quotes to {OUT}")


if __name__ == "__main__":
    main()
