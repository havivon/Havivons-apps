# האפליקציות של Havivon

דף נחיתה (GitHub Pages) לכל האפליקציות: כרטיס קצר לכל אפליקציה בדף הבית, ודף פירוט עם
יתרונות, צילומי מסך והורדה.

אתר: https://havivon.github.io/Havivons-apps/

## מבנה

| קובץ / תיקייה | מה יש בו | מי מעדכן |
|---|---|---|
| `index.html`, `app.html`, `assets/` | האתר עצמו (Tailwind + Lucide, RTL, בהיר/כהה) | ידני |
| `data/apps.json` | גרסה, תאריך, קישור הורדה וגודל לכל אפליקציה | `sync.py` (לא לערוך ידנית) |
| `data/content.json` | שם, תיאור קצר וארוך, יתרונות, דרישות, הוראות התקנה | ידני |
| `data/screens.json` + `apps/<id>/` | אייקון וצילומי מסך (WebP, עד 1600px גובה) | ידני |
| `downloads/` | קבצי ההורדה (APK / HTML / ZIP) | `sync.py` |
| `web/<id>/` | עותק מתארח של כלי ווב מקומיים | `sync.py` |
| `sync-sources.json` | איפה נמצאת הבנייה העדכנית של כל אפליקציה | ידני |

## עדכון גרסה

```bash
python sync.py                  # כל האפליקציות
python sync.py pigeon           # רק אחת
python sync.py --push pigeon    # כולל commit + push
```

הסקריפט לוקח את הבנייה החדשה ביותר מהנתיבים ב-`sync-sources.json`, קורא את מספר הגרסה מתוך ה-APK
(או מקובץ ה-gradle), ומעדכן את `data/apps.json`. אפליקציות שמתפרסמות ב-GitHub Releases
(NewPlayer, BabyMonitor, Print My Bingo) מתעדכנות מה-Release האחרון.
אם ה-API של GitHub חוסם (60 בקשות לשעה), אפשר להגדיר `GITHUB_TOKEN`.

אפליקציה חדשה: להוסיף ל-`sync-sources.json`, ל-`data/content.json` ול-`data/screens.json`, ולהריץ sync.
`"hidden": "<סיבה>"` מוריד אפליקציה מהאתר בלי למחוק את ההגדרות שלה.

## צילומי מסך

- 3–5 מסכים, המסך הראשי ראשון, ממשק בעברית.
- אנדרואיד: באמולטור (AVD `Zochrim`), לא בטלפון האישי, עם נתוני דוגמה בלבד.
- ווב: viewport של טלפון (412×915, DPR 2).
- WebP באיכות 80, עד 1600px גובה. בלי מידע אישי (שמות, מספרים, הודעות).

---
Created By Havivon
