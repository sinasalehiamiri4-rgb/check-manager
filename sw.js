// Service Worker برای نمایش اعلان سررسید چک و قسط
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if (data.page) { try { c.postMessage({ type: 'open-' + data.page }); } catch (e) {} }
          return c.focus();
        }
      }
      return self.clients.openWindow(url + (data.page ? '#' + data.page : ''));
    })
  );
});

/* ===== اعلان سررسید اقساط در پس‌زمینه =====
   (Periodic Background Sync؛ فقط در Chrome اندروید و برای برنامه نصب‌شده کار می‌کند.
    صفحه اصلی لیست سررسیدها را در IndexedDB ذخیره می‌کند و اینجا خوانده می‌شود.) */
function openKV() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('checks-app', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function kvGet(key) {
  const db = await openKV();
  return new Promise((resolve) => {
    const rq = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    rq.onsuccess = () => { db.close(); resolve(rq.result); };
    rq.onerror = () => { db.close(); resolve(undefined); };
  });
}
async function kvSet(key, val) {
  const db = await openKV();
  return new Promise((resolve) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); resolve(false); };
  });
}

function instStage(d) {
  if (d < 0) return 'late';
  if (d === 0) return 'd0';
  if (d === 1) return 'd1';
  if (d <= 3) return 'd3';
  return null;
}

async function checkInstallments() {
  if (self.Notification && self.Notification.permission !== 'granted') return;
  const due = (await kvGet('due')) || [];
  if (!due.length) return;
  const sent = (await kvGet('sent')) || {};
  const today = new Date().toLocaleDateString('en-CA');           // YYYY-MM-DD (تاریخ محلی)
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const faStr = (t) => String(t).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const fresh = [];
  for (const it of due) {
    const d = Math.round((Date.parse(it.due + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5);
    const st = instStage(d);
    if (!st) continue;
    const key = it.id + '|' + it.nextDate + '|' + st;
    if (st === 'late' ? sent[key] === today : sent[key] !== undefined) continue;
    fresh.push({ it, d, st, key });
  }
  if (!fresh.length) return;
  const base = { dir: 'rtl', lang: 'fa', renotify: true, requireInteraction: true, data: { url: './', page: 'installments' } };
  if (fresh.length <= 4) {
    for (const f of fresh) {
      const when = f.st === 'late' ? fa(-f.d) + ' روز از سررسید قسط گذشته'
        : f.st === 'd0' ? 'امروز سررسید قسط است'
        : f.st === 'd1' ? 'فردا سررسید قسط است'
        : fa(f.d) + ' روز تا سررسید قسط';
      await self.registration.showNotification('💳 ' + when + ' — ' + f.it.bank, Object.assign({}, base, {
        tag: 'inst-' + f.it.id,
        body: 'قسط ' + fa(f.it.n) + ' از ' + fa(f.it.total) + (f.it.fee ? ' (کارمزدی)' : '') + ' | مبلغ: ' + fa(f.it.amount) + ' ریال | سررسید: ' + faStr(f.it.nextDate)
      }));
      sent[f.key] = today;
    }
  } else {
    await self.registration.showNotification('💳 ' + fa(fresh.length) + ' قسط نزدیک یا گذشته از سررسید', Object.assign({}, base, {
      tag: 'inst-summary', body: fresh.slice(0, 4).map((f) => f.it.bank).join('، ') + ' و ...'
    }));
    fresh.forEach((f) => { sent[f.key] = today; });
  }
  await kvSet('sent', sent);
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'inst-due') event.waitUntil(checkInstallments());
});
