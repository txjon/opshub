#!/usr/bin/env python3
"""FOG god-mode aggregator.

Merges every order-export CSV in the exports/ folder (or the files/dirs
passed as arguments) and emits fog-data.json, the compact aggregate file
the dashboard embeds. Drop each new export into exports/ and re-run:

    python3 aggregate.py            # uses ./exports/*.csv
    python3 aggregate.py a.csv b.csv [out.json]

Exports may overlap freely: when the same OrderNumber appears in more
than one file, only the NEWEST file's rows for that order are kept (so
later exports can add split shipments or corrections to old orders).
File age = modification time.
"""
import sys, re, json, pathlib
import pandas as pd

args = sys.argv[1:]
OUT = "fog-data.json"
if args and args[-1].endswith(".json"):
    OUT = args.pop()
paths = []
for a in (args or [str(pathlib.Path(__file__).parent / "exports")]):
    p = pathlib.Path(a)
    paths += sorted(p.glob("*.csv"), key=lambda f: f.stat().st_mtime) if p.is_dir() else [p]
if not paths:
    sys.exit("no export CSVs found (put them in exports/ or pass paths)")

# Drop detection: days at/above this many orders seed a drop window;
# seed days closer than GAP days apart merge into one window.
DROP_DAY_MIN_ORDERS = 150
GAP_DAYS = 3

# Pre-order/in-stock classification comes from the item titles at order time
# (FOG practice: pre-order items say PRE-ORDER at launch). When a launch
# skipped the marker, pin its kind here by window start date - the measured
# preorderShare still reports what the titles said.
# 2026-02-13: Jon 2026-08-15 - hybrid drop (pre-order apparel + capped-qty
# in-stock items), titles carried no marker; counts as pre-order.
DROP_KIND_OVERRIDES = {
    "2026-02-13": "pre",
}

SIZE = re.compile(
    r'^(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|OSFA|O/S|One Size|Small|Medium|Large|'
    r'\d{2}(\s*/\s*\d{2})?.*|Relaxed.*|Regular( \(.*\))?|Slim.*)$', re.I)

PREORDER = re.compile(r'pre[- ]?order', re.I)

TYPES = [
    ("Tee",      r'\btees?\b|t-shirt|\btshirt\b|tank top'),
    ("Hoodie",   r'hoodie|hooded'),
    ("Crewneck", r'crew ?neck|sweatshirt|\bcrew\b'),
    ("Longsleeve", r'long ?sleeve|\bl/s\b'),
    ("Hat",      r'\bhats?\b|\bcaps?\b|snapback|trucker'),
    ("Beanie",   r'beanie|balaclava|watch cap|boonie'),
    ("Shorts",   r'\bshorts?\b|trunks|ranger panties'),
    ("Pants",    r'\bpants?\b|chino|denim|jeans'),
    ("Outerwear", r'jacket|parka|anorak|\bvest\b|wind ?breaker|fleece|pullover|coat\b'),
    ("Shirt",    r'flannel|button|polo|work shirt'),
    ("Socks",    r'\bsocks?\b'),
    ("Sticker",  r'sticker|decal'),
    ("Patch",    r'\bpatch'),
    ("Flag",     r'\bflag\b|banner'),
    ("Pin",      r'enamel pin|\bpin\b|keychain|lanyard'),
    ("Book/Media", r'coffee table book|vol\.?\s*\d|magazine|\bbook\b|poster|stencil|print\b|dvd|zine'),
    ("Gear",     r'nalgene|pouch|belt\b|backpack|bag\b|lighter|glove|dick beaters|knife|tool|'
                 r'bottle|mug|cup\b|towel|blanket|koozie|torch|seaf|multitool|carabiner|tumbler|flask'),
]
TYPES_C = [(t, re.compile(p, re.I)) for t, p in TYPES]

def norm_name(name):
    n = re.sub(r'\*+[^*]*\*+', ' ', str(name))
    n = re.sub(r'\bpre[- ]?orders?\b', ' ', n, flags=re.I)
    n = re.sub(r'\(\s*\)', ' ', n)
    n = re.sub(r'(\s*-\s*){2,}', ' - ', n)
    parts = [p.strip(' -') for p in re.split(r'\s+-\s+|\s*/\s*', n) if p.strip(' -')]
    while len(parts) > 1 and SIZE.match(parts[-1]):
        parts.pop()
    out = ' '.join(parts).strip(' -')
    return re.sub(r'\s+', ' ', out)

def ptype(n):
    for t, pat in TYPES_C:
        if pat.search(n):
            return t
    return "Other"

frames = []
for i, p in enumerate(paths):
    print("reading", p)
    d = pd.read_csv(p, encoding="utf-8-sig", low_memory=False)
    d["__src"] = i
    frames.append(d)
df = pd.concat(frames, ignore_index=True)
newest = df.groupby("OrderNumber")["__src"].transform("max")
dropped = int((df["__src"] != newest).sum())
df = df[df["__src"] == newest]
if dropped:
    print(f"merged {len(paths)} files; {dropped} superseded rows replaced by newer exports")
