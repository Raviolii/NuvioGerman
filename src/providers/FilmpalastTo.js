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
    'dropload', 'savefiles', 'streamembed', 'vidara', 'vidsonic'
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

async function resolveVoePageToStream(pageUrl) {
    try {
        var pageRes = await fetch(pageUrl, { headers: DEFAULT_HEADERS });
        if (!pageRes.ok) return null;
        var html = await pageRes.text();
        var $ = cheerio.load(html);

        var title = $('title').text().trim() || $('meta[name="description"]').attr('content') || '';

        // Follow simple JS redirects: window.location.href = '...'
        var redirectMatch = html.match(/window\.location\.href\s*=\s*'([^']+)'/);
        while (redirectMatch && redirectMatch[1]) {
            try {
                var redirected = redirectMatch[1];
                var redirectedRes = await fetch(redirected, { headers: DEFAULT_HEADERS });
                if (!redirectedRes.ok) break;
                html = await redirectedRes.text();
                redirectMatch = html.match(/window\.location\.href\s*=\s*'([^']+)'/);
            } catch (e) {
                break;
            }
        }

        // Attempt ResolveURL-style JSON/script decoding
        var jsonScriptMatch = html.match(/json">\["([^\"]+)"]<\/script>\s*<script\s*src="([^\"]+)/i);
        if (jsonScriptMatch) {
            try {
                var ct = jsonScriptMatch[1];
                var scriptPart = jsonScriptMatch[2];
                var scriptUrl = new URL(scriptPart, pageUrl).href;
                var html2res = await fetch(scriptUrl, { headers: DEFAULT_HEADERS });
                if (html2res && html2res.ok) {
                    var html2 = await html2res.text();
                    var repl = html2.match(/(\[(?:'\W{2}'[,\]]){1,9})/);
                    if (repl && repl[1]) {
                        var s = null;
                        try {
                            s = voe_decode(ct, repl[1]);
                        } catch (e) {
                            s = null;
                        }

                        if (s) {
                            // Collect candidate URLs from common keys and nested structures
                            var candidates = [];
                            var tryAdd = function(u) {
                                if (!u) return;
                                if (typeof u !== 'string') return;
                                var cand = u;
                                if (cand.startsWith('//')) cand = 'https:' + cand;
                                else if (cand.startsWith('/')) cand = (new URL(pageUrl)).origin + cand;
                                else if (!cand.match(/^https?:\/\//)) {
                                    try { cand = new URL(cand, pageUrl).href; } catch (e) { /* leave as-is */ }
                                }
                                if (cand.indexOf('http') === 0 || cand.indexOf('.m3u8') !== -1) {
                                    if (candidates.indexOf(cand) === -1) candidates.push(cand);
                                }
                            };

                            ['file', 'source', 'direct_access_url'].forEach(function(k) {
                                if (s[k]) {
                                    if (typeof s[k] === 'string') tryAdd(s[k]);
                                    else if (typeof s[k] === 'object') {
                                        for (var kk in s[k]) tryAdd(s[k][kk]);
                                    }
                                }
                            });

                            // Also scan top-level object fields for string urls
                            for (var pk in s) {
                                if (typeof s[pk] === 'string') tryAdd(s[pk]);
                                else if (typeof s[pk] === 'object') {
                                    for (var q in s[pk]) tryAdd(s[pk][q]);
                                }
                            }

                            // Prefer direct m3u8 links
                            var m3u8c = candidates.filter(function(u) { return u.toLowerCase().indexOf('.m3u8') !== -1; });
                            var chosen = null;
                            if (m3u8c.length) {
                                chosen = m3u8c[0];
                            } else {
                                // Probe candidates: fetch and look for #EXTM3U or m3u8 content-type
                                    for (var ci = 0; ci < candidates.length; ci++) {
                                    var cand = candidates[ci];
                                    try {
                                            var probeRes = await fetch(cand, { headers: Object.assign({}, DEFAULT_HEADERS, { 'Referer': pageUrl, 'Origin': (new URL(pageUrl)).origin }) });
                                        if (!probeRes.ok) continue;
                                        var ctype = (probeRes.headers && probeRes.headers.get && probeRes.headers.get('content-type')) || '';
                                        var body = await probeRes.text();
                                        if (ctype.indexOf('mpegurl') !== -1 || body.indexOf('#EXTM3U') !== -1 || body.indexOf('#EXTINF') !== -1) {
                                            // If the response is a playlist or contains HLS markers, use it
                                            chosen = cand;
                                            break;
                                        }
                                        // If the fetched HTML contains an m3u8 link, extract and resolve it
                                        var innerM3u8 = body.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
                                        if (innerM3u8 && innerM3u8[0]) {
                                            try { chosen = new URL(innerM3u8[0], cand).href; break; } catch (e) { chosen = innerM3u8[0]; break; }
                                        }
                                    } catch (e) {
                                        // ignore probe errors
                                    }
                                }
                            }

                            if (chosen) {
                                var sizeMatch = html.match(/[\d,.]+\s*(?:GB|MB)/i);
                                var size = sizeMatch ? parseSizeToBytes(sizeMatch[0]) : null;
                                var heightMatch = html.match(/(\d{3,4})p/);
                                var height = heightMatch ? parseInt(heightMatch[1], 10) : undefined;
                                return { streaming_url: chosen, title: title, height: height, size: size };
                            }
                        }
                    }
                }
            } catch (e) {
                // fall through to other extraction methods
            }
        }

            // If ResolveURL-style decoding didn't find anything, try scanning all external scripts
            try {
                var scriptSrcMatches = html.match(/<script[^>]+src=["']([^"']+)["'][^>]*>/ig) || [];
                for (var si = 0; si < scriptSrcMatches.length; si++) {
                    try {
                        var m = scriptSrcMatches[si].match(/src=["']([^"']+)["']/i);
                        if (!m || !m[1]) continue;
                        var scrUrl = new URL(m[1], pageUrl).href;
                        var scrRes = await fetch(scrUrl, { headers: DEFAULT_HEADERS });
                        if (!scrRes || !scrRes.ok) continue;
                        var scrText = await scrRes.text();
                        // try to find the LUT pattern and any ct candidate in page html
                        var repl2 = scrText.match(/(\[(?:'[^']+'[,\]]){1,12})/);
                        var ctCandidates = [];
                        var ct1 = html.match(/json">\["([^\"]{40,})/i);
                        if (ct1 && ct1[1]) ctCandidates.push(ct1[1]);
                        var ct2 = html.match(/var\s+ct\s*=\s*'([^']+)'/i);
                        if (ct2 && ct2[1]) ctCandidates.push(ct2[1]);
                        var ct3 = html.match(/data-ct=["']([^"']+)["']/i);
                        if (ct3 && ct3[1]) ctCandidates.push(ct3[1]);
                        // also search script text for a long base64-like chunk
                        var ct4 = scrText.match(/([A-Za-z0-9+/=]{60,})/);
                        if (ct4 && ct4[1]) ctCandidates.push(ct4[1]);

                        if (repl2 && repl2[1] && ctCandidates.length) {
                            for (var cti = 0; cti < ctCandidates.length; cti++) {
                                try {
                                    var s2 = voe_decode(ctCandidates[cti], repl2[1]);
                                    if (!s2) continue;
                                    var candList = [];
                                    ['file','source','direct_access_url'].forEach(function(k){ if (s2[k]) { if (typeof s2[k] === 'string') candList.push(s2[k]); else if (typeof s2[k] === 'object') for (var kk in s2[k]) candList.push(s2[k][kk]); }});
                                    for (var xi=0; xi<candList.length; xi++) {
                                        var u = candList[xi];
                                        if (!u) continue;
                                        try { u = new URL(u, pageUrl).href; } catch(e){}
                                        if (u && u.toLowerCase().indexOf('.m3u8') !== -1) return { streaming_url: u, title: title };
                                    }
                                } catch (e) { }
                            }
                        }
                    } catch (e) { /* ignore script fetch errors */ }
                }
            } catch (e) { /* ignore */ }

        // Fallback: try to scrape .m3u8 or JS vars
        var m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
        var streaming = null;
        if (m3u8Match && m3u8Match[0]) {
            streaming = m3u8Match[0];
        } else {
            var fileMatch = html.match(/file\s*:\s*\"([^\"]+\.m3u8[^\"]*)\"/i) || html.match(/source\s*:\s*'([^']+\.m3u8[^']*)'/i) || html.match(/hls\s*[:=]\s*\"([^\"]+)\"/i);
            if (fileMatch && fileMatch[1]) streaming = fileMatch[1];
        }

        if (!streaming) return null;

        var sizeMatch2 = html.match(/[\d,.]+\s*(?:GB|MB)/i);
        var size2 = sizeMatch2 ? parseSizeToBytes(sizeMatch2[0]) : null;
        var heightMatch2 = html.match(/(\d{3,4})p/);
        var height2 = heightMatch2 ? parseInt(heightMatch2[1], 10) : undefined;

        return { streaming_url: streaming, title: title, height: height2, size: size2 };
    } catch (e) {
        return null;
    }
}

function voe_decode(ct, luts) {
    try {
        // Build LUT array similar to ResolveURL implementation
        var inner = luts.slice(2, -2);
        var parts = inner.split("','");
        var lut = parts.map(function(i) {
            return i.split('').map(function(x) {
                return " .*+?^${}()|[]\\".indexOf(x) !== -1 ? ('\\' + x) : x;
            }).join('');
        });

        var txt = '';
        for (var idx = 0; idx < ct.length; idx++) {
            var x = ct.charCodeAt(idx);
            if (64 < x && x < 91) x = (x - 52) % 26 + 65;
            else if (96 < x && x < 123) x = (x - 84) % 26 + 97;
            txt += String.fromCharCode(x);
        }

        for (var ii = 0; ii < lut.length; ii++) {
            try { txt = txt.replace(new RegExp(lut[ii], 'g'), ''); } catch (e) { /* ignore */ }
        }

        var b1 = Buffer.from(txt, 'base64').toString('latin1');
        var shifted = '';
        for (var j = 0; j < b1.length; j++) shifted += String.fromCharCode(b1.charCodeAt(j) - 3);
        var rev = shifted.split('').reverse().join('');
        var decoded = Buffer.from(rev, 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch (e) {
        return null;
    }
}

function extractAutocompleteResult(candidates) {
    if (Array.isArray(candidates)) {
        for (var i = 0; i < candidates.length; i++) {
            var item = candidates[i];
            if (typeof item === 'string' && item.trim()) {
                return item.trim();
            }
        }
        return undefined;
    }

    if (candidates && typeof candidates === 'object') {
        for (var key in candidates) {
            var value = candidates[key];
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
    }

    return undefined;
}

async function fetchStreamPageUrl(searchQuery, type, season, episode) {
    var autocompleteUrl = BASE_URL + '/autocomplete.php';
    var formData = new URLSearchParams({ term: searchQuery });

    var autocompleteResponse = await fetch(autocompleteUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...DEFAULT_HEADERS
        },
        body: formData.toString()
    });

    var candidates = await autocompleteResponse.json();
    var searchResult = extractAutocompleteResult(candidates);
    if (!searchResult) {
        return undefined;
    }

    if (type === 'series' && season && episode) {
        var seriesSlug = searchResult
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

        if (seriesSlug) {
            return new URL(BASE_URL + '/stream/' + seriesSlug + '-s' + String(season).padStart(2, '0') + 'e' + String(episode).padStart(2, '0'));
        }
    }

    var encodedSearchResult = encodeURIComponent(searchResult);
    var searchPageUrl = BASE_URL + '/search/title/' + encodedSearchResult;
    var searchPageResponse = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS });
    var searchPageHtml = await searchPageResponse.text();
    var $ = cheerio.load(searchPageHtml);

    var streamLink = $('a[href^="//filmpalast.to/stream/"]')
        .first()
        .attr('href');

    if (streamLink) {
        return resolveHref(streamLink, BASE_URL);
    }

    return undefined;
}

async function getStreams(tmdbId, type, season, episode) {
    if (!tmdbId) {
        return [];
    }

    var searchQuery = String(tmdbId);

    // Optionally convert numeric TMDB id to IMDb id when an API key is available
    try {
        var tmdbKey = TMDB_API_KEY || process.env.TMDB_API_KEY;
        if (tmdbKey && /^\d+$/.test(searchQuery)) {
            var tmdbBase = 'https://api.themoviedb.org/3';
            var endpoint = type === 'series' ? '/tv/' : '/movie/';
            var tmdbUrl = tmdbBase + endpoint + encodeURIComponent(searchQuery) + '/external_ids?api_key=' + tmdbKey;
            var tmdbRes = await fetch(tmdbUrl);
            if (tmdbRes && tmdbRes.ok) {
                var tmdbData = await tmdbRes.json();
                if (tmdbData && tmdbData.imdb_id) {
                    searchQuery = tmdbData.imdb_id;
                }
            }
        }
    } catch (e) {
        // Non-fatal: continue using original tmdb id
    }

    try {
        var streamPageUrl = await fetchStreamPageUrl(searchQuery, type, season, episode);
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

        $('ul.currentStreamLinks').each(function(_i, streamBlock) {
            var hostName = $(streamBlock).find('.hostName').text().trim() || 'Filmpalast';
            var title = season ? searchQuery : searchQuery;

            $(streamBlock).find('a[data-player-url]').each(function(_j, el) {
                var playerUrl = $(el).attr('data-player-url');
                var linkText = $(el).text();
                var quality = extractQuality(linkText || hostName);
                if (playerUrl && playerUrl.startsWith('http')) {
                    results.push({
                        name: hostName + ' - ' + quality,
                        title: hostName + ' - ' + quality,
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
                            title: hostName + ' - ' + title,
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
                        results.push({
                            name: hostName + ' - ' + quality,
                            title: hostName + ' - ' + quality,
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
                                title: hostName + ' - ' + title,
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

                    if (urlStr.indexOf('vidara') !== -1) {
                        var vid = await resolveVidaraPageToStream(urlStr);
                        if (vid && vid.streaming_url) {
                            item.meta = item.meta || {};
                            item.meta.directStreamUrl = vid.streaming_url;
                            item.meta.directStreamSource = 'vidara';
                            item.meta.hostPage = urlStr;
                            item.requestHeaders = Object.assign({}, item.requestHeaders || {}, { 'Origin': (new URL(urlStr)).origin });
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
                            item.requestHeaders = Object.assign({}, item.requestHeaders || {}, { 'Origin': (new URL(urlStr)).origin });
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
                            item.requestHeaders = Object.assign({}, item.requestHeaders || {}, { 'Origin': (new URL(urlStr)).origin });
                            if (voe.title) item.meta.title = item.meta.title || voe.title;
                            if (voe.height) item.meta.height = item.meta.height || voe.height;
                            if (voe.size) item.meta.bytes = item.meta.bytes || voe.size;
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
