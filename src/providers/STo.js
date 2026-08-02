var cheerio = require('cheerio-without-node-native');

function extractDomain(url) {
    if (!url || typeof url !== 'string') return 'Server';
    var matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    var domain = matches && matches[1];
    if (domain) return domain.replace(/^www\./i, '');
    return 'Server';
}

// ==========================================
// DOODSTREAM EXTRACTOR LOGIC (Standalone)
// ==========================================
function normalizeDoodUrl(url) {
    if (!url || typeof url !== 'string') return url;
    var isDood = url.match(/dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s|playmogo|playmogo.com/i);
    if (isDood) {
        var playmogoMatch = url.match(/playmogo\.com\/e\/([a-zA-Z0-9]+)/i);
        if (playmogoMatch && playmogoMatch[1]) return 'https://dood.to/e/' + playmogoMatch[1];
        var match = url.match(/\/[dew]\/([a-zA-Z0-9]+)/) || url.match(/\/([a-zA-Z0-9]+)(?:\?|$)/);
        if (match && match[1]) return 'https://dood.to/e/' + match[1];
    }
    return url;
}

async function extractDoodStream(urlStr, headers) {
    try {
        var url = new URL(normalizeDoodUrl(urlStr));
        var res = await fetch(url.href, { headers: headers });
        var html = await res.text();

        if (/Video not found/.test(html)) {
            throw new Error('Video not found');
        }

        var $ = cheerio.load(html);
        var title = $('title').text().trim().replace(/ - DoodStream$/, '').trim();

        var downloadUrl = url.href.replace('/e/', '/d/');
        var downloadRes = await fetch(downloadUrl, { headers: headers });
        var downloadHtml = await downloadRes.text();
        var sizeMatch = downloadHtml.match(/([\d.]+ ?[GM]B)/);

        var passMatch = html.match(/\/pass_md5\/([a-zA-Z0-9\/\-_]+)/);
        if (passMatch) {
            var passUrl = 'https://' + url.hostname + passMatch[0];
            var tokenRes = await fetch(passUrl, { headers: Object.assign({}, headers, { 'Referer': url.href }) });
            var tokenText = await tokenRes.text();
            if (tokenText) {
                var randomToken = '' + Math.random().toString(36).substring(2);
                var directStreamUrl = tokenText + 'zplain?token=' + randomToken + '&expiry=' + Date.now();
                return {
                    url: directStreamUrl,
                    title: title || 'DoodStream',
                    size: sizeMatch ? sizeMatch[1] : 'Server',
                    headers: Object.assign({}, headers, { 'Referer': 'https://' + url.hostname + '/' })
                };
            }
        }

        return {
            url: url.href,
            title: title || 'DoodStream',
            size: sizeMatch ? sizeMatch[1] : 'Server',
            headers: headers
        };
    } catch (e) {
        console.error('[DoodStream] Extraction failed:', e.message);
        return null;
    }
}

