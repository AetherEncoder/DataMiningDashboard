# Campus Kiosk Spending Dashboard

Dashboard for the CompSci 35 & 39 final project *Predictive Analytics and Market Basket Analysis of Student Consumer Behavior in Campus Food Kiosks in Silliman University*.

Plain HTML, CSS, and JavaScript. No build step and no chart library; every chart is drawn as SVG by `app.js`.

## Files

| File | What it is |
|---|---|
| `index.html` | The page layout |
| `styles.css` | The "Reading Room" theme (colors and fonts from the project's DESIGN.md) |
| `app.js` | Filters, KPIs, charts, tables, and tooltips |
| `data/dashboard_data.js` | The 357 cleaned responses and the data mining results. **Made by a script; don't edit by hand.** |

## Updating the data

The data file is made in the main project folder:

```
python scripts/mining.py
python scripts/evaluation.py
python scripts/export_dashboard_data.py
```

## Viewing it

- Locally: open `index.html` in a browser. It works without a server.
- Online: GitHub → Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`. The site will be at `https://aetherencoder.github.io/DataMiningDashboard/`.

Filters are saved in the address, so a filtered view can be shared, e.g. `index.html#allowance=Below%20%E2%82%B1100`.
