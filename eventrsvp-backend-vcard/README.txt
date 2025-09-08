
EventRSVP Backend (vCard via WhatsApp) – Quick Start
====================================================
What you get:
- Workspace with ownerPhone (מספר הלקוח שמעלה vCard בוואטסאפ)
- Active Event per workspace
- Webhook שקולט הודעות מסוג contacts (vCard) ומוסיף אורחים לאירוע הפעיל
- ממשק API להוספה ידנית/CSV/שליחה/תזמון כמו קודם

Setup
1) npm install
2) npx prisma generate
3) npx prisma migrate dev --name init
4) העתק .env.example ל-.env והגדר WABA_* אם יש לך, אחרת זה מצב סימולציה
5) npm run dev

Provision
- צור workspace עם מספר הלקוח (ownerPhone) וקרדיטים:
  POST /workspaces/init
  { "name": "Studio RSVP", "credits": 500, "ownerPhone": "055-953-7193" }

- צור אירוע ושייך ל-workspace:
  POST /events
  { "workspaceId": "<WS_ID>", "title": "החתונה של שרה ומיכאל" }
  (ברירת מחדל: האירוע יהפוך לאירוע הפעיל. אפשר לשנות ב-/workspaces/:id/active-event)

WhatsApp Webhook (Cloud API)
- קבע Callback URL ל: http://<public-url>/webhooks/whatsapp  (ngrok לחשיפה מקומית)
- אימות Verify: GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<WABA_VERIFY_TOKEN>&hub.challenge=1234
- כעת כשהלקוח (ownerPhone) שולח **כרטיסי קשר** בצ'אט – המערכת תוסיף אותם כאורחים לאירוע הפעיל ותשיב בתקציר.

Manual Add (UI/Frontend)
- הממשק שלך ימשיך לקרוא ל:
  POST /events/:id/guests
  POST /events/:id/guests/import
  GET  /events/:id
  POST /events/:id/messages/send-now
  POST /events/:id/messages/schedule

Notes
- מספרי טלפון מנורמלים ל"ספרות בלבד". אפשר לשדרג ל-libphonenumber-js ל-E.164.
- אם בעל ה-Workspace מנהל כמה אירועים, אפשר לבחור אירוע פעיל דרך WhatsApp: שליחת "set <מילת חיפוש>" תחליף אירוע פעיל לפי ID/כותרת.
