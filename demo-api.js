(() => {
  const nativeFetch = window.fetch.bind(window);
  const pages = globalThis.madarPages;
  const key = 'madar-feedback-demo-v1:' + pages.base;
  const sessionKey = 'madar-demo-user:' + pages.base;
  const demoEmail = 'admin@madar-demo.test';
  const demoPassword = 'MadarDemo-2026!';
  const roles = { [demoEmail]:['admin',demoPassword], 'demo01@deraah.test':['employee','MadarEmployee-2026!'] };
  const ready = nativeFetch(pages.path('/feedback/fixtures.json')).then(response => response.json()).then(seed => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : seed;
  });
  const role = () => sessionStorage.getItem(sessionKey);
  const timestamp = () => new Date().toISOString();
  const id = () => crypto.randomUUID();
  const ok = (data = {ok:true}, status = 200) => Response.json(data, {status});
  const fail = (error, status) => ok({error}, status);
  const persist = data => localStorage.setItem(key,JSON.stringify(data));
  const replace = (array, value) => {
    const index = array.findIndex(row => row.id === value.id);
    if (index === -1) array.unshift(value);
    else array[index] = {...array[index],...value};
  };
  const base = '/pulse/api';
  const attachments = new Map();
  const fileDB = new Promise((resolve, reject) => {
    const request = indexedDB.open('madar-preview-files:' + pages.base,1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function addFile(file) {
    if (!(file instanceof Blob) || !file.size) return undefined;
    const key = id();
    const db = await fileDB;
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files','readwrite');
      tx.objectStore('files').put(file,key);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    attachments.set(key,URL.createObjectURL(file));
    return {id:key,name:file.name};
  }
  async function assetURL(fixtures, target) {
    if (fixtures.files[target]) return pages.path(fixtures.files[target]);
    if (!target.startsWith('/files/')) return undefined;
    const key = target.split('/').at(-1);
    if (attachments.has(key)) return attachments.get(key);
    const db = await fileDB;
    return new Promise((resolve,reject) => {
      const request = db.transaction('files').objectStore('files').get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (!request.result) return resolve();
        if (!attachments.has(key)) attachments.set(key,URL.createObjectURL(request.result));
        resolve(attachments.get(key));
      };
    });
  }
  function notify(fixtures, title, body, href) {
    const note = {id:id(),title,body,href,at:timestamp()};
    for (const name of ['admin','employee']) fixtures[name]['/api/notifications'].unshift(note);
  }
  function changes(fixtures, profile, action, data) {
    const name = role();
    const trainer = profile['/api/trainer'];
    const portal = profile['/api/portal'];
    const family = profile['/api/family'];
    const shared = fixtures.admin['/api/trainer'];
    const boards = fixtures.admin['/api/trainer/assessments'];
    const application = shared.applications.find(row => row.id === data.id);
    const session = shared.sessions.find(row => row.id === data.id);
    const bulletin = fixtures.admin['/api/family'].bulletins.find(row => row.id === data.id);
    const survey = boards.items.find(row => row.id === data.id);
    const today = new Date().toISOString().slice(0,10);
    switch (action) {
      case 'trainer.apply': {
        const row = {id:id(),campaign:data.campaign,name:portal.me.name,department:data.department||portal.me.department,profileId:portal.me.id,topic:data.topic,outline:data.outline,material:data.material||'',answers:data.answers||{},at:timestamp(),status:'submitted',mine:true,reviews:[],reviewCount:0,reviewComplete:false};
        trainer.applications.unshift(row);
        if (name !== 'admin') shared.applications.unshift({...row,mine:false});
        break;
      }
      case 'trainer.campaign': {
        const row = {...data,id:data.id||id(),panel:data.panel||[],questions:data.questions||[],rubric:data.rubric||[]};
        for (const kind of ['admin','employee']) {
          replace(fixtures[kind]['/api/trainer'].campaigns,row);
          const available = fixtures[kind]['/api/public/knowledge'].campaigns;
          if (row.status === 'open' && (!row.deadline || row.deadline >= today)) replace(available,row);
          else fixtures[kind]['/api/public/knowledge'].campaigns = available.filter(item => item.id !== row.id);
        }
        break;
      }
      case 'trainer.appointment':
        if (!application) return false;
        application.appointment = data.appointment;
        const employee = fixtures.employee['/api/trainer'];
        const calendars = [shared.calendar];
        if (employee.applications.some(item => item.id === application.id)) calendars.push(employee.calendar);
        for (const list of calendars) {
          const index = list.findIndex(event => event.id === application.id);
          if (index >= 0) list.splice(index,1);
          if (data.appointment) list.push({id:application.id,kind:'interview',title:application.topic,at:data.appointment,detail:application.name});
        }
        break;
      case 'trainer.evaluate': {
        if (!application) return false;
        const ratings = Object.values(data.ratings || {});
        application.reviews ||= [];
        const by = portal.me.id;
        const review = {by,ratings:data.ratings,note:data.note};
        application.reviews = application.reviews.filter(item => item.by !== by).concat(review);
        application.reviewCount = application.reviews.length;
        application.reviewComplete = true;
        application.score = ratings.reduce((sum,n) => sum + n,0) * 20 / Math.max(1,ratings.length);
        break;
      }
      case 'trainer.decide':
        if (!application) return false;
        Object.assign(application,{status:data.status,decision:data.note||''});
        break;
      case 'trainer.session':
        replace(shared.sessions,{feedbackCount:0,quizCount:0,feedbackDimensions:[],published:false,quiz:[],...data,id:data.id||id()});
        break;
      case 'trainer.sessionClose':
      case 'trainer.sessionPublish':
        if (!session) return false;
        if (action.endsWith('Close')) session.status = 'closed';
        else {
          session.published = true;
          const event = {id:session.id,kind:'session',title:session.title,at:session.at,detail:''};
          for (const kind of ['admin','employee']) {
            replace(fixtures[kind]['/api/trainer'].calendar,event);
            if (kind !== 'admin') replace(fixtures[kind]['/api/trainer'].sessions,session);
          }
          notify(fixtures,session.title,session.at,'/knowledge');
        }
        break;
      case 'trainer.rate': {
        if (!session) return false;
        const scores = Object.values(data.observation||{});
        session.adminRatings = data.observation;
        session.adminNote = data.note;
        session.adminScore = scores.reduce((sum,n) => sum + n,0)*20/Math.max(1,scores.length);
        break;
      }
      case 'trainer.board': return true;
      case 'trainer.feedback':
      case 'trainer.quiz': {
        const row = trainer.sessions.find(item => item.id === data.id);
        if (!row) return false;
        if (action.endsWith('feedback')) {
          row.feedbackDone = true;
          row.feedbackCount = (row.feedbackCount||0) + 1;
        } else {
          row.quizDone = true;
          row.quizCount = (row.quizCount||0) + 1;
        }
        break;
      }
      case 'trainer.assessmentSave':
        replace(boards.items,{count:0,participants:[],results:[],...data,id:data.id||id()});
        break;
      case 'trainer.assessmentStatus':
        if (!survey) return false;
        survey.status = data.status;
        break;
      case 'trainer.assessmentStart': return true;
      case 'trainer.assessmentSubmit':
        if (!survey) return false;
        survey.done = true;
        break;
      case 'family.comment':
        if (!bulletin) return false;
        bulletin.comments.push({id:id(),name:portal.me.name,text:data.text||data.comment,at:timestamp()});
        break;
      case 'family.removeComment':
        if (!bulletin) return false;
        bulletin.comments = bulletin.comments.filter(row => row.id !== data.comment);
        break;
      case 'family.hide':
        if (!bulletin) return false;
        bulletin.hidden = data.hidden;
        break;
      case 'family.delete':
        fixtures.admin['/api/family'].bulletins = fixtures.admin['/api/family'].bulletins.filter(row => row.id !== data.id);
        break;
      case 'family.feature':
        if (!bulletin) return false;
        fixtures.admin['/api/family'].current = bulletin.id;
        break;
      case 'system.registration':
        fixtures.admin['/api/portal'].registration = Boolean(data.open ?? data.enabled);
        fixtures.public['/api/public'].registration = fixtures.admin['/api/portal'].registration;
        break;
      case 'system.profile':
        Object.assign(portal.me,data.profile || data);
        break;
      case 'system.program':
        for (const p of [fixtures.public['/api/public'],fixtures.admin['/api/portal'],fixtures.employee['/api/portal']]) {
          p.programs[data.program] = Boolean(data.open);
        }
        break;
      case 'system.demo': return true;
      case 'notice.read':
      case 'notice.readAll':
        for (const row of profile['/api/notifications']) if (!data.id || row.id === data.id) row.read = true;
        break;
      default: return false;
    }
    if (action.startsWith('family.')) {
      const full = fixtures.admin['/api/family'];
      Object.assign(fixtures.employee['/api/family'],{...full,bulletins:full.bulletins.filter(row => !row.hidden)});
    }
    if (application && action.startsWith('trainer.')) {
      const own = fixtures.employee['/api/trainer'].applications.find(row => row.id === application.id);
      if (own) Object.assign(own, {appointment:application.appointment,status:application.status,decision:application.decision});
    }
    return true;
  }

  window.fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const path = url.pathname;
    if (url.origin !== location.origin || !/^\/(?:api\/|pulse\/api\/|files\/)/.test(path)) return nativeFetch(input,options);
    const method = (options?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const state = await ready;
    const profile = state[role()];
    const resource = path + url.search;
    const mapped = await assetURL(state,resource);
    if (mapped) return nativeFetch(mapped);
    const body = async () => {
      if (options?.body instanceof FormData) return options.body;
      if (typeof options?.body === 'string') return JSON.parse(options.body);
      if (input instanceof Request) return input.json();
      return {};
    };
    if (method === 'POST' && path === '/api/login') {
      const form = await body();
      const entry = roles[String(form.email).toLowerCase()];
      if (!entry || entry[1] !== form.password) return fail('بيانات الدخول التجريبية غير صحيحة.',401);
      sessionStorage.setItem(sessionKey,entry[0]);
      return ok();
    }
    if (path === '/api/logout') {
      sessionStorage.removeItem(sessionKey);
      return ok();
    }
    if (path.startsWith(base+'/public/surveys/')) {
      const publicPath = method === 'POST' ? path.slice(0,-10) : path;
      const item = state.public[publicPath];
      const survey = state.admin[base+'/surveys'].find(row => row.id === item?.id);
      if (!item || survey?.status !== 'published') return fail('not_found',404);
      if (method === 'GET') return ok({...item,definition:survey.definition});
      if (method === 'POST' && path.endsWith('/responses')) {
        const answer = await body();
        if (!answer.consent || !Number.isInteger(answer.enps) || answer.enps < 0 || answer.enps > 10) return fail('invalid_response',400);
        (state.demoAnswers ||= {})[survey.id] ||= [];
        state.demoAnswers[survey.id].push({id:id(),enps:answer.enps,answers:answer.answers||{},comment:answer.comment||''});
        survey.response_count++;
        persist(state);
        return ok({},201);
      }
    }
    if (method === 'GET' && Object.hasOwn(state.public,path)) return ok(state.public[path]);
    if (path === '/api/register') return ok();
    if (!profile) return fail('سجّل الدخول بالحساب التجريبي.',401);
    if (method === 'GET' && Object.hasOwn(profile,path)) return ok(profile[path]);
    if (path === '/api/upload' && method === 'POST') {
      return ok(await addFile((await body()).get('file')) || {},201);
    }
    if (path === '/api/family/save' && method === 'POST') {
      const form = await body();
      const family = state.admin['/api/family'];
      const pdf = await addFile(form.get('pdf'));
      const video = await addFile(form.get('video'));
      if (form.get('mode') === 'intro') family.intro = video || (form.has('removeVideo') ? null : family.intro);
      else {
        const key = form.get('id') || id();
        const old = family.bulletins.find(row => row.id === key);
        replace(family.bulletins,{id:key,title:form.get('title'),summary:form.get('summary'),at:old?.at||timestamp(),hidden:old?.hidden||false,comments:old?.comments||[],pdf:pdf||(form.has('removePDF')?null:old?.pdf),video:video||(form.has('removeVideo')?null:old?.video)});
        if (!old) {
          family.current = key;
          notify(state,form.get('title'),'اتنشرت نشرة جديدة','/family?tab=current');
        }
      }
      state.employee['/api/family'] = {...family,bulletins:family.bulletins.filter(row => !row.hidden)};
      persist(state);
      return ok();
    }
    if (path === '/api/action' || (path === '/api/public/knowledge' && method === 'POST')) {
      const form = await body();
      if (form instanceof FormData) {
        const file = await addFile(form.get('file'));
        const values = Object.fromEntries(form);
        values.material = file?.id;
        values.answers = Object.fromEntries([...form].filter(([key]) => key.startsWith('extra-')).map(([key,value]) => [key.slice(6),value]));
        if (!changes(state,profile,'trainer.apply',values)) return fail('تعذّر إرسال الطلب التجريبي.',422);
        persist(state);
        return ok();
      }
      const accepted = changes(state,profile,form.action,form.data||{});
      if (!accepted) return fail('الإجراء ده غير متاح في نسخة العرض.',422);
      persist(state);
      return ok();
    }
    if (path === '/api/trainer/assessment' && method === 'GET') {
      const assessment = state.admin['/api/trainer/assessments'].items.find(item => item.id === url.searchParams.get('id'));
      return assessment ? ok(assessment) : fail('الاختبار غير موجود.',404);
    }
    if (path === '/api/survey/submit') return ok();
    if (path.startsWith(base+'/surveys') && role() === 'admin') {
      const surveys = profile[base+'/surveys'];
      const [surveyId,action] = path.slice((base+'/surveys/').length).split('/');
      const survey = surveys.find(item => item.id === surveyId);
      if (method === 'POST' && path === base+'/surveys') {
        const row = {...await body(),id:id(),status:'draft',response_count:0,created_at:timestamp()};
        surveys.unshift(row);
        persist(state);
        return ok({id:row.id},201);
      }
      if (method === 'POST' && surveyId === 'demo') return ok({id:'pulse-demo-v1'});
      if (!survey) return fail('not_found',404);
      if (method === 'PUT') Object.assign(survey,await body());
      if (action === 'status' && method === 'POST') survey.status = (await body()).status;
      if (action === 'visibility' && method === 'PATCH') {
        survey.employee_visible = Boolean((await body()).visible);
      }
      if (action === 'link' && method === 'POST') {
        if (!state.links[survey.id]) {
          const token = id();
          state.links[survey.id] = {path:'/pulse/r/'+token};
          state.public[base+'/public/surveys/'+token] = survey;
        }
        persist(state);
        return ok(state.links[survey.id]);
      }
      if (action === 'analytics' && method === 'GET') {
        const answers = state.demoAnswers?.[survey.id] || [];
        const count = answers.length;
        const promoters = answers.filter(row => row.enps >= 9).length;
        const detractors = answers.filter(row => row.enps <= 6).length;
        const drivers = (survey.definition?.categories || []).map(category => {
          const ratings = answers.flatMap(row => category.questions.map(question => row.answers[question.id]).filter(Number.isInteger));
          return {id:category.id,name:category.name,track:category.track,respondents:answers.filter(row => category.questions.some(question => Number.isInteger(row.answers[question.id]))).length,average:ratings.length ? ratings.reduce((sum,value) => sum+value,0)/ratings.length : null,favorable:ratings.length ? 100*ratings.filter(value => value>=4).length/ratings.length : null};
        });
        return ok({survey_id:survey.id,status:survey.status,response_count:count,expected_count:survey.expected_count,release:survey.status==='closed'&&count?'released':'insufficient',overall:{count,enps:count ? Math.round(100*(promoters-detractors)/count) : null,promoters,passives:count-promoters-detractors,detractors,suppressed:false},drivers,themes:[]});
      }
      if (action === 'comments' && method === 'GET') {
        const items = (state.demoAnswers?.[survey.id]||[]).filter(row => row.comment).map(row => ({id:row.id,body:row.comment,status:'pending'}));
        const page = Math.max(1,Number(url.searchParams.get('page'))||1);
        return ok({items:items.slice((page-1)*25,page*25),page,pages:Math.max(1,Math.ceil(items.length/25)),total:items.length});
      }
      if (method === 'GET') return fail('not_found',404);
      persist(state);
      return ok();
    }
    if (path.startsWith(base+'/plans') && ['POST','PUT'].includes(method)) {
      const plan = await body();
      const owner = profile[base+'/owners'].find(item => item.id === plan.owner_id);
      replace(profile[base+'/plans'],{...plan,id:path.split('/')[4]||id(),owner:owner?.name||''});
      persist(state);
      return ok();
    }
    return fail('الإجراء ده غير متاح في نسخة العرض.',404);
  };

  function prefill() {
    if (pages.route() !== '/login' && pages.route() !== '/') return;
    const input = document.querySelector('#root input[autocomplete=username]');
    const password = document.querySelector('#root input[autocomplete=current-password]');
    if (!input || !password || input.dataset.demoPrefilled) return;
    input.dataset.demoPrefilled = '1';
    if (!input.value) input.value = demoEmail;
    if (!password.value && input.value === demoEmail) password.value = demoPassword;
  }
  function rewire(node) {
    if (!(node instanceof Element)) return;
    const elements = [...node.querySelectorAll('[src^="/files/"],a[href^="/"]')];
    if (node.matches('[src^="/files/"],a[href^="/"]')) elements.push(node);
    for (const element of elements) {
      const attribute = element.tagName === 'A' ? 'href' : 'src';
      const source = element.getAttribute(attribute);
      if (!source) continue;
      if (attribute === 'href') {
        const navigation = pages.nav(source);
        if (navigation !== source) { element.setAttribute(attribute,navigation); continue; }
      }
      void ready.then(state => assetURL(state,source)).then(value => {
        if (value && element.isConnected && element.getAttribute(attribute) === source) element.setAttribute(attribute,value);
      }).catch(() => {});
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('#root');
    const observer = new MutationObserver(mutations => {
      prefill();
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') rewire(mutation.target);
        else for (const node of mutation.addedNodes) rewire(node);
      }
    });
    observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href']});
    prefill();
    rewire(root);
  });
})();
