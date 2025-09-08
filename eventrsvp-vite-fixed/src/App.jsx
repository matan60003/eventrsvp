import React, { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";
const EVENT_ID  = import.meta.env.VITE_EVENT_ID  || "";

// ===== תבניות הודעה =====
const TEMPLATES = [
  {
    id: "default",
    name: "ברירת מחדל — הזמנה",
    text:
`🎉 אתם מוזמנים ל[כותרת האירוע]!
📅 תאריך: [תאריך האירוע]
⏰ שעה: [שעת האירוע]
📍 מקום: [מקום האירוע]

נשמח לאישורך בהודעה חוזרת: כן/לא + מספר האורחים.`
  },
  {
    id: "save",
    name: "Save the date",
    text:
`שומרים את התאריך! 📅
[כותרת האירוע]
ב[תאריך האירוע], בשעה [שעת האירוע], ב[מקום האירוע].

פרטים נוספים בקרוב — נשמח שתסמנו ביומן!`
  },
  {
    id: "reminder",
    name: "תזכורת עדינה",
    text:
`שלום! 🎈
תזכורת קטנה לגבי [כותרת האירוע] ב[תאריך האירוע] בשעה [שעת האירוע], ב[מקום האירוע].

נשמח לאישור הגעה קצר: כן/לא + מספר אורחים 🙏`
  }
];

const formatPhone = (p) => p.replace(/\D/g, "");
const download = (filename, text) => {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};
const toCsv = (rows) => {
  const header = ["name","phone","relation","side","status","responseTime"];
  const body = rows.map(r => header.map(k => (r[k] ?? "").toString().replace(/,/g," ")).join(",")).join("\n");
  return header.join(",") + "\n" + body;
};

const StatusPill = ({ status }) => {
  const map = {
    confirmed: { text: "מאושר", cls: "bg-green-100 text-green-800" },
    declined:  { text: "ביטל",   cls: "bg-red-100 text-red-800" },
    pending:   { text: "ממתין",  cls: "bg-yellow-100 text-yellow-800" },
  };
  const s = map[status] || map.pending;
  return <span className={`px-3 py-1 rounded-full text-sm ${s.cls}`}>{s.text}</span>;
};

function Stat({ title, value, icon }) {
  return (
    <div className="rounded-2xl border p-4 flex items-center gap-4">
      <div className="text-2xl">{icon}</div>
      <div>
        <div className="text-sm text-gray-500">{title}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
    </div>
  );
}

function QuickAdd({ onAdd }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState("");
  const [side, setSide] = useState("");
  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">שם מלא</label>
        <input className="border rounded-xl px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">מס׳ נייד</label>
        <input className="border rounded-xl px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0501234567" />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">סוג קשר</label>
        <select className="border rounded-xl px-3 py-2" value={relation} onChange={(e) => setRelation(e.target.value)}>
          <option value="">בחרו...</option>
          <option value="משפחה">משפחה</option>
          <option value="חבר/ה">חבר/ה</option>
          <option value="עבודה">עבודה</option>
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">קבוצה</label>
        <select className="border rounded-xl px-3 py-2" value={side} onChange={(e) => setSide(e.target.value)}>
          <option value="">בחרו...</option>
          <option value="כלת">כלת</option>
          <option value="חתן">חתן</option>
          <option value="אחר">אחר</option>
        </select>
      </div>
      <button
        onClick={() => {
          if (!name || !phone) return alert("חסר שם או טלפון");
          onAdd({ name, phone: formatPhone(phone), relation, side });
          setName(""); setPhone(""); setRelation(""); setSide("");
        }}
        className="px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-black"
      >
        הוסף אורח
      </button>
    </div>
  );
}

