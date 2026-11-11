(() => {
  const script = new URL(document.currentScript.src);
  const base = script.pathname.slice(0,-'/feedback/pages.js'.length);
  const pageRoutes = new Set(['/','/login','/settings','/knowledge','/knowledge/apply','/knowledge/assessment','/family','/pulse','/pulse/history','/pulse/r','/survey']);
  function route(input) {
    const pathname = input ?? location.pathname;
    const relative = base && (pathname === base || pathname.startsWith(base+'/')) ? pathname.slice(base.length) : pathname;
    const page = relative.replace(/\/+$/,'') || '/';
    if (page === '/pulse/r' && input === undefined) {
      const token = new URLSearchParams(location.search).get('token');
      return token && /^[A-Za-z0-9_-]{1,120}$/.test(token) ? '/pulse/r/' + token : page;
    }
    return page;
  }
  function path(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return value;
    const target = new URL(value,location.origin);
    const logical = route(target.pathname);
    if (logical.startsWith('/pulse/r/')) {
      const token = logical.slice('/pulse/r/'.length);
      if (/^[A-Za-z0-9_-]{1,120}$/.test(token)) {
        target.searchParams.set('token',token);
        return base+'/pulse/r/'+target.search+target.hash;
      }
    }
    if (pageRoutes.has(logical)) return base+(logical==='/' ? '/' : logical+'/')+target.search+target.hash;
    if (base && (target.pathname === base || target.pathname.startsWith(base+'/'))) return value;
    return base+target.pathname+target.search+target.hash;
  }
  globalThis.madarPages = {
    base,route,path,
    absolute(value, origin = location.origin) { return new URL(path(value),origin); },
    assign(value) { location.assign(path(value)); },
    replace(value) { location.replace(path(value)); },
    nav(value) {
      if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return value;
      const logical = route(new URL(value,location.origin).pathname);
      return pageRoutes.has(logical) || logical.startsWith('/pulse/r/') ? path(value) : value;
    },
  };
})();
