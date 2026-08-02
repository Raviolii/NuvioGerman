var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://filmpalast.to';

// TMDB API key (falls back to `process.env.TMDB_API_KEY` if set)
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

var STREAMING_HOSTS = [
    'voe', 'dood', 'streamtape', 'veev', 'vinovo', 'vidhide', 'dhtpre',
    'mixdrop', 'supervideo', 'uqload', 'filelion', 'lulustream', 'fastream',
    'dropload', 'savefiles', 'streamembed', 'vidara', 'vidsonic', 'firestream', 'vidmatrixa'
];

function isStreamingHost(hostname) {
    return STREAMING_HOSTS.some(function(host) {
        return hostname.includes(host);
    });
}

function resolveHref(href, baseUrl) {
    var fullHref = href.startsWith('//') ? 'https:' + href : href;
    return new URL(fullHref.startsWith('http') ? fullHref : baseUrl + fullHref);
}

// Resolve Vidara page URL to actual streaming m3u8 via their API
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
        // ignore errors and fall back to original URL
    }
    return null;
}

function decodeHexUrl(hexString) {
    var joined = hexString.split('|').join('');
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

function parseSizeToBytes(sizeStr) {
    if (!sizeStr) return null;
    var m = sizeStr.match(/([\d,.]+)\s*(GB|MB)/i);
    if (!m) return null;
    var num = parseFloat(m[1].replace(/,/g, '.'));
    var unit = m[2].toUpperCase();
    if (unit === 'GB') return Math.round(num * 1024 * 1024 * 1024);
    if (unit === 'MB') return Math.round(num * 1024 * 1024);
    return null;
}

var VOE_DOMAINS = [
    'voe.sx', 'voe-unblock.com', 'voe-unblock.net', 'voeunblock.com', 'un-block-voe.net',
    'voeunbl0ck.com', 'voeunblck.com', 'voeunblk.com', 'voe-un-block.com', 'jonathansociallike.com',
    'voeun-block.net', 'v-o-e-unblock.com', 'edwardarriveoften.com', 'nathanfromsubject.com',
    'audaciousdefaulthouse.com', 'launchreliantcleaverriver.com', 'kennethofficialitem.com',
    'reputationsheriffkennethsand.com', 'fittingcentermondaysunday.com', 'lukecomparetwo.com',
    'housecardsummerbutton.com', 'fraudclatterflyingcar.com', 'wolfdyslectic.com',
    'bigclatterhomesguideservice.com', 'uptodatefinishconferenceroom.com', 'jayservicestuff.com',
    'realfinanceblogcenter.com', 'tinycat-voe-fashion.com', '35volitantplimsoles5.com',
    '20demidistance9elongations.com', 'telyn610zoanthropy.com', 'toxitabellaeatrebates306.com',
    'greaseball6eventual20.com', '745mingiestblissfully.com', '19turanosephantasia.com',
    '30sensualizeexpression.com', '321naturelikefurfuroid.com', '449unceremoniousnasoseptal.com',
    'guidon40hyporadius9.com', 'cyamidpulverulence530.com', 'boonlessbestselling244.com',
    'antecoxalbobbing1010.com', 'matriculant401merited.com', 'scatch176duplicities.com',
    'availedsmallest.com', 'counterclockwisejacky.com', 'simpulumlamerop.com', 'paulkitchendark.com',
    'metagnathtuggers.com', 'gamoneinterrupted.com', 'chromotypic.com', 'crownmakermacaronicism.com',
    'generatesnitrosate.com', 'yodelswartlike.com', 'figeterpiazine.com', 'strawberriesporail.com',
    'valeronevijao.com', 'timberwoodanotia.com', 'apinchcaseation.com', 'nectareousoverelate.com',
    'nonesnanking.com', 'kathleenmemberhistory.com', 'stevenimaginelittle.com', 'jamiesamewalk.com',
    'bradleyviewdoctor.com', 'sandrataxeight.com', 'graceaddresscommunity.com', 'shannonpersonalcost.com',
    'cindyeyefinal.com', 'michaelapplysome.com', 'sethniceletter.com', 'brucevotewithin.com',
    'rebeccaneverbase.com', 'loriwithinfamily.com', 'roberteachfinal.com', 'erikcoldperson.com',
    'jasminetesttry.com', 'heatherdiscussionwhen.com', 'robertplacespace.com', 'alleneconomicmatter.com',
    'josephseveralconcern.com', 'donaldlineelse.com', 'lisatrialidea.com', 'toddpartneranimal.com',
    'jamessoundcost.com', 'brittneystandardwestern.com', 'sandratableother.com', 'robertordercharacter.com',
    'maxfinishseveral.com', 'chuckle-tube.com', 'kristiesoundsimply.com', 'adrianmissionminute.com',
    'richardsignfish.com', 'jennifercertaindevelopment.com', 'diananatureforeign.com', 'goofy-banana.com',
    'mariatheserepublican.com', 'johnalwayssame.com', 'kellywhatcould.com', 'jilliandescribecompany.com',
    'lukesitturn.com', 'mikaylaarealike.com', 'christopheruntilpoint.com', 'walterprettytheir.com',
    'crystaltreatmenteast.com', 'lauradaydo.com', 'smoki.cc', 'lancewhosedifficult.com',
    'ogladaj.me', 'dianaavoidthey.com', 'jefferycontrolmodel.com', 'marissasharecareer.com',
    'charlestoughrace.com', 'ianrequireadult.com', 'timmaybealready.com', 'jessicayeahcatch.com',
    'kinoger.ru'
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
        if (typeof globalThis.atob === 'function') {
            return globalThis.atob(value);
        }
        if (typeof Buffer !== 'undefined' && Buffer.from) {
            return Buffer.from(value, 'base64').toString('utf8');
        }

        var base64 = String(value).replace(/[^A-Za-z0-9+/=]/g, '');
        var padding = (4 - (base64.length % 4)) % 4;
        base64 += '='.repeat(padding);

        var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        var lookup = {};
        for (var i = 0; i < alphabet.length; i++) {
            lookup[alphabet.charAt(i)] = i;
        }

        var bytes = [];
        for (var i = 0; i < base64.length; i += 4) {
            var a = lookup[base64.charAt(i)] >>> 0;
            var b = lookup[base64.charAt(i + 1)] >>> 0;
            var c = lookup[base64.charAt(i + 2)] >>> 0;
            var d = lookup[base64.charAt(i + 3)] >>> 0;

            bytes.push((a << 2) | (b >> 4));
            if (base64.charAt(i + 2) !== '=') {
                bytes.push(((b & 15) << 4) | (c >> 2));
            }
            if (base64.charAt(i + 3) !== '=') {
                bytes.push(((c & 3) << 6) | d);
            }
        }

        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
        }

        return String.fromCharCode.apply(null, bytes);
    } catch (e) {
        return '';
    }
}

