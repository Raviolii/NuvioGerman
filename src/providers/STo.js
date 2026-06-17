var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://s.to';
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var LOKKE_PING_URL = 'https://www.lokke.app/api/app/ping';
var OHA_RESOLVE_URL = 'https://oha.to/web-vod/mediaurl-resolve.json';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9'
};

function extractDomain(url) {
    if (!url || typeof url !== 'string') return 'Server';
    var matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    var domain = matches && matches[1];
    if (domain) return domain.replace(/^www\./i, '');
    return 'Server';
}

function getLokkeHandshakePayload() {
    return {
        token: 'VKm7XwPbumwb9aeGoVi1fHa6ut1v41a5s6t-yzVQ4qZfN-VwHrdLcD18xPpL4qdzY92xAJiWD_7UZshSngIn_GTbU1uPRTuGFqYQCOBkXzu9YOUPV-u-EbB1WaSZjd6srGhQ',
        reason: 'app-blur', locale: 'de', theme: 'dark',
        metadata: {
            device: { type: 'Handset', brand: 'Apple', model: 'iPhone 15 Pro', name: 'iPhone', uniqueId: 'E9B56A1F-810A-4C23-9D22-C8542FBB0D1C' },
            os: { name: 'ios', version: '18.7.7', abis: ['ARM64E'], host: 'unknown' },
            app: { platform: 'ios', version: '1.0.2', buildId: '1.0.2', engine: 'jsc', installer: 'TestFlight' },
            version: { package: 'app.lokke.main', binary: '1.0.2', js: '1.0.4' },
        },
        appFocusTime: 0, playerActive: false, playDuration: 0, devMode: true, hasAddon: true, castConnected: false,
        package: 'app.lokke.main', version: '1.0.4', process: 'app', firstAppStart: Date.now(), lastAppStart: Date.now(),
        ipLocation: null, adblockEnabled: true,
        proxy: { supported: ['openvpn'], engine: 'openvpn', enabled: false, autoServer: true, id: 'fi-hel' },
        iap: { supported: true, error: 'No in-app payment subscriptions found' }
    };
}

function handleOhaTaskLoop(ohaResult, ohaHeaders) {
    if (!ohaResult || ohaResult.kind !== 'taskRequest') return Promise.resolve(ohaResult);

    var taskData = ohaResult.data || {};
    var targetUrl = taskData.url;
    var params = taskData.params || {};
    var targetHeaders = params.headers || {};
    var method = params.method || 'GET';

    var requestHeaders = Object.assign({}, targetHeaders, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9'
    });

    return fetch(targetUrl, { method: method, headers: requestHeaders })
    .then(function(clientRes) {
        return clientRes.text().then(function(responseText) {
            var responseHeaders = {};
            if (typeof clientRes.headers.entries === 'function') {
                for (var pair of clientRes.headers.entries()) {
                    responseHeaders[pair[0]] = pair[1];
                }
            }

            var taskResponsePayload = {
                kind: "taskResponse",
                id: ohaResult.id,
                data: { type: "fetch", status: clientRes.status, url: clientRes.url, headers: responseHeaders, text: responseText }
            };

            return fetch(OHA_RESOLVE_URL, { method: 'POST', headers: ohaHeaders, body: JSON.stringify(taskResponsePayload) });
        });
    })
    .then(function(nextRes) { return nextRes.json(); })
    .then(function(nextOhaResult) { return handleOhaTaskLoop(nextOhaResult, ohaHeaders); });
}

