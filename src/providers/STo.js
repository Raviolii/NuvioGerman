var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://s.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
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
        const response = await fetch(url, {
            method: 'GET',
            headers: { ...DEFAULT_HEADERS, 'Referer': referer },
            redirect: 'follow'
        });
        return response.url;
    } catch (e) {
        return url;
    }
}

// ==========================================
// 2. MAIN FUNCTION
// ==========================================
async function getStreams(tmdbId, type, season, episode) {
    // s.to unterstützt nur Serien
    if (type !== 'series') return [];
    
    var results = [];
    console.log("[S.TO] Suche gestartet für TMDB ID:", tmdbId);

    try {
        // Schritt A: IMDB-ID via TMDB API holen
        var tmdbUrl = `${TMDB_BASE_URL}/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
        var idRes = await fetch(tmdbUrl);
        var idData = await idRes.json();
        var imdbId = idData.imdb_id;

        if (!imdbId) {
            console.log("[S.TO] Keine IMDB-ID gefunden.");
            return [];
        }

        // Schritt B: Suche auf s.to mit der IMDB-ID
        var searchUrl = `${BASE_URL}/suche?term=${imdbId}`;
        var searchRes = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
        var searchHtml = await searchRes.text();
        var $search = cheerio.load(searchHtml);

        // Link zur Serie finden
        var relativeSeriesLink = $search('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href');
        if (!relativeSeriesLink) {
            console.log("[S.TO] Serie nicht gefunden.");
            return [];
        }

        // Schritt C: Episoden-Seite aufrufen
        var targetUrl = `${BASE_URL}${relativeSeriesLink}/staffel-${season || 1}/episode-${episode || 1}`;
        var epRes = await fetch(targetUrl, { headers: DEFAULT_HEADERS });
        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        // Schritt D: Deutsche Links extrahieren (data-language-id="1")
        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        
        for (var el of linkBoxes) {
            var playPath = $ep(el).attr('data-play-url');
            var hosterName = $ep(el).attr('data-provider-name') || 'Hoster';

            if (!playPath) continue;

            // Redirect auflösen (von s.to/r/... zum echten Hoster wie voe.sx)
            var redirectUrl = BASE_URL + playPath;
            var rawHosterUrl = await getFinalRedirect(redirectUrl, targetUrl);

            if (rawHosterUrl) {
                results.push({
                    url: rawHosterUrl,
                    meta: {
                        title: `${hosterName} (DE) - S${season}E${episode}`,
                        countryCodes: ['de'],
                        sourceLabel: "S.to"
                    }
                });
            }
        }
    } catch (e) {
        console.log("[S.TO] Fehler:", e.message);
    }

    return results;
}

module.exports = { getStreams };
