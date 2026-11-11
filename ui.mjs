import {Zip, workbook} from './archive.mjs';

let storagePromise;
function storage() {
  return storagePromise ??= import('./cloud.mjs')
    .catch(error => {storagePromise = null; throw error;});
}

const layer = document.createElement('div');
layer.dataset.feedbackUi = '';
layer.innerHTML = `
  <button class="mf-trigger" type="button">Feedback</button>
  <dialog class="mf-dialog" aria-labelledby="mf-title">
    <header><h2 id="mf-title">إرسال ملاحظة</h2><button type="button" data-close aria-label="إغلاق">×</button></header>
    <form class="mf-body" id="mf-send">
      <label>عنوان التغيير<input name="title" required maxlength="160"></label>
      <label>وصف المشكلة أو التغيير<textarea name="description" required maxlength="4000"></textarea></label>
      <label>النوع<select name="category" required><option value="">اختر النوع</option><option value="bug">مشكلة (Bug)</option><option value="addition">إضافة</option><option value="design">تغيير في الشكل</option></select></label>
      <div class="mf-actions">
        <button type="button" id="mf-capture"><svg width="18" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h4l2-3h6l2 3h4v15H3z"/><circle cx="12" cy="13" r="4"/></svg> تحديد جزء من الشاشة</button>
        <button type="button" id="mf-tab-capture" hidden>التقاط من التبويب</button>
        <button type="button" id="mf-file-button">إرفاق صورة</button>
        <input type="file" accept="image/*" id="mf-file" hidden>
        <button type="button" id="mf-clear" hidden>إزالة الصورة</button>
      </div>
      <img id="mf-preview" alt="معاينة المرفق" hidden>
      <div class="mf-status" role="status" id="mf-send-status"></div>
      <div class="mf-actions"><button class="mf-primary">إرسال الملاحظة</button><button type="button" id="mf-open-admin">مراجعة الملاحظات</button></div>
    </form>
  </dialog>
  <dialog class="mf-dialog" aria-labelledby="mf-admin-title">
    <header><h2 id="mf-admin-title">مراجعة الملاحظات</h2><button type="button" data-close aria-label="إغلاق">×</button></header>
    <div class="mf-body">
      <p id="mf-review-login" hidden>سجّل الدخول بحساب مدير العرض عشان تفتح شاشة المراجعة. <a href="#" id="mf-go-login">تسجيل الدخول</a></p>
      <section id="mf-review" hidden>
        <div class="mf-actions"><button class="mf-primary" type="button" id="mf-export">تنزيل ZIP وExcel</button><button type="button" id="mf-refresh">تحديث</button></div>
        <div id="mf-entries"></div>
        <div class="mf-actions"><button type="button" id="mf-prev">السابق</button><button type="button" id="mf-next">التالي</button><small id="mf-page"></small></div>
        <p id="mf-cleanup" hidden>بعد التأكد إن ملف ZIP اتفتح عندك، تقدر تحذف الملاحظات اللي اتصدّرت. <button type="button" id="mf-delete" class="mf-delete">حذف الملاحظات المصدّرة</button> <button type="button" id="mf-keep">الاحتفاظ بها</button></p>
        <p id="mf-download"></p>
      </section>
      <div class="mf-status" role="status" id="mf-admin-status"></div>
    </div>
  </dialog>`;
document.body.append(layer);

const $ = selector => layer.querySelector(selector);
const [sendDialog, adminDialog] = layer.querySelectorAll('dialog');
const sendForm = $('#mf-send');
const reviewLogin = $('#mf-review-login');
const review = $('#mf-review');
const sendStatus = $('#mf-send-status');
const adminStatus = $('#mf-admin-status');
const preview = $('#mf-preview');
const types = {bug:'مشكلة', addition:'إضافة', design:'تغيير شكل'};
let image;
let imageURL;
let busy = false;
let page = 0;
let cursors = [null];
let exported = [];
let downloadURL;
let restoreFocus;

