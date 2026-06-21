var cheerio = require('cheerio-without-node-native');

// NOTE: Plugin environments may not allow requiring other provider files.
// Inline a minimal subset of OhaTo helpers here so `S.to` works standalone.

function extractDomain(url) {
    if (!url || typeof url !== 'string') return 'Server';
    var matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    var domain = matches && matches[1];
    if (domain) return domain.replace(/^www\./i, '');
    return 'Server';
}

function normalizeDoodUrl(url) {
    if (!url || typeof url !== 'string') return url;
    var isDood = url.match(/dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s|playmogo|playmogo.com/i);
    if (isDood) {
        var playmogoMatch = url.match(/playmogo\.com\/e\/([a-zA-Z0-9]+)/i);
        if (playmogoMatch && playmogoMatch[1]) return 'https://dood.yt/e/' + playmogoMatch[1];
        var match = url.match(/\/[dew]\/([a-zA-Z0-9]+)/) || url.match(/\/([a-zA-Z0-9]+)(?:\?|$)/);
        if (match && match[1]) return 'https://dood.yt/e/' + match[1];
    }
    return url;
}

function normalizeVoeUrl(url) {
    if (!url || typeof url !== 'string') return url;
    var host = extractDomain(url);
    var isVoe = url.indexOf('voe') !== -1; // simple heuristic
    if (isVoe) {
        var match = url.match(/(?:\/voe)?\/([a-zA-Z0-9]+)(?:\?|$)/);
        if (match && match[1]) return 'https://voe.sx/e/' + match[1];
    }
    return url;
}

// VOE mirrors list and full Oha-like resolver logic (inlined)
var LOKKE_PING_URL = 'https://www.lokke.app/api/app/ping';
var OHA_RESOLVE_URL = 'https://oha.to/web-vod/mediaurl-resolve.json';

var VOE_MIRRORS = [
    '19turanosephantasia.com', '20demidistance9elongations.com', '30sensualizeexpression.com',
    '321naturelikefurfuroid.com', '35volitantplimsoles5.com', '449unceremoniousnasoseptal.com',
    '745mingiestblissfully.com', 'adrianmissionminute.com', 'alleneconomicmatter.com',
    'antecoxalbobbing1010.com', 'apinchcaseation.com', 'audaciousdefaulthouse.com',
    'availedsmallest.com', 'bigclatterhomesguideservice.com', 'boonlessbestselling244.com',
    'bradleyviewdoctor.com', 'brittneystandardwestern.com', 'brucevotewithin.com',
    'charlestoughrace.com', 'christopheruntilpoint.com', 'chromotypic.com',
    'chuckle-tube.com', 'cindyeyefinal.com', 'counterclockwisejacky.com',
    'crownmakermacaronicism.com', 'crystaltreatmenteast.com', 'cyamidpulverulence530.com',
    'diananatureforeign.com', 'donaldlineelse.com', 'edwardarriveoften.com',
    'erikcoldperson.com', 'figeterpiazine.com', 'fittingcentermondaysunday.com',
    'fraudclatterflyingcar.com', 'gamoneinterrupted.com', 'generatesnitrosate.com',
    'goofy-banana.com', 'graceaddresscommunity.com', 'greaseball6eventual20.com',
    'guidon40hyporadius9.com', 'heatherdiscussionwhen.com', 'housecardsummerbutton.com',
    'jamessoundcost.com', 'jamiesamewalk.com', 'jasminetesttry.com',
    'jayservicestuff.com', 'jennifercertaindevelopment.com', 'jilliandescribecompany.com',
    'johnalwayssame.com', 'jonathansociallike.com', 'josephseveralconcern.com',
    'kathleenmemberhistory.com', 'kellywhatcould.com', 'kennethofficialitem.com',
    'kinoger.ru', 'kristiesoundsimply.com', 'lancewhosedifficult.com',
    'launchreliantcleaverriver.com', 'lauradaydo.com', 'lisatrialidea.com',
    'loriwithinfamily.com', 'lukecomparetwo.com', 'lukesitturn.com',
    'mariatheserepublican.com', 'matriculant401merited.com', 'maxfinishseveral.com',
    'metagnathtuggers.com', 'michaelapplysome.com', 'mikaylaarealike.com',
    'nathanfromsubject.com', 'nectareousoverelate.com', 'nonesnanking.com',
    'paulkitchendark.com', 'realfinanceblogcenter.com', 'rebeccaneverbase.com',
    'reputationsheriffkennethsand.com', 'richardsignfish.com', 'roberteachfinal.com',
    'robertordercharacter.com', 'robertplacespace.com', 'sandratableother.com',
    'sandrataxeight.com', 'scatch176duplicities.com', 'sethniceletter.com',
    'shannonpersonalcost.com', 'simpulumlamerop.com', 'smoki.cc',
    'stevenimaginelittle.com', 'strawberriesporail.com', 'telyn610zoanthropy.com',
    'timberwoodanotia.com', 'toddpartneranimal.com', 'toxitabellaeatrebates306.com',
    'uptodatefinishconferenceroom.com', 'v-o-e-unblock.com', 'valeronevijao.com',
    'walterprettytheir.com', 'wolfdyslectic.com', 'yodelswartlike.com'
];

