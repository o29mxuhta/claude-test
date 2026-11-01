// Data regression test for the 2026-06-02 Home Front Command shelter-time
// lengthening (60s -> 90s) in the north. Locks web/cities.json:
//  - the 157 alert zones individually verified against the official IDF/HFC
//    161-locality list (https://www.idf.il/media/j1xlicjw/____________________12.pdf)
//    must have countdown === 90;
//  - the 15 adjacent infrastructure zones NOT explicitly named in that list
//    were set to 90 by the site owner's 2026-11-01 decision relying on the
//    newer secondary source (eladnava/pikud-haoref-api cities.json @9b4ec62,
//    which lists all 15 at 90); they are still NOT verified against the
//    official document, and this list locks that secondary-source value;
//  - entry count and required schema fields stay intact (no zone added,
//    removed, or otherwise edited by the countdown update).
// Run: node tests/cities-countdown.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

var VERIFIED_90 = [
  "אורנים",
  "אושה",
  "אחוזת ברק",
  "איבטין",
  "אילניה",
  "אכסאל",
  "אלוני אבא",
  "אלונים",
  "אפק",
  "בית אורן",
  "בית אלפא וחפציבה",
  "בית השיטה",
  "בית יוסף",
  "בית לחם הגלילית",
  "בית צבי",
  "בית קשת",
  "בית רימון",
  "בית שאן",
  "בית שערים",
  "בלפוריה",
  "בסמת טבעון",
  "בת שלמה",
  "גבע כרמל",
  "גבעת אלה",
  "גבת",
  "גדעונה",
  "גזית",
  "גן נר",
  "גניגר",
  "גשר",
  "דבוריה",
  "דברת",
  "דור, נחשולים",
  "דחי",
  "דלית אל כרמל",
  "הבונים",
  "הושעיה",
  "החותרים",
  "היוגב",
  "הסוללים",
  "זרזיר",
  "חג'אג'רה",
  "חיפה - בת גלים ק.אליעזר",
  "חיפה - כרמל, הדר ועיר תחתית",
  "חיפה - מערב",
  "חיפה - מפרץ",
  "חיפה - נווה שאנן ורמות כרמל",
  "חיפה - קריית חיים ושמואל",
  "חמדיה",
  "טייבה בגלבוע",
  "טירת כרמל",
  "טירת צבי",
  "טמרה בגלבוע",
  "יגור",
  "יזרעאל",
  "יפיע",
  "יפעת",
  "ירדנה",
  "ישובי אומן",
  "ישובי יעל",
  "כדורי",
  "כעביה טבאש",
  "כפר ביאליק",
  "כפר ברוך",
  "כפר גדעון",
  "כפר גלים",
  "כפר החורש",
  "כפר המכבי",
  "כפר ח'וואלד",
  "כפר חסידים",
  "כפר יהושע",
  "כפר יחזקאל",
  "כפר כנא",
  "כפר מצר",
  "כפר קיש",
  "כפר רופין",
  "כפר תבור",
  "כפר תקווה",
  "כרם מהר'ל",
  "מאיר שפיה",
  "מגדים",
  "מגדל העמק",
  "מגן שאול",
  "מולדת",
  "מוקיבלה",
  "מזרע",
  "מירב",
  "מנשית זבדה",
  "מסילות",
  "מעוז חיים",
  "מעלה גלבוע",
  "מרחביה מושב",
  "מרחביה קיבוץ",
  "מרכז חבר",
  "משהד",
  "נאעורה",
  "נהלל",
  "נוה איתן",
  "נווה אור",
  "נווה ים",
  "נוף הגליל",
  "נופית",
  "נורית",
  "נין",
  "ניר דוד",
  "ניר עציון, ימין אורד",
  "נצרת",
  "נשר",
  "סולם",
  "סנדלה",
  "עוזייר, רומאנה",
  "עופר",
  "עילוט",
  "עין איילה",
  "עין דור",
  "עין הוד",
  "עין הנצי'ב",
  "עין חוד",
  "עין חרוד, תל יוסף",
  "עין כרמל",
  "עין מאהל",
  "עספיא",
  "עפולה",
  "עתלית",
  "פוריידיס",
  "ציפורי",
  "צרופה",
  "קבוצת גבע",
  "קריית אתא",
  "קריית ביאליק",
  "קריית טבעון - בית זייד",
  "קריית ים",
  "קריית מוצקין",
  "ראס עלי",
  "רוויה",
  "רומת אל הייב",
  "רחוב",
  "ריינה",
  "רכסים",
  "רם און",
  "רמת דוד",
  "רמת יוחנן",
  "רמת ישי",
  "רמת צבי",
  "רשפים, שלוחות, שלפים",
  "שדה אליהו",
  "שדה יעקב",
  "שדה נחום",
  "שדי תרומות",
  "שדמות דבורה",
  "שיבלי אום אלג'נם",
  "שמשית",
  "שער העמקים",
  "שריד",
  "תל עדשים",
  "תל תאומים",
  "תמרת"
];

var SECONDARY_90 = [
  "אזור תעשייה אלון התבור",
  "אזור תעשייה מבואות הגלבוע",
  "אזור תעשייה ניר עציון",
  "אזור תעשייה ציפורית",
  "אזור תעשייה קריית ביאליק",
  "אזור תעשייה שער נעמן",
  "בית סוהר קישון",
  "בית עלמין תל רגב",
  "גבעת וולפסון",
  "גני חוגה",
  "כפר גמילה מלכישוע",
  "מרכז מיר'ב",
  "מתחם סקי גלבוע",
  "תחנת רכבת כפר ברוך",
  "תחנת רכבת כפר יהושוע"
];

var cities = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'cities.json'), 'utf8'));
assert(Array.isArray(cities), 'cities.json parses as a JSON array');
assert(cities.length === 1451, 'entry count stays 1451, got ' + cities.length);

var byValue = {};
cities.forEach(function(c) {
  assert(typeof c.value === 'string' && c.value.length > 0, 'entry has non-empty value');
  assert(typeof c.zone === 'string', c.value + ': has zone field');
  assert(typeof c.countdown === 'number', c.value + ': countdown is numeric');
  assert(typeof c.lat === 'number' && typeof c.lng === 'number', c.value + ': has coordinates');
  byValue[c.value] = c;
});

VERIFIED_90.forEach(function(name) {
  var c = byValue[name];
  assert(c, 'verified zone present: ' + name);
  if (c) assert(c.countdown === 90, name + ': countdown is 90, got ' + c.countdown);
});

SECONDARY_90.forEach(function(name) {
  var c = byValue[name];
  assert(c, 'secondary-source zone present: ' + name);
  if (c) assert(c.countdown === 90, name + ': 90 per secondary source (not officially verified), got ' + c.countdown);
});

if (failed) { console.error(failed + ' failed, ' + passed + ' passed'); process.exit(1); }
console.log('cities-countdown: ' + passed + ' checks passed');
