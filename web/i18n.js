/* Redmap UI translations: switches the whole interface (menus, buttons, messages,
   alerts, timeline, About page) between Hebrew (default), English, Arabic and Russian.
   Hebrew source strings stay untouched in the code and in all logic/data paths;
   this file only changes what is RENDERED when a non-Hebrew language is selected.
   Alert classification and API matching keep working on the original Hebrew values.
   Unknown future alert text from the API is always shown as-is (Hebrew) - safety
   information is never hidden. */
(function () {
  var LANG = (function () {
    try {
      var l = localStorage.getItem('oref-map-lang');
      return (l === 'en' || l === 'ru') ? l : 'he';
    } catch (e) { return 'he'; }
  })();
  var RTL = (LANG === 'he' || LANG === 'ar');
  document.documentElement.lang = LANG;
  document.documentElement.dir = RTL ? 'rtl' : 'ltr';

  window.__i18nScan = function () { return []; };
  if (LANG === 'he') return; // Hebrew is the source language: nothing to do.

  var LANG_IDX = { en: 0, ru: 1 }[LANG];
  var RAW = {
 "התרעות פיקוד העורף בזמן אמת": [
  "Home Front Command alerts in real time",
  "Оповещения Командования тыла в реальном времени"
 ],
 "⚠️ נא להסתמך על אמצעי ההתרעה הרשמיים בלבד": [
  "⚠️ Please rely only on the official alert channels",
  "⚠️ Полагайтесь только на официальные средства оповещения"
 ],
 "מתחבר...": [
  "Connecting...",
  "Подключение..."
 ],
 "בעיית תקשורת לפיקוד העורף. מנסה שוב...": [
  "Connection problem with the Home Front Command. Retrying...",
  "Проблема связи с Командованием тыла. Повторная попытка..."
 ],
 "תקלה בטעינת התרעות קודמות. מנסה שוב...": [
  "Failed to load previous alerts. Retrying...",
  "Не удалось загрузить предыдущие оповещения. Повторная попытка..."
 ],
 "אירעה שגיאה בטעינת נתונים גאוגרפיים": [
  "An error occurred while loading geographic data",
  "Произошла ошибка при загрузке географических данных"
 ],
 "תפריט": [
  "Menu",
  "Меню"
 ],
 "חיפוש יישוב...": [
  "Search for a locality...",
  "Поиск населённого пункта..."
 ],
 "חפש יישוב...": [
  "Search for a locality...",
  "Поиск населённого пункта..."
 ],
 "הראה אותי": [
  "Show me",
  "Показать меня"
 ],
 "מצב נהיגה": [
  "Driving mode",
  "Режим вождения"
 ],
 "זום אוטומטי": [
  "Auto zoom",
  "Автомасштаб"
 ],
 "מנע כיבוי מסך": [
  "Keep screen on",
  "Не выключать экран"
 ],
 "ערכת נושא": [
  "Theme",
  "Тема"
 ],
 "בהיר": [
  "Light",
  "Светлая"
 ],
 "כהה": [
  "Dark",
  "Тёмная"
 ],
 "אוטומטי": [
  "Auto",
  "Авто"
 ],
 "שתף חברים": [
  "Share with friends",
  "Поделиться с друзьями"
 ],
 "אודות": [
  "About",
  "О проекте"
 ],
 "הצג זמני התגוננות": [
  "Show time to reach shelter",
  "Показать время на укрытие"
 ],
 "מפת חום (24 שעות)": [
  "Heatmap (24 hours)",
  "Тепловая карта (24 часа)"
 ],
 "ב-24 השעות האחרונות": [
  "In the last 24 hours",
  "За последние 24 часа"
 ],
 "אזור ניסיוני": [
  "Experimental zone",
  "Экспериментальная зона"
 ],
 "מצב שקט": [
  "Silent mode",
  "Бесшумный режим"
 ],
 "בחר מיקום לקבלת התרעות קוליות:": [
  "Choose a location for sound alerts:",
  "Выберите место для звуковых оповещений:"
 ],
 "כל הארץ": [
  "Whole country",
  "Вся страна"
 ],
 "כלי מפתחים": [
  "Developer tools",
  "Инструменты разработчика"
 ],
 "אליפסה": [
  "Ellipse",
  "Эллипс"
 ],
 "כיוון שיגור": [
  "Launch direction",
  "Направление запуска"
 ],
 "לחצו על המפה לצפייה בהיסטוריית התרעות": [
  "Click the map to view alert history",
  "Нажмите на карту, чтобы увидеть историю оповещений"
 ],
 "מציג מוקדי נפילות מהיממה האחרונה": [
  "Showing impact sites from the last 24 hours",
  "Показаны точки падений за последние сутки"
 ],
 "המסך לא יכבה במצב נהיגה": [
  "The screen will stay on in driving mode",
  "Экран не будет выключаться в режиме вождения"
 ],
 "צליל מופעל": [
  "Sound on",
  "Звук включён"
 ],
 "איפוס תצוגה": [
  "Reset view",
  "Сброс вида"
 ],
 "מצב לילה/יום": [
  "Night/Day mode",
  "Ночной/дневной режим"
 ],
 "מפת התגוננות": [
  "Shelter Times Map",
  "Карта времени укрытия"
 ],
 "מקרא": [
  "Legend",
  "Легенда"
 ],
 "ירי רקטות וטילים": [
  "Rocket and missile fire",
  "Ракетный обстрел"
 ],
 "חדירת כטב״מ": [
  "Drone infiltration",
  "Проникновение БПЛА"
 ],
 "חדירת מחבלים": [
  "Terrorist infiltration",
  "Проникновение террористов"
 ],
 "התרעה מוקדמת": [
  "Early warning",
  "Раннее предупреждение"
 ],
 "האירוע הסתיים": [
  "The event has ended",
  "Событие завершено"
 ],
 "ציר זמן": [
  "Timeline",
  "Шкала времени"
 ],
 "התרעות קודמות": [
  "Previous alerts",
  "Предыдущие оповещения"
 ],
 "התרעות קודמות ✕": [
  "Previous alerts ✕",
  "Предыдущие оповещения ✕"
 ],
 "סגור": [
  "Close",
  "Закрыть"
 ],
 "יום קודם": [
  "Previous day",
  "Предыдущий день"
 ],
 "יום הבא": [
  "Next day",
  "Следующий день"
 ],
 "📅 בחר תאריך": [
  "📅 Choose a date",
  "📅 Выберите дату"
 ],
 "אירוע קודם": [
  "Previous event",
  "Предыдущее событие"
 ],
 "אירוע הבא": [
  "Next event",
  "Следующее событие"
 ],
 "נגן/עצור": [
  "Play/Pause",
  "Старт/Пауза"
 ],
 "אין התרעות היום": [
  "No alerts today",
  "Сегодня оповещений нет"
 ],
 "אין נתונים בתאריך זה": [
  "No data for this date",
  "Нет данных на эту дату"
 ],
 "טוען...": [
  "Loading...",
  "Загрузка..."
 ],
 "אין אירועים": [
  "No events",
  "Нет событий"
 ],
 "בעיית GPS": [
  "GPS problem",
  "Проблема с GPS"
 ],
 "מראה מיקום על המפה": [
  "Showing location on the map",
  "Показ местоположения на карте"
 ],
 "נעשה שימוש במיקום שמור": [
  "Using the saved location",
  "Используется сохранённое местоположение"
 ],
 "מיקום לא זמין": [
  "Location unavailable",
  "Местоположение недоступно"
 ],
 "מאתר...": [
  "Locating...",
  "Определение местоположения..."
 ],
 "מיקום ומצב נהיגה כובו": [
  "Location and driving mode turned off",
  "Местоположение и режим вождения отключены"
 ],
 "מיקום הוסר מהמפה": [
  "Location removed from the map",
  "Местоположение удалено с карты"
 ],
 "ידני": [
  "Manual",
  "Вручную"
 ],
 "עקוב אחרי": [
  "Follow",
  "Следить"
 ],
 "לאירועים": [
  "To events",
  "К событиям"
 ],
 "מיקום המכשיר לא זמין": [
  "Device location unavailable",
  "Местоположение устройства недоступно"
 ],
 "מעקב אחרי המיקום הופעל": [
  "Location tracking turned on",
  "Отслеживание местоположения включено"
 ],
 "מצב נהיגה משוחזר, ממתין לאיתור מיקום...": [
  "Driving mode restored, waiting for location...",
  "Режим вождения восстановлен, ожидание определения местоположения..."
 ],
 "זום אוטומטי אינו זמין במצב נהיגה": [
  "Auto zoom is unavailable in driving mode",
  "Автомасштаб недоступен в режиме вождения"
 ],
 "הופעלה התמקדות אוטומטית באיזורי אירוע": [
  "Auto-focus on event areas turned on",
  "Автофокус на зонах событий включён"
 ],
 "התמקדות אוטומטית של המפה כובתה": [
  "Map auto-focus turned off",
  "Автофокус карты отключён"
 ],
 "להפעלת מצב נהיגה יש להפעיל תחילה 'הראה אותי'": [
  "To enable driving mode, first turn on 'Show me'",
  "Чтобы включить режим вождения, сначала включите «Показать меня»"
 ],
 "במצב נהיגה, המפה עוקבת אחרי המיקום שלך": [
  "In driving mode, the map follows your location",
  "В режиме вождения карта следует за вашим местоположением"
 ],
 "מצב נהיגה כובה": [
  "Driving mode turned off",
  "Режим вождения отключён"
 ],
 "שפה": [
  "Language",
  "Язык"
 ],
 "ירי רקטות וטילים - היכנסו למרחב המוגן": [
  "Rocket and missile fire - enter the protected space",
  "Ракетный обстрел - войдите в защищенное пространство"
 ],
 "אזעקת רקטות וטילים": [
  "Rocket and missile alert",
  "Ракетная тревога"
 ],
 "ירי רקטות וטילים - האירוע הסתיים": [
  "Rocket and missile fire - the event has ended",
  "Ракетный обстрел - событие завершено"
 ],
 "רקטות וטילים - הסתיים": [
  "Rockets and missiles - ended",
  "Ракеты и снаряды - завершено"
 ],
 "חדירת כלי טיס עוין": [
  "Hostile aircraft intrusion",
  "Проникновение вражеских летательных аппаратов"
 ],
 "חדירת כלי טיס עוין - האירוע הסתיים": [
  "Hostile aircraft intrusion - the event has ended",
  "Проникновение вражеских летательных аппаратов - событие завершено"
 ],
 "כטב״מ - האירוע הסתיים": [
  "Drone - the event has ended",
  "БПЛА - событие завершено"
 ],
 "הסתיים אירוע חדירת מחבלים - ניתן לצאת מהבתים": [
  "The terrorist infiltration event has ended - you may leave your homes",
  "Событие проникновения террористов завершено - можно выходить из домов"
 ],
 "אירוע חדירת מחבלים הסתיים": [
  "The terrorist infiltration event has ended",
  "Событие проникновения террористов завершено"
 ],
 "חדירת מחבלים - החשש הוסר": [
  "Terrorist infiltration - the concern has been lifted",
  "Проникновение террористов - угроза снята"
 ],
 "חדירת מחבלים - הסתיים": [
  "Terrorist infiltration - ended",
  "Проникновение террористов - завершено"
 ],
 "חדירת מחבלים - אין לצאת מהמרחב המוגן": [
  "Terrorist infiltration - do not leave the protected space",
  "Проникновение террористов - не выходите из защищенного пространства"
 ],
 "חדירת מחבלים - אין לצאת": [
  "Terrorist infiltration - do not go out",
  "Проникновение террористов - не выходите"
 ],
 "בדקות הקרובות צפויות להתקבל התרעות באזורך": [
  "Alerts are expected in your area in the coming minutes",
  "В ближайшие минуты в вашем районе ожидаются оповещения"
 ],
 "היכנסו מייד למרחב המוגן": [
  "Enter the protected space immediately",
  "Немедленно войдите в защищенное пространство"
 ],
 "היכנסו למרחב המוגן": [
  "Enter the protected space",
  "Войдите в защищенное пространство"
 ],
 "בזמן ההתגוננות העומד לרשותכם": [
  "Within the time you have to take cover",
  "В течение времени, отведённого на укрытие"
 ],
 "על תושבי האזורים הבאים לשפר את המיקום למיגון המיטבי בקרבתך. במקרה של קבלת התרעה, יש להיכנס למרחב המוגן ולשהות בו עד להודעה חדשה.": [
  "Residents of the following areas should move to the best available protected space nearby. If an alert is received, enter the protected space and stay there until a new announcement.",
  "Жителям следующих районов следует переместиться в ближайшее место с наилучшей доступной защитой. При получении оповещения войдите в защищённое пространство и оставайтесь в нём до нового сообщения."
 ],
 "שיפור מיקום למיגון מיטבי": [
  "Improving position for optimal protection",
  "Улучшение позиции для оптимальной защиты"
 ],
 "יש לשהות בסמיכות למרחב המוגן": [
  "Stay near the protected space",
  "Оставайтесь рядом с защищенным пространством"
 ],
 "שהייה בסמיכות למרחב המוגן": [
  "Staying near the protected space",
  "Пребывание рядом с защищенным пространством"
 ],
 "איום מלבנון - התקרבו למרחב מוגן": [
  "Threat from Lebanon - approach a protected space",
  "Угроза из Ливана - приблизьтесь к защищенному пространству"
 ],
 "⚠ איום מלבנון - התקרבו למרחב מוגן": [
  "⚠ Threat from Lebanon - approach a protected space",
  "⚠ Угроза из Ливана - приблизьтесь к защищенному пространству"
 ],
 "התקרבו למרחב מוגן": [
  "Approach a protected space",
  "Приблизьтесь к защищенному пространству"
 ],
 "איום מלבנון": [
  "Threat from Lebanon",
  "Угроза из Ливана"
 ],
 "איום מאיראן": [
  "Threat from Iran",
  "Угроза из Ирана"
 ],
 "התראה מוקדמת": [
  "Early notification",
  "Раннее оповещение"
 ],
 "ניתן לצאת מהמרחב המוגן": [
  "You may leave the protected space",
  "Можно выйти из защищенного пространства"
 ],
 "ניתן לצאת מהמרחב המוגן אך יש להישאר בקרבתו": [
  "You may leave the protected space but must stay near it",
  "Можно выйти из защищенного пространства, но необходимо оставаться рядом с ним"
 ],
 "השוהים במרחב המוגן יכולים לצאת": [
  "Those staying in the protected space may come out",
  "Находящиеся в защищенном пространстве могут выйти"
 ],
 "עדכון": [
  "Update",
  "Обновление"
 ],
 "התרעת צבע אדום": [
  "Red Alert",
  "Сигнал «Цева Адом»"
 ],
 "נשק לא קונבנציונלי": [
  "Non-conventional weapon",
  "Неконвенциональное оружие"
 ],
 "היכנסו מייד למבנה, נעלו את הדלתות וסגרו את החלונות": [
  "Enter a building immediately, lock the doors and close the windows",
  "Немедленно войдите в здание, заприте двери и закройте окна"
 ],
 "מטח כבד ארצי - היכנסו מייד למרחב המוגן": [
  "Nationwide heavy barrage - enter the protected space immediately",
  "Массированный залп по всей стране - немедленно войдите в защищенное пространство"
 ],
 "אין התרעות פעילות (Map is already clear)": [
  "No active alerts (map is already clear)",
  "Нет активных оповещений (карта уже чистая)"
 ],
 "כלל האזורים": [
  "All regions",
  "Все районы"
 ],
 "כלל היישובים": [
  "All localities",
  "Все населённые пункты"
 ],
 "דקה וחצי": [
  "1.5 min",
  "1,5 мин"
 ],
 "לפני פחות מדקה": [
  "Less than a minute ago",
  "Меньше минуты назад"
 ],
 "🚨 טסט טילים (Red)": [
  "🚨 Missile test (Red)",
  "🚨 Тест ракет (красный)"
 ],
 "🥷 טסט מחבלים (Brown)": [
  "🥷 Infiltration test (Brown)",
  "🥷 Тест проникновения (коричневый)"
 ],
 "🚁 טסט כטב״מ (Purple)": [
  "🚁 Drone test (Purple)",
  "🚁 Тест БПЛА (фиолетовый)"
 ],
 "💥 טסט מטח כבד (Chaos)": [
  "💥 Heavy barrage test (Chaos)",
  "💥 Тест массированного залпа (хаос)"
 ],
 "⚠️ טסט איום מלבנון (Yellow)": [
  "⚠️ Lebanon threat test (Yellow)",
  "⚠️ Тест угрозы из Ливана (жёлтый)"
 ],
 "✅ טסט סיום אירוע (All Clear)": [
  "✅ Event end test (All Clear)",
  "✅ Тест завершения события (отбой)"
 ],
 "🔄 נקה מפה": [
  "🔄 Clear map",
  "🔄 Очистить карту"
 ],
 "נא להסתמך על אמצעי ההתרעה הרשמיים בלבד": [
  "Please rely only on the official alert channels",
  "Полагайтесь только на официальные средства оповещения"
 ],
 "אין התרעות פעילות": [
  "No active alerts",
  "Нет активных оповещений"
 ],
 "אודות - מפת העורף": [
  "About - Oref Map",
  "О проекте - Карта оповещений"
 ],
 "איך זה עובד": [
  "How it works",
  "Как это работает"
 ],
 "קוד פתוח": [
  "Open source",
  "Открытый код"
 ],
 "חזרה למפה": [
  "Back to the map",
  "Назад к карте"
 ],
 "קוד המקור ב-GitHub": [
  "Source code on GitHub",
  "Исходный код на GitHub"
 ],
 "דיווח על בעיה": [
  "Report a problem",
  "Сообщить о проблеме"
 ],
 "מפת העורף": [
  "Oref Map",
  "Карта оповещений"
 ],
 "המפה מציגה את התרעות פיקוד העורף על גבי מפה אינטראקטיבית.": [
  "The map displays Home Front Command alerts on an interactive map.",
  "На карте отображаются оповещения Командования тыла на интерактивной карте."
 ],
 "האזורים מסומנים לפי סוג ההתרעה: אדום לירי רקטות וטילים, סגול לחדירת כלי טיס עוין, חום לחדירת מחבלים, צהוב להתרעה מוקדמת וירוק כשהאירוע הסתיים.": [
  "Areas are marked by alert type: red for rocket and missile fire, purple for hostile aircraft intrusion, brown for terrorist infiltration, yellow for an early warning, and green when the event is over.",
  "Районы отмечены по типу оповещения: красный - ракетный обстрел, фиолетовый - проникновение вражеских летательных аппаратов, коричневый - проникновение террористов, жёлтый - предварительное оповещение, зелёный - событие завершено."
 ],
 "אפשר לצפות בהיסטוריית ההתרעות באמצעות ציר הזמן ולהתקרב לכל אזור במפה.": [
  "You can view past alerts on the timeline and zoom in on any area of the map.",
  "Вы можете просматривать прошлые оповещения на шкале времени и приближать любой район карты."
 ],
 "הנתונים מתקבלים מממשק ההתרעות הציבורי של פיקוד העורף דרך שרת האתר. האתר בודק אם התקבלו התרעות חדשות מדי שנייה; ייתכנו עיכובים בעדכון.": [
  "Data is received from the Home Front Command's public alert interface through the site's server. The site checks for new alerts every second; updates may be delayed.",
  "Данные поступают из открытого интерфейса оповещений Командования тыла через сервер сайта. Сайт проверяет новые оповещения каждую секунду; возможны задержки обновления."
 ],
 "מפת העורף הוא פרויקט קוד פתוח ברישיון AGPL-3.0. קוד המקור זמין ב-GitHub, ואפשר לתרום קוד, לדווח על תקלות ולהציע שיפורים.": [
  "Oref Map is an open-source project under the AGPL-3.0 license. The source code is available on GitHub, and you can contribute code, report issues, and suggest improvements.",
  "Карта оповещений - проект с открытым кодом под лицензией AGPL-3.0. Исходный код доступен на GitHub: можно вносить код, сообщать об ошибках и предлагать улучшения."
 ],
 "האתר מבוסס על": [
  "The site is based on ",
  "Сайт основан на "
 ],
 ", שנוצר על ידי מאור קונפורטי, ומאוחסן על תשתית": [
  ", created by Maor Konforti, and hosted on ",
  ", созданном Маором Конфорти, и размещён на инфраструктуре "
 ],
 "הבהרה חשובה": [
  "Important notice",
  "Важное примечание"
 ],
 "אין להסתמך על המידע והתכנים המוצגים באתר זה.": [
  "Do not rely on the information and content displayed on this site. ",
  "Не полагайтесь на информацию и материалы, представленные на этом сайте. "
 ],
 "בכל מקרה יש לנהוג בהתאם להנחיות פיקוד העורף.": [
  "In any case, follow the Home Front Command's guidelines.",
  "В любом случае следуйте указаниям Командования тыла."
 ]
};
  var DICT = {};
  for (var k in RAW) DICT[k] = RAW[k][LANG_IDX];

  var HE_RE = /[\u0590-\u05FF]/;

  function ruPlural(n, one, few, many) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
    return many;
  }

  var PATTERNS = [
    { re: /^\u05dc\u05e4\u05e0\u05d9 (\d+) \u05d3\u05e7\u05d5\u05ea$/, // "X minutes ago"
      f: function (n) {
        n = +n;
        if (LANG === 'en') return n === 1 ? '1 minute ago' : n + ' minutes ago';
        if (LANG === 'ar') return n === 1 ? '\u0642\u0628\u0644 \u062f\u0642\u064a\u0642\u0629' : n === 2 ? '\u0642\u0628\u0644 \u062f\u0642\u064a\u0642\u062a\u064a\u0646' : n <= 10 ? '\u0642\u0628\u0644 ' + n + ' \u062f\u0642\u0627\u0626\u0642' : '\u0642\u0628\u0644 ' + n + ' \u062f\u0642\u064a\u0642\u0629';
        return n + ' ' + ruPlural(n, '\u043c\u0438\u043d\u0443\u0442\u0443', '\u043c\u0438\u043d\u0443\u0442\u044b', '\u043c\u0438\u043d\u0443\u0442') + ' \u043d\u0430\u0437\u0430\u0434';
      } },
    { re: /^\u05dc\u05e4\u05e0\u05d9 (\d+) \u05e9\u05e2\u05d5\u05ea$/, // "X hours ago"
      f: function (n) {
        n = +n;
        if (LANG === 'en') return n === 1 ? '1 hour ago' : n + ' hours ago';
        if (LANG === 'ar') return n === 1 ? '\u0642\u0628\u0644 \u0633\u0627\u0639\u0629' : n === 2 ? '\u0642\u0628\u0644 \u0633\u0627\u0639\u062a\u064a\u0646' : n <= 10 ? '\u0642\u0628\u0644 ' + n + ' \u0633\u0627\u0639\u0627\u062a' : '\u0642\u0628\u0644 ' + n + ' \u0633\u0627\u0639\u0629';
        return n + ' ' + ruPlural(n, '\u0447\u0430\u0441', '\u0447\u0430\u0441\u0430', '\u0447\u0430\u0441\u043e\u0432') + ' \u043d\u0430\u0437\u0430\u0434';
      } },
    { re: /^(\d+) \u05e9\u05e0\u05d9\u05d5\u05ea$/, // "N seconds" (shelter-time map markers)
      f: function (n) {
        n = +n;
        if (LANG === 'en') return n + ' sec';
        if (LANG === 'ar') return n + ' \u062b\u0648\u0627\u0646\u064d';
        return n + ' \u0441\u0435\u043a';
      } },
    { re: /^([\d,]+) \u05d1\u05de\u05e7\u05dc\u05d8\u05d9\u05dd \u2022 (\d+) \u05d0\u05d6\u05d5\u05e8\u05d9 \u05d4\u05ea\u05e8\u05d0\u05d4$/, // "X in shelters - Y alert zones"
      f: function (a, b) {
        if (LANG === 'en') return a + ' in shelters \u2022 ' + b + ' alert zones';
        if (LANG === 'ar') return a + ' \u0641\u064a \u0627\u0644\u0645\u0644\u0627\u062c\u0626 \u2022 ' + b + ' \u0645\u0646\u0627\u0637\u0642 \u0625\u0646\u0630\u0627\u0631';
        return a + ' \u0432 \u0443\u0431\u0435\u0436\u0438\u0449\u0430\u0445 \u2022 ' + b + ' \u0437\u043e\u043d \u043e\u043f\u043e\u0432\u0435\u0449\u0435\u043d\u0438\u044f';
      } },
    { re: /^(\d+) \u05d0\u05d6\u05d5\u05e8\u05d9 \u05d4\u05ea\u05e8\u05d0\u05d4$/, // "Y alert zones"
      f: function (b) {
        if (LANG === 'en') return b + ' alert zones';
        if (LANG === 'ar') return b + ' \u0645\u0646\u0627\u0637\u0642 \u0625\u0646\u0630\u0627\u0631';
        return b + ' \u0437\u043e\u043d \u043e\u043f\u043e\u0432\u0435\u0449\u0435\u043d\u0438\u044f';
      } }
    ,{ re: /^(\d+) \u05de\u05d7\u05d5\u05d1\u05e8\u05d9\u05dd \u05db\u05e2\u05ea$/, // "N connected now"
      f: function (n) {
        n = +n;
        if (LANG === 'en') return n === 1 ? '1 connected now' : n + ' connected now';
        if (LANG === 'ar') return n + ' \u0645\u062a\u0635\u0644 \u0627\u0644\u0622\u0646';
        return '\u0421\u0435\u0439\u0447\u0430\u0441 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u043e: ' + n;
      } }
  ];

  // City / locality names: official translations from the bundled oref catalogue.
  var cityMap = null;

  // Lets the site's search boxes match a place by its translated name too.
  window.__i18nMatchName = function(hebrewName, q) {
    if (!cityMap || !q) return false;
    var t = cityMap[hebrewName];
    return t ? t.toLowerCase().indexOf(q.toLowerCase()) !== -1 : false;
  }; // Hebrew name -> translated name
  function loadCities() {
    fetch('cities.json').then(function (r) { return r.ok ? r.json() : []; }).then(function (data) {
      var m = {};
      var key = LANG === 'en' ? 'name_en' : LANG === 'ar' ? 'name_ar' : 'name_ru';
      var zkey = LANG === 'en' ? 'zone_en' : LANG === 'ar' ? 'zone_ar' : 'zone_ru';
      for (var i = 0; i < data.length; i++) {
        var c = data[i];
        if (c.name && c[key]) m[c.name] = c[key];
        if (c.value && c[key]) m[c.value] = c[key];
        if (c.zone && c[zkey]) m[c.zone] = c[zkey];
      }
      cityMap = m;
      translateTree(document.body); // re-run with names available
      translateTitle();
    }).catch(function () { cityMap = {}; });
  }

  function translateCities(s) {
    if (!cityMap) return s;
    // Longest-first replacement of KNOWN catalogue names only (data values from the
    // same source the app renders); everything else in the string is left intact.
    var names = Object.keys(cityMap).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < names.length; i++) {
      if (s.indexOf(names[i]) !== -1) s = s.split(names[i]).join(cityMap[names[i]]);
    }
    return s;
  }

  function translateString(s) {
    if (!s || !HE_RE.test(s)) return s;
    var t = s.trim();
    if (Object.prototype.hasOwnProperty.call(DICT, t)) return DICT[t];
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = t.match(PATTERNS[i].re);
      if (m) return PATTERNS[i].f.apply(null, m.slice(1));
    }
    return translateCities(t);
  }

  // Guard against observer feedback loops and double translation.
  var lastNodeOut = new WeakMap();
  var lastAttrOut = new WeakMap(); // el -> {attr: value}

  function processTextNode(node) {
    var v = node.nodeValue;
    if (!v || !HE_RE.test(v)) return;
    if (lastNodeOut.get(node) === v) return;
    var out = translateString(v);
    if (out !== v.trim() && out !== v) {
      node.nodeValue = out;
      lastNodeOut.set(node, out);
    }
  }

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function processAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute && el.getAttribute(a);
      if (!v || !HE_RE.test(v)) continue;
      var rec = lastAttrOut.get(el) || {};
      if (rec[a] === v) continue;
      var out = translateString(v);
      if (out !== v) {
        el.setAttribute(a, out);
        rec[a] = out;
        lastAttrOut.set(el, rec);
      }
    }
    if (!RTL) {
      if (el.getAttribute && el.getAttribute('dir') === 'rtl') el.setAttribute('dir', 'ltr');
      if (el.style && el.style.direction === 'rtl') el.style.direction = 'ltr';
    }
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { processTextNode(root); return; }
    if (root.nodeType !== 1) return;
    var tag = root.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'CANVAS') return;
    processAttrs(root);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var p = node.parentNode;
      if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.tagName === 'NOSCRIPT')) continue;
      processTextNode(node);
    }
    var els = root.querySelectorAll('[placeholder], [title], [aria-label], [alt], [dir="rtl"]');
    for (var i = 0; i < els.length; i++) processAttrs(els[i]);
  }

  function translateTitle() {
    var t = document.title;
    if (t && HE_RE.test(t)) document.title = translateString(t);
  }

  var observer = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var mu = muts[i];
      if (mu.type === 'characterData') {
        processTextNode(mu.target);
      } else if (mu.type === 'childList') {
        for (var j = 0; j < mu.addedNodes.length; j++) translateTree(mu.addedNodes[j]);
        if (mu.target && mu.target.nodeType === 1) {
          for (var k = 0; k < mu.target.childNodes.length; k++) {
            var n = mu.target.childNodes[k];
            if (n.nodeType === 3) processTextNode(n);
          }
        }
      } else if (mu.type === 'attributes') {
        processAttrs(mu.target);
      }
    }
  });

  if (!RTL) {
    var st = document.createElement('style');
    st.id = 'i18n-ltr';
    st.textContent = 'html[dir="ltr"] .tta-marker, html[dir="ltr"] #status, html[dir="ltr"] #legend, html[dir="ltr"] #timeline, html[dir="ltr"] #timeline-btn-row, html[dir="ltr"] #up-location-header, html[dir="ltr"] #up-event-list, html[dir="ltr"] .up-event-row, html[dir="ltr"] #up-close-row, html[dir="ltr"] #menu-panel, html[dir="ltr"] .menu-sub-panel, html[dir="ltr"] .menu-setting-select, html[dir="ltr"] .modal-content, html[dir="ltr"] .selected-label .maplibregl-popup-content, html[dir="ltr"] #search-input, html[dir="ltr"] #sound-search, html[dir="ltr"] #toast, html[dir="ltr"] .toast { direction: ltr !important; }';
    (document.head || document.documentElement).appendChild(st);
  }

  function start() {
    translateTitle();
    translateTree(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    loadCities();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Diagnostic: list visible text that still contains Hebrew (used in testing).
  window.__i18nScan = function () {
    var out = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var v = node.nodeValue;
      if (v && HE_RE.test(v) && v.trim()) {
        var p = node.parentNode;
        if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.tagName === 'NOSCRIPT')) continue;
        out.push(v.trim().slice(0, 80));
      }
    }
    return out;
  };
})();