function getLokkeHandshakePayload() {
    return {
        token: 'VKm7XwPbumwb9aeGoVi1fHa6ut1v41a5s6t-yzVQ4qZfN-VwHrdLcD18xPpL4qdzY92xAJiWD_7UZshSngIn_GTbU1uPRTuGFqYQCOBkXzu9YOUPV-u-EbB1WaSZjd6srGhQ',
        reason: 'app-blur',
        locale: 'de',
        theme: 'dark',
        metadata: {
            device: { 
                type: 'Handset', 
                brand: 'Apple', 
                model: 'iPhone 15 Pro', 
                name: 'iPhone', 
                uniqueId: 'E9B56A1F-810A-4C23-9D22-C8542FBB0D1C' 
            },
            os: { name: 'ios', version: '18.7.7', abis: ['ARM64E'], host: 'unknown' },
            app: { platform: 'ios', version: '1.0.2', buildId: '1.0.2', engine: 'jsc', installer: 'TestFlight' },
            version: { package: 'app.lokke.main', binary: '1.0.2', js: '1.0.4' },
        },
        appFocusTime: 0,
        playerActive: false,
        playDuration: 0,
        devMode: true,
        hasAddon: true,
        castConnected: false,
        package: 'app.lokke.main',
        version: '1.0.4',
        process: 'app',
        firstAppStart: Date.now(),
        lastAppStart: Date.now(),
        ipLocation: null,
        adblockEnabled: true,
        proxy: { supported: ['openvpn'], engine: 'openvpn', enabled: false, autoServer: true, id: 'fi-hel' },
        iap: { supported: true, error: 'No in-app payment subscriptions found' }
    };
}

function handleOhaTaskLoop(ohaResult, ohaHeaders) {
    if (!ohaResult || ohaResult.kind !== 'taskRequest') {
        return Promise.resolve(ohaResult);
    }

    var taskData = ohaResult.data || {};
    var targetUrl = taskData.url;
    var params = taskData.params || {};
    var targetHeaders = params.headers || {};
    var method = params.method || 'GET';

    var requestHeaders = Object.assign({}, targetHeaders, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
    });

    return fetch(targetUrl, {
        method: method,
        headers: requestHeaders
    })
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
                data: {
                    type: "fetch",
                    status: clientRes.status,
                    url: clientRes.url,
                    headers: responseHeaders,
                    text: responseText
                }
            };

            return fetch(OHA_RESOLVE_URL, {
                method: 'POST',
                headers: ohaHeaders,
                body: JSON.stringify(taskResponsePayload)
            });
        });
    })
    .then(function(nextRes) { return nextRes.json(); })
    .then(function(nextOhaResult) {
        return handleOhaTaskLoop(nextOhaResult, ohaHeaders);
    });
}