function voeDecode(ct, luts) {
    try {
        var lutMatches = luts.slice(2, -2).split("','");
        var lut = lutMatches.map(function(i) {
            return i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });

        var txt = '';
        for (var i = 0; i < ct.length; i++) {
            var x = ct.charCodeAt(i);
            if (x > 64 && x < 91) {
                x = (x - 52) % 26 + 65;
            } else if (x > 96 && x < 123) {
                x = (x - 84) % 26 + 97;
            }
            txt += String.fromCharCode(x);
        }

        for (var j = 0; j < lut.length; j++) {
            var regex = new RegExp(lut[j], 'g');
            txt = txt.replace(regex, '');
        }

        var decodedB64 = decodeBase64Utf8(txt);
        var shifted = '';
        for (var k = 0; k < decodedB64.length; k++) {
            shifted += String.fromCharCode(decodedB64.charCodeAt(k) - 3);
        }

        var reversedB64 = shifted.split('').reverse().join('');
        var finalJsonStr = decodeBase64Utf8(reversedB64);
        return JSON.parse(finalJsonStr);
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
            } else {
                break;
            }
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
                    if (candidateUrl) {
                        return {
                            url: candidateUrl,
                            title: sObj.title || 'VOE Stream',
                            size: 'Server',
                            headers: Object.assign({}, headers, { 'Referer': webUrl })
                        };
                    }
                }
            }
        }

        var m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8(?:\?[^"'\s]*)?/i);
        if (m3u8Match && m3u8Match[0]) {
            return {
                url: m3u8Match[0],
                title: 'VOE Stream',
                size: 'Server',
                headers: Object.assign({}, headers, { 'Referer': webUrl })
            };
        }

        var hlsMatch = html.match(/hls['"]\s*:\s*['"]([^'"]+)['"]/);
        if (hlsMatch && hlsMatch[1]) {
            return {
                url: hlsMatch[1],
                title: 'VOE Stream',
                size: 'Server',
                headers: Object.assign({}, headers, { 'Referer': webUrl })
            };
        }

        return {
            url: webUrl,
            title: 'VOE Stream',
            size: 'Server',
            headers: headers
        };
    } catch (e) {
        return null;
    }
}

async function resolveVoePageToStream(pageUrl) {
    try {
        if (!isVoeUrl(pageUrl)) return null;
        var voe = await extractVoeStream(pageUrl, Object.assign({}, DEFAULT_HEADERS, { 'Referer': pageUrl }));
        if (!voe || !voe.url) return null;
        return {
            streaming_url: voe.url,
            title: voe.title || 'VOE Stream',
            size: voe.size || 'Server',
            headers: voe.headers || Object.assign({}, DEFAULT_HEADERS, { 'Referer': pageUrl })
        };
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
            var tmdbUrl = 'https://api.themoviedb.org/3' + endpoint + encodeURIComponent(String(tmdbId)) + '?api_key=' + tmdbKey + '&language=de-DE';
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

async function fetchStreamPageUrl(searchQuery, type, season, episode, year, mediaType) {
    if (!searchQuery) return undefined;

    var query = String(searchQuery).trim();
    var effectiveMediaType = mediaType || type;
    var searchQueries = [];

    if (effectiveMediaType === 'series' && season && episode) {
        searchQueries.push(query + ' S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0'));
        searchQueries.push(query);
    } else {
        searchQueries.push(query);
        if (year) {
            searchQueries.push(query + ' ' + String(year));
        }
    }

    for (var i = 0; i < searchQueries.length; i++) {
        var candidateQuery = searchQueries[i];
        var encodedSearchQuery = encodeURIComponent(candidateQuery);
        var searchPageUrl = BASE_URL + '/search/title/' + encodedSearchQuery;
        var searchPageResponse = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS });
        if (!searchPageResponse || !searchPageResponse.ok) continue;

        var searchPageHtml = await searchPageResponse.text();
        var $ = cheerio.load(searchPageHtml);

        var streamLinks = $('a[href*="/stream/"]')
            .map(function(_i, el) {
                var href = $(el).attr('href');
                var title = ($(el).attr('title') || $(el).text().trim() || '').trim();
                if (!href) return null;
                return {
                    href: href,
                    title: title
                };
            })
            .get()
            .filter(function(item) { return !!item; });

        if (!streamLinks.length) continue;

        if (!season) {
            var yearMatch = streamLinks.find(function(link) {
                return link.title && new RegExp(String(year || ''), 'i').test(link.title);
            });
            if (yearMatch) {
                return resolveHref(yearMatch.href, BASE_URL);
            }
        }

        var firstLink = streamLinks[0];
        if (!firstLink) continue;
        return resolveHref(firstLink.href, BASE_URL);
    }

    return undefined;
}