// ==========================================
// VOE EXTRACTOR LOGIC (Standalone)
// ==========================================
var VOE_DOMAINS = [
    'voe.sx',
    'jessicachoosemake.com',
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

function isVoeUrl(urlStr) {
    try {
        var parsed = new URL(urlStr);
        return parsed.host.indexOf('voe') !== -1 || VOE_DOMAINS.indexOf(parsed.host) !== -1;
    } catch (e) {
        return /voe/i.test(urlStr);
    }
}

async function extractVoeStream(urlStr, headers) {
    try {
        var urlObj = new URL(urlStr);
        var pathSegments = urlObj.pathname.replace(/\/+$/, '').split('/');
        var fileId = pathSegments[pathSegments.length - 1];
        var targetUrl = new URL('/e/' + fileId, urlObj.origin);

        var res = await fetch(targetUrl.href, { headers: headers });
        var html = await res.text();

        var redirectMatch = html.match(/window\.location\.href\s*=\s*'([^']+)/);
        if (redirectMatch && redirectMatch[1]) {
            return await extractVoeStream(redirectMatch[1], headers);
        }

        if (/An error occurred during encoding|Video not found/.test(html)) {
            throw new Error('VOE Video not found');
        }

        var $ = cheerio.load(html);
        var metaDesc = $('meta[name="description"]').attr('content') || '';
        var title = metaDesc.trim().replace(/^Watch /, '').replace(/ at VOE$/, '').trim() || 'VOE Stream';

        var hlsUrlMatch = html.match(/'hls'\s*:\s*'([^']+)'/) || html.match(/"hls"\s*:\s*"([^"]+)"/) || html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
        var streamUrl = hlsUrlMatch ? (hlsUrlMatch[1] || hlsUrlMatch[0]) : null;

        if (!streamUrl) {
            var scriptMatch = html.match(/sources\s*=\s*({[^}]+})/);
            if (scriptMatch) {
                try {
                    var sources = JSON.parse(scriptMatch[1]);
                    streamUrl = sources.hls || sources.file || sources.src;
                } catch (e) {}
            }
        }

        var sizeMatch = html.matchAll(/[\d.]+ ?[GM]B/g).toArray();
        var sizeStr = sizeMatch.length > 0 ? sizeMatch[sizeMatch.length - 1][0] : 'Server';

        return {
            url: streamUrl || targetUrl.href,
            title: title,
            size: sizeStr,
            headers: headers
        };
    } catch (e) {
        console.error('[VOE] Extraction failed:', e.message);
        return null;
    }
}

var BASE_URL = 'https://serienstream.to';
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

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

async function getStreams(tmdbId, type, season, episode, onResult) {
    if (type !== 'series' && type !== 'show' && type !== 'tv') {
        console.log(`[S.TO] Skip: Provider does not support type "${type}"`);
        return [];
    }

    var results = [];
    console.log(`\n--- [S.TO] Search: TMDB ${tmdbId} | S${season}E${episode} ---`);

    try {
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

        var searchUrl = `${BASE_URL}/suche?term=${imdbId}`;
        console.log(`[S.TO] Searching S.TO: ${searchUrl}`);
        var searchRes = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
        var searchHtml = await searchRes.text();
        var $search = cheerio.load(searchHtml);

        var relativeSeriesLink = $search('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href');
        
        if (!relativeSeriesLink) {
            if (searchHtml.includes('series-title')) {
                console.log("[S.TO] Search redirected directly to series page.");
                relativeSeriesLink = new URL(searchRes.url).pathname;
            } else {
                console.warn("[S.TO] Series link not found in search results.");
                return [];
            }
        }

        var targetUrl = `${BASE_URL}${relativeSeriesLink}/staffel-${season}/episode-${episode}`;
        console.log(`[S.TO] Navigating to: ${targetUrl}`);
        var epRes = await fetch(targetUrl, { headers: DEFAULT_HEADERS });
        
        if (!epRes.ok) {
            console.error(`[S.TO] Episode page returned status ${epRes.status}`);
            return [];
        }

        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        console.log(`[S.TO] Found ${linkBoxes.length} potential German streams.`);
        
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

            var redirectUrl = BASE_URL + playPath;
            var rawHosterUrl = await getFinalRedirect(redirectUrl, targetUrl);

            if (rawHosterUrl && !rawHosterUrl.includes('s.to/r/')) {
                var finalUrl = rawHosterUrl;
                var sizeLabel = 'Server';

                var isDood = /dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s|playmogo|playmogo.com/i.test(rawHosterUrl);
                var isVoe = isVoeUrl(rawHosterUrl);

                if (isDood) {
                    var doodResult = await extractDoodStream(rawHosterUrl, { 'Referer': targetUrl });
                    if (doodResult) {
                        finalUrl = doodResult.url;
                        sizeLabel = doodResult.size;
                    }
                } else if (isVoe) {
                    var voeResult = await extractVoeStream(rawHosterUrl, { 'Referer': targetUrl });
                    if (voeResult) {
                        finalUrl = voeResult.url;
                        sizeLabel = voeResult.size;
                    }
                }

                var hostDomain = sizeLabel;
                try {
                    if (sizeLabel === 'Server' || sizeLabel.indexOf('GB') === -1 && sizeLabel.indexOf('MB') === -1) {
                        hostDomain = (new URL(finalUrl)).hostname.replace(/^www\./i, '');
                    }
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
