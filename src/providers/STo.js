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
// VOE EXTRACTOR LOGIC (Kodi ResolveURL Port)
// ==========================================
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

function voeDecode(ct, luts) {
    try {
        var lutMatches = luts.slice(2, -2).split("','");
        var lut = lutMatches.map(function(i) {
            return i.replace(/[\.*+?^${}()|[\]\\]/g, '\\$&');
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

        var decodedB64 = Buffer.from(txt, 'base64').toString('utf8');
        var shifted = '';
        for (var k = 0; k < decodedB64.length; k++) {
            shifted += String.fromCharCode(decodedB64.charCodeAt(k) - 3);
        }

        var reversedB64 = shifted.split('').reverse().join('');
        var finalJsonStr = Buffer.from(reversedB64, 'base64').toString('utf8');
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

        // Check for JSON script token format
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

        // Fallback helper regex parsing for hls streams
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
        const response = await fetch(url, {
            method: 'GET',
            headers: Object.assign({}, DEFAULT_HEADERS, { 'Referer': referer }),
            redirect: 'follow'
        });
        return response.url;
    } catch (e) {
        return url;
    }
}

async function getStreams(tmdbId, type, season, episode, onResult) {
    if (type !== 'series' && type !== 'show' && type !== 'tv') {
        return [];
    }

    var results = [];

    try {
        var tmdbUrl = `${TMDB_BASE_URL}/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
        var idRes = await fetch(tmdbUrl);
        if (idRes.status === 404) return [];

        var idData = await idRes.json();
        var imdbId = idData.imdb_id;
        if (!imdbId) return [];

        var searchUrl = `${BASE_URL}/suche?term=${imdbId}`;
        var searchRes = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
        var searchHtml = await searchRes.text();
        var $search = cheerio.load(searchHtml);

        var relativeSeriesLink = $search('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href');
        if (!relativeSeriesLink) {
            if (searchHtml.includes('series-title')) {
                relativeSeriesLink = new URL(searchRes.url).pathname;
            } else {
                return [];
            }
        }

        var targetUrl = `${BASE_URL}${relativeSeriesLink}/staffel-${season}/episode-${episode}`;
        var epRes = await fetch(targetUrl, { headers: DEFAULT_HEADERS });
        if (!epRes.ok) return [];

        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        
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
                var customHeaders = {
                    'User-Agent': 'MediaUrl/2',
                    'Referer': BASE_URL + '/'
                };

                var isDood = /dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s|playmogo|playmogo.com/i.test(rawHosterUrl);
                var isVoe = isVoeUrl(rawHosterUrl);

                if (isDood) {
                    var doodResult = await extractDoodStream(rawHosterUrl, { 'Referer': targetUrl });
                    if (doodResult) {
                        finalUrl = doodResult.url;
                        sizeLabel = doodResult.size;
                        customHeaders = doodResult.headers;
                    }
                } else if (isVoe) {
                    var voeResult = await extractVoeStream(rawHosterUrl, { 'Referer': targetUrl });
                    if (voeResult) {
                        finalUrl = voeResult.url;
                        sizeLabel = voeResult.size;
                        customHeaders = voeResult.headers;
                    }
                }

                var hostDomain = sizeLabel;
                try {
                    if (sizeLabel === 'Server' || (sizeLabel.indexOf('GB') === -1 && sizeLabel.indexOf('MB') === -1)) {
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
                    headers: customHeaders,
                    provider: 'sto'
                };

                try {
                    if (typeof onResult === 'function') onResult(streamObj);
                } catch (e) {}

                results.push(streamObj);
            }
        }
    } catch (e) {}

    return results;
}

module.exports = { getStreams };