function message(error) {
  const hints = {
    'permission-denied':'Firestore رفض الطلب. اتأكد إن Test Mode لسه مفتوح.',
    'unavailable':'تعذر الاتصال بـ Firestore. جرّب مرة تانية.',
  };
  return hints[error.code] || error.message || String(error);
}
function pagePath() {
  const path = globalThis.madarPages.route().replace(/^\/pulse\/r\/.+/, '/pulse/r/[رابط الاستبيان]');
  return (path + (/^#[a-z0-9-]{1,40}$/i.test(location.hash) ? location.hash : '')).slice(0,180);
}
function setImage(value) {
  image = value;
  if (imageURL) URL.revokeObjectURL(imageURL);
  imageURL = value ? URL.createObjectURL(new Blob([value], {type:'image/jpeg'})) : null;
  if (imageURL) preview.src = imageURL;
  else preview.removeAttribute('src');
  preview.hidden = !imageURL;
  $('#mf-clear').hidden = !imageURL;
}
async function compress(source, width, height) {
  let scale = Math.min(1, 1500 / Math.max(width,height));
  const canvas = document.createElement('canvas');
  for (let attempt = 0; attempt < 7; attempt++) {
    canvas.width = Math.max(1, Math.round(width*scale));
    canvas.height = Math.max(1, Math.round(height*scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(source,0,0,canvas.width,canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.84));
    if (blob && blob.size <= 245760) return new Uint8Array(await blob.arrayBuffer());
    scale *= .73;
  }
  throw Error('تعذّر ضغط الصورة. اختار مساحة أصغر.');
}

let renderer;
function loadRenderer() {
  return renderer ??= new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(Error('أداة تصوير الصفحة لم تتحمّل. جرّب الالتقاط من التبويب أو أرفق صورة.'));
    document.head.append(script);
  }).catch(error => { renderer = null; throw error; });
}
function pickRegion() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'mf-select';
    overlay.innerHTML = '<p>اسحب لتحديد المنطقة. Esc للإلغاء.</p><div class="mf-rect" hidden></div>';
    const outline = overlay.lastElementChild;
    let start;
    let rect;
    function finish(value) {
      window.removeEventListener('keydown', cancel);
      overlay.remove();
      resolve(value);
    }
    function cancel(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish();
      }
    }
    function position(event) {
      const x = Math.max(0, Math.min(innerWidth, event.clientX));
      const y = Math.max(0, Math.min(innerHeight, event.clientY));
      return {left:Math.min(x,start.x),top:Math.min(y,start.y),width:Math.abs(x-start.x),height:Math.abs(y-start.y)};
    }
    overlay.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      start = {x:event.clientX,y:event.clientY};
      outline.hidden = false;
      overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener('pointermove', event => {
      if (!start || !event.isPrimary) return;
      rect = position(event);
      for (const [key,value] of Object.entries(rect)) outline.style[key] = value + 'px';
    });
    overlay.addEventListener('pointerup', event => {
      if (!start || !event.isPrimary) return;
      rect = position(event);
      finish(rect.width >= 10 && rect.height >= 10 ? rect : undefined);
    });
    overlay.addEventListener('pointercancel', () => finish());
    overlay.addEventListener('wheel', event => event.preventDefault(), {passive:false});
    window.addEventListener('keydown',cancel);
    layer.append(overlay);
  });
}
$('.mf-trigger').onclick = () => {
  restoreFocus = document.activeElement;
  sendDialog.showModal();
};
for (const close of layer.querySelectorAll('[data-close]')) {
  close.onclick = () => { if (!busy) close.closest('dialog').close(); };
}
for (const dialog of [sendDialog,adminDialog]) {
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
}
$('#mf-clear').onclick = () => setImage();
$('#mf-file-button').onclick = () => $('#mf-file').click();
$('#mf-file').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    try { setImage(await compress(bitmap,bitmap.width,bitmap.height)); }
    finally { bitmap.close(); }
    sendStatus.textContent = 'تم إرفاق الصورة.';
  } catch (error) { sendStatus.textContent = message(error); }
};
async function capture(renderRegion) {
  sendDialog.close();
  sendStatus.textContent = '';
  try {
    const canvas = await renderRegion();
    if (!canvas) return;
    setImage(await compress(canvas,canvas.width,canvas.height));
    sendStatus.textContent = 'راجع اللقطة قبل الإرسال.';
  } catch (error) { sendStatus.textContent = message(error); }
  finally {
    if (restoreFocus?.isConnected) restoreFocus.focus({preventScroll:true});
    sendDialog.showModal();
  }
}
$('#mf-capture').onclick = () => capture(async () => {
  const rect = await pickRegion();
  if (!rect) return;
  try {
    const render = await loadRenderer();
    return await render(document.body,{
      x:scrollX + rect.left, y:scrollY + rect.top,
      width:rect.width, height:rect.height, scale:Math.min(devicePixelRatio, 2, 1500/Math.max(rect.width,rect.height)),
      logging:false, useCORS:true,
      ignoreElements: element => element.hasAttribute('data-feedback-ui') || element.tagName === 'IFRAME' || element.type === 'password',
    });
  } catch (error) {
    $('#mf-tab-capture').hidden = !navigator.mediaDevices?.getDisplayMedia;
    throw error;
  }
});
$('#mf-tab-capture').onclick = () => capture(async () => {
  const stream = await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:false,preferCurrentTab:true});
  try {
    if (stream.getVideoTracks()[0].getSettings().displaySurface !== 'browser') throw Error('اختار تبويب مدار درعه الحالي من نافذة المشاركة.');
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const rect = await pickRegion();
    if (!rect) return;
    await new Promise(resolve => setTimeout(resolve,150));
    const scaleX = video.videoWidth / innerWidth;
    const scaleY = video.videoHeight / innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width * scaleX);
    canvas.height = Math.round(rect.height * scaleY);
    canvas.getContext('2d').drawImage(video,rect.left*scaleX,rect.top*scaleY,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
    return canvas;
  } finally { for (const track of stream.getTracks()) track.stop(); }
});
sendForm.onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  const data = new FormData(sendForm);
  const title = data.get('title').trim();
  const description = data.get('description').trim();
  if (!title || !description) {
    sendStatus.textContent = 'اكتب العنوان والوصف.';
    return;
  }
  busy = true;
  const button = sendForm.querySelector('.mf-primary');
  button.disabled = true;
  sendStatus.textContent = 'جاري الحفظ…';
  try {
    const repo = await storage();
    await repo.save({id:crypto.randomUUID(),title,description,category:data.get('category'),page:pagePath()},image);
    sendForm.reset();
    setImage();
    sendStatus.textContent = 'اتحفظت الملاحظة.';
  } catch (error) { sendStatus.textContent = message(error); }
  finally { busy = false; button.disabled = false; }
};

