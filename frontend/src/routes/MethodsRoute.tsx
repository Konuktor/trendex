import { useEffect, useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
import { useApp } from '../store';
import { runChecks } from '../lib/checks';
import { NOT_ACCOUNTED } from '../lib/labels';
import { dataInfo } from '../data/info';
import { CELL_KM, COLS, DLAT, DLON, ROWS } from '../lib/geo';

const ALL_SECTIONS = [
  { id: 'measure', title: 'What we measure' },
  { id: 'answer', title: 'How the answer is built' },
  { id: 'formula', title: 'The formula' },
  { id: 'checks', title: 'Checks' },
  { id: 'sources', title: 'Data sources and versions' },
  { id: 'limits', title: 'What this does not know' },
  { id: 'ai', title: 'AI use disclosure' },
] as const;

/** Labels for meta.sources keys (Central Asia sources table). */
const SOURCE_LABEL: Record<string, string> = {
  ndvi: 'Greenness (NDVI)',
  landCover: 'Land cover',
  precip: 'Precipitation',
  dem: 'Elevation',
  boundaries: 'Boundaries',
  note: 'Note',
};

const flowReal = (km: number): { title: string; body: string }[] => [
  { title: 'Summer greenness', body: `NASA MODIS MOD13A3 monthly NDVI (1 km): the mean of clear May–September months, each year 2000–2025, averaged over the pasture part of each ${km} km cell.` },
  { title: 'Pasture mask', body: `Remove water, snow and ice, built-up land, cropland and forest (MODIS MCD12Q1, 2020) and slopes steeper than 35° (NASADEM). A ${km} km cell counts as pasture when the remaining land covers at least half of it.` },
  { title: 'Clear seasons', body: 'Count the summers with at least 3 clear months. Fewer than 16 of 26 means no trend.' },
  { title: 'Level and trend', body: 'Level: a score from greenness, year-to-year stability, green-season length and gentle terrain, ranked among all pastures here. Trend: Theil–Sen slope in % per year with a Mann–Kendall test, corrected for autocorrelation and for testing many cells at once.' },
  { title: 'Confidence', body: 'High, medium or low from the number of clear summers, whether the trend is reliable, and whether the level holds under other weightings.' },
  { title: 'Zones and outlines', body: 'Neighbouring cells of the same class form a zone. A drawn outline averages the cells inside it.' },
  { title: 'Answer card', body: 'Level, trend, confidence, the reasons, this season, better areas nearby and a suggested next step.' },
];

const FLOW: { title: string; body: string }[] = [
  { title: 'Peak-season greenness', body: 'MODIS NDVI, maximum of clear June–August observations, each year 2000–2025.' },
  { title: 'Pasture mask', body: 'Keep cells where grassland covers at least half the ground. Remove water, settlements, cropland, glaciers and bare rock.' },
  { title: 'Clear seasons', body: 'Count the years with enough cloud- and snow-free observations. Fewer than 10 means no level; fewer than 16 means no trend.' },
  { title: 'Level and trend', body: 'Level: percentile among all pastures in the oblast. Trend: slope in % per year with a significance test.' },
  { title: 'Confidence', body: 'High, medium or low from the number of clear seasons, whether the trend is reliable, and the size of the area.' },
  { title: 'Zones and outlines', body: 'Neighbouring cells of the same class form a zone. A drawn outline averages the cells inside it.' },
  { title: 'Answer card', body: 'Level, trend, confidence, the reasons, this season, better areas nearby and a suggested next step.' },
];

/** Scroll only the page's own scroll container, so the top bar stays in place. */
function jump(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  const el = document.getElementById(id);
  const main = el?.closest('main');
  if (!el || !main) return;
  e.preventDefault();
  const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 32;
  main.scrollTo({ top, behavior: 'smooth' });
  history.replaceState(null, '', `#${id}`);
  el.focus({ preventScroll: true });
}

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  title = `${n}. ${title}`;
  return (
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-h`} className="flex scroll-mt-8 flex-col gap-3 focus:outline-none">
      <h2 id={`${id}-h`} className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function MethodsRoute() {
  const data = useApp((s) => s.data);
  const real = useApp((s) => s.real);
  const load = useApp((s) => s.load);
  const dataset = useApp((s) => s.dataset);
  const meta = useApp((s) => s.meta);
  useEffect(() => {
    void load();
  }, [load]);
  // The checks are known Naryn places; there are none for Central Asia yet.
  const naryn = dataset === 'naryn';
  const checks = useMemo(() => (data && naryn ? runChecks(data) : null), [data, naryn]);
  const mismatches = checks?.filter((c) => !c.match).length ?? 0;
  const SECTIONS = ALL_SECTIONS.filter((x) => naryn || x.id !== 'checks');
  /** Section numbers by position, so hiding Checks keeps them in order. */
  const no = (id: string) => SECTIONS.findIndex((x) => x.id === id) + 1;
  // Central Asia uses the production method; its sample export only stands in for the real numbers.
  const method = real || !naryn;
  const km = Math.round(CELL_KM);
  const title = meta?.title ?? (naryn ? 'Naryn oblast' : 'Central Asia');
  const area = naryn ? 'Naryn oblast and the Suusamyr valley' : title;
  const FLOW_REAL = flowReal(km);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto flex max-w-[1080px] gap-12 px-4 py-6 md:px-8 md:py-8">
        <nav aria-label="On this page" className="sticky top-0 hidden w-[200px] flex-none self-start pt-14 lg:block">
          <h2 className="label-caps mb-2">On this page</h2>
          <ol className="flex flex-col gap-0.5">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} onClick={(e) => jump(e, s.id)} className="block rounded px-2 py-1 text-sm text-text-2 transition-colors hover:bg-panel hover:text-text">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="flex min-w-0 max-w-prose flex-1 flex-col gap-10 text-base leading-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold">Methods & limits</h1>
            <p className="text-md text-text-2">
              How TrendeX turns satellite records into a plain answer{naryn ? ', how it was checked, and ' : ' and '}what it cannot see.{' '}
              {real
                ? 'Figures come from NASA satellite records, 2000–2025.'
                : naryn
                  ? 'All pasture figures in this pilot are sample data.'
                  : `All pasture figures for ${title} are sample data for now; the method below is the one the real figures use.`}
            </p>
          </header>

          <Section id="measure" n={no('measure')} title="What we measure">
            {method ? (
              <p>
                For each pasture area TrendeX reads one number per year: summer greenness, the mean normalised
                difference vegetation index (NDVI) of clear May–September months from NASA MODIS (MOD13A3, 1 km).
                NDVI rises with the amount of green, living plant cover. Over 26 summers (2000–2025) it shows how much
                green cover a pasture tends to carry and which way that has moved.
              </p>
            ) : (
              <p>
                For each pasture area TrendeX reads one number per year: peak-season greenness, the highest
                normalised difference vegetation index (NDVI) seen in clear June–August observations. NDVI rises with the
                amount of green, living plant cover. Over 26 seasons (2000–2025) it shows how much green cover a
                pasture tends to carry and which way that has moved.
              </p>
            )}
            <p>
              Greenness is not forage quality, biomass or species mix. A pasture can stay green while the plants
              animals prefer are replaced by ones they avoid. TrendeX points to where a field check is worth the trip;
              it does not replace one.
            </p>
            <p>
              The analysis grid is {COLS} × {ROWS} cells of about {km} × {km} km. Cells are a calculation unit only; the map shows
              smoothed zones.
            </p>
          </Section>

          <Section id="answer" n={no('answer')} title="How the answer is built">
            <ol className="flex flex-col items-stretch" aria-label="Steps from satellite record to answer">
              {(method ? FLOW_REAL : FLOW).map((f, i) => (
                <li key={f.title} className="flex flex-col items-center">
                  <div className="card w-full p-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-text-2">{i + 1}</span>
                      <h3 className="text-sm font-semibold">{f.title}</h3>
                    </div>
                    <p className="mt-1 text-sm text-text-2">{f.body}</p>
                  </div>
                  {i < (method ? FLOW_REAL : FLOW).length - 1 && <ArrowDown size={16} strokeWidth={1.5} className="my-1 text-text-3" aria-hidden="true" />}
                </li>
              ))}
            </ol>
          </Section>

          <Section id="formula" n={no('formula')} title="The formula">
            <h3 className="text-md font-semibold">Level</h3>
            {method ? (
              <p>
                Every 1 km pasture square gets a score from four parts, each ranked against all pastures in {title}:
                summer greenness (weight 0.4), year-to-year stability (0.2), green-season length (0.2) and
                gentle terrain (0.2). A cell’s level is the mean score of its pasture, ranked against every other
                pasture cell in {area} and split into thirds: low, moderate and good.
                Level is always relative to other pastures here, never an absolute standard.
              </p>
            ) : (
              <p>
                The mean peak-season greenness of each pasture cell is ranked against every other pasture cell in {area}.
                The percentile is split into thirds: low, moderate and good. Level is
                always relative to other pastures here, never an absolute standard.
              </p>
            )}
            <h3 className="text-md font-semibold">Trend</h3>
            <p>
              The trend is the Theil–Sen slope of the 26 yearly values, expressed in % of the area’s mean per year.
              A trend is <b className="font-semibold">reliable</b> when the Mann–Kendall test gives p &lt; 0.05 and at
              least 16 of 26 seasons were clear{method ? ' (on this record the test is corrected for autocorrelation by the Hamed–Rao method and for testing every cell at once by the Benjamini–Hochberg false discovery rate, q < 0.05)' : ''}. Otherwise it is <b className="font-semibold">not reliable</b>. A
              slope of −1.1% per year or steeper (or +1.1% or steeper) is shown in the darker colour.
            </p>
            <p className="rounded-lg border border-border-strong bg-panel p-3 text-sm">
              {method
                ? 'Cell trends come from the TrendeX pipeline (Theil–Sen with Mann–Kendall, as above). For a drawn outline or a district average this page fits an ordinary least-squares line with a 95% interval to the averaged series, which behaves like Theil–Sen on smooth series.'
                : 'In this pilot the series are sample data, and the slope and its 95% interval come from an ordinary least-squares fit, which behaves like Theil–Sen on smooth series. The production pipeline uses Theil–Sen with Mann–Kendall as described above.'}
            </p>
            <h3 className="text-md font-semibold">Confidence</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li><b className="font-medium">Low</b>: fewer than 16 of 26 clear seasons.</li>
              <li><b className="font-medium">High</b>: a reliable trend and more than about 20 of 26 clear seasons{method ? ', and a level that does not change under other weightings' : ''}.</li>
              <li><b className="font-medium">Medium</b>: everything else.</li>
              <li>A drawn outline that covers fewer than 3 cells drops one step, because the interval is wide.</li>
            </ul>
            <h3 className="text-md font-semibold">Zones and drawn outlines</h3>
            <p>
              Clicking the map selects a zone: cells of the same class that touch the clicked cell, within 2.3 cells
              of it. The zone answer uses the majority level and trend and the mean slope. A drawn outline instead
              averages the yearly values of every cell whose centre falls inside it and fits one slope to that average.
            </p>
          </Section>

          {naryn && <Section id="checks" n={no('checks')} title="Checks">
            <p>
              {real
                ? 'Known places compared with what the map says. Expectations are illustrative; field notes from district pasture committees will replace them. Mismatches are kept visible rather than tuned away.'
                : 'Known places compared with what the map says. Expectations here are illustrative for the sample data; the real checks will use field notes from district pasture committees.'}
            </p>
            {checks ? (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <caption className="sr-only-label">Known places, expected versus observed</caption>
                  <thead className="border-b border-hairline bg-surface text-left text-xs text-text-2">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Place</th>
                      <th scope="col" className="px-3 py-2 font-medium">Expected</th>
                      <th scope="col" className="px-3 py-2 font-medium">Observed</th>
                      <th scope="col" className="px-3 py-2 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((c) => (
                      <tr key={c.place} className={`border-b border-hairline last:border-0 ${c.match ? '' : 'bg-panel'}`}>
                        <td className="px-3 py-2 align-top">{c.place}</td>
                        <td className="px-3 py-2 align-top">{c.expected}</td>
                        <td className="px-3 py-2 align-top text-text-2">{c.observed}</td>
                        <td className="px-3 py-2 align-top">{c.match ? 'Match' : <b className="font-semibold">Mismatch</b>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-48 animate-pulse rounded-lg bg-panel" aria-busy="true" />
            )}
            {checks && (
              <p className="text-sm text-text-2">
                {checks.length - mismatches} of {checks.length} match.{' '}
                {mismatches > 0 && !real &&
                  'A mismatch is kept visible rather than tuned away: near Suusamyr village the year-to-year swings are larger than the slope, so the record shows no reliable direction even though the valley floor next to it does.'}
              </p>
            )}
          </Section>}

          <Section id="sources" n={no('sources')} title="Data sources and versions">
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only-label">Data sources and versions</caption>
                <thead className="border-b border-hairline bg-surface text-left text-xs text-text-2">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Source</th>
                    <th scope="col" className="px-3 py-2 font-medium">Version</th>
                    <th scope="col" className="px-3 py-2 font-medium">Used for</th>
                  </tr>
                </thead>
                <tbody>
                  {(!naryn
                    ? [
                        ...Object.entries(meta?.sources ?? {}).map(([k, v]) => [SOURCE_LABEL[k] ?? k, v, k === 'note' ? 'Data status' : 'Central Asia export']),
                        ['TrendeX pipeline', dataInfo.pipelineVersion, `Analysis grid of ${DLON}° × ${DLAT}° cells`],
                      ]
                    : real
                    ? [
                        ['NASA MODIS MOD13A3', 'v061, 1 km, monthly (LP DAAC)', 'Summer NDVI and clear-season counts'],
                        ['NASA MODIS MCD12Q1', 'v061, IGBP LC_Type1, 2020', 'Pasture mask: water, snow and ice, built-up, cropland, forest; land-cover shares'],
                        ['NASADEM', '30 m (LP DAAC)', 'Slope: terrain part of the level and the steep-slope mask'],
                        ['NASA GPM IMERG', 'Final V07, monthly (GES DISC)', 'Precipitation context in the TrendeX data cube'],
                        ['geoBoundaries', 'gbOpen KGZ ADM2', 'The 5 official Naryn districts and the oblast outline'],
                        ['TrendeX pipeline', dataInfo.pipelineVersion, 'Everything above, joined on the 0.12° × 0.09° grid. Data cube: huggingface.co/datasets/TrendeX90/naryn-cube'],
                      ]
                    : [
                    ['MODIS MOD13Q1', 'Collection 6.1, 250 m, 16-day', 'Peak-season NDVI and clear-season counts'],
                    ['ESA WorldCover', 'v200 (2021), 10 m', 'Pasture mask: grassland share, cropland, settlement, water, bare'],
                    ['CHIRPS', 'v2.0, daily', 'Weather-year context for unusual seasons'],
                    ['Copernicus DEM', 'GLO-30', 'Elevation, glacier and bare-rock screening, hillshade context'],
                    ['geoBoundaries', 'gbOpen KGZ ADM1 / ADM2', 'Oblast and district boundaries'],
                    ['TrendeX pipeline', '0.1.0 (sample data)', 'Everything above, joined on the 0.12° × 0.09° grid'],
                  ]).map(([a, b, c]) => (
                    <tr key={a} className="border-b border-hairline last:border-0">
                      <td className="px-3 py-2 align-top font-medium">{a}</td>
                      <td className="px-3 py-2 align-top">{b}</td>
                      <td className="px-3 py-2 align-top text-text-2">{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-text-2">
              Basemap © OpenStreetMap contributors, CARTO or Esri; terrain Esri World Hillshade.
            </p>
          </Section>

          <Section id="limits" n={no('limits')} title="What this does not know">
            <p>{NOT_ACCOUNTED}.</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>Why greenness changed. A decline can follow heavier grazing, drier years, a change in species or a mapping error; the record alone cannot tell them apart.</li>
              <li>Anything smaller than about {km} km. A cell can average a worn spring area with a healthy slope.</li>
              <li>Forage quality and plant species. Green cover is not the same as good feed.</li>
              <li>Seasons hidden by snow or cloud. Fewer clear seasons means less certainty, and the card says so.</li>
              <li>What is permitted or agreed locally. TrendeX ranks places for a look; decisions stay with the people who manage the pastures.</li>
            </ul>
          </Section>

          <Section id="ai" n={no('ai')} title="AI use disclosure">
            <p>
              {method ? 'This interface and the data pipeline were' : 'This interface and its sample data generator were'} written with the help of an AI coding assistant
              (Claude), working from a written specification and a reviewed prototype. Every answer on the map is
              produced by fixed, documented rules in the code; no language model runs when you use TrendeX, and no
              AI model decides which areas are ranked or flagged.
            </p>
          </Section>
        </article>
      </div>
    </main>
  );
}