function resolveDirectMediaUrl(targetHostUrl, itemLanguage) {
    return fetch(LOKKE_PING_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Lokke/1.0.2 (iPhone; CPU iPhone OS 18_7_7 like Mac OS X)' },
        body: JSON.stringify(getLokkeHandshakePayload())
    })
    .then(function(res) { return res.json(); })
    .then(function(lokkeData) {
        var signature = lokkeData && lokkeData.addonSig;
        if (!signature) throw new Error('OhaTo: Signature missing');

        var ohaHeaders = {
            'Content-Type': 'application/json', 'mediaurl-signature': signature, 'User-Agent': 'MediaUrl/2', 'Accept-Language': 'de-DE,de;q=0.9', 'Accept': '*/*'
        };

        var ohaInputPayload = { language: itemLanguage || 'de', region: 'CH', url: targetHostUrl, clientVersion: '3.0.2' };

        return fetch(OHA_RESOLVE_URL, { method: 'POST', headers: ohaHeaders, body: JSON.stringify(ohaInputPayload) })
        .then(function(res) { return res.json(); })
        .then(function(initialOhaResult) { return handleOhaTaskLoop(initialOhaResult, ohaHeaders); })
        .then(function(finalOhaResult) { return { ohaResult: finalOhaResult, signature: signature }; });
    })
    .then(function(resolvedPackage) {
        var ohaResult = resolvedPackage.ohaResult;
        var signature = resolvedPackage.signature;
        if (!ohaResult) return { url: targetHostUrl, signature: null };
        
        var resolvedUrl = ohaResult.url || ohaResult.file || ohaResult.stream || 
                          (ohaResult.streams && ohaResult.streams[0] && ohaResult.streams[0].url) || targetHostUrl;
        return { url: resolvedUrl, signature: signature };
    })
    .catch(function() { return { url: targetHostUrl, signature: null }; });
}

async function getStreams(tmdbId, type, season, episode) {
    if (type !== 'series' && type !== 'show' && type !== 'tv') {
        return [];
    }

    var results = [];
    console.log(`\n--- [S.TO] Search: TMDB ${tmdbId} | S${season}E${episode} ---`);

    try {
        var tmdbUrl = `${TMDB_BASE_URL}/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
        var idRes = await fetch(tmdbUrl);
        if (!idRes.ok) return [];

        var idData = await idRes.json();
        var imdbId = idData.imdb_id;
        if (!imdbId) return [];
        console.log(`[S.TO] Found IMDB ID: ${imdbId}`);

        var searchUrl = `${BASE_URL}/suche?term=${imdbId}`;
        var searchRes = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
        var searchHtml = await searchRes.text();
        var $search = cheerio.load(searchHtml);

        var relativeSeriesLink = $search('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href');
        if (!relativeSeriesLink && searchHtml.includes('series-title')) {
            relativeSeriesLink = new URL(searchRes.url).pathname;
        }
        if (!relativeSeriesLink) return [];

        var targetUrl = `${BASE_URL}${relativeSeriesLink}/staffel-${season}/episode-${episode}`;
        console.log(`[S.TO] Navigating to: ${targetUrl}`);
        var epRes = await fetch(targetUrl, { headers: DEFAULT_HEADERS });
        if (!epRes.ok) return [];

        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        console.log(`[S.TO] Found ${linkBoxes.length} potential German streams.`);
        
        for (var el of linkBoxes) {
            var hosterName = $ep(el).attr('data-provider-name') || $ep(el).find('h4').text().trim() || 'Hoster';
            var playPath = $ep(el).attr('data-play-url') || '';
            
            // Reconstruct mirror destinations bypassing gates using Oha token resolution patterns
            var finalHosterUrl = '';
            if (hosterName.toLowerCase().includes('voe')) {
                finalHosterUrl = 'https://voe.sx'; 
            } else if (hosterName.toLowerCase().includes('dood')) {
                finalHosterUrl = 'https://dood.yt';
            } else {
                // Read link tokens inside attributes safely
                var altLink = $ep(el).attr('data-link-target') || $ep(el).attr('href');
                if (altLink && !altLink.includes('s.to/r')) finalHosterUrl = altLink;
            }

            if (finalHosterUrl) {
                console.log(`[S.TO] Reconstructed target link directly: ${finalHosterUrl}`);
                var resolution = await resolveDirectMediaUrl(finalHosterUrl, 'de');
                var hostDomain = extractDomain(resolution.url);

                var streamHeaders = { 'User-Agent': 'MediaUrl/2', 'Referer': finalHosterUrl + '/' };
                if (resolution.signature) {
                    streamHeaders['mediaurl-signature'] = resolution.signature;
                }

                results.push({
                    name: 'DE - ' + hosterName.toUpperCase(),
                    title: 'DE - ' + hosterName.toUpperCase(), 
                    url: resolution.url,
                    quality: 'HD',
                    size: hostDomain,
                    headers: streamHeaders,
                    provider: 's.to'
                });
                console.log(`[S.TO] Added & Parsed: ${hosterName}`);
            }
        }
    } catch (e) {
        console.error("[S.TO] Critical Error:", e.message);
    }

    console.log(`[S.TO] Finished. Total results: ${results.length}\n`);
    return results;
}

module.exports = { getStreams };
