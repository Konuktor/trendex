// Workstream A extras for dynamic (Edge) cards: F23 precip trend, F14 spring-autumn level + snow.
// Mirrors backend/trendex_core/ext/{precip,seasons,snow}.py (static cards come from Python).
import { classOfScore, EXTRA_HOOKS, type Data, type Sel } from "./core.ts";
import { classify, trend1d } from "./stats.ts";

const T = {
  en: { growth: "Apr–Sep precipitation rose: {s} mm per decade (95% CI {lo} to {hi})",
        decline: "Apr–Sep precipitation fell: {s} mm per decade (95% CI {lo} to {hi})",
        unreliable: "No reliable trend in Apr–Sep precipitation ({s} mm per decade, 95% CI {lo} to {hi})",
        insufficient: "Not enough precipitation data",
        sa: "Spring–autumn (Apr, May, Sep, Oct): {lvl}",
        snow: "May snow cover: {pct}% of 8-day periods on average (more than on {p}% of pastures)" },
  ru: { growth: "Осадки апрель–сентябрь выросли: {s} мм за десятилетие (95% ДИ от {lo} до {hi})",
        decline: "Осадки апрель–сентябрь снизились: {s} мм за десятилетие (95% ДИ от {lo} до {hi})",
        unreliable: "Надёжного тренда осадков апрель–сентябрь нет ({s} мм за десятилетие, 95% ДИ от {lo} до {hi})",
        insufficient: "Недостаточно данных по осадкам",
        sa: "Весна–осень (апр, май, сен, окт): {lvl}",
        snow: "Снег в мае: в среднем {pct}% восьмидневных периодов (больше, чем на {p}% пастбищ)" },
} as Record<string, Record<string, string>>;
const sg = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(0);
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_m, k) => v[k] ?? "");

export function registerAExtras(d: Data) {
  const P = d.f["precip_S"] as Int16Array | undefined;
  const meta = d.h.extra?.precip_S;
  if (P && meta) {
    EXTRA_HOOKS.push((d: Data, _sel: Sel, ctx: any) => {
      const p: number[] = ctx.pasture;
      if (!p.length) return null;
      const vals: number[] = [];
      for (let y = 0; y < d.Y; y++) {
        let s = 0, c = 0;
        for (const i of p) { const v = P[i * d.Y + y]; if (v !== meta.nan) { s += v * meta.scale; c++; } }
        vals.push(c >= Math.max(1, 0.5 * p.length) && c > 0 ? s / c : NaN);
      }
      const r = trend1d(vals, d.years, d.cfg.trend.method);
      const cls = classify(r.slope, r.p, r.n, d.cfg.trend.alpha, d.cfg.min_valid_years);
      const lang = ctx.lang === "ru" ? "ru" : "en";
      const s = r.slope * 10, lo = r.ci_lo * 10, hi = r.ci_hi * 10;
      return ["precip", { slope_per_decade: s, ci95: [lo, hi], p_value: r.p, class: cls, unit: "mm per decade (Apr–Sep total)",
        text: Number.isFinite(s) ? fill(T[lang][cls], { s: sg(s), lo: sg(lo), hi: sg(hi) }) : T[lang].insufficient,
        series: vals.map((v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null)) }];
    });
  }
  if (d.f["score_sa"]) {
    EXTRA_HOOKS.push((d: Data, _sel: Sel, ctx: any) => {
      const p: number[] = ctx.pasture;
      if (!p.length) return null;
      let s = 0, c = 0;
      for (const i of p) { const v = d.f.score_sa[i]; if (Number.isFinite(v)) { s += v; c++; } }
      const score = c ? s / c : NaN;
      const lvl = classOfScore(score, d.cfg.level_thresholds);
      const lang = ctx.lang === "ru" ? "ru" : "en";
      const label = lvl ? d.texts[lang].labels.level[lvl] : null;
      return ["season_variant", { season: "spring_autumn", months: d.cfg.spring_autumn_months, score: Math.round(score * 10) / 10,
        level_class: lvl, level_label: label, text: fill(T[lang].sa, { lvl: (label ?? "—").toLowerCase() }) }];
    });
  }
  if (d.f["snow_may"]) {
    EXTRA_HOOKS.push((d: Data, _sel: Sel, ctx: any) => {
      const p: number[] = ctx.pasture;
      if (!p.length) return null;
      let s = 0, c = 0, sp = 0, cp = 0;
      for (const i of p) {
        const v = d.f.snow_may[i], q = d.f.snow_may_pct[i];
        if (Number.isFinite(v)) { s += v; c++; }
        if (Number.isFinite(q)) { sp += q; cp++; }
      }
      const may = c ? s / c : NaN, pp = cp ? sp / cp : NaN;
      const lang = ctx.lang === "ru" ? "ru" : "en";
      return ["snow", { may_share: may, percentile: Number.isFinite(pp) ? Math.round(1000 * pp) / 10 : null,
        text: fill(T[lang].snow, { pct: (100 * may).toFixed(0), p: (100 * pp).toFixed(0) }) }];
    });
  }
}