function resolveDirectMediaUrl(targetHostUrl, itemLanguage) {
    var finalTargetUrl = normalizeDoodUrl(targetHostUrl);
    finalTargetUrl = normalizeVoeUrl(finalTargetUrl);

    return fetch(LOKKE_PING_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Lokke/1.0.2 (iPhone; CPU iPhone OS 18_7_7 like Mac OS X)'
        },
        body: JSON.stringify(getLokkeHandshakePayload())
    })
    .then(function(res) { return res.json(); })
    .then(function(lokkeData) {
        var signature = lokkeData && lokkeData.addonSig;
        if (!signature) throw new Error('OhaTo: Signature validation failed');

        var ohaHeaders = {
            'Content-Type': 'application/json',
            'mediaurl-signature': signature,
            'User-Agent': 'MediaUrl/2',
            'Accept-Language': 'de-DE,de;q=0.9',
            'Accept': '*/*'
        };

        var ohaInputPayload = {
            language: itemLanguage || 'de',
            region: 'CH',
            url: finalTargetUrl,
            clientVersion: '3.0.2'
        };

        return fetch(OHA_RESOLVE_URL, {
            method: 'POST',
            headers: ohaHeaders,
            body: JSON.stringify(ohaInputPayload)
        })
        .then(function(res) { return res.json(); })
        .then(function(initialOhaResult) {
            return handleOhaTaskLoop(initialOhaResult, ohaHeaders);
        });
    })
    .then(function(ohaResult) {
        if (!ohaResult) return finalTargetUrl;
        
        var resolvedUrl = ohaResult.url || ohaResult.file || ohaResult.stream || 
                          (ohaResult.streams && ohaResult.streams[0] && ohaResult.streams[0].url) || 
                          (ohaResult.links && ohaResult.links[0]) || finalTargetUrl;
        return resolvedUrl;
    })
    .catch(function() {
        return finalTargetUrl;
    });
}

var BASE_URL = 'https://s.to';
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ==========================================
// 1. REDIRECT HELPER
// ==========================================
async function getFinalRedirect(url, referer) {
    try {
        console.log(`[S.TO] Resolving redirect: ${url}`);
        const response = await fetch(url, {
            method: 'GET',
            headers: { ...DEFAULT_HEADERS, 'Referer': referer },
            redirect: 'follow'
        });
        return response.url;
    } catch (e) {
        console.error(`[S.TO] Redirect resolution failed: ${e.message}`);
        return url;
    }
}