df["dt"] = pd.to_datetime(df["OrderDate"], format="%m/%d/%y %H:%M", errors="coerce")
df = df[df["dt"].notna()]
df = df[df["OrderStatus"] != "Cancelled"].copy()

for c in ["OrderTotal", "OrderShippingAmount", "OrderItemQuantity",
          "OrderItemUnitPrice", "OrderItemExtendedPrice", "TaxAmount"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")

df["name"] = df["OrderItemDescription"].fillna("(unknown)").map(norm_name)
uniq = df["name"].unique()
tmap = {n: ptype(n) for n in uniq}
df["type"] = df["name"].map(tmap)
df["preorder"] = df["OrderItemDescription"].fillna("").str.contains(PREORDER)
df["qty"] = df["OrderItemQuantity"].fillna(0)
df["ext"] = df["OrderItemExtendedPrice"].fillna(0.0)

# Split-shipment handling: the export emits one row per item per shipment, and
# secondary shipments of the same order carry OrderTotal/shipping/tax of 0 and
# the reshipment date. Order-level truth is therefore the MAX of the money
# fields and the EARLIEST timestamp; item rows are stamped with the order's
# date so items follow the order they belong to.
orders = df.groupby("OrderNumber").agg(
    dt=("dt", "min"),
    OrderTotal=("OrderTotal", "max"),
    OrderShippingAmount=("OrderShippingAmount", "max"),
    TaxAmount=("TaxAmount", "max"),
    OrderShipState=("OrderShipState", "first"),
    units=("qty", "sum"),
).reset_index()
orders["day"] = orders["dt"].dt.normalize()
orders["merch"] = orders["OrderTotal"] - orders["OrderShippingAmount"].fillna(0) - orders["TaxAmount"].fillna(0)

df["odt"] = df["OrderNumber"].map(orders.set_index("OrderNumber")["dt"])
df["day"] = df["odt"].dt.normalize()

# ---------- drop detection ----------
daily = orders.groupby("day")["OrderNumber"].count()
seeds = sorted(daily[daily >= DROP_DAY_MIN_ORDERS].index)
windows = []
for d in seeds:
    if windows and (d - windows[-1][1]).days <= GAP_DAYS:
        windows[-1][1] = d
    else:
        windows.append([d, d])

first_seen = df.groupby("name")["odt"].min()

drops = []
for i, (a, b) in enumerate(windows):
    w_orders = orders[(orders["day"] >= a) & (orders["day"] <= b)]
    w_items = df[(df["day"] >= a) & (df["day"] <= b)]
    if len(w_orders) == 0:
        continue
    t0 = w_orders["dt"].min()
    # Launch alignment: windows often open with stray trickle orders hours
    # before the real release. The launch clock starts at the first 15-minute
    # bin where volume spikes, not at the first stray order.
    b15 = w_orders["dt"].dt.floor("15min").value_counts().sort_index()
    thr = max(10, 0.01 * len(w_orders))
    spikes = b15[b15 >= thr]
    launch = spikes.index[0] if len(spikes) else t0
    # label: top-units product that debuted in this window, else overall top
    prod = w_items.groupby("name").agg(units=("qty", "sum"), rev=("ext", "sum")).sort_values("units", ascending=False)
    label = None
    for n in prod.index:
        if n != "(unknown)" and first_seen[n] >= t0 - pd.Timedelta(days=2) and first_seen[n] <= pd.Timestamp(b) + pd.Timedelta(days=1):
            label = n
            break
    if label is None:
        label = prod.index[0]
    # cumulative merch curves from launch: hourly for 48h, 5-minute for 6h.
    # Pre-launch trickle orders clamp to elapsed 0 so cumulative totals hold.
    elapsed = (w_orders["dt"] - launch).dt.total_seconds().clip(lower=0)
    hourly = w_orders.groupby((elapsed // 3600).astype(int))["merch"].sum()
    curve = []
    run = 0.0
    for h in range(48):
        run += float(hourly.get(h, 0.0))
        curve.append(round(run))
    by5 = w_orders.groupby((elapsed // 300).astype(int))["merch"].sum()
    curve6 = []
    run = 0.0
    for m in range(72):
        run += float(by5.get(m, 0.0))
        curve6.append(round(run))
    total_merch = float(w_orders["merch"].sum())
    first24 = float(w_orders[elapsed < 24 * 3600]["merch"].sum())
    tmix = w_items.groupby("type")["qty"].sum().sort_values(ascending=False)
    drops.append({
        "id": i,
        "label": label,
        "start": t0.strftime("%Y-%m-%d %H:%M"),
        "launch": launch.strftime("%Y-%m-%d %H:%M"),
        "endDay": pd.Timestamp(b).strftime("%Y-%m-%d"),
        "days": (b - a).days + 1,
        "orders": int(len(w_orders)),
        "units": int(w_orders["units"].sum()),
        "gross": round(float(w_orders["OrderTotal"].sum())),
        "merch": round(total_merch),
        "aov": round(float(w_orders["OrderTotal"].mean()), 2),
        "upo": round(float(w_orders["units"].mean()), 2),
        "preorderShare": round(float(w_items[w_items["preorder"]]["qty"].sum() / max(w_items["qty"].sum(), 1)), 3),
        "kind": DROP_KIND_OVERRIDES.get(
            pd.Timestamp(a).strftime("%Y-%m-%d"),
            "pre" if w_items[w_items["preorder"]]["qty"].sum() / max(w_items["qty"].sum(), 1) >= 0.5 else "stock",
        ),
        "first24Share": round(first24 / total_merch, 3) if total_merch else 0,
        "curve48": curve,
        "curve6h": curve6,
        "typeMix": {t: int(v) for t, v in tmix.head(8).items()},
        "top": [
            {"name": n, "units": int(r["units"]), "rev": round(float(r["rev"]))}
            for n, r in prod.head(10).iterrows()
        ],
    })

in_window = pd.Series(False, index=orders.index)
for a, b in windows:
    in_window |= (orders["day"] >= a) & (orders["day"] <= b)

# ---------- series ----------
om = orders.set_index("dt").resample("MS")
monthly = [
    {
        "m": ts.strftime("%Y-%m"),
        "orders": int(g["OrderNumber"].count()),
        "gross": round(float(g["OrderTotal"].sum())),
        "merch": round(float(g["merch"].sum())),
        "units": int(g["units"].sum()),
        "aov": round(float(g["OrderTotal"].mean()), 2) if len(g) else 0,
    }
    for ts, g in om
]

df["q"] = df["odt"].dt.to_period("Q").astype(str)
qt = df.groupby(["q", "type"]).agg(units=("qty", "sum"), rev=("ext", "sum")).reset_index()
quarters = sorted(qt["q"].unique())
type_order = df.groupby("type")["ext"].sum().sort_values(ascending=False).index.tolist()
type_rev = {
    t: [round(float(qt[(qt["q"] == q) & (qt["type"] == t)]["rev"].sum())) for q in quarters]
    for t in type_order
}

st = orders.groupby("OrderShipState").agg(orders=("OrderNumber", "count"), rev=("OrderTotal", "sum"))
st = st[st.index.str.len() == 2]
states = {s: {"orders": int(r["orders"]), "rev": round(float(r["rev"]))} for s, r in st.iterrows()}

topprod = df.groupby("name").agg(units=("qty", "sum"), rev=("ext", "sum"), first=("odt", "min"))
topprod = topprod.drop("(unknown)", errors="ignore").sort_values("rev", ascending=False).head(60)
top_products = [
    {"name": n, "units": int(r["units"]), "rev": round(float(r["rev"])),
     "type": tmap.get(n, "Other"), "first": r["first"].strftime("%Y-%m")}
    for n, r in topprod.iterrows()
]

years = {}
for y, g in orders.groupby(orders["dt"].dt.year):
    years[int(y)] = {
        "orders": int(len(g)),
        "gross": round(float(g["OrderTotal"].sum())),
        "aov": round(float(g["OrderTotal"].mean()), 2),
        "drops": sum(1 for d in drops if d["start"].startswith(str(y))),
    }

# prior-year same-period slice, so the current YTD card can compare apples to apples
last = orders["dt"].max()
cut = last - pd.DateOffset(years=1)
prev = orders[(orders["dt"].dt.year == last.year - 1) & (orders["dt"] <= cut)]
prev_ytd = {
    "year": int(last.year - 1),
    "through": cut.strftime("%Y-%m-%d"),
    "orders": int(len(prev)),
    "gross": round(float(prev["OrderTotal"].sum())),
    "aov": round(float(prev["OrderTotal"].mean()), 2) if len(prev) else 0,
}

out = {
    "prevYtd": prev_ytd,
    "meta": {
        "generated": pd.Timestamp.now().strftime("%Y-%m-%d"),
        "rows": int(len(df)),
        "orders": int(len(orders)),
        "units": int(orders["units"].sum()),
        "gross": round(float(orders["OrderTotal"].sum())),
        "merch": round(float(orders["merch"].sum())),
        "shipCollected": round(float(orders["OrderShippingAmount"].sum())),
        "from": orders["dt"].min().strftime("%Y-%m-%d"),
        "to": orders["dt"].max().strftime("%Y-%m-%d"),
        "aov": round(float(orders["OrderTotal"].mean()), 2),
        "dropRevShare": round(float(orders[in_window]["OrderTotal"].sum() / orders["OrderTotal"].sum()), 3),
        "dropOrderShare": round(float(in_window.mean()), 3),
    },
    "monthly": monthly,
    "quarters": quarters,
    "typeRev": type_rev,
    "typeTotals": {t: {"units": int(df[df["type"] == t]["qty"].sum()),
                       "rev": round(float(df[df["type"] == t]["ext"].sum()))} for t in type_order},
    "drops": drops,
    "states": states,
    "topProducts": top_products,
    "years": years,
}

with open(OUT, "w") as f:
    json.dump(out, f)
print("drops detected:", len(drops))
print("wrote", OUT, len(json.dumps(out)) // 1024, "KB")
for d in drops[-12:]:
    print(f'  {d["start"]}  {d["label"][:40]:40s}  orders={d["orders"]:6d}  gross=${d["gross"]:,}')
