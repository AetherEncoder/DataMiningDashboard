/* Campus Kiosk Spending Dashboard
 * Draws every chart as plain SVG from data/dashboard_data.js
 * (made by scripts/export_dashboard_data.py). Colors and fonts follow DESIGN.md.
 */
(function () {
  "use strict";

  const D = window.DASHBOARD_DATA;
  if (!D) {
    document.querySelector(".page").insertAdjacentHTML("afterbegin",
      '<p class="empty">The data file (data/dashboard_data.js) did not load.</p>');
    return;
  }

  // ---- Theme (same values as DESIGN.md and scripts/theme.py) ----
  const C = {
    espresso: "#2E241D", walnutDeep: "#55341C", walnut: "#7E4116", tan: "#D8B38F",
    tanLight: "#E9D4BC", muted: "#6E6055", grid: "#EEE7DC", rule: "#E4D9CB",
    white: "#FFFFFF", pine: "#288463", slate: "#3A6FA3", slateLight: "#93BCE6",
    tanWarm: "#DFAB7F", parchment: "#F4ECDE",
  };
  const RAMP = ["#F7EFE3", "#E9D4BC", "#D8B38F", "#C38F65", "#A76A3E", "#874A20", "#633416", "#3F2313"];
  const RATING = ["#5B7A8C", "#A9BCC6", "#DCB48C", "#7A3E14"];
  const RATING_TEXT = [C.white, C.espresso, C.espresso, C.white];
  const RATING_NAMES = ["1 Not at all important", "2", "3", "4 Very important"];
  const FONT = '"Source Sans 3", "Segoe UI", Arial, sans-serif';
  const NS = "http://www.w3.org/2000/svg";
  const SMALL_GROUP = 30;

  const state = { year: "", college: "", allowance: "" };
  let confusionModel = "Random Forest";

  // ---- Small helpers ----
  function svgEl(tag, attrs, parent, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function htmlEl(tag, attrs, parent, text) {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function newSvg(box, width, height, label) {
    box.textContent = "";
    return svgEl("svg", {
      viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": label,
    }, box);
  }
  function tip(node, value, label) {
    node.setAttribute("data-tv", value);
    node.setAttribute("data-tl", label);
    return node;
  }
  const pct = (x) => (x * 100).toFixed(2) + "%";
  const peso = (x) => "₱" + (Number.isInteger(x) ? x.toLocaleString("en-US") : x.toFixed(2));
  const f4 = (x) => Number(x).toFixed(4);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const q = (sel) => document.querySelector(sel);
  const chartBox = (name) => q(`[data-chart="${name}"]`);
  const tableBox = (name) => q(`[data-table="${name}"]`);

  const canvas = document.createElement("canvas").getContext("2d");
  function textWidth(text, size, weight) {
    canvas.font = `${weight || 400} ${size}px ${FONT}`;
    return canvas.measureText(text).width;
  }
  // an x-axis label that breaks onto two lines when it doesn't fit its slot
  function axisLabel(parent, x, y, text, maxW, size, color) {
    const t = svgEl("text", { x, y, "text-anchor": "middle", "font-size": size, fill: color }, parent);
    if (textWidth(text, size) <= maxW) { t.textContent = text; return 1; }
    const cuts = [];
    for (let i = 1; i < text.length; i++) {
      if (text[i] === " ") cuts.push([text.slice(0, i), text.slice(i + 1)]);
      if (text[i - 1] === "–") cuts.push([text.slice(0, i), text.slice(i)]);
    }
    if (!cuts.length) { t.textContent = text; return 1; }
    cuts.sort((a, b) => Math.max(textWidth(a[0], size), textWidth(a[1], size)) - Math.max(textWidth(b[0], size), textWidth(b[1], size)));
    svgEl("tspan", { x, dy: 0 }, t, cuts[0][0]);
    svgEl("tspan", { x, dy: size + 2 }, t, cuts[0][1]);
    return 2;
  }
  function boxWidth(box) {
    return Math.max(260, Math.floor(box.clientWidth || box.parentNode.clientWidth || 500));
  }

  function setNote(name, parts) {
    // parts: array of strings and {b: "bold text"} pieces, so no HTML strings are built
    const p = q(`[data-note="${name}"]`);
    p.textContent = "";
    (parts || []).forEach((part) => {
      if (typeof part === "string") p.appendChild(document.createTextNode(part));
      else htmlEl("strong", {}, p, part.b);
    });
  }

  function makeTable(box, headers, rows, opts) {
    opts = opts || {};
    box.textContent = "";
    const wrap = htmlEl("div", { class: "tbl-wrap" }, box);
    const stack = headers.length > 2 ? " stack" : ""; // on phones, wide tables become label/value rows
    const t = htmlEl("table", { class: "tbl" + stack + (opts.cls ? " " + opts.cls : "") }, wrap);
    const tr = htmlEl("tr", {}, htmlEl("thead", {}, t));
    headers.forEach((h) => htmlEl("th", { scope: "col" }, tr, h));
    const tb = htmlEl("tbody", {}, t);
    rows.forEach((r, i) => {
      const row = htmlEl("tr", opts.highlight === i ? { class: "hl" } : {}, tb);
      r.forEach((cell, j) => htmlEl("td", { "data-label": headers[j] }, row, cell));
    });
    return t;
  }

  function empty(box, msg) {
    box.textContent = "";
    htmlEl("p", { class: "empty" }, box, msg || "No students match these filters.");
  }

  // ---- Statistics ----
  function quantile(sorted, p) {
    // linear interpolation, the same as numpy/pandas default
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function stats(values) {
    const s = values.slice().sort((a, b) => a - b);
    const n = s.length;
    if (!n) return null;
    const mean = s.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
    const counts = new Map();
    s.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    let mode = s[0], best = 0;
    counts.forEach((c, v) => { if (c > best) { best = c; mode = v; } }); // ties → smallest value
    return {
      n, mean, sd, mode, min: s[0], max: s[n - 1],
      q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75), sorted: s,
    };
  }
  const round2 = (x) => Math.round(x * 100) / 100;

  // ---- Filtering ----
  function matches(r, skip) {
    return (skip === "year" || !state.year || r.year === state.year) &&
      (skip === "college" || !state.college || r.college === state.college) &&
      (skip === "allowance" || !state.allowance || r.allowance === state.allowance);
  }
  const filtered = () => D.rows.filter((r) => matches(r));

  function setupFilters() {
    ["year", "college", "allowance"].forEach((key) => {
      const sel = q(`[data-filter="${key}"]`);
      sel.addEventListener("change", () => { state[key] = sel.value; update(); });
    });
    q("#reset").addEventListener("click", () => {
      state.year = state.college = state.allowance = "";
      update();
    });
  }

  function refreshFilterOptions() {
    // option labels show how many students each choice would give, with the other filters on
    const all = { year: "All year levels", college: "All colleges", allowance: "All allowances" };
    ["year", "college", "allowance"].forEach((key) => {
      const sel = q(`[data-filter="${key}"]`);
      const pool = D.rows.filter((r) => matches(r, key));
      sel.textContent = "";
      htmlEl("option", { value: "" }, sel, `${all[key]} (${pool.length})`);
      D.orders[key].forEach((v) => {
        const n = pool.filter((r) => r[key] === v).length;
        if (!n && state[key] !== v) return; // hide choices with nobody in them
        const o = htmlEl("option", { value: v }, sel, `${v} (${n})`);
        if (state[key] === v) o.selected = true;
      });
      sel.value = state[key];
      sel.classList.toggle("is-active", !!state[key]);
    });
    q("#reset").disabled = !state.year && !state.college && !state.allowance;
  }

  function renderStatus(rows) {
    const p = q("#filter-status");
    p.textContent = "";
    p.appendChild(document.createTextNode("Showing "));
    htmlEl("strong", {}, p, String(rows.length));
    p.appendChild(document.createTextNode(` of ${D.meta.n} students.`));
    if (rows.length && rows.length < SMALL_GROUP) {
      p.appendChild(document.createTextNode(
        ` This is a small group, so one or two answers can move the percentages a lot.`));
    }
  }

  // ---- KPIs ----
  function itemCounts(rows) {
    return D.items.map((it, i) => ({
      label: it.label, count: rows.filter((r) => r.items.includes(i)).length,
    }));
  }
  function motiveStats(rows) {
    return D.motives.map((m, i) => {
      const vals = rows.map((r) => r.motives[i]);
      const dist = [1, 2, 3, 4].map((v) => vals.filter((x) => x === v).length);
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      return { label: m.label, long: m.long, mean, dist, n: vals.length };
    });
  }

  function renderKPIs(rows) {
    const n = rows.length;
    q("#kpi-n").textContent = String(n);
    q("#kpi-n-sub").textContent = n === D.meta.n
      ? `${D.meta.rawResponses} answered; ${D.meta.removed} removed in cleaning`
      : `of ${D.meta.n} students after cleaning`;
    if (!n) {
      ["#kpi-median", "#kpi-item", "#kpi-motive"].forEach((id) => (q(id).textContent = "–"));
      ["#kpi-median-sub", "#kpi-item-sub", "#kpi-motive-sub"].forEach((id) => (q(id).textContent = ""));
      return;
    }
    const st = stats(rows.map((r) => r.amount));
    q("#kpi-median").textContent = peso(round2(st.median));
    q("#kpi-median-sub").textContent = `Mean ${peso(round2(st.mean))}`;
    const items = itemCounts(rows).sort((a, b) => b.count - a.count);
    q("#kpi-item").textContent = items[0].label;
    q("#kpi-item-sub").textContent = `In ${pct(items[0].count / n)} of baskets`;
    const mot = motiveStats(rows).sort((a, b) => b.mean - a.mean);
    q("#kpi-motive").textContent = mot[0].label;
    q("#kpi-motive-sub").textContent = `Mean rating ${mot[0].mean.toFixed(2)} of 4`;
  }

  // ---- Horizontal bar chart (items) ----
  function renderItems(rows) {
    const box = chartBox("items");
    const n = rows.length;
    if (!n) { empty(box); setNote("items"); tableBox("items").textContent = ""; return; }
    const data = itemCounts(rows).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const W = boxWidth(box);
    const labelW = Math.min(170, Math.max(...data.map((d) => textWidth(d.label, 13))) + 12);
    const valueW = 56, rowH = 24, barH = 14;
    const H = data.length * rowH + 4;
    const svg = newSvg(box, W, H, "Bar chart of item categories bought");
    const max = Math.max(...data.map((d) => d.count / n), 0.01);
    const plotW = W - labelW - valueW;
    data.forEach((d, i) => {
      const y = i * rowH;
      const share = d.count / n;
      const g = tip(svgEl("g", {}, svg), `${pct(share)} of baskets`, `${d.label} · ${plural(d.count, "basket")}`);
      svgEl("rect", { x: 0, y, width: W, height: rowH, fill: "transparent" }, g);
      svgEl("text", { x: labelW - 10, y: y + rowH / 2, "text-anchor": "end", "dominant-baseline": "central",
        "font-size": 13, fill: C.espresso }, g, d.label);
      const w = Math.max(share / max * plotW, d.count ? 2 : 0);
      svgEl("rect", { class: "mark", x: labelW, y: y + (rowH - barH) / 2, width: w, height: barH, fill: C.walnut }, g);
      svgEl("text", { x: labelW + w + 6, y: y + rowH / 2, "dominant-baseline": "central", "font-size": 12.5,
        fill: C.espresso }, g, pct(share));
    });
    svgEl("line", { x1: labelW, x2: labelW, y1: 0, y2: H - 4, stroke: C.rule }, svg);

    const one = rows.filter((r) => r.items.length === 1).length;
    setNote("items", [{ b: data[0].label }, ` (${pct(data[0].count / n)}) and `, { b: data[1].label },
      ` (${pct(data[1].count / n)}) were bought most. ${pct(one / n)} of these students bought only one item category.`]);
    makeTable(tableBox("items"), ["Item category", "Baskets", "% of baskets"],
      data.map((d) => [d.label, String(d.count), pct(d.count / n)]));
  }

  // ---- Summary statistics (table + tier split) ----
  function renderSummary(rows) {
    const box = chartBox("summary");
    if (!rows.length) { empty(box); setNote("summary"); return; }
    const st = stats(rows.map((r) => r.amount));
    box.textContent = "";
    makeTable(htmlEl("div", {}, box), ["Measure", "Amount paid"], [
      ["Mean", peso(round2(st.mean))],
      ["Median", peso(round2(st.median))],
      ["Mode", peso(st.mode)],
      ["Minimum", peso(st.min)],
      ["Maximum", peso(st.max)],
      ["Standard deviation", peso(round2(st.sd))],
      ["1st quartile (Q1)", peso(round2(st.q1))],
      ["3rd quartile (Q3)", peso(round2(st.q3))],
    ]);
    const above = rows.filter((r) => r.amount > 100).length;
    const below = rows.length - above;
    const split = htmlEl("div", { class: "split" }, box);
    htmlEl("p", { class: "split-title" }, split, "Spending tier (the target of the classification models)");
    const bar = htmlEl("div", { class: "split-bar", role: "img",
      "aria-label": `₱100 and below ${pct(below / rows.length)}, above ₱100 ${pct(above / rows.length)}` }, split);
    if (below) htmlEl("div", { class: "split-seg", style: `flex:${below};background:${C.walnut}` }, bar);
    if (above) htmlEl("div", { class: "split-seg", style: `flex:${above};background:${C.tan}` }, bar);
    const labels = htmlEl("div", { class: "split-labels" }, split);
    const l1 = htmlEl("span", {}, labels);
    htmlEl("span", { class: "swatch", style: `display:inline-block;vertical-align:-1px;margin-right:6px;background:${C.walnut}` }, l1);
    l1.appendChild(document.createTextNode(`₱100 and below: ${below} (${pct(below / rows.length)})`));
    const l2 = htmlEl("span", {}, labels);
    htmlEl("span", { class: "swatch", style: `display:inline-block;vertical-align:-1px;margin-right:6px;background:${C.tan}` }, l2);
    l2.appendChild(document.createTextNode(`Above ₱100: ${above} (${pct(above / rows.length)})`));

    const parts = [];
    if (st.mean > st.median) {
      parts.push("The mean is above the median because a few students paid much more, up to ", { b: peso(st.max) },
        ". The median is the better guide to a typical purchase.");
    } else {
      parts.push(`Half of these students paid ${peso(round2(st.median))} or less.`);
    }
    setNote("summary", parts);
  }

  // ---- Histogram (amount paid) ----
  function renderHist(rows) {
    const box = chartBox("hist");
    const n = rows.length;
    if (!n) { empty(box); setNote("hist"); tableBox("hist").textContent = ""; return; }
    const st = stats(rows.map((r) => r.amount));
    const step = 20, top = Math.max(560, Math.ceil(st.max / step) * step);
    const bins = [];
    for (let a = 0; a < top; a += step) bins.push({ from: a, to: a + step, count: 0 });
    rows.forEach((r) => {
      let i = Math.floor(r.amount / step);
      if (i >= bins.length) i = bins.length - 1; // the top edge counts in the last bin
      bins[i].count++;
    });
    const W = boxWidth(box), H = 270;
    const m = { l: 34, r: 8, t: 26, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxC = Math.max(...bins.map((b) => b.count));
    const yMax = Math.max(5, Math.ceil(maxC / 10) * 10);
    const x = (v) => m.l + (v / top) * pw;
    const y = (c) => m.t + ph - (c / yMax) * ph;
    const svg = newSvg(box, W, H, "Histogram of amount paid");
    const yStep = yMax <= 10 ? 2 : yMax <= 40 ? 10 : 20;
    for (let t = 0; t <= yMax; t += yStep) {
      svgEl("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: t ? C.grid : C.rule }, svg);
      svgEl("text", { x: m.l - 6, y: y(t), "text-anchor": "end", "dominant-baseline": "central",
        "font-size": 12, fill: C.muted }, svg, String(t));
    }
    const xStep = 100;
    for (let t = 0; t <= top; t += xStep) {
      svgEl("text", { x: x(t), y: H - 8, "text-anchor": "middle", "font-size": 12, fill: C.muted }, svg, "₱" + t);
    }
    const bw = (step / top) * pw;
    bins.forEach((b) => {
      if (!b.count) return;
      const g = tip(svgEl("g", {}, svg), plural(b.count, "student"), `Paid ₱${b.from} to under ₱${b.to}`);
      svgEl("rect", { x: x(b.from), y: m.t, width: bw, height: ph, fill: "transparent" }, g);
      svgEl("rect", { class: "mark", x: x(b.from) + 1, y: y(b.count), width: Math.max(bw - 2, 1),
        height: y(0) - y(b.count), fill: C.walnut }, g);
    });
    // median (pine, dashed) and mean (muted, dotted)
    const lines = [
      { v: st.median, color: C.pine, dash: "5 4", label: `Median ${peso(round2(st.median))}`, w: 2 },
      { v: st.mean, color: C.muted, dash: "2 3", label: `Mean ${peso(round2(st.mean))}`, w: 1.5 },
    ];
    const close = Math.abs(x(st.mean) - x(st.median)) < 90;
    lines.forEach((ln, i) => {
      svgEl("line", { x1: x(ln.v), x2: x(ln.v), y1: m.t - 4, y2: y(0), stroke: ln.color,
        "stroke-width": ln.w, "stroke-dasharray": ln.dash }, svg);
      const right = i === 1 || !close; // when the two are close, median label goes left, mean right
      svgEl("text", { x: x(ln.v) + (right ? 5 : -5), y: m.t - 10, "text-anchor": right ? "start" : "end",
        "font-size": 12, "font-weight": i === 0 ? 600 : 400, fill: C.espresso }, svg, ln.label);
    });
    const mid = rows.filter((r) => r.amount >= 50 && r.amount <= 150).length;
    setNote("hist", [{ b: pct(mid / n) }, " of these students paid between ₱50 and ₱150.",
      st.mean - st.median > 5 ? " A few large amounts on the right pull the mean above the median (green line)." : ""]);
    makeTable(tableBox("hist"), ["Amount paid", "Students", "%"],
      bins.filter((b) => b.count).map((b) => [`₱${b.from} to under ₱${b.to}`, String(b.count), pct(b.count / n)]));
  }

  // ---- Box plot (amount by allowance) ----
  function renderBox(rows) {
    const box = chartBox("box");
    if (!rows.length) { empty(box); setNote("box"); tableBox("box").textContent = ""; return; }
    const groups = D.orders.allowance.map((g) => {
      const vals = rows.filter((r) => r.allowance === g).map((r) => r.amount);
      return { label: g, st: stats(vals) };
    }).filter((g) => g.st);
    const W = boxWidth(box);
    const narrow = groups.some((g) => textWidth(g.label, 12.5) > (W - 56) / groups.length - 6);
    const H = narrow ? 284 : 270;
    const m = { l: 44, r: 12, t: 12, b: narrow ? 58 : 44 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const yMax = Math.max(100, Math.ceil(Math.max(...groups.map((g) => g.st.max)) / 100) * 100);
    const y = (v) => m.t + ph - (v / yMax) * ph;
    const svg = newSvg(box, W, H, "Box plot of amount paid by daily allowance");
    for (let t = 0; t <= yMax; t += 100) {
      svgEl("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: t ? C.grid : C.rule }, svg);
      svgEl("text", { x: m.l - 6, y: y(t), "text-anchor": "end", "dominant-baseline": "central",
        "font-size": 12, fill: C.muted }, svg, "₱" + t);
    }
    const slot = pw / groups.length;
    const bw = Math.min(56, slot * 0.42);
    const tableRows = [];
    groups.forEach((g, i) => {
      const s = g.st, cx = m.l + slot * i + slot / 2;
      const iqr = s.q3 - s.q1;
      const inside = s.sorted.filter((v) => v >= s.q1 - 1.5 * iqr && v <= s.q3 + 1.5 * iqr);
      const lo = inside[0], hi = inside[inside.length - 1];
      const gEl = tip(svgEl("g", {}, svg), `Median ${peso(round2(s.median))}`,
        `${g.label} · n = ${s.n} · middle half ${peso(round2(s.q1))} to ${peso(round2(s.q3))}`);
      svgEl("rect", { x: cx - slot / 2, y: m.t, width: slot, height: ph, fill: "transparent" }, gEl);
      svgEl("line", { x1: cx, x2: cx, y1: y(hi), y2: y(s.q3), stroke: C.walnut, "stroke-width": 1.4 }, gEl);
      svgEl("line", { x1: cx, x2: cx, y1: y(s.q1), y2: y(lo), stroke: C.walnut, "stroke-width": 1.4 }, gEl);
      [hi, lo].forEach((v) => svgEl("line", { x1: cx - bw / 4, x2: cx + bw / 4, y1: y(v), y2: y(v),
        stroke: C.walnut, "stroke-width": 1.4 }, gEl));
      svgEl("rect", { class: "mark", x: cx - bw / 2, y: y(s.q3), width: bw, height: Math.max(y(s.q1) - y(s.q3), 1),
        fill: C.tanLight, stroke: C.walnut, "stroke-width": 1.4 }, gEl);
      svgEl("line", { x1: cx - bw / 2, x2: cx + bw / 2, y1: y(s.median), y2: y(s.median),
        stroke: C.espresso, "stroke-width": 2 }, gEl);
      s.sorted.filter((v) => v < lo || v > hi).forEach((v) =>
        svgEl("circle", { cx, cy: y(v), r: 2.6, fill: C.muted, "fill-opacity": 0.6 }, gEl));
      if (!narrow) {
        svgEl("text", { x: cx + bw / 2 + 5, y: y(s.median), "dominant-baseline": "central", "font-size": 12,
          "font-weight": 600, fill: C.espresso }, gEl, peso(round2(s.median)));
      }
      const shortLabel = narrow ? g.label.replace(" and above", "+").replace("Below ₱100", "< ₱100") : g.label;
      axisLabel(svg, cx, H - 24 - (narrow ? 14 : 0), shortLabel, slot - 6, 12.5, C.espresso);
      svgEl("text", { x: cx, y: H - 8, "text-anchor": "middle", "font-size": 12, fill: C.muted }, svg, `n = ${s.n}`);
      const above = rows.filter((r) => r.allowance === g.label && r.amount > 100).length;
      tableRows.push([g.label, String(s.n), peso(round2(s.median)), peso(round2(s.q1)), peso(round2(s.q3)),
        peso(s.min), peso(s.max), pct(above / s.n)]);
    });
    if (groups.length > 1) {
      const sorted = groups.slice().sort((a, b) => a.st.median - b.st.median);
      const low = sorted[0], high = sorted[sorted.length - 1];
      const phrase = (g) => g.label.replace("Below ₱100", "less than ₱100").replace("and above", "or more");
      setNote("box", ["Students with ", { b: phrase(low) }, ` a day had the lowest median (${peso(round2(low.st.median))}); students with `,
        { b: phrase(high) }, ` had the highest (${peso(round2(high.st.median))}).`]);
    } else {
      setNote("box", [`Only one allowance group is in view. Its median is ${peso(round2(groups[0].st.median))}.`]);
    }
    makeTable(tableBox("box"), ["Daily allowance", "Students", "Median", "Q1", "Q3", "Min", "Max", "Paid above ₱100"], tableRows);
  }

  // ---- Line chart (time of day) ----
  function renderTime(rows) {
    const box = chartBox("time");
    const n = rows.length;
    if (!n) { empty(box); setNote("time"); tableBox("time").textContent = ""; return; }
    const slots = D.orders.time;
    const data = slots.map((s) => ({ label: s, count: rows.filter((r) => r.time === s).length }));
    const W = boxWidth(box);
    const narrow = slots.some((s) => textWidth(s, 12.5) > (W - 64) / slots.length - 6);
    const SHORT_SLOT = { "Before 11 AM": "Before 11", "11 AM–1 PM": "11–1", "1–4 PM": "1–4", "After 4 PM": "After 4" };
    const H = 290;
    const m = { l: 40, r: 24, t: 28, b: narrow ? 46 : 30 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxShare = Math.max(...data.map((d) => d.count / n));
    const yMax = Math.max(0.1, Math.ceil(maxShare * 10) / 10);
    const x = (i) => m.l + pw * (i + 0.5) / slots.length;
    const y = (v) => m.t + ph - (v / yMax) * ph;
    const svg = newSvg(box, W, H, "Line chart of purchases by time of day");
    for (let t = 0; t <= yMax + 1e-9; t += yMax > 0.5 ? 0.2 : 0.1) {
      svgEl("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: t ? C.grid : C.rule }, svg);
      svgEl("text", { x: m.l - 6, y: y(t), "text-anchor": "end", "dominant-baseline": "central",
        "font-size": 12, fill: C.muted }, svg, Math.round(t * 100) + "%");
    }
    svgEl("polyline", { points: data.map((d, i) => `${x(i)},${y(d.count / n)}`).join(" "),
      fill: "none", stroke: C.walnut, "stroke-width": 2.5, "stroke-linejoin": "round" }, svg);
    data.forEach((d, i) => {
      const share = d.count / n;
      const g = tip(svgEl("g", { class: "col" }, svg), `${pct(share)} of purchases`, `${d.label} · ${plural(d.count, "student")}`);
      svgEl("rect", { x: m.l + pw * i / slots.length, y: m.t - 20, width: pw / slots.length, height: ph + 20, fill: "transparent" }, g);
      svgEl("line", { class: "xhair", x1: x(i), x2: x(i), y1: m.t - 6, y2: y(0), stroke: C.rule }, g);
      svgEl("circle", { cx: x(i), cy: y(share), r: 5, fill: C.walnut, stroke: C.white, "stroke-width": 2 }, g);
      const nb = [data[i - 1], data[i + 1]].filter(Boolean).map((o) => o.count / n);
      const below = nb.every((v) => v > share);
      svgEl("text", { x: x(i), y: y(share) + (below ? 20 : -12), "text-anchor": "middle", "font-size": 12.5,
        "font-weight": 600, fill: C.espresso }, g, pct(share));
      axisLabel(svg, x(i), H - 8 - (narrow ? 18 : 0), narrow ? SHORT_SLOT[d.label] || d.label : d.label,
        pw / slots.length - 6, 12.5, C.espresso);
    });
    if (narrow) {
      svgEl("text", { x: m.l + pw / 2, y: H - 4, "text-anchor": "middle", "font-size": 12, fill: C.muted }, svg, "Time of day (AM to PM)");
    }
    const best = data.slice().sort((a, b) => b.count - a.count)[0];
    const midday = data[1].count + data[2].count;
    setNote("time", [{ b: best.label }, ` was the busiest slot (${pct(best.count / n)}). `,
      { b: pct(midday / n) }, " of purchases happened between 11 AM and 4 PM."]);
    makeTable(tableBox("time"), ["Time of purchase", "Students", "%"], data.map((d) => [d.label, String(d.count), pct(d.count / n)]));
  }

  // ---- 100% stacked bars (motives) ----
  function renderMotiveLegend() {
    const lg = q('[data-legend="motives"]');
    lg.textContent = "";
    RATING_NAMES.forEach((name, i) => {
      const it = htmlEl("span", { class: "legend-item" }, lg);
      htmlEl("span", { class: "swatch", style: `background:${RATING[i]}` }, it);
      it.appendChild(document.createTextNode(name));
    });
  }
  function renderMotives(rows) {
    const box = chartBox("motives");
    const n = rows.length;
    if (!n) { empty(box); setNote("motives"); tableBox("motives").textContent = ""; return; }
    const data = motiveStats(rows).sort((a, b) => b.mean - a.mean);
    const W = boxWidth(box);
    const labelW = Math.min(120, Math.max(...data.map((d) => textWidth(d.label, 13))) + 12);
    const meanW = 40, rowH = 30, barH = 20;
    const H = data.length * rowH + 22;
    const pw = W - labelW - meanW;
    const svg = newSvg(box, W, H, "Stacked bar chart of motive ratings");
    svgEl("text", { x: W, y: 8, "text-anchor": "end", "font-size": 12, fill: C.muted }, svg, "Mean");
    data.forEach((d, i) => {
      const y0 = 18 + i * rowH;
      svgEl("text", { x: labelW - 10, y: y0 + rowH / 2, "text-anchor": "end", "dominant-baseline": "central",
        "font-size": 13, fill: C.espresso }, svg, d.label);
      let x0 = labelW;
      d.dist.forEach((c, k) => {
        if (!c) return;
        const w = c / d.n * pw;
        const g = tip(svgEl("g", {}, svg), `${pct(c / d.n)} rated it ${k + 1}`, `${d.label} · ${plural(c, "student")}`);
        svgEl("rect", { class: "mark", x: x0, y: y0 + (rowH - barH) / 2, width: Math.max(w - 2, 1), height: barH, fill: RATING[k] }, g);
        const label = Math.round(c / d.n * 100) + "%";
        if (w - 2 >= Math.max(22, textWidth(label, 11.5) + 4)) {
          svgEl("text", { x: x0 + (w - 2) / 2, y: y0 + rowH / 2, "text-anchor": "middle", "dominant-baseline": "central",
            "font-size": 11.5, fill: RATING_TEXT[k] }, g, label);
        }
        x0 += w;
      });
      svgEl("text", { x: W, y: y0 + rowH / 2, "text-anchor": "end", "dominant-baseline": "central",
        "font-size": 12.5, "font-weight": 600, fill: C.espresso }, svg, d.mean.toFixed(2));
    });
    const top = data[0], bottom = data[data.length - 1];
    setNote("motives", [{ b: top.label }, ` mattered most (mean ${top.mean.toFixed(2)}). `, { b: bottom.label },
      ` mattered least (mean ${bottom.mean.toFixed(2)}).`]);
    makeTable(tableBox("motives"), ["Reason", "Mean", "Rated 1", "Rated 2", "Rated 3", "Rated 4"],
      data.map((d) => [d.label, d.mean.toFixed(2)].concat(d.dist.map((c) => pct(c / d.n)))));
  }

  // ================= Data mining (fixed, all 357) =================
  // the mining CSVs use the long item labels; show the short ones
  const SHORT = {};
  D.items.forEach((it) => (SHORT[it.long] = it.label));
  const shortItem = (full) => SHORT[full] || full;
  const ruleName = (r) => `${shortItem(r["If they buy (A)"])} → ${shortItem(r["They also buy (B)"])}`;

  function renderRuleLegend() {
    const lg = q('[data-legend="rules"]');
    lg.textContent = "";
    [[C.tan, "All students (B on its own)"], [C.walnut, "Students who bought A"], [C.pine, "Strongest rule"]].forEach(([c, t]) => {
      const it = htmlEl("span", { class: "legend-item" }, lg);
      htmlEl("span", { class: "swatch dot", style: `background:${c}` }, it);
      it.appendChild(document.createTextNode(t));
    });
  }

  function renderRules() {
    const box = chartBox("rules");
    const rules = D.mining.rules.slice().sort((a, b) => b.Lift - a.Lift);
    const W = boxWidth(box);
    // wide card: rule names in a 260px column beside the dots; narrow: name above its dots
    const side = W >= 640;
    const labelW = side ? Math.max(...rules.map((r) => textWidth(ruleName(r), 13, 600))) + 16 : 0;
    const rowH = side ? 44 : 72, m = { l: 8 + labelW, r: 110, t: 4, b: 28 };
    const H = m.t + rules.length * rowH + m.b;
    const pw = W - m.l - m.r;
    const xMin = 0.1, xMax = 0.5;
    const x = (v) => m.l + ((v - xMin) / (xMax - xMin)) * pw;
    const svg = newSvg(box, W, H, "Dumbbell chart of the four association rules");
    for (let t = xMin; t <= xMax + 1e-9; t += 0.1) {
      svgEl("line", { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b, stroke: C.grid }, svg);
      svgEl("text", { x: x(t), y: H - 8, "text-anchor": "middle", "font-size": 12, fill: C.muted }, svg, Math.round(t * 100) + "%");
    }
    svgEl("line", { x1: m.l, x2: x(xMax), y1: H - m.b, y2: H - m.b, stroke: C.rule }, svg);
    rules.forEach((r, i) => {
      const y0 = m.t + i * rowH;
      const yl = side ? y0 + rowH / 2 : y0 + 50;
      const best = i === 0;
      const base = r["B in all baskets"], conf = r.Confidence;
      const g = tip(svgEl("g", {}, svg), `Lift ${r.Lift.toFixed(2)}`,
        `${ruleName(r)} · ${pct(conf)} of A-buyers vs. ${pct(base)} of all students bought B`);
      svgEl("rect", { x: 0, y: y0, width: W, height: rowH, fill: "transparent" }, g);
      const countText = `${r["Baskets with both"]} baskets with both`;
      svgEl("text", { x: 8, y: side ? yl - 6 : y0 + 14, "font-size": 13, "font-weight": best ? 600 : 400, fill: C.espresso }, g, ruleName(r));
      svgEl("text", { x: 8, y: side ? yl + 11 : y0 + 31, "font-size": 12, fill: C.muted }, g, countText);
      svgEl("line", { x1: x(base), x2: x(conf), y1: yl, y2: yl, stroke: C.tan, "stroke-width": 3 }, g);
      svgEl("circle", { cx: x(base), cy: yl, r: 6, fill: C.tan, stroke: C.white, "stroke-width": 2 }, g);
      svgEl("circle", { class: "mark", cx: x(conf), cy: yl, r: 7, fill: best ? C.pine : C.walnut, stroke: C.white, "stroke-width": 2 }, g);
      svgEl("text", { x: x(conf) + 12, y: yl, "dominant-baseline": "central", "font-size": 12.5,
        "font-weight": best ? 600 : 400, fill: C.espresso }, g, `${pct(conf)} · lift ${r.Lift.toFixed(2)}`);
    });
    const top = rules[0];
    setNote("rules", ["Lift = the gap between the two dots. Students who bought a ", { b: "burger or sandwich" },
      ` were ${top.Lift.toFixed(2)} times as likely as the average student to add a soft drink (${pct(top.Confidence)} vs. ${pct(top["B in all baskets"])}).`]);
  }

  function renderRuleTable() {
    const rules = D.mining.rules.slice().sort((a, b) => b.Lift - a.Lift);
    const check = {};
    D.mining.ruleCheck.forEach((c) => (check[c.Rule] = c));
    const rows = rules.map((r) => {
      const c = check[`${r["If they buy (A)"]} → ${r["They also buy (B)"]}`] || {};
      return [ruleName(r), String(r["Baskets with both"]), f4(r.Support), f4(r.Confidence), r.Lift.toFixed(2),
        c["Expected by chance"] !== undefined ? Number(c["Expected by chance"]).toFixed(1) : "–"];
    });
    makeTable(chartBox("ruleTable"), ["Rule (A → B)", "Baskets", "Support", "Confidence", "Lift", "Expected"], rows, { highlight: 0, cls: "wide-first" });
    setNote("ruleTable", ["Expected = baskets with both if the two items were unrelated. Only the ", { b: "burger → soft drinks" },
      " rule is clearly above chance (14 vs. 7.7). The other three would fail a cut-off with one basket fewer, so treat them as ideas to test."]);
  }

  function luminance(hex) {
    const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function rampColor(share) {
    const top = RAMP.length - 2; // darkest step left out so one cell doesn't jump away from the rest
    const i = Math.min(top, Math.floor(share * (top + 1) / 0.8));
    const L = luminance(RAMP[i]);
    const onWhite = 1.05 / (L + 0.05), onDark = (L + 0.05) / (luminance(C.espresso) + 0.05);
    return { bg: RAMP[i], fg: onWhite >= onDark ? C.white : C.espresso };
  }

  function renderRuleTime() {
    const box = chartBox("ruleTime");
    box.textContent = "";
    const slots = D.orders.time;
    const wrap = htmlEl("div", { class: "tbl-wrap" }, box);
    const t = htmlEl("table", { class: "tbl heat stack" }, wrap);
    const hr = htmlEl("tr", {}, htmlEl("thead", {}, t));
    htmlEl("th", { scope: "col" }, hr, "Rule");
    slots.forEach((s) => htmlEl("th", { scope: "col", class: "cell" }, hr, s));
    htmlEl("th", { scope: "col" }, hr, "Baskets");
    const tb = htmlEl("tbody", {}, t);
    let best = null;
    D.mining.rulesByTime.forEach((r) => {
      const isAll = r.rule === "All baskets";
      const tr = htmlEl("tr", isAll ? { class: "total" } : {}, tb);
      const name = isAll ? "All baskets" : r.rule.split(" → ").map(shortItem).join(" → ");
      const nameCell = htmlEl("td", {}, tr, name);
      htmlEl("span", { class: "n" }, nameCell, ` · ${r.total}`);
      r.counts.forEach((c, i) => {
        const share = c / r.total;
        const col = rampColor(share);
        const td = htmlEl("td", { class: "cell", "data-label": slots[i],
          "data-short": ["Before 11", "11–1", "1–4", "After 4"][i], style: `background:${col.bg};color:${col.fg}` }, tr);
        tip(td, `${pct(share)} of this rule's baskets`, `${name} · ${slots[i]} · ${c} of ${r.total}`);
        htmlEl("span", { class: "v" }, td, pct(share));
        htmlEl("span", { class: "c" }, td, `${c} of ${r.total}`);
        if (!isAll && (!best || share > best.share)) best = { name, slot: slots[i], share, c, total: r.total, i };
      });
      htmlEl("td", { "data-label": "Baskets" }, tr, String(r.total));
    });
    const all = D.mining.rulesByTime.find((r) => r.rule === "All baskets");
    setNote("ruleTime", [{ b: best.name }, ` was mostly a ${best.slot} pair: ${best.c} of its ${best.total} baskets (${pct(best.share)}), against ${pct(all.counts[best.i] / all.total)} of all baskets. Each rule has only 11 to 17 baskets, so these timings are hints, not proof.`]);
  }

  function renderModels() {
    const box = chartBox("models");
    const models = D.mining.models.slice().sort((a, b) => b["F1 (macro)"] - a["F1 (macro)"]);
    const bestName = models[0].Model;
    const W = boxWidth(box);
    const names = models.map((d) => d.Model.startsWith("Baseline") ? "Baseline (always ₱100 and below)" : d.Model);
    const fullW = Math.max(...names.map((s) => textWidth(s, 13))) + 12;
    const wrap = fullW > W * 0.45; // long labels break at " (" onto two lines
    const labelW = wrap ? Math.max(140, ...names.map((s) => s.split(" (").reduce((a, p, k) =>
      Math.max(a, textWidth(k ? "(" + p : p, 13)), 0) + 12)) : fullW;
    const rowH = wrap ? 46 : 44, barH = 20, valueW = 52;
    const H = models.length * rowH + 4;
    const pw = W - labelW - valueW;
    const svg = newSvg(box, W, H, "Bar chart of macro F1-score by model");
    models.forEach((d, i) => {
      const y0 = i * rowH;
      const v = d["F1 (macro)"];
      const isBase = d.Model.startsWith("Baseline");
      const fill = d.Model === bestName ? C.pine : isBase ? C.tan : C.walnut;
      const g = tip(svgEl("g", {}, svg), `Macro F1 ${f4(v)}`, `${names[i]} · balanced accuracy ${f4(d["Balanced accuracy"])}`);
      svgEl("rect", { x: 0, y: y0, width: W, height: rowH, fill: "transparent" }, g);
      const t = svgEl("text", { x: labelW - 10, y: y0 + rowH / 2, "text-anchor": "end", "dominant-baseline": "central", "font-size": 13,
        "font-weight": d.Model === bestName ? 600 : 400, fill: C.espresso }, g);
      const k = names[i].indexOf(" (");
      if (!wrap || k < 0) t.textContent = names[i];
      else {
        svgEl("tspan", { x: labelW - 10, dy: -8 }, t, names[i].slice(0, k));
        svgEl("tspan", { x: labelW - 10, dy: 16 }, t, names[i].slice(k + 1));
      }
      const w = v * pw;
      svgEl("rect", { class: "mark", x: labelW, y: y0 + (rowH - barH) / 2, width: w, height: barH, fill }, g);
      svgEl("text", { x: labelW + w + 6, y: y0 + rowH / 2, "dominant-baseline": "central", "font-size": 12.5,
        "font-weight": d.Model === bestName ? 600 : 400, fill: C.espresso }, g, f4(v));
    });
    svgEl("line", { x1: labelW, x2: labelW, y1: 0, y2: H - 4, stroke: C.rule }, svg);

    const tableRows = D.mining.models.map((d) => [d.Model.startsWith("Baseline") ? "Baseline" : d.Model,
      f4(d.Accuracy), f4(d["Balanced accuracy"]), f4(d["Precision (macro)"]), f4(d["Recall (macro)"]), f4(d["F1 (macro)"])]);
    const tb = chartBox("modelTable");
    makeTable(tb, ["Model", "Accuracy", "Balanced acc.", "Precision", "Recall", "F1"], tableRows,
      { highlight: D.mining.models.findIndex((d) => d.Model === bestName) });
    const base = D.mining.models.find((d) => d.Model.startsWith("Baseline"));
    const best = models[0];
    setNote("models", [{ b: best.Model }, ` scored best (macro F1 ${f4(best["F1 (macro)"])} vs. ${f4(base["F1 (macro)"])} for the baseline), but prediction is weak. Accuracy is not used to rank the models: the baseline had the highest accuracy (${f4(base.Accuracy)}) without finding a single student who spent above ₱100.`]);
  }

  function renderConfusionChips() {
    const box = q('[data-chips="confusion"]');
    box.textContent = "";
    D.mining.models.forEach((d) => {
      const name = d.Model.startsWith("Baseline") ? "Baseline" : d.Model;
      const b = htmlEl("button", { type: "button", class: "chip", "aria-pressed": String(d.Model === confusionModel) }, box, name);
      b.addEventListener("click", () => { confusionModel = d.Model; renderConfusionChips(); renderConfusion(); });
    });
  }

  function renderConfusion() {
    const box = chartBox("confusion");
    box.textContent = "";
    const rows = D.mining.confusion.filter((r) => r.Model === confusionModel);
    const cols = ["Predicted ₱100 and below", "Predicted Above ₱100"];
    const wrap = htmlEl("div", { class: "tbl-wrap" }, box);
    const t = htmlEl("table", { class: "tbl heat" }, wrap);
    const hr = htmlEl("tr", {}, htmlEl("thead", {}, t));
    htmlEl("th", { scope: "col" }, hr, "Actual tier");
    ["Predicted ₱100 and below", "Predicted above ₱100"].forEach((c) => htmlEl("th", { scope: "col", class: "cell" }, hr, c));
    const tb = htmlEl("tbody", {}, t);
    rows.forEach((r) => {
      const tr = htmlEl("tr", {}, tb);
      htmlEl("td", {}, tr, r.Actual);
      const total = cols.reduce((a, c) => a + r[c], 0);
      cols.forEach((c, i) => {
        const share = r[c] / total;
        const col = rampColor(share * 0.8);
        const td = htmlEl("td", { class: "cell", style: `background:${col.bg};color:${col.fg};padding:14px 10px` }, tr);
        const correct = (r.Actual === "₱100 and below") === (i === 0);
        tip(td, `${r[c]} students (${pct(share)})`, `Actual ${r.Actual}, predicted ${i === 0 ? "₱100 and below" : "above ₱100"} · ${correct ? "correct" : "wrong"}`);
        htmlEl("span", { class: "v" }, td, String(r[c]));
        htmlEl("span", { class: "c" }, td, `${pct(share)} of row`);
      });
    });
    const tier = D.mining.tiers.find((x) => x.Model === confusionModel && x.Tier === "Above ₱100");
    const loRow = rows.find((r) => r.Actual === "₱100 and below");
    const name = confusionModel.startsWith("Baseline") ? "The baseline" : `The ${confusionModel}`;
    if (tier.Correct === 0) {
      setNote("confusion", [name, " put every student in the ₱100-and-below tier, so it found ", { b: "none" },
        ` of the ${tier["Students in tier"]} students who spent above ₱100.`]);
    } else {
      setNote("confusion", [name, " found ", { b: `${tier.Correct} of the ${tier["Students in tier"]}` },
        ` students who spent above ₱100, but it also wrongly put ${loRow["Predicted Above ₱100"]} lower spenders in that tier. Only ${pct(tier.Precision)} of its "above ₱100" guesses were right.`]);
    }
  }

  function renderFeatures() {
    const box = chartBox("features");
    const f = D.mining.features;
    const W = boxWidth(box);
    const rowH = 66, barH = 12, valueW = 56;
    const H = f.length * rowH - 8;
    const pw = Math.min(W - valueW, 640);
    const max = Math.max(...f.map((d) => d.Importance));
    const svg = newSvg(box, W, H, "Bar chart of the top five feature importances");
    f.forEach((d, i) => {
      const y0 = i * rowH;
      const g = tip(svgEl("g", {}, svg), `Importance ${f4(d.Importance)}`, d.Direction);
      svgEl("rect", { x: 0, y: y0, width: W, height: rowH, fill: "transparent" }, g);
      svgEl("text", { x: 0, y: y0 + 13, "font-size": 13, "font-weight": i === 0 ? 600 : 400, fill: C.espresso }, g, d.Feature);
      const w = d.Importance / max * pw;
      svgEl("rect", { class: "mark", x: 0, y: y0 + 22, width: w, height: barH, fill: i === 0 ? C.pine : C.walnut }, g);
      svgEl("text", { x: w + 6, y: y0 + 22 + barH / 2, "dominant-baseline": "central", "font-size": 12.5,
        "font-weight": i === 0 ? 600 : 400, fill: C.espresso }, g, f4(d.Importance));
      svgEl("text", { x: 0, y: y0 + 50, "font-size": 12, fill: C.muted }, g, fitText(d.Direction, W, 12));
    });
    const total = f.reduce((a, d) => a + d.Importance, 0);
    setNote("features", [{ b: "Daily allowance" }, " was the most useful feature: only 7.27% of students with less than ₱100 a day spent above ₱100. The two reasons in the top five show no clear difference between the tiers. The top five together make up only ",
      { b: total.toFixed(2) }, " of the total importance, so no single feature decides spending."]);
  }
  function fitText(text, width, size) {
    if (textWidth(text, size) <= width) return text;
    let t = text;
    while (t.length > 10 && textWidth(t + "…", size) > width) t = t.slice(0, -1);
    return t.trimEnd() + "…";
  }

  // ---- Key findings (all 357; numbers taken from the data file) ----
  function renderFindings() {
    const all = D.rows, n = all.length;
    const mot = motiveStats(all).sort((a, b) => b.mean - a.mean);
    const items = itemCounts(all).sort((a, b) => b.count - a.count);
    const midday = all.filter((r) => r.time === D.orders.time[1] || r.time === D.orders.time[2]).length;
    const low = all.filter((r) => r.allowance === D.orders.allowance[0]);
    const high = all.filter((r) => r.allowance === D.orders.allowance[3]);
    const share = (rs) => pct(rs.filter((r) => r.amount > 100).length / rs.length);
    const top = D.mining.rules.slice().sort((a, b) => b.Lift - a.Lift)[0];
    const models = D.mining.models.slice().sort((a, b) => b["F1 (macro)"] - a["F1 (macro)"]);
    const base = D.mining.models.find((d) => d.Model.startsWith("Baseline"));
    const one = all.filter((r) => r.items.length === 1).length;
    const list = [
      [{ b: `${mot[0].label} and ${mot[1].label.toLowerCase()}` }, ` were the top reasons (means ${mot[0].mean.toFixed(2)} and ${mot[1].mean.toFixed(2)} of 4). "${mot[mot.length - 1].long}" ranked last (${mot[mot.length - 1].mean.toFixed(2)}), even though most students bought with friends.`],
      [{ b: `${items[0].label} (${pct(items[0].count / n)}) and ${items[1].label.toLowerCase()} (${pct(items[1].count / n)})` }, ` were bought most. Baskets were small: ${pct(one / n)} of students bought only one item category.`],
      ["The kiosks are busiest ", { b: "from 11 AM to 4 PM" }, `, when ${pct(midday / n)} of the purchases were made.`],
      ["Allowance matters most at the low end: ", { b: share(low) }, ` of students with less than ₱100 a day paid above ₱100, against ${share(high)} of students with ₱300 or more.`],
      [{ b: `${ruleName(top)}` }, ` is the strongest and only clearly reliable rule (lift ${top.Lift.toFixed(2)}): a ready-made bundle for the kiosks to try.`],
      [{ b: models[0].Model }, ` predicted the spending tier best (macro F1 ${f4(models[0]["F1 (macro)"])} vs. ${f4(base["F1 (macro)"])} for always guessing), but a student's profile and reasons only weakly predict how much they spend.`],
    ];
    const ol = q("#findings");
    ol.textContent = "";
    list.forEach((parts) => {
      const li = htmlEl("li", {}, ol);
      const p = htmlEl("p", {}, li);
      parts.forEach((part) => {
        if (typeof part === "string") p.appendChild(document.createTextNode(part));
        else htmlEl("strong", {}, p, part.b);
      });
    });
  }

  function fillMeta() {
    const map = { n: D.meta.n, raw: D.meta.rawResponses, removed: D.meta.removed, collected: D.meta.collected, place: D.meta.place };
    document.querySelectorAll("[data-meta]").forEach((s) => (s.textContent = String(map[s.dataset.meta])));
  }

  // ---- Tooltip (one for the whole page) ----
  function setupTooltip() {
    const box = q("#tooltip");
    const val = box.querySelector(".tooltip-value");
    const lab = box.querySelector(".tooltip-label");
    let current = null;
    function place(x, y) {
      const r = box.getBoundingClientRect();
      let left = x + 14, top = y + 14;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
      if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
      box.style.left = Math.max(8, left) + "px";
      box.style.top = Math.max(8, top) + "px";
    }
    document.addEventListener("pointermove", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-tv]") : null;
      if (!t) { if (current) { box.hidden = true; current = null; } return; }
      if (t !== current) {
        current = t;
        val.textContent = t.getAttribute("data-tv");
        lab.textContent = t.getAttribute("data-tl");
        box.hidden = false;
      }
      place(e.clientX, e.clientY);
    });
    document.addEventListener("pointerleave", () => { box.hidden = true; current = null; });
    window.addEventListener("scroll", () => { box.hidden = true; current = null; }, { passive: true });
  }

  // ---- Render ----
  function renderFiltered() {
    const rows = filtered();
    renderStatus(rows);
    renderKPIs(rows);
    renderItems(rows);
    renderSummary(rows);
    renderHist(rows);
    renderBox(rows);
    renderTime(rows);
    renderMotives(rows);
  }
  function renderFixed() {
    renderRules();
    renderModels();
    renderFeatures();
  }
  // tables wider than their card get a fade on the right edge until scrolled to the end
  function markScrollable() {
    document.querySelectorAll(".tbl-wrap").forEach((w) => {
      const check = () => w.classList.toggle("has-more", w.scrollLeft + w.clientWidth < w.scrollWidth - 2);
      if (!w.dataset.watch) { w.addEventListener("scroll", check, { passive: true }); w.dataset.watch = "1"; }
      check();
    });
  }

  function update() {
    refreshFilterOptions();
    renderFiltered();
    markScrollable();
    writeHash();
  }

  // filters are kept in the address (#year=...&college=...) so a filtered view can be shared
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    ["year", "college", "allowance"].forEach((k) => {
      const v = p.get(k);
      if (v && D.orders[k].includes(v)) state[k] = v;
    });
  }
  function writeHash() {
    const p = new URLSearchParams();
    ["year", "college", "allowance"].forEach((k) => { if (state[k]) p.set(k, state[k]); });
    const h = p.toString();
    if (h !== location.hash.slice(1)) history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  function init() {
    fillMeta();
    readHash();
    setupFilters();
    setupTooltip();
    renderMotiveLegend();
    renderRuleLegend();
    renderRuleTable();
    renderRuleTime();
    renderConfusionChips();
    renderConfusion();
    renderFindings();
    update();
    renderFixed();
    markScrollable();
    // redraw the SVG charts when the card width changes (phone rotation, window resize)
    let timer = null, lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(timer);
      timer = setTimeout(() => { renderFiltered(); renderFixed(); markScrollable(); }, 150);
    });
    // fonts change text widths; redraw once they are ready
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { renderFiltered(); renderFixed(); markScrollable(); });
  }

  init();
})();