async function getStreams(tmdbId, type, season, episode) {
    if (!tmdbId) {
        return [];
    }

    var searchTitle = String(tmdbId);
    var searchYear = '';
    var searchMediaType = type;

    try {
        var metadata = await getTmdbMetadata(tmdbId, type);
        if (metadata && metadata.title) {
            searchTitle = metadata.title;
            searchYear = metadata.year || '';
            searchMediaType = metadata.mediaType || type;
        }
    } catch (e) {
        // Non-fatal: continue with the fallback query
    }

    try {
        var streamPageUrl = await fetchStreamPageUrl(searchTitle, type, season, episode, searchYear, searchMediaType);
        if (!streamPageUrl) {
            return [];
        }

        var html = await fetch(streamPageUrl.href, { headers: DEFAULT_HEADERS }).then(function(res) {
            return res.text();
        });
        var $ = cheerio.load(html);
        var results = [];

        function extractQuality(text) {
            if (!text || typeof text !== 'string') return 'HD';
            var q = text.match(/(\d{3,4}p|4k|uhd|hd|sd)/i);
            return q ? q[0].toUpperCase() : 'HD';
        }

        function formatDisplayName(hostName, quality) {
            hostName = hostName || 'Filmpalast';
            if (type === 'series' && season && episode) {
                return `${hostName} (DE) - S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
            }
            return `${hostName} - ${quality}`;
        }

        $('ul.currentStreamLinks').each(function(_i, streamBlock) {
            var hostName = $(streamBlock).find('.hostName').text().trim() || 'Filmpalast';
            var title = searchTitle;

            $(streamBlock).find('a[data-player-url]').each(function(_j, el) {
                var playerUrl = $(el).attr('data-player-url');
                var linkText = $(el).text();
                var quality = extractQuality(linkText || hostName);
                var displayName = formatDisplayName(hostName, quality);
                if (playerUrl && playerUrl.startsWith('http')) {
                    results.push({
                        name: displayName,
                        title: displayName,
                        language: 'de',
                        quality: quality,
                        url: playerUrl,
                        headers: {
                            'User-Agent': DEFAULT_HEADERS['User-Agent'],
                            'Referer': streamPageUrl.href
                        },
                        provider: 'filmpalast',
                        meta: {
                            countryCodes: ['de'],
                            referer: streamPageUrl.href,
                            title: displayName,
                            sourceLabel: 'Filmpalast'
                        }
                    });
                }
            });

            $(streamBlock).find('a[href]').each(function(_j, el) {
                var href = $(el).attr('href');
                if (!href || href === '#' || href.startsWith('javascript') || href.includes('filmpalast.to') || $(el).attr('data-player-url')) {
                    return;
                }

                try {
                    var url = resolveHref(href, BASE_URL);
                    if (isStreamingHost(url.hostname)) {
                        var linkText = $(el).text();
                        var quality = extractQuality(linkText || hostName);
                        var displayName = formatDisplayName(hostName, quality);
                        results.push({
                            name: displayName,
                            title: displayName,
                            language: 'de',
                            quality: quality,
                            url: url.href || String(url),
                            headers: {
                                'User-Agent': DEFAULT_HEADERS['User-Agent'],
                                'Referer': streamPageUrl.href
                            },
                            provider: 'filmpalast',
                            meta: {
                                countryCodes: ['de'],
                                referer: streamPageUrl.href,
                                title: displayName,
                                sourceLabel: 'Filmpalast'
                            }
                        });
                    }
                } catch (err) {
                    // Invalid URL, skip
                }
            });
        });

        // Post-process Vidara page URLs: resolve to direct streaming m3u8 where possible
        var postPromises = results.map(async function(item) {
                try {
                    var urlStr = item && (typeof item.url === 'string' ? item.url : (item.url && item.url.href));
                    if (!urlStr) return;

                    if (urlStr.indexOf('vidara') !== -1 || urlStr.indexOf('vidmatrix') !== -1 || urlStr.indexOf('vidmatrixa') !== -1) {
                        var vid = await resolveVidaraPageToStream(urlStr);
                        if (vid && vid.streaming_url) {
                            item.meta = item.meta || {};
                            item.meta.directStreamUrl = vid.streaming_url;
                            item.meta.directStreamSource = 'vidara';
                            item.meta.hostPage = urlStr;
                            item.meta.originalUrl = item.url;
                            item.url = vid.streaming_url;
                            item.headers = Object.assign({}, item.headers || {}, {
                                'User-Agent': DEFAULT_HEADERS['User-Agent'],
                                'Referer': streamPageUrl.href,
                                'Origin': (new URL(urlStr)).origin
                            });
                            if (vid.title) {
                                item.meta.title = item.meta.title || vid.title;
                            }
                        }
                    }

                    if (urlStr.indexOf('vidsonic') !== -1) {
                        var vs = await resolveVidsonicPageToStream(urlStr);
                        if (vs && vs.streaming_url) {
                            item.meta = item.meta || {};
                            item.meta.directStreamUrl = vs.streaming_url;
                            item.meta.directStreamSource = 'vidsonic';
                            item.meta.hostPage = urlStr;
                            item.meta.originalUrl = item.url;
                            item.url = vs.streaming_url;
                            item.headers = Object.assign({}, item.headers || {}, {
                                'User-Agent': DEFAULT_HEADERS['User-Agent'],
                                'Referer': streamPageUrl.href,
                                'Origin': (new URL(urlStr)).origin
                            });
                            if (vs.title) {
                                item.meta.title = item.meta.title || vs.title;
                            }
                        }
                    }

                    if (urlStr.indexOf('voe') !== -1) {
                        var voe = await resolveVoePageToStream(urlStr);
                        if (voe && voe.streaming_url) {
                            item.meta = item.meta || {};
                            item.meta.directStreamUrl = voe.streaming_url;
                            item.meta.directStreamSource = 'voe';
                            item.meta.hostPage = urlStr;
                            item.meta.originalUrl = item.url;
                            item.url = voe.streaming_url;
                            item.headers = Object.assign({}, item.headers || {}, {
                                'User-Agent': DEFAULT_HEADERS['User-Agent'],
                                'Referer': streamPageUrl.href,
                                'Origin': (new URL(urlStr)).origin
                            });
                            if (voe.title) item.meta.title = item.meta.title || voe.title;
                            if (voe.height) item.meta.height = item.meta.height || voe.height;
                            if (voe.size) item.meta.bytes = item.meta.bytes || voe.size;
                        }
                    }

                    if (urlStr.indexOf('firestream') !== -1) {
                        var fire = await resolveFireStreamPageToStream(urlStr);
                        if (fire && fire.streaming_url) {
                            item.meta = item.meta || {};
                            item.meta.directStreamUrl = fire.streaming_url;
                            item.meta.directStreamSource = 'firestream';
                            item.meta.hostPage = urlStr;
                            item.meta.originalUrl = item.url;
                            item.url = fire.streaming_url;
                            item.headers = Object.assign({}, item.headers || {}, {
                                'User-Agent': DEFAULT_HEADERS['User-Agent'],
                                'Referer': streamPageUrl.href,
                                'Origin': (new URL(urlStr)).origin
                            }, fire.headers || {});
                            if (fire.title) item.meta.title = item.meta.title || fire.title;
                        }
                    }
                } catch (e) {
                    // ignore per-item failures
                }
        });

        await Promise.all(postPromises);

        return results;
    } catch (err) {
        return [];
    }
}

module.exports = { getStreams };
