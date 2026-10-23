"""Generate FAKE demo data for the Quote Builder ("Bluewave Pool & Spa Service (demo)").

Products are generic pool-supply items with made-up SKUs, brands and part numbers. A few
mistakes are planted on purpose so the Catalog Health check has something to find.
Run:  python tools/make_quote_data.py
"""
import csv
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "demo" / "sample-data" / "quotes"

# (sku, name, category, manufacturer, part #, unit, cost, price override, taxable)
CATALOG = [
    # Chemicals
    ("CHM-001", "Liquid Chlorine 12.5%", "Chemicals", "AquaChem", "AC-LC125", "gal", "3.10", "", ""),
    ("CHM-002", "Chlorine Tablets 3in", "Chemicals", "AquaChem", "AC-TAB25", "25 lb bucket", "68.00", "", ""),
    ("CHM-003", "Cal-Hypo Shock", "Chemicals", "AquaChem", "AC-SH1", "1 lb bag", "2.40", "", ""),
    ("CHM-004", "Muriatic Acid 31.45%", "Chemicals", "ClearLine", "CL-MA1", "gal", "4.25", "", ""),
    ("CHM-005", "Alkalinity Increaser", "Chemicals", "ClearLine", "CL-ALK25", "25 lb bag", "21.50", "", ""),
    ("CHM-006", "Cyanuric Acid Stabilizer", "Chemicals", "ClearLine", "CL-CYA4", "4 lb", "14.75", "", ""),
    ("CHM-007", "Pool Salt", "Chemicals", "SeaPure", "SP-40", "40 lb bag", "6.20", "", ""),
    ("CHM-008", "Phosphate Remover", "Chemicals", "ClearLine", "CL-PR1Q", "qt", "18.90", "", ""),
    ("CHM-009", "Algaecide 60%", "Chemicals", "AquaChem", "AC-ALG60", "qt", "11.30", "", ""),
    ("CHM-010", "Calcium Hardness Increaser", "Chemicals", "ClearLine", "CL-CAL25", "25 lb bag", "19.80", "", ""),
    ("CHM-011", "Muriatic Acid (2-pack)", "Chemicals", "ClearLine", "CL-MA2", "2 gal", "8.40", "9.25", ""),   # below min margin
    # Parts
    ("PRT-101", "Pump Lid O-Ring", "Parts", "FlowTek", "FT-OR320", "each", "6.10", "", ""),
    ("PRT-102", "Pump Impeller 1.5 HP", "Parts", "FlowTek", "FT-IMP15", "each", "48.00", "", ""),
    ("PRT-103", "Shaft Seal Kit", "Parts", "FlowTek", "FT-SSK", "kit", "17.50", "", ""),
    ("PRT-104", "Filter Pressure Gauge", "Parts", "GaugeCo", "GC-60", "each", "9.40", "", ""),
    ("PRT-105", "Skimmer Basket", "Parts", "FlowTek", "FT-SB1", "each", "12.80", "", ""),
    ("PRT-106", "Filter Cartridge 100 sq ft", "Parts", "PureFlo", "PF-C100", "each", "54.00", "", ""),
    ("PRT-107", "Filter Cartridge 150 sq ft", "Parts", "PureFlo", "PF-C150", "each", "71.00", "", ""),
    ("PRT-108", "2in PVC Union", "Parts", "PipeRight", "PR-U2", "each", "11.25", "", ""),
    ("PRT-109", "3-Way Diverter Valve 2in", "Parts", "PipeRight", "PR-V3W2", "each", "62.00", "", ""),
    ("PRT-110", "Salt Cell Replacement", "Parts", "SeaPure", "SP-CELL15", "each", "385.00", "", ""),
    ("PRT-111", "Pump Motor 1.5 HP", "Parts", "FlowTek", "FT-MTR15", "each", "295.00", "", ""),
    ("PRT-112", "Pump lid o ring (old listing)", "Parts", "FlowTek", "ft-or320", "each", "6.10", "", ""),  # duplicate part #
    ("PRT-113", "Heater Igniter", "Parts", "WarmWave", "", "each", "88.00", "", ""),               # missing part #
    ("PRT-114", "Return Jet Fitting", "Parts", "PipeRight", "PR-RJ1", "each", "", "", ""),         # missing cost
    # Equipment
    ("EQP-201", "Variable-Speed Pump 1.65 HP", "Equipment", "FlowTek", "FT-VS165", "each", "1080.00", "", ""),
    ("EQP-202", "Cartridge Filter 150 sq ft", "Equipment", "PureFlo", "PF-CF150", "each", "640.00", "", ""),
    ("EQP-203", "Salt Chlorine Generator", "Equipment", "SeaPure", "SP-SCG40", "each", "910.00", "", ""),
    ("EQP-204", "Gas Pool Heater 400K BTU", "Equipment", "WarmWave", "WW-H400", "each", "2350.00", "", ""),
    ("EQP-205", "Automation Controller", "Equipment", "FlowTek", "FT-AUTO1", "each", "1290.00", "", ""),
    ("EQP-206", "UV Sanitizer", "Equipment", "PureFlo", "", "each", "720.00", "", ""),           # missing part #
    # Services (flat prices)
    ("SVC-301", "Weekly Service Visit", "Services", "", "", "visit", "", "45.00", "No"),
    ("SVC-302", "Filter Cartridge Clean", "Services", "", "", "each", "", "95.00", "No"),
    ("SVC-303", "Green-to-Clean Recovery", "Services", "", "", "job", "", "425.00", "No"),
    ("SVC-304", "Equipment Install (per hour)", "Services", "", "", "hr", "", "95.00", "No"),
    ("SVC-305", "Opening / Startup", "Services", "", "", "job", "", "185.00", "No"),
    # Uncategorised leftover from an old import
    ("MSC-901", "Leak Detection Dye Kit", "", "ClearLine", "CL-DYE", "kit", "14.00", "", ""),
]

RULES = [
    ("Chemicals", "markup", "45", "25"),
    ("Parts", "margin", "40", "30"),
    ("Equipment", "markup", "30", "18"),
    ("Services", "markup", "0", ""),
]

SETTINGS = [
    ("Company Name", "Bluewave Pool & Spa Service (demo)"),
    ("Company Address", "200 Example Ave, Lakeview, ST 00000"),
    ("Company Phone", "(555) 555-0142"),
    ("Company Email", "office@example.com"),
    ("Brand Color", "#0b6e99"),
    ("Labor Rate", "95.00"),
    ("Tax Rate %", "7"),
    ("Tax Labor", "No"),
    ("Quote Valid Days", "30"),
    ("Quote Prefix", "Q"),
    ("Quotes Folder", "Quotes"),
    ("Terms", "Prices include standard materials listed. Quote valid for 30 days. 50% deposit on equipment orders; "
              "balance due on completion. Any additional work will be quoted separately before it starts."),
]


def write(name, header, rows):
    with open(OUT / name, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write("catalog.csv", ["SKU", "Name", "Category", "Manufacturer", "Part #", "Unit", "Cost", "Price Override", "Taxable", "Active"],
          [r + ("",) for r in CATALOG])
    write("pricing-rules.csv", ["Category", "Method", "Value %", "Min Margin %"], RULES)
    write("settings.csv", ["Setting", "Value"], SETTINGS)
    write("quotes-log.csv", ["Quote #", "Date", "Customer", "Total", "Margin %", "PDF", "Status", "Data"], [])
    print(f"Wrote {len(CATALOG)} catalog items to {OUT}")


if __name__ == "__main__":
    main()
