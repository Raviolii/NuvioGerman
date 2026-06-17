var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://s.to';
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var LOKKE_PING_URL = 'https://www.lokke.app/api/app/ping';
var OHA_RESOLVE_URL = 'https://oha.to/web-vod/mediaurl-resolve.json';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
};

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

function extractDomain(url) {
    if (!url || typeof url !== 'string') return 'Server';
    var matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    var domain = matches && matches[1];
    if (domain) return domain.replace(/^www\./i, '');
    return 'Server';
}

function normalizeDoodUrl(url) {
    if (!url || typeof url !== 'string') return url;
    var isDood = url.match(/dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s/i);
    if (isDood) {
        var match = url.match(/\/[dew]\/([a-zA-Z0-9]+)/) || url.match(/\/([a-zA-Z0-9]+)(?:\?|$)/);
        if (match && match[1]) return 'https://dood.yt/w/' + match[1];
    }
    return url;
}

function normalizeVoeUrl(url) {
    if (!url || typeof url !== 'string') return url;
    var host = extractDomain(url);
    var isVoeMirror = VOE_MIRRORS.indexOf(host) !== -1 || url.indexOf('voe') !== -1;
    if (isVoeMirror) {
        var match = url.match(/(?:\/voe)?\/([a-zA-Z0-9]+)(?:\?|$)/);
        if (match && match[1]) return 'https://voe.sx/' + match[1];
    }
    return url;
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
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
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
                data: {
                    type: "fetch", status: clientRes.status, url: clientRes.url, headers: responseHeaders, text: responseText
                }
            };

            return fetch(OHA_RESOLVE_URL, {
                method: 'POST', headers: ohaHeaders, body: JSON.stringify(taskResponsePayload)
            });
        });
    })
    .then(function(nextRes) { return nextRes.json(); })
    .then(function(nextOhaResult) { return handleOhaTaskLoop(nextOhaResult, ohaHeaders); });
}

function resolveDirectMediaUrl(targetHostUrl, itemLanguage) {
    var finalTargetUrl = normalizeVoeUrl(normalizeDoodUrl(targetHostUrl));

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

        var ohaInputPayload = { language: itemLanguage || 'de', region: 'CH', url: finalTargetUrl, clientVersion: '3.0.2' };

        return fetch(OHA_RESOLVE_URL, { method: 'POST', headers: ohaHeaders, body: JSON.stringify(ohaInputPayload) })
        .then(function(res) { return res.json(); })
        .then(function(initialOhaResult) { return handleOhaTaskLoop(initialOhaResult, ohaHeaders); })
        .then(function(finalOhaResult) { return { ohaResult: finalOhaResult, signature: signature }; });
    })
    .then(function(resolvedPackage) {
        var ohaResult = resolvedPackage.ohaResult;
        var signature = resolvedPackage.signature;
        if (!ohaResult) return { url: finalTargetUrl, signature: null };
        
        var resolvedUrl = ohaResult.url || ohaResult.file || ohaResult.stream || 
                          (ohaResult.streams && ohaResult.streams[0] && ohaResult.streams[0].url) || finalTargetUrl;
        return { url: resolvedUrl, signature: signature };
    })
    .catch(function() { return { url: finalTargetUrl, signature: null }; });
}

async function getFinalRedirect(url, referer, cookieStr) {
    try {
        console.log(`[S.TO] Requesting secure gate extraction: ${url}`);
        
        var headers = {
            ...DEFAULT_HEADERS,
            'Referer': referer,
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin'
        };

        if (cookieStr) {
            headers['Cookie'] = cookieStr;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            redirect: 'follow'
        });
        
        if (response.url && !response.url.includes('s.to/r')) {
            console.log(`[S.TO] HTTP Redirection succeeded: ${response.url}`);
            return response.url;
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        
        let targetLink = $('a.watchEpisode').attr('href') || 
                         $('.redirect-link').attr('href') || 
                         $('a[target="_blank"]').filter((i, el) => $(el).text().toLowerCase().includes('weiter')).attr('href');
        
        if (!targetLink) {
            const pattern = /(?:window\.location\.href|window\.location|location\.replace)\s*=\s*['"]([^'"]+)['"]/i;
            const match = html.match(pattern);
            if (match) targetLink = match[1];
        }

        if (!targetLink) {
            const rawUrlMatch = html.match(/https?:\/\/(?:[a-z0-9-]+\.)*(?:voe|dood|stream|ds2play|delivery|myvid|all3do)[^\s'"`>]+/i);
            if (rawUrlMatch) targetLink = rawUrlMatch[0];
        }
        
        if (targetLink) {
            targetLink = targetLink.replace(/&amp;/g, '&').replace(/\\/g, '');
            if (targetLink.startsWith('/')) {
                targetLink = BASE_URL + targetLink;
            }
            console.log(`[S.TO] Successfully verified destination link: ${targetLink}`);
            return targetLink;
        }

        return response.url;
    } catch (e) {
        console.error(`[S.TO] Redirect processing tracking failed: ${e.message}`);
        return url;
    }
}

async function getStreams(tmdbId, type, season, episode) {
    if (type !== 'series' && type !== 'show' && type !== 'tv') {
        console.log(`[S.TO] Skip: Provider does not support type "${type}"`);
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

        // Catch validation session cookies generated by S.to
        var cookieHeader = epRes.headers.get('set-cookie');
        var cookieStr = '';
        if (cookieHeader) {
            cookieStr = cookieHeader.split(',').map(c => c.split(';')[0].trim()).join('; ');
        }

        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        console.log(`[S.TO] Found ${linkBoxes.length} potential German streams.`);
        
        for (var el of linkBoxes) {
            var playPath = $ep(el).attr('data-play-url');
            var hosterName = $ep(el).attr('data-provider-name') || 'Hoster';
            if (!playPath) continue;

            var redirectUrl = BASE_URL + playPath;
            var rawHosterUrl = await getFinalRedirect(redirectUrl, targetUrl, cookieStr);

            if (rawHosterUrl && !rawHosterUrl.includes('s.to/r')) {
                var cleanUrl = normalizeVoeUrl(normalizeDoodUrl(rawHosterUrl));
                var hostDomain = extractDomain(cleanUrl);

                console.log(`[S.TO] Passing true stream URL to Oha: ${cleanUrl}`);
                var resolution = await resolveDirectMediaUrl(cleanUrl, 'de');

                var streamHeaders = {
                    'User-Agent': 'MediaUrl/2',
                    'Referer': 'https://' + hostDomain + '/'
                };
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
