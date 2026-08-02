/* istanbul ignore file */

var cheerio = require('cheerio');

// TMDB API key (falls back to process.env.TMDB_API_KEY if set)
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

var STREAMING_HOSTS = [
  'voe', 'dood', 'streamtape', 'veev', 'vidhide', 'dhtpre',
  'mixdrop', 'supervideo', 'uqload', 'filelion', 'lulustream', 'fastream',
  'dropload', 'savefiles', 'streamembed', 'vidara', 'vidsonic', 'firestream', 'vidmatrixa'
];

function isStreamingHost(hostname) {
  return STREAMING_HOSTS.some(function(host) {
    return hostname.includes(host);
  });
}

async function getFinalRedirect(urlToFetch, referer) {
  try {
    var res = await fetch(urlToFetch, {
      method: 'GET',
      headers: Object.assign({}, DEFAULT_HEADERS, { 'Referer': referer }),
      redirect: 'follow'
    });
    return res && res.url ? res.url : urlToFetch;
  } catch (e) {
    return urlToFetch;
  }
}

async function resolveVidaraPageToStream(pageUrl) {
  try {
    var parsed = new URL(pageUrl);
    var filecode = parsed.pathname.split('/').filter(Boolean).pop();
    if (!filecode) return null;

    var apiUrl = new URL('/api/stream', parsed.origin);
    var res = await fetch(apiUrl.href, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, DEFAULT_HEADERS),
      body: JSON.stringify({ filecode: filecode, device: 'web' })
    });

    if (!res.ok) return null;
    var data = await res.json();
    if (data && data.streaming_url) {
      return { streaming_url: data.streaming_url, title: data.title };
    }
  } catch (e) {
    return null;
  }
  return null;
}

function decodeHexUrl(hexString) {
  var joined = String(hexString || '').split('|').join('');
  var decoded = '';
  for (var i = 0; i < joined.length; i += 2) {
    decoded += String.fromCharCode(parseInt(joined.substring(i, i + 2), 16));
  }
  return decoded.split('').reverse().join('');
}

async function resolveVidsonicPageToStream(pageUrl) {
  try {
    var pageRes = await fetch(pageUrl, { headers: DEFAULT_HEADERS });
    if (!pageRes.ok) return null;
    var html = await pageRes.text();
    var $ = cheerio.load(html);
    var title = $('title').text().trim().replace(/^Watch\s*/i, '').trim();

    var hexMatch = html.match(/const _0x1\s*=\s*'([^']+)'/);
    if (!hexMatch || !hexMatch[1]) return null;

    var decoded = decodeHexUrl(hexMatch[1]);
    try {
      var m3u8 = new URL(decoded);
      return { streaming_url: m3u8.href, title: title };
    } catch (e) {
      return null;
    }
  } catch (e) {
    return null;
  }
}