// ==========================================
// 2. MAIN FUNCTION
// ==========================================
async function getStreams(tmdbId, type, season, episode, onResult) {
    // S.to ONLY supports series. 
    // If 'movie' is passed, we exit early to prevent unnecessary API calls.
    if (type !== 'series' && type !== 'show' && type !== 'tv') {
        console.log(`[S.TO] Skip: Provider does not support type "${type}"`);
        return [];
    }

    var results = [];
    console.log(`\n--- [S.TO] Search: TMDB ${tmdbId} | S${season}E${episode} ---`);

    try {
        // Schritt A: IMDB-ID via TMDB API holen
        // We use the /tv/ endpoint because S.to is a series provider
        var tmdbUrl = `${TMDB_BASE_URL}/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
        
        console.log(`[S.TO] Fetching External IDs: ${tmdbUrl}`);
        var idRes = await fetch(tmdbUrl);
        
        if (idRes.status === 404) {
            console.error(`[S.TO] Error 404: TMDB ID ${tmdbId} not found. Ensure this is a TV Show ID, not a Movie ID.`);
            return [];
        }

        var idData = await idRes.json();
        var imdbId = idData.imdb_id;

        if (!imdbId) {
            console.log("[S.TO] No IMDB-ID linked to this TMDB entry.");
            return [];
        }
        console.log(`[S.TO] Found IMDB ID: ${imdbId}`);

        // Schritt B: Suche auf s.to mit der IMDB-ID
        var searchUrl = `${BASE_URL}/suche?term=${imdbId}`;
        console.log(`[S.TO] Searching S.TO: ${searchUrl}`);
        var searchRes = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
        var searchHtml = await searchRes.text();
        var $search = cheerio.load(searchHtml);

        // Find the series link
        var relativeSeriesLink = $search('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href');
        
        if (!relativeSeriesLink) {
            // Check if we are already on the series page (sometimes search redirects directly)
            if (searchHtml.includes('series-title')) {
                console.log("[S.TO] Search redirected directly to series page.");
                // Extract path from the response URL
                relativeSeriesLink = new URL(searchRes.url).pathname;
            } else {
                console.warn("[S.TO] Series link not found in search results.");
                return [];
            }
        }

        // Schritt C: Episoden-Seite aufrufen
        var targetUrl = `${BASE_URL}${relativeSeriesLink}/staffel-${season}/episode-${episode}`;
        console.log(`[S.TO] Navigating to: ${targetUrl}`);
        var epRes = await fetch(targetUrl, { headers: DEFAULT_HEADERS });
        
        if (!epRes.ok) {
            console.error(`[S.TO] Episode page returned status ${epRes.status}`);
            return [];
        }

        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        // Schritt D: Deutsche Links extrahieren (data-language-id="1")
        // Language IDs: 1 = German, 2 = English, 3 = German Subbed
        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        console.log(`[S.TO] Found ${linkBoxes.length} potential German streams.`);
        
        // Domains that should be rewritten to Dood format before resolving
        function mapToDood(url) {
            if (!url || typeof url !== 'string') return url;
            // Playmogo often exposes Dood streams at /e/:id -> map to dood.yt/e/:id
            var pm = url.match(/playmogo\.com\/e\/([a-zA-Z0-9]+)/i);
            if (pm && pm[1]) return 'https://dood.yt/e/' + pm[1];
            return url;
        }
        
        for (var el of linkBoxes) {
            var playPath = $ep(el).attr('data-play-url');
            var hosterName = $ep(el).attr('data-provider-name') || 'Hoster';
            var languageId = $ep(el).attr('data-language-id') || '';
            var languageLabel = $ep(el).attr('data-language-label') || '';

            function mapLanguage(label, id) {
                var l = (label || '').toLowerCase();
                if (id === '1' || l.indexOf('deutsch') === 0 || l === 'de' || l.indexOf('german') === 0) return 'de';
                if (id === '2' || l.indexOf('engl') === 0 || l === 'en' || l.indexOf('english') === 0) return 'en';
                if (id === '3') return 'de';
                return (l.substr(0,2) || 'de');
            }

            var langCode = mapLanguage(languageLabel, languageId);

            if (!playPath) continue;

            // Redirect auflösen
            var redirectUrl = BASE_URL + playPath;
            var rawHosterUrl = await getFinalRedirect(redirectUrl, targetUrl);

            // Map certain host URLs to dood format first (Playmogo etc.)
            rawHosterUrl = mapToDood(rawHosterUrl);

            // Also normalize Voe mirrors to the consistent /e/ form using local helper
            try {
                rawHosterUrl = normalizeVoeUrl(rawHosterUrl);
            } catch (e) {
                console.error('[S.TO] Voe normalization failed:', e && e.message);
            }

            // Filter out internal s.to links that didn't resolve to a real hoster
            if (rawHosterUrl && !rawHosterUrl.includes('s.to/r/')) {
                // Let Oha.to resolve direct media URLs and normalize hosts
                var finalUrl = rawHosterUrl;
                try {
                    finalUrl = await resolveDirectMediaUrl(rawHosterUrl, 'de');
                } catch (e) {
                    console.error('[S.TO] resolveDirectMediaUrl failed:', e && e.message);
                }

                var hostDomain = 'Server';
                try {
                    hostDomain = (new URL(finalUrl)).hostname.replace(/^www\./i, '');
                } catch (e) {}

                var displayLang = langCode ? langCode.toUpperCase() : (languageLabel || 'DE');
                var streamObj = {
                    name: `${hosterName} (${displayLang}) - S${season}E${episode}`,
                    title: `${hosterName} (${displayLang}) - S${season}E${episode}`,
                    language: langCode,
                    meta: {
                        countryCodes: [langCode]
                    },
                    url: finalUrl,
                    quality: 'HD',
                    size: hostDomain,
                    headers: {
                        'User-Agent': 'MediaUrl/2',
                        'Referer': BASE_URL + '/'
                    },
                    provider: 'sto'
                };

                // Emit partial result immediately if caller provided a callback
                try {
                    if (typeof onResult === 'function') onResult(streamObj);
                } catch (e) {
                    console.error('[S.TO] onResult callback error:', e && e.message);
                }

                results.push(streamObj);
                console.log(`[S.TO] Added: ${hosterName} -> ${hostDomain}`);
            }
        }
    } catch (e) {
        console.error("[S.TO] Critical Error during execution:", e.message);
    }

    console.log(`[S.TO] Finished. Total results: ${results.length}\n`);
    return results;
}

module.exports = { getStreams };