export default function App() {
  const [event, setEvent] = useState(null);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDate,  setEventDate]  = useState("");
  const [eventTime,  setEventTime]  = useState("");
  const [eventVenue, setEventVenue] = useState("");

  const [selectedTemplate, setSelectedTemplate] = useState("default");
  const [message, setMessage] = useState(TEMPLATES[0].text);

  const [statusFilter, setStatusFilter]     = useState("all");
  const [sideFilter, setSideFilter]         = useState("all");
  const [relationFilter, setRelationFilter] = useState("all");
  const [sendDate, setSendDate] = useState("");
  const [sendTime, setSendTime] = useState("10:00");
  const [loading, setLoading] = useState(false);

  const guests = event?.guests || [];

  const stats = useMemo(() => {
    const total = guests.length;
    const confirmed = guests.filter((g) => g.status === "confirmed").length;
    const declined  = guests.filter((g) => g.status === "declined").length;
    const pending   = guests.filter((g) => g.status === "pending").length;
    return { total, confirmed, declined, pending };
  }, [guests]);

  const filteredGuests = useMemo(() => {
    return guests.filter((g) => {
      const statusOk   = (statusFilter === "all")   || g.status === statusFilter;
      const sideOk     = (sideFilter === "all")     || (g.side || "") === sideFilter;
      const relationOk = (relationFilter === "all") || (g.relation || "") === relationFilter;
      return statusOk && sideOk && relationOk;
    });
  }, [guests, statusFilter, sideFilter, relationFilter]);

  // ===== טענת אירוע מה-API =====
  const apiGetEvent = async () => {
    if (!EVENT_ID) { alert("חסר EVENT_ID. פתח .env.local והגדר VITE_EVENT_ID"); return; }
    const res = await fetch(`${API_BASE}/events/${EVENT_ID}`);
    if (!res.ok) throw new Error("אירוע לא נמצא");
    const data = await res.json();
    setEvent(data);
    setEventTitle(data.title || "");
    setEventVenue(data.venue || "");
    // אם יש date/timeStr בשרת – נעדכן אותם לשדות
    if (data.date) {
      try {
        const d = new Date(data.date);
        if (!isNaN(d)) setEventDate(d.toISOString().slice(0,10));
      } catch {}
    }
    if (data.timeStr) setEventTime(data.timeStr);
  };
  useEffect(() => { apiGetEvent().catch(e => console.error(e)); }, []);

  // ===== מילוי אוטומטי של Placeholders בתבנית =====
  const fillTemplateWithEvent = (txt) => {
    const dateStr = eventDate || "";                // פורמט yyyy-mm-dd (מספיק לוואטסאפ)
    const timeStr = eventTime || "";
    const venue   = eventVenue || event?.venue || "";
    const title   = eventTitle || event?.title || "";

    return txt
      .replaceAll("[תאריך האירוע]",  dateStr)
      .replaceAll("[שעת האירוע]",    timeStr)
      .replaceAll("[מקום האירוע]",   venue)
      .replaceAll("[כותרת האירוע]",  title);
  };

  // בוחרים תבנית -> ממלאים (לא חייב; אפשר גם לערוך ידנית אחרי)
  const applyTemplate = (id) => {
    const t = TEMPLATES.find(x => x.id === id) || TEMPLATES[0];
    setSelectedTemplate(id);
    setMessage(fillTemplateWithEvent(t.text));
  };

  // ===== אורחים =====
  const addGuest = async ({ name, phone, relation, side }) => {
    if (!EVENT_ID) return alert("חסר EVENT_ID ב-.env.local");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/events/${EVENT_ID}/guests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, relation, side })
      });
      if (!res.ok) throw new Error("שגיאה בהוספת אורח");
      await apiGetEvent();
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  const handleCsv = async (file) => {
    if (!EVENT_ID) return alert("חסר EVENT_ID ב-.env.local");
    const fd = new FormData(); fd.append("file", file);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/events/${EVENT_ID}/guests/import`, { method: "POST", body: fd });
      if (!res.ok) {
        const t = await res.text();
        throw new Error("שגיאה ביבוא CSV: " + t);
      }
      await apiGetEvent(); alert("ייבוא הושלם");
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  // ===== תמונת הזמנה =====
  const uploadInviteImage = async (file) => {
    if (!EVENT_ID) return alert("חסר EVENT_ID ב-.env.local");
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/events/${EVENT_ID}/invite-image`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "שגיאה בהעלאת תמונה");
      setEvent((prev) => ({ ...prev, inviteImageUrl: data.url }));
    } catch (e) { alert(e.message); }
  };
  const removeInviteImage = async () => {
    if (!EVENT_ID || !event?.inviteImageUrl) return;
    if (!confirm("להסיר את תמונת ההזמנה?")) return;
    try {
      const res = await fetch(`${API_BASE}/events/${EVENT_ID}/invite-image`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "שגיאה במחיקת התמונה");
      setEvent(prev => ({ ...prev, inviteImageUrl: null }));
    } catch (e) { alert(e.message); }
  };

  // ===== שליחה/תזמון =====
  const handleSend = async (immediate = false) => {
    if (!EVENT_ID) return alert("חסר EVENT_ID ב-.env.local");
    try {
      const img = event?.inviteImageUrl || null;
      if (immediate) {
        const res = await fetch(`${API_BASE}/events/${EVENT_ID}/messages/send-now`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bodyText: message, imageUrl: img })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "שגיאה בשליחה");
        alert(`נשלח ל-${data.targets} אורחים`);
      } else {
        if (!sendDate || !sendTime) return alert("בחרו תאריך ושעה לשליחה.");
        const [h, m] = sendTime.split(":").map(Number);
        const dt = new Date(sendDate); dt.setHours(h, m, 0, 0);
        const res = await fetch(`${API_BASE}/events/${EVENT_ID}/messages/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bodyText: message, imageUrl: img, scheduledAt: dt.toISOString() })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "שגיאה בתזמון");
        alert(`תוזמן ל-${data.targets} אורחים במועד: ${new Date(data.scheduledAt).toLocaleString()}`);
      }
    } catch (e) { alert(e.message); }
  };

  const downloadCsv = () => download("guests.csv", toCsv(guests));

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 text-gray-900">
      <header className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 text-white flex items-center justify-center rounded-xl font-bold">RS</div>
          <div>
            <h1 className="text-xl font-semibold">EventRSVP — מנהל הזמנות וואטסאפ</h1>
            <p className="text-sm text-gray-500">אירוע: {event?.title || "—"}</p>
          </div>
        </div>
        <button onClick={downloadCsv} className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow" disabled={!guests.length}>
          ייצוא CSV
        </button>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-6">
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1">
              <input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} className="w-full text-2xl font-bold bg-transparent focus:outline-none" placeholder="כותרת אירוע" />
              <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-600">
                <div className="flex items-center gap-2"><span>📅</span><input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="border rounded px-2 py-1" /></div>
                <div className="flex items-center gap-2"><span>⏰</span><input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} className="border rounded px-2 py-1" /></div>
                <div className="flex items-center gap-2"><span>📍</span><input value={eventVenue} onChange={(e) => setEventVenue(e.target.value)} className="border rounded px-2 py-1" placeholder="מקום האירוע" /></div>
              </div>
            </div>
            <span className="self-start md:self-center text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-full">חיבור ל-API פעיל</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <Stat title='סה"כ אורחים' value={stats.total} icon="👥" />
            <Stat title="מאושרים" value={stats.confirmed} icon="✅" />
            <Stat title="ביטלו" value={stats.declined} icon="❌" />
            <Stat title="ממתינים" value={stats.pending} icon="⏳" />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-6 grid md:grid-cols-2 gap-6 pb-24">
        {/* הודעת הזמנה + תמונה */}
        <section className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">הודעת הזמנה</h2>

          {/* תבנית הודעה + מילוי */}
          <div className="mb-3 flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">תבנית</label>
              <select
                className="border rounded-xl px-3 py-2 w-full"
                value={selectedTemplate}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <button
              onClick={() => setMessage(fillTemplateWithEvent(message))}
              className="px-4 py-2 rounded-xl border hover:bg-gray-50"
              title="ממלא את ה-placeholders בטקסט הנוכחי"
            >
              מלא פרטי אירוע לתבנית
            </button>
          </div>

          {/* תמונת הזמנה */}
          <div className="mb-3">
            <h3 className="font-semibold mb-2">תמונת הזמנה</h3>
            <div className="flex items-center gap-4">
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={(e) => e.target.files?.[0] && uploadInviteImage(e.target.files[0])}
              />
              {event?.inviteImageUrl && (
                <div className="flex items-center gap-3">
                  <img
                    src={event.inviteImageUrl.startsWith("http") ? event.inviteImageUrl : `${API_BASE}${event.inviteImageUrl}`}
                    alt="הזמנה"
                    className="h-24 rounded-lg border"
                  />
                  <button onClick={removeInviteImage} className="px-3 py-1 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">
                    הסר תמונה
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* טקסט ההודעה */}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={10} className="w-full border rounded-xl p-3 focus:outline-none focus:ring" />

          {/* תזמון */}
          <div className="mt-6 border-t pt-4">
            <h3 className="font-semibold mb-3">תזמון הודעה</h3>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2"><span>תאריך:</span><input type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)} className="border rounded px-2 py-1" /></div>
              <div className="flex items-center gap-2"><span>שעה:</span><input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} className="border rounded px-2 py-1" /></div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button onClick={() => handleSend(true)}  className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">שליחה מיידית</button>
              <button onClick={() => handleSend(false)} className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700">תזמון שליחה</button>
            </div>
          </div>
        </section>

        {/* ניהול אורחים */}
        <section className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold mb-2">ניהול רשימת אורחים</h2>
          <div className="border-2 border-dashed rounded-2xl p-6 text-center">
            <p className="text-sm text-gray-600">העלו קובץ CSV עם העמודות: name, phone, relation, side</p>
            <div className="mt-3"><input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])} /></div>
          </div>

          <QuickAdd onAdd={addGuest} />

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end text-sm">
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">סטטוס</label>
              <select className="border rounded-xl px-3 py-2" value={statusFilter} onChange={(e)=> setStatusFilter(e.target.value)}>
                <option value="all">הכל</option>
                <option value="confirmed">מאושרים</option>
                <option value="declined">מבוטלים</option>
                <option value="pending">ממתינים</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">צד</label>
              <select className="border rounded-xl px-3 py-2" value={sideFilter} onChange={(e)=> setSideFilter(e.target.value)}>
                <option value="all">הכל</option>
                <option value="כלת">כלת</option>
                <option value="חתן">חתן</option>
                <option value="אחר">אחר</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">סוג קשר</label>
              <select className="border rounded-xl px-3 py-2" value={relationFilter} onChange={(e)=> setRelationFilter(e.target.value)}>
                <option value="all">הכל</option>
                <option value="משפחה">משפחה</option>
                <option value="חבר/ה">חבר/ה</option>
                <option value="עבודה">עבודה</option>
              </select>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="text-sm text-gray-500">
                  <th className="py-2">אורח</th>
                  <th className="py-2">טלפון</th>
                  <th className="py-2">קבוצה</th>
                  <th className="py-2">סוג קשר</th>
                  <th className="py-2">סטטוס</th>
                  <th className="py-2">זמן תגובה</th>
                </tr>
              </thead>
              <tbody>
                {filteredGuests.map((g) => (
                  <tr key={g.id} className="border-t">
                    <td className="py-3"><div className="font-medium">{g.name || "—"}</div></td>
                    <td className="py-3">{g.phone}</td>
                    <td className="py-3"><span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm">{g.side || "—"}</span></td>
                    <td className="py-3">{g.relation || "—"}</td>
                    <td className="py-3"><StatusPill status={g.status} /></td>
                    <td className="py-3 text-sm text-gray-600">{g.responseTime ? new Date(g.responseTime).toLocaleString() : "-"}</td>
                  </tr>
                ))}
                {filteredGuests.length === 0 && (
                  <tr><td colSpan="6" className="py-6 text-center text-gray-500">אין תוצאות להצגה.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="text-center text-xs text-gray-500 py-10">
        תבניות + מילוי אוטומטי עובדים. תמונת הזמנה תצא אם קיימת.
      </footer>

      {loading && <div className="fixed inset-0 bg-black/10 grid place-items-center"><div className="bg-white p-3 rounded-xl border">טוען…</div></div>}
    </div>
  );
}
