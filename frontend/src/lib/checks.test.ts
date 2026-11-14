import { runChecks } from './checks';
import { fixture } from '../test/fixtures';

it('checks known places against the sample data', () => {
  const r = runChecks(fixture().data);
  const by = Object.fromEntries(r.map((x) => [x.place, x]));
  expect(by['Kochkor village'].match).toBe(true);
  expect(by['Lake Son-Kul'].match).toBe(true);
  expect(by['Suusamyr valley floor'].match).toBe(true);
  expect(by['Ak-Sai valley'].match).toBe(true);
  // A real disagreement in the sample data, kept visible on purpose.
  expect(by['Suusamyr village surroundings'].match).toBe(false);
});
