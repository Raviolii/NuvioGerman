/* istanbul ignore file */

var cheerio = require('cheerio-without-node-native');

// TMDB API key (falls back to process.env.TMDB_API_KEY if set)
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

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

async function getTmdbMetadata(tmdbId, type) {
  try {
    if (!tmdbId) return null;
    var tmdbKey = TMDB_API_KEY || process.env.TMDB_API_KEY;
    if (!tmdbKey || !/^\d+$/.test(String(tmdbId))) return null;

    var endpoints = type === 'series' ? ['/tv/', '/movie/'] : ['/movie/', '/tv/'];
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

const { ContentType } = require('stremio-addon-sdk');
const { CountryCode } = require('../types');
const { Fetcher, getTmdbId, Id } = require('../utils');
const { Source } = require('./Source');

class OhaTO extends Source {
  constructor(fetcher) {
    super();
    this.id = 'ohato';
    this.label = 'Oha.to';
    this.baseUrl = 'https://oha.to';

    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.de];
    this.priority = 1;

    this.fetcher = fetcher;
  }

  async handleInternal(ctx, _type, id) {
    const debug = process.env['DEBUG_OHATO'] === '1';

    if (debug) console.log(`OhaTO: handleInternal called for id=${id}`);

    const tmdbId = await getTmdbId(ctx, this.fetcher, id);

    const sourcePayload = {
      language: 'de',
      region: 'DE',
      type: tmdbId && tmdbId.season ? 'series' : 'movie',
      ids: { tmdb_id: String(tmdbId.id) },
      name: '',
      ...(tmdbId && tmdbId.season ? { episode: { ids: {}, season: tmdbId.season, episode: tmdbId.episode ?? 1 } } : {}),
    };

    const parseHeightFromString = (text) => {
      if (!text && text !== 0) return undefined;
      if (typeof text === 'number') return text;
      const s = String(text);
      const m = s.match(/(\d{3,4})p/i);
      if (m) return parseInt(m[1], 10);
      const m2 = s.match(/(\d{3,4})x(\d{3,4})/i);
      if (m2) return parseInt(m2[2], 10);
      const m3 = s.match(/(\d{3,4})/);
      if (m3) return parseInt(m3[1], 10);
      if (/4k/i.test(s)) return 2160;
      if (/fhd|1080/i.test(s)) return 1080;
      if (/hd/i.test(s)) return 720;
      return undefined;
    };

    const qualityFromHeight = (h) => {
      if (!h && h !== 0) return undefined;
      if (h >= 2160) return '4K';
      if (h >= 1080) return '1080p';
      if (h >= 720) return '720p';
      if (h >= 480) return '480p';
      return undefined;
    };

    const OHA_SOURCE_URL = 'https://oha.to/mediaurl-source.json';

    let finalData;
    try {
      if (debug) console.log(`OhaTO: posting to ${OHA_SOURCE_URL}`);
      finalData = await this.fetcher.json(ctx, new URL(OHA_SOURCE_URL), {
        method: 'POST',
        data: JSON.stringify(sourcePayload),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'application/json,text/plain,*/*',
          'Accept-Language': 'de-DE,de;q=0.9',
          'Origin': 'https://oha.to',
          'Referer': 'https://oha.to/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
    } catch (e) {
      if (debug) console.log('OhaTO: source request failed', (e && e.message) || e);
      return [];
    }

    const candidates = Array.isArray(finalData)
      ? finalData
      : (finalData && (finalData.streams || finalData.sources || finalData.items)) || [];

    const results = [];

    // Fetch TMDB metadata (optional) to improve titles like SerienStream provider
    let tmdbMeta = null;
    try {
      if (tmdbId && tmdbId.id) tmdbMeta = await getTmdbMetadata(tmdbId.id, sourcePayload.type);
    } catch (e) {}

    for (const s of candidates) {
      const urlStr = s && (s.url || s.file || s.source || s.stream);
      if (!urlStr) continue;

      try {
        let url = new URL(String(urlStr));
        let language;
        if (Array.isArray(s.languages) && s.languages[0]) {
          language = String(s.languages[0]).toLowerCase();
        } else if (s.language || s.lang) {
          language = String(s.language || s.lang).toLowerCase();
        } else {
          language = 'de';
        }

        if (language !== 'de') continue;

        const height = parseHeightFromString(
          s.height || s.resolution || s.res || s.quality || s.tag
          || (Array.isArray(s.qualities) ? s.qualities[0] : undefined) || s.name || s.title,
        );
        const quality = qualityFromHeight(height) || (s.quality || s.tag || (Array.isArray(s.qualities) ? s.qualities[0] : undefined));

        if (debug) console.log(`OhaTO: candidate ${url.href} lang=${language} height=${height || 'unknown'}`);

        const meta = {
          countryCodes: [CountryCode.de],
          language,
          referer: this.baseUrl,
          title: `${(s && s.name) || (tmdbMeta && tmdbMeta.title) || ''} [${language.toUpperCase()}]`.trim(),
          sourceLabel: this.label,
        };
        if (quality) meta.quality = quality;
        if (height) meta.height = height;

        // If the host is DoodStream or VOE, attempt to resolve to direct stream URL and headers
        let headersObj = undefined;
        let finalUrl = url.href;
        try {
          const doodRegex = /dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s|playmogo|playmogo.com|doodstream/i;
          const isDood = doodRegex.test(finalUrl);
          const isVoe = isVoeUrl(finalUrl);

          if (isDood) {
            const doodResult = await extractDoodStream(finalUrl, Object.assign({}, DEFAULT_HEADERS, { 'Referer': this.baseUrl }));
            if (doodResult && doodResult.url) {
              finalUrl = doodResult.url;
              headersObj = doodResult.headers;
              if (doodResult.title && !meta.title) meta.title = doodResult.title;
            }
          } else if (isVoe) {
            const voeResult = await extractVoeStream(finalUrl, Object.assign({}, DEFAULT_HEADERS, { 'Referer': this.baseUrl }));
            if (voeResult && voeResult.url) {
              finalUrl = voeResult.url;
              headersObj = voeResult.headers;
              if (voeResult.title && !meta.title) meta.title = voeResult.title;
            }
          }
        } catch (e) {
          // ignore extraction errors and fall back to original URL
        }

        // push result; include headers at top-level if available
        try {
          const finalUrlObj = new URL(String(finalUrl));
          if (headersObj) {
            results.push({ url: finalUrlObj, meta, headers: headersObj });
          } else {
            results.push({ url: finalUrlObj, meta });
          }
        } catch (e) {
          // if final URL is not a valid absolute URL, push original url object
          if (headersObj) results.push({ url, meta, headers: headersObj });
          else results.push({ url, meta });
        }
      } catch (err) {
        continue;
      }
    }

    return results;
  }
}

module.exports.OhaTO = OhaTO;
