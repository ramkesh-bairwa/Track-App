// Builds the Page Inspector report from a fetched page (see fetchPage in ./pageFetch).
import * as cheerio from 'cheerio';
import { resolveBase } from './pageFetch';

const MAX_LIST = 1000;
const MAX_IMAGES = 500;
const MAX_HEADINGS = 500;
const MAX_JSONLD_CHARS = 100000;
const clean = (s, max = 300) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const relTokens = (v) => String(v || '').toLowerCase().split(/\s+/).filter(Boolean);
const sameSite = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

function resolve(raw, base) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  try {
    return new URL(v, base).href;
  } catch {
    return null;
  }
}

// ---------- headers ----------

function parseCookie(line) {
  const [pair, ...attrs] = line.split(';');
  const name = pair.split('=')[0].trim();
  const flags = { secure: false, httpOnly: false, sameSite: null, path: null, domain: null, expires: null, maxAge: null, partitioned: false };
  for (const a of attrs) {
    const [k, ...rest] = a.split('=');
    const key = k.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'secure') flags.secure = true;
    else if (key === 'httponly') flags.httpOnly = true;
    else if (key === 'partitioned') flags.partitioned = true;
    else if (key === 'samesite') flags.sameSite = val || null;
    else if (key === 'path') flags.path = val || null;
    else if (key === 'domain') flags.domain = val || null;
    else if (key === 'expires') flags.expires = val || null;
    else if (key === 'max-age') flags.maxAge = val || null;
  }
  return { name, ...flags };
}

export function analyzeHeaders(headers, finalUrl) {
  const list = [];
  for (const [name, value] of headers) {
    if (name === 'set-cookie') continue;
    list.push({ name, value });
  }
  const cookieLines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const cookies = cookieLines.map(parseCookie);
  if (cookies.length) list.push({ name: 'set-cookie', value: `(${cookies.length} cookie${cookies.length === 1 ? '' : 's'}, values hidden)` });
  list.sort((a, b) => a.name.localeCompare(b.name));

  const get = (n) => headers.get(n);
  const csp = get('content-security-policy');
  const frameAncestors = csp?.match(/frame-ancestors\s+([^;]+)/i)?.[1]?.trim() || null;
  const isHttps = finalUrl.startsWith('https:');
  const security = [
    {
      key: 'hsts', label: 'Strict-Transport-Security', value: get('strict-transport-security'),
      hint: isHttps ? 'Tells browsers to always use HTTPS.' : 'Only has effect on HTTPS pages (this page is plain HTTP).',
    },
    {
      key: 'csp', label: 'Content-Security-Policy', value: csp,
      hint: !csp && get('content-security-policy-report-only') ? 'Only a report-only policy is set.' : 'Limits where scripts, styles and other resources can load from.',
    },
    {
      key: 'framing', label: 'X-Frame-Options / frame-ancestors',
      value: [get('x-frame-options') && `X-Frame-Options: ${get('x-frame-options')}`, frameAncestors && `frame-ancestors ${frameAncestors}`].filter(Boolean).join(' · ') || null,
      hint: 'Stops other sites from framing the page (clickjacking).',
    },
    {
      key: 'nosniff', label: 'X-Content-Type-Options', value: get('x-content-type-options'),
      hint: 'Should be "nosniff".',
    },
    { key: 'referrer', label: 'Referrer-Policy', value: get('referrer-policy'), hint: 'Controls how much of the URL is sent as the Referer.' },
    { key: 'permissions', label: 'Permissions-Policy', value: get('permissions-policy'), hint: 'Turns browser features (camera, geolocation…) on or off.' },
  ].map((h) => ({ ...h, present: Boolean(h.value), ok: h.key === 'nosniff' ? /nosniff/i.test(h.value || '') : Boolean(h.value) }));

  return { list, cookies, security, xRobotsTag: get('x-robots-tag') };
}

// ---------- HTML ----------

