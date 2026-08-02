# Product Data — Quick Reference

Keep this open while filling `products.csv` and `ingredients.csv`.

---

## Two files, on purpose

| File | One row per | Why separate |
|---|---|---|
| `products.csv` | Product | The 15 fixed attributes |
| `ingredients.csv` | **Ingredient** | A product has 1–10 active ingredients. Cramming them into one cell means typing `ויטמין D3:1000:IU\|ויטמין K2:100:מק"ג` and getting a delimiter wrong. One row each is faster and impossible to mis-parse |

They join on `product_slug` = `slug`.

---

## 🔴 Fill order — left to right, in three passes

`products.csv` columns are ordered so each pass is one contiguous block.

### Pass 1 — identity (already done for the 15)
```
slug · image_file · name_he · name_en · category · brand · target_audience
```

### Pass 2 — invent freely, no source needed
```
price · stock_quantity · description · health_goals
```
This is a demo store. Make them up. Nothing depends on their accuracy.

### Pass 3 — 🔴 must be accurate, needs a source
```
dosage_form · package_quantity · usage_instructions · warnings_allergens
```
Plus every row in `ingredients.csv`.

These describe a **real product**. Read them off the package or the manufacturer's page. Record where in `data_source`, then set `verified = yes`.

**Why the split matters:** a made-up price in a student demo reads as obviously fictional. A made-up allergen list does not. Someone with a soy allergy reading "contains no soy" on a product that contains soy has been misled about something real.

---

## Allowed values — copy exactly

### `category` — exactly one
```
ויטמינים
מינרלים
אומגה ושומנים
חלבונים ואבקות
פרוביוטיקה
צמחי מרפא
```

### `dosage_form` — exactly one
```
כמוסות
טבליות
טיפות
אבקה
סירופ        ← added by DEC-028
```

### `target_audience` — one, or leave blank
```
מבוגרים
ילדים
ספורטאים
```

### `health_goals` — zero or more, pipe-separated
```
חיזוק חיסון | עצמות | אנרגיה | שינה | עיכול | עור ושיער | ספורט
```
Not a closed list. Add what fits — just stay consistent, because these become filter options.

### `unit` in `ingredients.csv`
```
מ"ג    מק"ג    IU    גרם    מ"ל    %
```

---

## Column notes

| Column | Rule |
|---|---|
| `slug` | ASCII, lowercase, hyphens. 🔴 **Never change one after it ships** — it appears in URLs |
| `image_file` | Exact filename in this folder, including the extension |
| `price` | Decimal **greater than 0**. Two places: `89.90` |
| `stock_quantity` | Integer, **not negative**. `0` is valid, blank is not |
| `package_quantity` | Integer **greater than 0**. The count on the package |
| `usage_instructions` | 🔴 **Quote the manufacturer.** "טבליה ביום, לפי הוראות היצרן" — never "מומלץ ליטול" |
| `warnings_allergens` | 🔴 **Never empty.** If nothing applies, write what the package says |
| `data_source` | A URL, or `filename`, or `invented` |
| `verified` | `yes` once checked against the source. Blank means not checked |
| `notes` | Anything odd. Free text, ignored by the seed |

🔴 **A row with `verified` blank is not seeded into a catalogue anyone else will see.**

---

## Editing in Excel

The file is **UTF-8 with BOM** so Hebrew opens correctly.

```
✅ Open normally
🔴 When saving: choose "CSV UTF-8 (comma delimited)"
❌ Plain "CSV (comma delimited)" mangles Hebrew
```

**A safer alternative:** edit in VS Code with the *Rainbow CSV* extension. It colours columns, catches a missing comma immediately, and cannot re-encode the file behind your back.

---

## Adding a new product

```
1. Drop the image into this folder
2. products.csv     — one new row, pass 1 then pass 2
3. ingredients.csv  — one row per active ingredient
4. Pass 3 from the package or the manufacturer's page
5. data_source + verified = yes
```

---

## Where these files end up

They stay here in `assets/products/` and move into the repository with the rest of `assets/`. The seed script reads them from there.

```
VitaShop/
└── assets/
    └── products/
        ├── products.csv       ← the seed reads this
        ├── ingredients.csv    ← and this
        ├── REFERENCE.md
        └── *.jpg
```

**Deliberately not** under `server/prisma/` — keeping the data next to the images it describes means one place to look, and the images have to live in the repository anyway (see ISSUE-008 on ephemeral hosting filesystems).

---

## Current state — 15 products

| Filled | Blank |
|---|---|
| slug · image_file · name_he · name_en | price · stock_quantity · description · health_goals |
| category · brand · target_audience (5) | usage_instructions · warnings_allergens |
| **dosage_form — all 15** | **all of `ingredients.csv`** |
| package_quantity (6) | |

`dosage_form` and part of `package_quantity` were filled from manufacturer and retailer pages on 2026-08-01, with URLs in `data_source`. **`verified` is blank on every row** — confirm against the actual package you photographed, since most of these products ship in several pack sizes and formats.

---

Last updated: 2026-08-01
