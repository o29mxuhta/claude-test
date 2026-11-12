// Neighbouring-country borders: the layer built by customizeBasemapLayers is dashed,
// thin, never Israel's own border, has no disputed outlines, and is really appended
// to the rendered style. Runs the real function, not a text match.
// Run: node tests/foreign-borders.test.js
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; } else { failed++; console.error('  FAIL: ' + m); } }
var html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

var scaleStart = html.indexOf('function scaleWidthExpr(');
var scaleEnd = html.indexOf('\n  }', scaleStart) + 4;
var start = html.indexOf('function customizeBasemapLayers(');
var end = html.indexOf('function buildMapStyle(', start);
assert(scaleStart !== -1 && start !== -1 && end !== -1, 'found the layer-building code');

var sandbox = { console: console, JSON: JSON, basemaps: { themes: { light: {}, black: {} } }, FOCUS_GEOJSON: { type: 'FeatureCollection', features: [] } };
vm.createContext(sandbox);
vm.runInContext(html.slice(scaleStart, scaleEnd) + '\n' + html.slice(start, end) +
  '\nthis.customizeBasemapLayers = customizeBasemapLayers;', sandbox);

var input = [
  { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth', paint: { 'fill-color': '#000' } },
  { id: 'boundaries_country', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
    paint: { 'line-color': '#999', 'line-width': 1 } }
];
var flavor = { earth: '#111111' };

// Minimal evaluator for the filter expressions the layer uses.
function evalFilter(f, props) {
  var op = f[0];
  if (op === 'all') return f.slice(1).every(function (x) { return evalFilter(x, props); });
  if (op === 'any') return f.slice(1).some(function (x) { return evalFilter(x, props); });
  if (op === '<=') return props[f[1]] <= f[2];
  if (op === '==') return props[f[1]] === f[2];
  if (op === '!=') return props[f[1]] !== f[2];
  throw new Error('unsupported filter op ' + op);
}

[true, false].forEach(function (isDark) {
  var out = sandbox.customizeBasemapLayers(JSON.parse(JSON.stringify(input)), isDark, flavor);
  var tag = isDark ? 'dark' : 'light';
  var foreign = out.filter(function (l) { return l.id === 'boundaries_foreign'; })[0];
  var israel = out.filter(function (l) { return l.id === 'boundaries_country'; })[0];
  assert(!!foreign, tag + ': boundaries_foreign is in the rendered layer list');
  assert(!!israel, tag + ': Israel border layer still rendered');
  if (!foreign || !israel) return;
  assert(out.indexOf(foreign) < out.indexOf(israel), tag + ': foreign borders drawn under Israel border');
  assert(foreign.type === 'line' && foreign.source === 'protomaps' && foreign['source-layer'] === 'boundaries',
    tag + ': uses the basemap boundaries source layer');
  assert(JSON.stringify(foreign.paint['line-dasharray']) === '[4,3]', tag + ': dashed');
  assert(foreign.paint['line-width'] < israel.paint['line-width'], tag + ': thinner than Israel border');
  var f = foreign.filter;
  assert(evalFilter(f, { kind_detail: 2, adm0_l: 'JOR', adm0_r: 'SYR' }) === true, tag + ': Jordan/Syria border shown');
  assert(evalFilter(f, { kind_detail: 2, adm0_l: 'ISR', adm0_r: 'JOR' }) === false, tag + ': Israel/Jordan border not duplicated');
  assert(evalFilter(f, { kind_detail: 2, adm0_l: 'EGY', adm0_r: 'ISR' }) === false, tag + ': Egypt/Israel border not duplicated');
  assert(evalFilter(f, { kind_detail: 2, disputed: true, adm0_l: 'JOR', adm0_r: 'PSE' }) === false, tag + ': disputed outline hidden');
  assert(evalFilter(f, { kind_detail: 4, adm0_l: 'JOR', adm0_r: 'JOR' }) === false, tag + ': sub-national lines hidden');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