async function showPage(index) {
  const repo = await storage();
  const {items,cursor} = await repo.list(cursors[index],20);
  const entries = $('#mf-entries');
  entries.replaceChildren();
  for (const row of items) {
    const entry = document.createElement('article');
    entry.className = 'mf-entry';
    const heading = document.createElement('strong');
    const details = document.createElement('span');
    const meta = document.createElement('small');
    heading.textContent = row.title;
    details.textContent = row.description;
    meta.textContent = [types[row.category],row.page,new Date(row.createdAt).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',calendar:'gregory'}),row.hasImage?'مع صورة':''].filter(Boolean).join(' · ');
    entry.append(heading,details,meta);
    if (row.hasImage) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'عرض الصورة';
      button.onclick = async () => {
        button.disabled = true;
        try {
          const picture = await repo.picture(row.id);
          const url = URL.createObjectURL(new Blob([picture],{type:'image/jpeg'}));
          const img = document.createElement('img');
          img.alt = 'لقطة الملاحظة';
          img.onload = img.onerror = () => URL.revokeObjectURL(url);
          img.src = url;
          button.replaceWith(img);
        } catch (error) { adminStatus.textContent = message(error); button.disabled = false; }
      };
      entry.append(button);
    }
    entries.append(entry);
  }
  if (!items.length) entries.textContent = 'مفيش ملاحظات في الصفحة دي.';
  page = index;
  cursors.splice(page + 1);
  if (cursor) cursors.push(cursor);
  $('#mf-page').textContent = 'صفحة ' + (page + 1);
  $('#mf-prev').disabled = page === 0;
  $('#mf-next').disabled = !cursor;
}
async function reviewerTask(task) {
  if (busy) return;
  busy = true;
  adminStatus.textContent = '';
  try { await task(); }
  catch (error) { adminStatus.textContent = message(error); }
  finally { busy = false; }
}
async function reviewerView() {
  const repo = await storage();
  const allowed = await repo.isReviewer();
  reviewLogin.hidden = allowed;
  review.hidden = !allowed;
  if (allowed) {
    cursors = [null];
    await showPage(0);
  }
}
$('#mf-open-admin').onclick = () => {
  sendDialog.close();
  adminDialog.showModal();
  void reviewerTask(reviewerView);
};
$('#mf-go-login').onclick = event => {
  event.preventDefault();
  sessionStorage.removeItem('madar-demo-user:' + globalThis.madarPages.base);
  globalThis.madarPages.assign('/login');
};
$('#mf-prev').onclick = () => reviewerTask(() => showPage(page - 1));
$('#mf-next').onclick = () => reviewerTask(() => showPage(page + 1));
$('#mf-refresh').onclick = () => reviewerTask(reviewerView);
$('#mf-keep').onclick = () => { exported = []; $('#mf-cleanup').hidden = true; };
$('#mf-delete').onclick = () => reviewerTask(async () => {
  if (!exported.length || !confirm('اتأكدت إن ملف ZIP بيفتح؟ الحذف هيشمل ' + exported.length + ' ملاحظة من الملف ده.')) return;
  const repo = await storage();
  while (exported.length) {
    await repo.remove(exported.slice(0,100));
    exported.splice(0,100);
    adminStatus.textContent = 'متبقي للحذف ' + exported.length;
  }
  $('#mf-cleanup').hidden = true;
  await reviewerView();
  adminStatus.textContent = 'اتحذفت الملاحظات المصدّرة.';
});
$('#mf-export').onclick = () => reviewerTask(async () => {
  const name = 'Madar_Feedback_' + new Date().toISOString().slice(0,19).replace(/:/g,'-') + '.zip';
  let handle;
  if (window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({suggestedName:name,types:[{description:'ZIP',accept:{'application/zip':['.zip']}}]});
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (error.name !== 'SecurityError' && error.name !== 'NotAllowedError') throw error;
    }
  }
  const repo = await storage();
  exported = [];
  $('#mf-cleanup').hidden = true;
  $('#mf-download').replaceChildren();
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  const output = handle ? await handle.createWritable() : null;
  const chunks = [];
  let buffered = 0;
  const zip = new Zip(async chunk => {
    if (output) await output.write(chunk);
    else {
      buffered += chunk.byteLength;
      if (buffered > 160 * 1024 * 1024) throw Error('التصدير كبير. افتح النسخة في Chrome أو Edge واستخدم اختيار مكان حفظ الملف.');
      chunks.push(chunk);
    }
  });
  const rows = [];
  const captured = [];
  let cursor = null;
  try {
    do {
      const batch = await repo.list(cursor,100);
      cursor = batch.cursor;
      for (let start = 0; start < batch.items.length; start += 8) {
        const records = batch.items.slice(start,start+8);
        const pictures = await Promise.all(records.map(record => record.hasImage ? repo.picture(record.id) : undefined));
        for (const [index,record] of records.entries()) {
          const number = String(rows.length + 1).padStart(6,'0');
          const path = record.hasImage ? 'screenshots/' + number + '.jpg' : '';
          if (path) await zip.add(path,pictures[index]);
          rows.push([number,types[record.category],record.title,record.description,record.page,record.createdAt,path,record.id]);
          captured.push({id:record.id,hasImage:record.hasImage});
        }
        adminStatus.textContent = 'جاري تجهيز ' + rows.length + ' ملاحظة…';
      }
    } while (cursor);
    if (!rows.length) {
      if (output) await output.abort();
      adminStatus.textContent = 'مفيش ملاحظات للتصدير.';
      return;
    }
    await zip.add('Feedback.xlsx',await workbook(rows));
    await zip.finish();
    if (output) {
      await output.close();
      exported = captured;
      $('#mf-cleanup').hidden = false;
    } else {
      downloadURL = URL.createObjectURL(new Blob(chunks,{type:'application/zip'}));
      const download = document.createElement('a');
      download.href = downloadURL;
      download.download = name;
      download.textContent = 'تحميل ' + name;
      download.onclick = () => { exported = captured; $('#mf-cleanup').hidden = false; };
      $('#mf-download').append(download);
    }
    adminStatus.textContent = 'اتجهزت ' + rows.length + ' ملاحظة.';
  } catch (error) {
    if (output) await output.abort().catch(() => {});
    throw error;
  }
});