export function analyzeHtml(html, finalUrl) {
  const $ = cheerio.load(html);
  const base = resolveBase($, finalUrl);
  const host = new URL(finalUrl).hostname;

  // meta tags by lowercased name / property
  const metaName = {};
  const og = [];
  const twitter = [];
  let metaCharset = null;
  let refresh = null;
  $('meta').each((_, el) => {
    const m = $(el);
    const name = (m.attr('name') || '').trim().toLowerCase();
    const prop = (m.attr('property') || '').trim().toLowerCase();
    const content = m.attr('content') ?? '';
    if (m.attr('charset')) metaCharset = m.attr('charset');
    const equiv = (m.attr('http-equiv') || '').toLowerCase();
    if (equiv === 'content-type' && !metaCharset) metaCharset = content.match(/charset=([\w.:-]+)/i)?.[1] || null;
    if (equiv === 'refresh') refresh = content;
    if (name && !(name in metaName)) metaName[name] = content;
    const key = prop || name;
    if (/^(og|article|profile|book|fb):/.test(key)) og.push({ property: key, content: clean(content, 1000) });
    else if (key.startsWith('twitter:')) twitter.push({ name: key, content: clean(content, 1000) });
  });

  const linkRels = [];
  $('link[rel]').each((_, el) => {
    const l = $(el);
    linkRels.push({ rel: relTokens(l.attr('rel')), href: l.attr('href'), el: l });
  });
  const firstRel = (rel) => linkRels.find((l) => l.rel.includes(rel));

  const titleEl = $('head > title').first().length ? $('head > title').first() : $('title').first();
  const title = titleEl.length ? clean(titleEl.text(), 1000) : null;
  const description = metaName.description != null ? clean(metaName.description, 2000) : null;

  // favicon
  const iconLinks = linkRels.filter((l) => l.rel.includes('icon') || l.rel.includes('apple-touch-icon'));
  const icons = iconLinks
    .map((l) => ({ href: resolve(l.href, base), rel: l.rel.join(' '), sizes: l.el.attr('sizes') || null, type: l.el.attr('type') || null }))
    .filter((i) => i.href);
  const favicon =
    icons.find((i) => i.rel === 'icon' || i.rel === 'shortcut icon') || icons.find((i) => i.rel.split(' ').includes('icon')) || icons[0] || null;

  const overview = {
    lang: $('html').attr('lang') || null,
    metaCharset,
    title,
    titleLength: title ? title.length : 0,
    description,
    descriptionLength: description ? description.length : 0,
    canonical: resolve(firstRel('canonical')?.href, base),
    robots: metaName.robots ?? null,
    googlebot: metaName.googlebot ?? null,
    viewport: metaName.viewport ?? null,
    favicon: favicon ? { ...favicon, declared: true } : { href: new URL('/favicon.ico', finalUrl).href, declared: false },
    icons,
    generator: metaName.generator ?? null,
    themeColor: metaName['theme-color'] ?? null,
    refresh,
    baseHref: $('base[href]').attr('href') || null,
  };

  // headings
  const headings = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    if (headings.length >= MAX_HEADINGS) return false;
    const h = $(el);
    const text = clean(h.text(), 200) || clean(h.find('img[alt]').attr('alt'), 200);
    headings.push({ level: Number(el.tagName[1]), text });
  });
  const headingWarnings = [];
  const h1Count = headings.filter((h) => h.level === 1).length;
  if (!h1Count) headingWarnings.push({ type: 'no-h1', message: 'No <h1> on the page.' });
  if (h1Count > 1) headingWarnings.push({ type: 'multi-h1', message: `${h1Count} <h1> headings — usually a page has one.` });
  let prev = 0;
  headings.forEach((h, i) => {
    if (prev && h.level > prev + 1) {
      h.skipped = true;
      headingWarnings.push({ type: 'skip', index: i, message: `Skipped level: h${prev} → h${h.level} ("${clean(h.text, 60) || 'empty'}")` });
    }
    if (!h.text) h.empty = true;
    prev = h.level;
  });
  const emptyHeadings = headings.filter((h) => h.empty).length;
  if (emptyHeadings) headingWarnings.push({ type: 'empty', message: `${emptyHeadings} empty heading${emptyHeadings === 1 ? '' : 's'}.` });
  const headingCounts = [1, 2, 3, 4, 5, 6].map((lv) => headings.filter((h) => h.level === lv).length);

  // links
  const links = [];
  const linkCounts = { total: 0, internal: 0, external: 0, nofollow: 0, empty: 0, javascript: 0, mailto: 0, tel: 0, other: 0, newTab: 0 };
  $('a').each((_, el) => {
    const a = $(el);
    const raw = a.attr('href');
    const href = raw == null ? null : raw.trim();
    const rel = relTokens(a.attr('rel'));
    const text = clean(a.text(), 150) || clean(a.find('img[alt]').attr('alt'), 150) || clean(a.attr('aria-label') || a.attr('title'), 150);
    let kind;
    let url = null;
    if (href == null || href === '' || href === '#') kind = 'empty';
    else if (/^javascript:/i.test(href)) kind = 'javascript';
    else if (/^mailto:/i.test(href)) kind = 'mailto';
    else if (/^tel:/i.test(href)) kind = 'tel';
    else {
      url = resolve(href, base);
      if (!url) kind = 'other';
      else {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') kind = 'other';
        else kind = sameSite(u.hostname, host) ? 'internal' : 'external';
      }
    }
    const nofollow = rel.includes('nofollow') || rel.includes('ugc') || rel.includes('sponsored');
    linkCounts.total += 1;
    linkCounts[kind] += 1;
    if (nofollow) linkCounts.nofollow += 1;
    if (a.attr('target') === '_blank') linkCounts.newTab += 1;
    if (links.length < MAX_LIST) {
      links.push({ href: href == null ? null : clean(href, 500), url, text, kind, rel: rel.join(' ') || null, nofollow, target: a.attr('target') || null });
    }
  });

  // images
  const images = [];
  let imgTotal = 0;
  let missingAlt = 0;
  let emptyAlt = 0;
  $('img').each((_, el) => {
    const img = $(el);
    const alt = img.attr('alt');
    imgTotal += 1;
    if (alt == null) missingAlt += 1;
    else if (!alt.trim()) emptyAlt += 1;
    if (images.length >= MAX_IMAGES) return;
    const rawSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
    const isData = /^data:/i.test(rawSrc.trim());
    images.push({
      src: isData ? null : resolve(rawSrc, base),
      rawSrc: isData ? `${rawSrc.slice(0, 40)}…` : clean(rawSrc, 500),
      dataUri: isData,
      alt: alt == null ? null : clean(alt, 300),
      width: img.attr('width') || null,
      height: img.attr('height') || null,
      loading: img.attr('loading') || null,
      srcset: Boolean(img.attr('srcset')),
    });
  });

  // resources
  const stylesheets = [];
  linkRels.filter((l) => l.rel.includes('stylesheet')).forEach((l) => {
    stylesheets.push({ href: resolve(l.href, base), media: l.el.attr('media') || null });
  });
  const scripts = [];
  let inlineScripts = 0;
  let inlineScriptBytes = 0;
  const jsonLd = [];
  $('script').each((_, el) => {
    const s = $(el);
    const type = (s.attr('type') || '').trim().toLowerCase();
    if (type === 'application/ld+json') {
      const raw = s.html() || '';
      try {
        const data = JSON.parse(raw);
        const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
        const types = [...new Set(items.flatMap((d) => [].concat(d?.['@type'] || [])).map(String))];
        const pretty = JSON.stringify(data, null, 2);
        jsonLd.push({ valid: true, types, json: pretty.length > MAX_JSONLD_CHARS ? `${pretty.slice(0, MAX_JSONLD_CHARS)}\n…` : pretty });
      } catch (err) {
        jsonLd.push({ valid: false, error: err.message, raw: raw.trim().slice(0, 5000) });
      }
      return;
    }
    const src = s.attr('src');
    if (src) {
      scripts.push({
        src: resolve(src, base),
        async: s.attr('async') != null,
        defer: s.attr('defer') != null,
        module: type === 'module',
        type: type || null,
      });
    } else if (!type || /javascript|module|ecmascript/.test(type)) {
      inlineScripts += 1;
      inlineScriptBytes += (s.html() || '').length;
    }
  });
  const iframes = [];
  $('iframe').each((_, el) => {
    const f = $(el);
    iframes.push({ src: resolve(f.attr('src'), base) || (f.attr('srcdoc') != null ? '(srcdoc)' : null), title: f.attr('title') || null, loading: f.attr('loading') || null });
  });
  const hints = linkRels
    .filter((l) => l.rel.some((r) => ['preload', 'preconnect', 'dns-prefetch', 'modulepreload', 'prefetch', 'prerender'].includes(r)))
    .map((l) => ({ rel: l.rel.join(' '), href: resolve(l.href, base), as: l.el.attr('as') || null, crossorigin: l.el.attr('crossorigin') != null }));
  const resources = {
    stylesheets,
    inlineStyles: $('style').length,
    scripts,
    inlineScripts,
    inlineScriptBytes,
    asyncScripts: scripts.filter((s) => s.async).length,
    deferScripts: scripts.filter((s) => s.defer).length,
    moduleScripts: scripts.filter((s) => s.module).length,
    iframes,
    hints,
    manifest: resolve(firstRel('manifest')?.href, base),
  };

  // microdata
  const microTypes = new Map();
  $('[itemscope]').each((_, el) => {
    const t = $(el).attr('itemtype') || '(no itemtype)';
    for (const one of t.split(/\s+/).filter(Boolean)) {
      const top = $(el).parents('[itemscope]').length === 0;
      const cur = microTypes.get(one) || { type: one, count: 0, topLevel: 0 };
      cur.count += 1;
      if (top) cur.topLevel += 1;
      microTypes.set(one, cur);
    }
  });

  // visible text
  const body = $('body').clone();
  body.find('script, style, noscript, template, svg, iframe').remove();
  const text = body.text().replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;

  return {
    overview,
    social: { og, twitter },
    headings: { items: headings, counts: headingCounts, warnings: headingWarnings, truncated: headings.length >= MAX_HEADINGS },
    links: { counts: linkCounts, items: links, truncated: linkCounts.total > links.length },
    images: { total: imgTotal, missingAlt, emptyAlt, items: images, truncated: imgTotal > images.length },
    resources,
    structured: { jsonLd, microdata: [...microTypes.values()] },
    text: { words, characters: text.length, readingMinutes: words ? Math.max(1, Math.round(words / 230)) : 0, sample: clean(text, 400) },
  };
}
