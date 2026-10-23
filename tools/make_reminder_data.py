"""Generate FAKE demo data for the Service Reminder Tracker ("Clearwell Water Co. (demo)").

Every name, email and phone here is made up: emails use example.com (reserved for
examples) and phones use the 555-01xx fictional range. Never put real customer data in demo/.
Run:  python tools/make_reminder_data.py
"""
import csv
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "demo" / "sample-data" / "reminders"
rng = random.Random(7)
AS_OF = date(2026, 10, 19)

FIRST = ["Maria", "James", "Linda", "Robert", "Patricia", "Michael", "Susan", "David", "Karen", "Daniel",
         "Nancy", "Paul", "Lisa", "Mark", "Sandra", "Steven", "Donna", "Kevin", "Carol", "Brian", "Angela",
         "Gary", "Sharon", "Eric", "Teresa", "Jason", "Ruth", "Ryan", "Diane", "Aaron"]
LAST = ["Alvarez", "Brooks", "Chen", "Dawson", "Ellis", "Foster", "Garcia", "Hughes", "Ingram", "Jensen",
        "Keller", "Lopez", "Morgan", "Nguyen", "Owens", "Patel", "Quinn", "Reyes", "Sullivan", "Turner",
        "Vaughn", "Walsh", "Young", "Zimmerman"]
CITIES = ["Maple Grove", "Cedar Falls", "Riverside", "Lakeview", "Fairview", "Oak Ridge"]

# Equipment -> list of (service, every N months, price)
INTERVALS = {
    "Softener": [("Annual service", 12, 149)],
    "Reverse Osmosis": [("Filter change", 12, 129), ("Membrane replacement", 36, 189)],
    "Whole-Home Carbon": [("Media check", 12, 139)],
    "UV System": [("UV bulb replacement", 12, 119)],
    "Iron Filter": [("Annual service", 12, 159)],
    "Sediment Filter": [("Cartridge change", 6, 69)],
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    items = []
    for n in range(160):
        first, last = rng.choice(FIRST), rng.choice(LAST)
        customer = f"{first} {last}"
        email = f"{first.lower()}.{last.lower()}{n}@example.com"
        roll = rng.random()
        if roll < 0.08:
            email = ""                       # no email on file
        elif roll < 0.10:
            email = email.replace("@", "")   # typo, should be flagged
        phone = f"(555) 555-01{rng.randint(0, 99):02d}"
        city = rng.choice(CITIES)
        dnc = "Yes" if rng.random() < 0.04 else ""
        installed = AS_OF - timedelta(days=rng.randint(120, 1400))
        for equipment in rng.sample(list(INTERVALS), rng.choice([1, 1, 2, 2, 3])):
            for service, months, _ in INTERVALS[equipment]:
                # Last done within one interval (+ up to ~3 months overdue), never before install.
                last_done = max(installed, AS_OF - timedelta(days=rng.randint(20, months * 30 + 90)))
                reminded = ""
                if rng.random() < 0.12:
                    reminded = (AS_OF - timedelta(days=rng.randint(2, 40))).isoformat()
                items.append({
                    "Customer": customer, "Email": email, "Phone": phone, "City": city,
                    "Equipment": equipment, "Service": service, "Installed": installed.isoformat(),
                    "Last Done": "" if last_done == installed else last_done.isoformat(),
                    "Every (months)": "", "Do Not Contact": dnc, "Last Reminded": reminded,
                })

    with open(OUT / "service-items.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(items[0].keys()))
        w.writeheader()
        w.writerows(items)
    with open(OUT / "intervals.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Equipment", "Service", "Every (months)", "Price"])
        for equipment, services in INTERVALS.items():
            for service, months, price in services:
                w.writerow([equipment, service, months, f"{price}.00"])
    with open(OUT / "settings.csv", "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([
            ["Setting", "Value"],
            ["Company Name", "Clearwell Water Co. (demo)"],
            ["Company Phone", "(555) 555-0100"],
            ["Company Address", "100 Example Way, Maple Grove, ST 00000"],
            ["Booking Link", "https://example.com/book"],
            ["Reminder Subject", "{first_name}, your {equipment} is due for service"],
            ["Reminder Body", "Hi {first_name},\n\nYour {equipment} is ready for its next service ({service}); "
                              "{due_phrase}. Staying on schedule keeps your water clean and protects the system.\n\n"
                              "Book a time here: {booking_link}\nOr call us at {phone}.\n\nThanks,\n{company}"],
            ["Remind Again After (days)", "21"],
            ["Look Ahead (days)", "30"],
            ["As Of Date", AS_OF.isoformat()],
        ])
    print(f"Wrote {len(items)} service items to {OUT}")


if __name__ == "__main__":
    main()
