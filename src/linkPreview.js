const dns = require('node:dns').promises;
const net = require('node:net');

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIp(ip) {
  const clean = String(ip || '').trim().toLowerCase();
  if (!clean) return true;
  if (clean === '::1' || clean === '::' || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) {
    return true;
  }
  if (clean.startsWith('::ffff:')) {
    return isPrivateIpv4(clean.slice(7));
  }
  if (net.isIPv4(clean)) return isPrivateIpv4(clean);
  if (net.isIPv6(clean)) return true;
  return false;
}

async function isSafePublicUrl(urlObj) {
  if (!urlObj || (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:')) return false;
  const host = (urlObj.hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const records = await dns.lookup(host, { all: true });
    if (!Array.isArray(records) || records.length === 0) return false;
    return records.every((r) => !isPrivateIp(r.address));
  } catch {
    return false;
  }
}

function extractFirstUrl(text) {
  if (typeof text !== 'string' || !text.includes('http')) return null;
  const m = /(https?:\/\/[^\s<>()[\]{}"']+)/i.exec(text);
  if (!m) return null;
  return m[1].replace(/[.,!?;:]+$/, '');
}

function decodeBasicEntities(str) {
  return String(str || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 32))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaContent(html, keys) {
  for (const key of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']{1,600})["'][^>]*>`, 'i');
    const m1 = re1.exec(html);
    if (m1 && m1[1]) return decodeBasicEntities(m1[1]);
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']{1,600})["'][^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
    const m2 = re2.exec(html);
    if (m2 && m2[1]) return decodeBasicEntities(m2[1]);
  }
  return '';
}

function createLinkPreviewService() {
  const cache = new Map(); // url -> { data, at }

  async function fetchPreview(rawUrl) {
    if (!rawUrl || typeof fetch !== 'function') return null;
    let urlObj;
    try {
      urlObj = new URL(rawUrl);
    } catch {
      return null;
    }

    const normalized = urlObj.toString();
    const cached = cache.get(normalized);
    if (cached && (Date.now() - cached.at) < 15 * 60 * 1000) {
      return cached.data;
    }

    if (!(await isSafePublicUrl(urlObj))) {
      return null;
    }

    try {
      const resp = await fetch(normalized, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(3500),
        headers: {
          'User-Agent': 'VibeRoom/1.0 (+https://chat.bitdev.fun)',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });
      if (!resp.ok) return null;
      const finalUrl = resp.url || normalized;
      try {
        const finalObj = new URL(finalUrl);
        if (!(await isSafePublicUrl(finalObj))) return null;
      } catch {
        return null;
      }

      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;

      let html = '';
      if (resp.body && typeof resp.body.getReader === 'function') {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let bytes = 0;
        while (bytes < 196 * 1024) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          html += decoder.decode(value, { stream: true });
          if (html.includes('</head>')) break;
        }
        try { reader.cancel(); } catch { }
      } else {
        html = (await resp.text()).slice(0, 196 * 1024);
      }

      const titleMatch = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html);
      const rawTitle = extractMetaContent(html, ['og:title', 'twitter:title']) || (titleMatch ? decodeBasicEntities(titleMatch[1]) : '');
      const rawDesc = extractMetaContent(html, ['og:description', 'twitter:description', 'description']);
      const rawSite = extractMetaContent(html, ['og:site_name']) || urlObj.hostname.replace(/^www\./i, '');
      let rawImg = extractMetaContent(html, ['og:image', 'twitter:image']);
      if (rawImg) {
        try {
          rawImg = new URL(rawImg, finalUrl).toString();
          if (!/^https?:\/\//i.test(rawImg)) rawImg = '';
        } catch {
          rawImg = '';
        }
      }

      const title = rawTitle.slice(0, 140);
      const description = rawDesc.slice(0, 220);
      const siteName = rawSite.slice(0, 60);
      if (!title && !description) return null;

      const preview = {
        url: normalized,
        siteName,
        title: title || urlObj.hostname,
        description,
        image: rawImg || null
      };

      if (cache.size > 200) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
      cache.set(normalized, { data: preview, at: Date.now() });
      return preview;
    } catch {
      return null;
    }
  }

  return {
    extractFirstUrl,
    fetchPreview
  };
}

module.exports = {
  createLinkPreviewService,
  extractFirstUrl,
  isPrivateIp,
  isSafePublicUrl
};