async function resolveFireStreamPageToStream(pageUrl) {
  try {
    var pageRes = await fetch(pageUrl, { headers: DEFAULT_HEADERS });
    if (!pageRes.ok) return null;
    var html = await pageRes.text();
    var tokenMatch = html.match(/id="token-blob"[^>]*>([^<]+)/i);
    if (!tokenMatch || !tokenMatch[1]) return null;

    var ref = new URL(pageUrl).origin + '/';
    var headers = Object.assign({}, DEFAULT_HEADERS, {
      'Referer': ref,
      'Origin': ref.replace(/\/$/, '')
    });

    var apiUrl = pageUrl.replace(/\/e\//i, '/api/videos/').replace(/\/v\//i, '/api/videos/').replace(/\/[^/]+$/i, '/resolve');
    var apiPath = new URL(pageUrl).pathname;
    var mediaId = apiPath.split('/').filter(Boolean).pop();
    if (mediaId) {
      apiUrl = 'https://firestream.to/api/videos/' + mediaId + '/resolve';
    }

    var apiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ blob: tokenMatch[1].trim() })
    });

    if (!apiRes.ok) return null;
    var data = await apiRes.json();
    if (data && data.signedVideoUrl) {
      return {
        streaming_url: data.signedVideoUrl,
        title: data.title || 'FireStream',
        headers: Object.assign({}, headers, { 'Referer': pageUrl })
      };
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function resolveHostPageToDirectStream(pageUrl, referer) {
  if (!pageUrl) return null;

  var hostname = '';
  try {
    hostname = new URL(pageUrl).hostname.toLowerCase();
  } catch (e) {
    return null;
  }

  var baseHeaders = Object.assign({}, DEFAULT_HEADERS, { 'Referer': referer || pageUrl });

  if (/vidara|vidmatrix/.test(hostname)) {
    var vidara = await resolveVidaraPageToStream(pageUrl);
    if (vidara && vidara.streaming_url) {
      return { streaming_url: vidara.streaming_url, title: vidara.title, headers: Object.assign({}, baseHeaders, { 'Origin': new URL(pageUrl).origin }) };
    }
  }

  if (/vidsonic/.test(hostname)) {
    var vidsonic = await resolveVidsonicPageToStream(pageUrl);
    if (vidsonic && vidsonic.streaming_url) {
      return { streaming_url: vidsonic.streaming_url, title: vidsonic.title, headers: Object.assign({}, baseHeaders, { 'Origin': new URL(pageUrl).origin }) };
    }
  }

  if (/firestream/.test(hostname)) {
    var firestream = await resolveFireStreamPageToStream(pageUrl);
    if (firestream && firestream.streaming_url) {
      return { streaming_url: firestream.streaming_url, title: firestream.title, headers: firestream.headers || baseHeaders };
    }
  }

  if (isVoeUrl(pageUrl)) {
    var voe = await extractVoeStream(pageUrl, baseHeaders);
    if (voe && voe.url) {
      return {
        streaming_url: voe.url,
        title: voe.title || 'VOE Stream',
        size: voe.size || 'Server',
        headers: voe.headers || Object.assign({}, baseHeaders, { 'Referer': pageUrl })
      };
    }
  }

  if (/dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s|playmogo|playmogo.com|doodstream/i.test(hostname)) {
    var dood = await extractDoodStream(pageUrl, baseHeaders);
    if (dood && dood.url) {
      return {
        streaming_url: dood.url,
        title: dood.title || 'DoodStream',
        size: dood.size || 'Server',
        headers: dood.headers || Object.assign({}, baseHeaders, { 'Referer': pageUrl })
      };
    }
  }

  return null;
}

var VOE_DOMAINS = [
  'voe.sx','voe-unblock.com','voe-unblock.net','voeunblock.com','un-block-voe.net','voeunbl0ck.com','voeunblck.com','voeunblk.com','voe-un-block.com','jonathansociallike.com','voeun-block.net','v-o-e-unblock.com','edwardarriveoften.com','nathanfromsubject.com','audaciousdefaulthouse.com','launchreliantcleaverriver.com','kennethofficialitem.com','reputationsheriffkennethsand.com','fittingcentermondaysunday.com','lukecomparetwo.com','housecardsummerbutton.com','fraudclatterflyingcar.com','wolfdyslectic.com','bigclatterhomesguidesservice.com','uptodatefinishconferenceroom.com','jayservicestuff.com','realfinanceblogcenter.com','tinycat-voe-fashion.com','35volitantplimsoles5.com','20demidistance9elongations.com','telyn610zoanthropy.com','toxitabellaeatrebates306.com','greaseball6eventual20.com','745mingiestblissfully.com','19turanosephantasia.com','30sensualizeexpression.com','321naturelikefurfuroid.com','449unceremoniousnasoseptal.com','guidon40hyporadius9.com','cyamidpulverulence530.com','boonlessbestselling244.com','antecoxalbobbing1010.com','matriculant401merited.com','scatch176duplicities.com','availedsmallest.com','counterclockwisejacky.com','simpulumlamerop.com','paulkitchendark.com','metagnathtuggers.com','gamoneinterrupted.com','chromotypic.com','crownmakermacaronicism.com','generatesnitrosate.com','yodelswartlike.com','figeterpiazine.com','strawberriesporail.com','valeronevijao.com','timberwoodanotia.com','apinchcaseation.com','nectareousoverelate.com','nonesnanking.com','kathleenmemberhistory.com','stevenimaginelittle.com','jamiesamewalk.com','bradleyviewdoctor.com','sandrataxeight.com','graceaddresscommunity.com','shannonpersonalcost.com','cindyeyefinal.com','michaelapplysome.com','sethniceletter.com','brucevotewithin.com','rebeccaneverbase.com','loriwithinfamily.com','roberteachfinal.com','erikcoldperson.com','jasminetesttry.com','heatherdiscussionwhen.com','robertplacespace.com','alleneconomicmatter.com','josephseveralconcern.com','donaldlineelse.com','lisatrialidea.com','toddpartneranimal.com','jamessoundcost.com','brittneystandardwestern.com','sandratableother.com','robertordercharacter.com','maxfinishseveral.com','chuckle-tube.com','kristiesoundsimply.com','adrianmissionminute.com','richardsignfish.com','jennifercertaindevelopment.com','diananatureforeign.com','goofy-banana.com','mariatheserepublican.com','johnalwayssame.com','kellywhatcould.com','jilliandescribecompany.com','lukesitturn.com','mikaylaarealike.com','christopheruntilpoint.com','walterprettytheir.com','crystaltreatmenteast.com','lauradaydo.com','smoki.cc','lancewhosedifficult.com','ogladaj.me','dianaavoidthey.com','jefferycontrolmodel.com','marissasharecareer.com','charlestoughrace.com','ianrequireadult.com','timmaybealready.com','jessicayeahcatch.com','kinoger.ru'
];

function isVoeUrl(urlStr) {
  try {
    var parsed = new URL(urlStr);
    return parsed.host.indexOf('voe') !== -1 || VOE_DOMAINS.indexOf(parsed.host) !== -1;
  } catch (e) {
    return /voe/i.test(urlStr);
  }
}

function decodeBase64Utf8(value) {
  try {
    if (!value) return '';
    if (typeof globalThis.atob === 'function') return globalThis.atob(value);
    if (typeof Buffer !== 'undefined' && Buffer.from) return Buffer.from(value, 'base64').toString('utf8');

    var base64 = String(value).replace(/[^A-Za-z0-9+/=]/g, '');
    var padding = (4 - (base64.length % 4)) % 4;
    base64 += '='.repeat(padding);

    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var lookup = {};
    for (var i = 0; i < alphabet.length; i++) lookup[alphabet.charAt(i)] = i;

    var bytes = [];
    for (var i = 0; i < base64.length; i += 4) {
      var a = lookup[base64.charAt(i)] >>> 0;
      var b = lookup[base64.charAt(i + 1)] >>> 0;
      var c = lookup[base64.charAt(i + 2)] >>> 0;
      var d = lookup[base64.charAt(i + 3)] >>> 0;

      bytes.push((a << 2) | (b >> 4));
      if (base64.charAt(i + 2) !== '=') bytes.push(((b & 15) << 4) | (c >> 2));
      if (base64.charAt(i + 3) !== '=') bytes.push(((c & 3) << 6) | d);
    }

    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    return String.fromCharCode.apply(null, bytes);
  } catch (e) {
    return '';
  }
}

function voeDecode(ct, luts) {
  try {
    var lutMatches = luts.slice(2, -2).split("','");
    var lut = lutMatches.map(function(i) { return i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });

    var txt = '';
    for (var i = 0; i < ct.length; i++) {
      var x = ct.charCodeAt(i);
      if (x > 64 && x < 91) x = (x - 52) % 26 + 65;
      else if (x > 96 && x < 123) x = (x - 84) % 26 + 97;
      txt += String.fromCharCode(x);
    }

    for (var j = 0; j < lut.length; j++) {
      var regex = new RegExp(lut[j], 'g');
      txt = txt.replace(regex, '');
    }

    var decodedB64 = decodeBase64Utf8(txt);
    var shifted = '';
    for (var k = 0; k < decodedB64.length; k++) shifted += String.fromCharCode(decodedB64.charCodeAt(k) - 3);

    var reversedB64 = shifted.split('').reverse().join('');
    var finalJsonStr = decodeBase64Utf8(reversedB64);
    return JSON.parse(finalJsonStr);
  } catch (e) {
    return null;
  }
}

function normalizeDoodUrl(url) {
  if (!url || typeof url !== 'string') return url;
  var isDood = url.match(/dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s|playmogo|playmogo.com|doodstream/i);
  if (isDood) {
    var playmogoMatch = url.match(/playmogo\.com\/e\/([a-zA-Z0-9]+)/i);
    if (playmogoMatch && playmogoMatch[1]) return 'https://dood.yt/e/' + playmogoMatch[1];

    var match = url.match(/\/([ewd])\/([a-zA-Z0-9]+)/i);
    if (match && match[2]) return 'https://dood.yt/' + match[1].toLowerCase() + '/' + match[2];

    var idMatch = url.match(/\/([a-zA-Z0-9]+)(?:\?|$)/);
    if (idMatch && idMatch[1]) return 'https://dood.yt/e/' + idMatch[1];
  }
  return url;
}

async function extractDoodStream(urlStr, headers) {
  try {
    var url = new URL(normalizeDoodUrl(urlStr));
    var res = await fetch(url.href, { headers: headers });
    var html = await res.text();

    if (/Video not found/.test(html)) throw new Error('Video not found');

    var $ = cheerio.load(html);
    var title = $('title').text().trim().replace(/ - DoodStream$/, '').trim();

    var downloadUrl = url.href.replace(/\/([ewd])\/([a-zA-Z0-9]+)/i, '/d/$2');
    var downloadRes = await fetch(downloadUrl, { headers: headers });
    var downloadHtml = await downloadRes.text();
    var sizeMatch = downloadHtml.match(/([\d.]+ ?[GM]B)/);

    var directMatch = downloadHtml.match(/https?:\/\/[^"']+\.m3u8[^"']*/i) || html.match(/https?:\/\/[^"']+\.m3u8[^"']*/i);
    if (directMatch && directMatch[0]) {
      return { url: directMatch[0], title: title || 'DoodStream', size: sizeMatch ? sizeMatch[1] : 'Server', headers: Object.assign({}, headers, { 'Referer': url.href }) };
    }

    var passMatch = html.match(/\/pass_md5\/([a-zA-Z0-9\/\-_]+)/);
    if (passMatch) {
      var passUrl = 'https://' + url.hostname + passMatch[0];
      var tokenRes = await fetch(passUrl, { headers: Object.assign({}, headers, { 'Referer': url.href }) });
      var tokenText = await tokenRes.text();
      if (tokenText) {
        var randomToken = '' + Math.random().toString(36).substring(2);
        var directStreamUrl = tokenText + 'zplain?token=' + randomToken + '&expiry=' + Date.now();
        return { url: directStreamUrl, title: title || 'DoodStream', size: sizeMatch ? sizeMatch[1] : 'Server', headers: Object.assign({}, headers, { 'Referer': 'https://' + url.hostname + '/' }) };
      }
    }

    return { url: url.href, title: title || 'DoodStream', size: sizeMatch ? sizeMatch[1] : 'Server', headers: headers };
  } catch (e) {
    return null;
  }
}

async function extractVoeStream(urlStr, headers) {
  try {
    var webUrl = urlStr;
    var res = await fetch(webUrl, { headers: headers });
    var html = await res.text();

    while (html.indexOf('const currentUrl') !== -1 || /window\.location\.href\s*=\s*'([^']+)'/.test(html)) {
      var rMatch = html.match(/window\.location\.href\s*=\s*'([^']+)'/);
      if (rMatch && rMatch[1]) {
        webUrl = rMatch[1];
        res = await fetch(webUrl, { headers: headers });
        html = await res.text();
      } else break;
    }

    var jsonMatch = html.match(/json">\["([^"]+)"\]<\/script>\s*<script\s*src="([^"]+)"/);
    if (jsonMatch) {
      var jsUrl = new URL(jsonMatch[2], webUrl).href;
      var jsRes = await fetch(jsUrl, { headers: headers });
      var jsHtml = await jsRes.text();

      var replMatch = jsHtml.match(/(\[(?:'\W{2}'[,\]]){1,9})/);
      if (replMatch) {
        var sObj = voeDecode(jsonMatch[1], replMatch[1]);
        if (sObj) {
          var candidateUrl = sObj.file || sObj.source || sObj.direct_access_url;
          if (candidateUrl) return { url: candidateUrl, title: sObj.title || 'VOE Stream', size: 'Server', headers: Object.assign({}, headers, { 'Referer': webUrl }) };
        }
      }
    }

    var m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8(?:\?[^"'\s]*)?/i);
    if (m3u8Match && m3u8Match[0]) return { url: m3u8Match[0], title: 'VOE Stream', size: 'Server', headers: Object.assign({}, headers, { 'Referer': webUrl }) };

    var hlsMatch = html.match(/hls['"]\s*:\s*['"]([^'"]+)['"]/);
    if (hlsMatch && hlsMatch[1]) return { url: hlsMatch[1], title: 'VOE Stream', size: 'Server', headers: Object.assign({}, headers, { 'Referer': webUrl }) };

    return { url: webUrl, title: 'VOE Stream', size: 'Server', headers: headers };
  } catch (e) {
    return null;
  }
}

function normalizeMediaType(type) {
  if (type === 'series' || type === 'show' || type === 'tv') return 'series';
  return 'movie';
}

async function getTmdbMetadata(tmdbId, type) {
  try {
    if (!tmdbId) return null;
    var tmdbKey = TMDB_API_KEY || process.env.TMDB_API_KEY;
    if (!tmdbKey || !/^\d+$/.test(String(tmdbId))) return null;

    var normalizedType = normalizeMediaType(type);
    var endpoints = normalizedType === 'series' ? ['/tv/', '/movie/'] : ['/movie/', '/tv/'];
    var tmdbData = null;

    for (var i = 0; i < endpoints.length; i++) {
      var endpoint = endpoints[i];
      var tmdbUrl = TMDB_BASE_URL + endpoint + encodeURIComponent(String(tmdbId)) + '?api_key=' + tmdbKey + '&language=de-DE';
      var tmdbRes = await fetch(tmdbUrl);
      if (!tmdbRes || !tmdbRes.ok) continue;
      tmdbData = await tmdbRes.json();
      if (tmdbData && (tmdbData.title || tmdbData.name)) break;
    }

    if (!tmdbData) return null;

    var title = tmdbData.title || tmdbData.name || '';
    var year = '';
    var releaseDate = tmdbData.release_date || tmdbData.first_air_date || '';
    if (releaseDate && releaseDate.length >= 4) year = releaseDate.substring(0, 4);

    if (!title) return null;
    return { title: title, year: year, mediaType: tmdbData.release_date ? 'movie' : (tmdbData.first_air_date ? 'series' : (type === 'series' ? 'series' : 'movie')) };
  } catch (e) {
    return null;
  }
}


async function getStreams(tmdbId, type, season, episode, onResult) {
  try {
    if (!tmdbId) return [];

    var normalizedType = normalizeMediaType(type);
    var payload = {
      language: 'de',
      region: 'DE',
      type: normalizedType === 'series' ? 'series' : 'movie',
      ids: { tmdb_id: String(tmdbId) },
      name: ''
    };
    if (season != null) payload.episode = { ids: {}, season: season, episode: episode != null ? episode : 1 };

    var finalData;
    try {
      var res = await fetch('https://oha.to/mediaurl-source.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'application/json,text/plain,*/*',
          'Accept-Language': 'de-DE,de;q=0.9',
          'Origin': 'https://oha.to',
          'Referer': 'https://oha.to/',
          'User-Agent': DEFAULT_HEADERS['User-Agent']
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) return [];
      finalData = await res.json();
    } catch (e) {
      return [];
    }

    var candidates = Array.isArray(finalData) ? finalData : (finalData && (finalData.streams || finalData.sources || finalData.items)) || [];
    var results = [];

    // Optional TMDB metadata for nicer titles
    var tmdbMeta = null;
    try { tmdbMeta = await getTmdbMetadata(tmdbId, normalizedType); } catch (e) { tmdbMeta = null; }

    function mapLanguage(label) {
      var l = (label || '').toLowerCase();
      if (l.indexOf('deutsch') === 0 || l === 'de' || l.indexOf('german') === 0) return 'de';
      if (l.indexOf('engl') === 0 || l === 'en' || l.indexOf('english') === 0) return 'en';
      if (l.indexOf('fra') === 0 || l === 'fr' || l.indexOf('french') === 0) return 'fr';
      return l.substr(0,2) || 'de';
    }

    var candidatePromises = candidates.map(async function(s) {
      if (!s || s.type !== 'url') return null;

      var urlStr = s && s.url;
      if (!urlStr || typeof urlStr !== 'string') return null;

      try {
        var url = new URL(String(urlStr));
        var language = 'de';
        if (Array.isArray(s.languages) && s.languages[0]) language = String(s.languages[0]).toLowerCase();
        else if (s.language || s.lang) language = String(s.language || s.lang).toLowerCase();
        var langCode = mapLanguage(language);
        if (langCode !== 'de') return null;

        var height = (function(text) {
          if (!text && text !== 0) return undefined;
          if (typeof text === 'number') return text;
          var str = String(text);
          var m = str.match(/(\d{3,4})p/i);
          if (m) return parseInt(m[1], 10);
          var m2 = str.match(/(\d{3,4})x(\d{3,4})/i);
          if (m2) return parseInt(m2[2], 10);
          var m3 = str.match(/(\d{3,4})/);
          if (m3) return parseInt(m3[1], 10);
          if (/4k/i.test(str)) return 2160;
          if (/fhd|1080/i.test(str)) return 1080;
          if (/hd/i.test(str)) return 720;
          return undefined;
        })(s.height || s.resolution || s.res || s.quality || s.tag || (Array.isArray(s.qualities) ? s.qualities[0] : undefined) || s.name || s.title);

        var quality = (function(h) {
          if (!h && h !== 0) return undefined;
          if (h >= 2160) return '4K';
          if (h >= 1080) return '1080p';
          if (h >= 720) return '720p';
          if (h >= 480) return '480p';
          return undefined;
        })(height) || (s.quality || s.tag || (Array.isArray(s.qualities) ? s.qualities[0] : undefined));

        var title = (s && s.name) || (tmdbMeta && tmdbMeta.title) || '';
        if (title) title = ('' + title).trim() + ' [' + (langCode ? langCode.toUpperCase() : 'DE') + ']';

        var meta = {
          countryCodes: ['de'],
          language: langCode,
          referer: 'https://oha.to/',
          title: title,
          sourceLabel: 'Oha.to'
        };
        if (quality) meta.quality = quality;
        if (height) meta.height = height;

        var finalUrl = url.href;
        var headersObj = Object.assign({}, DEFAULT_HEADERS, { 'Referer': 'https://oha.to/' });

        var displayName = (s && s.name) ? (s.name + ' (' + (langCode ? langCode.toUpperCase() : 'DE') + ')') : (meta.title || 'Oha.to');

        var streamObj = {
          name: displayName,
          title: displayName,
          language: langCode,
          quality: quality || 'HD',
          url: finalUrl,
          provider: 'ohato',
          meta: meta
        };
        if (headersObj) streamObj.headers = headersObj;

        try { if (typeof onResult === 'function') onResult(streamObj); } catch (e) {}
        return streamObj;
      } catch (err) {
        return null;
      }
    });

    var resolvedResults = await Promise.all(candidatePromises);
    return resolvedResults.filter(Boolean);
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams };
module.exports.getStreams = getStreams;
