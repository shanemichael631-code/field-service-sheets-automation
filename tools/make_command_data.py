"""Generate FAKE demo data for the Command Center (three made-up businesses).
Run:  python tools/make_command_data.py
"""
import csv
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "demo" / "sample-data" / "commands"
TODAY = date(2026, 10, 23)   # Friday

PROJECTS = [
    ("Service Ops", "Clearwell Water (demo)", "ops, dispatch", ""),
    ("Hiring", "Clearwell Water (demo)", "recruiting, new tech", ""),
    ("Truck Fleet", "Clearwell Water (demo)", "trucks, van, vans", ""),
    ("Pool Route Expansion", "Bluewave Pool (demo)", "route, expansion", ""),
    ("Supplier Pricing", "Bluewave Pool (demo)", "suppliers, pricing", ""),
    ("Website Refresh", "Bluewave Pool (demo)", "website", ""),
    ("Upwork", "Freelance (demo)", "freelance, proposals", ""),
    ("Taxes & Books", "Personal (demo)", "taxes, books, cpa", ""),
]

# (days from today or None, title, project, priority, status, waiting on, source, link, original, reasons)
TASKS = [
    (-4, "Renew commercial auto insurance for the vans", "Truck Fleet", "P1", "Next", "", "Gmail", "https://mail.google.com/mail/#inbox/demo1", "Email from Agent <agent@example.com>: Renewal notice: commercial auto", ""),
    (-2, "Send Q3 sales numbers to the CPA", "Taxes & Books", "P2", "Next", "", "Phone", "", "Taxes. Send Q3 sales numbers to the CPA by Wednesday", ""),
    (-1, "Call back the Henderson pool remodel lead", "Pool Route Expansion", "P1", "Inbox", "", "Phone", "", "Route expansion - call back the Henderson pool remodel lead yesterday urgent", ""),
    (0, "Post the service tech job ad", "Hiring", "P1", "Next", "", "Phone", "", "Hiring. Post the service tech job ad by Friday, urgent", ""),
    (0, "Approve this week's payroll", "Service Ops", "P1", "Next", "", "Manual", "", "Ops: approve this week's payroll today asap", ""),
    (0, "Reply to 2 Upwork client messages", "Upwork", "P2", "Inbox", "", "Phone", "", "Upwork - reply to 2 client messages today", ""),
    (1, "Order filter cartridges for Monday's route", "Service Ops", "P2", "Next", "", "Phone", "", "Dispatch. Order filter cartridges for Monday's route tomorrow", ""),
    (3, "Interview two plumber applicants", "Hiring", "P2", "Next", "", "Phone", "", "Hiring. Interview two plumber applicants on Monday", ""),
    (3, "Get three quotes on new tires for van 2", "Truck Fleet", "P2", "Inbox", "", "Manual", "", "Need to get three quotes on new tires for van 2 by Monday", ""),
    (4, "Compare chlorine prices from both suppliers", "Supplier Pricing", "P2", "Inbox", "", "Gmail", "https://mail.google.com/mail/#inbox/demo2", "Email from Supplier <sales@example.com>: Updated price list", ""),
    (5, "Finish the new homepage copy", "Website Refresh", "P3", "Next", "", "Phone", "", "Website - finish the new homepage copy by Wednesday no rush", ""),
    (6, "Send the Quote Builder proposal", "Upwork", "P2", "Next", "", "Phone", "", "Proposals. Send the Quote Builder proposal Thursday", ""),
    (7, "Schedule annual service on the shop water system", "Service Ops", "P3", "Inbox", "", "Phone", "", "Ops. Schedule annual service on the shop water system next Friday someday", ""),
    (12, "File quarterly sales tax return", "Taxes & Books", "P1", "Next", "", "Manual", "", "Books - file quarterly sales tax return by 11/4 urgent", ""),
    (20, "Plan the spring pool opening schedule", "Pool Route Expansion", "P3", "Inbox", "", "Phone", "", "Route. Plan the spring pool opening schedule in 3 weeks", ""),
    (None, "Signed contract from the Lakeview HOA", "Pool Route Expansion", "P2", "Waiting", "Jordan Ellis", "Gmail", "https://mail.google.com/mail/#inbox/demo3", "Email from Jordan Ellis <jordan@example.com>: Re: HOA pool contract", ""),
    (None, "Title paperwork for the used van", "Truck Fleet", "P2", "Waiting", "Mike Torres", "Phone", "", "Trucks - waiting on Mike Torres for the title paperwork for the used van", ""),
    (None, "Updated price sheet from the salt supplier", "Supplier Pricing", "P3", "Waiting", "Dana Price", "Phone", "", "Suppliers. Waiting on Dana Price for the updated salt price sheet", ""),
    (None, "Clean up the shared drive folders", "Service Ops", "P3", "Inbox", "", "Phone", "", "Ops - clean up the shared drive folders whenever", ""),
    (None, "Look into a second line for the office phone", "Service Ops", "P2", "Inbox", "", "Manual", "", "Look into a second line for the office phone, ops", ""),
    (None, "Call him", "", "P2", "Needs Review", "", "Phone", "", "call him", "No project recognized. Not enough detail to know what the task is."),
    (None, "Interview the two pool tech applicants", "Hiring", "P2", "Needs Review", "", "Phone", "", "Hiring. Interview the two pool tech applicants next week", "\"next week\" isn't a specific day."),
    (None, "Budget review for the website and trucks", "", "P2", "Needs Review", "", "Phone", "", "Website and trucks budget review", "Mentions more than one project (Website Refresh, Truck Fleet)."),
    (-10, "Return the rented trencher", "Service Ops", "P2", "Done", "", "Manual", "", "Ops. Return the rented trencher", ""),
    (-6, "Pay the October supplier invoice", "Supplier Pricing", "P1", "Done", "", "Gmail", "", "Email: Invoice due", ""),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    business = {p[0]: p[1] for p in PROJECTS}
    with open(OUT / "projects.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Project", "Business", "Aliases", "Active"])
        w.writerows(PROJECTS)
    with open(OUT / "tasks.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ID", "Created", "Source", "Original Text", "Title", "Project", "Business", "Due", "Priority", "Status",
                    "Waiting On", "Link", "Review Reasons"])
        for i, (days, title, project, pri, status, waiting, source, link, original, reasons) in enumerate(TASKS, start=1):
            created = TODAY - timedelta(days=(i * 3) % 11 + 1)
            due = (TODAY + timedelta(days=days)).isoformat() if days is not None else ""
            w.writerow([f"T-{i:04d}", created.isoformat(), source, original, title, project, business.get(project, ""), due,
                        pri, status, waiting, link, reasons])
    with open(OUT / "settings.csv", "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([
            ["Setting", "Value"],
            ["Title", "Command Center (demo)"],
            ["Digest Email", ""],
            ["Flag Label", "To Task"],
            ["Done Label", "Tasked"],
            ["As Of Date", TODAY.isoformat()],
        ])
    print(f"Wrote {len(PROJECTS)} projects and {len(TASKS)} tasks to {OUT}")


if __name__ == "__main__":
    main()
