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
async function getStreams(tmdbId, type, season, episode) {
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
        
        for (var el of linkBoxes) {
            var playPath = $ep(el).attr('data-play-url');
            var hosterName = $ep(el).attr('data-provider-name') || 'Hoster';

            if (!playPath) continue;

            // Redirect auflösen
            var redirectUrl = BASE_URL + playPath;
            var rawHosterUrl = await getFinalRedirect(redirectUrl, targetUrl);

            // Filter out internal s.to links that didn't resolve to a real hoster
            if (rawHosterUrl && !rawHosterUrl.includes('s.to/r/')) {
                results.push({
                    url: rawHosterUrl,
                    meta: {
                        title: `${hosterName} (DE) - S${season}E${episode}`,
                        countryCodes: ['de'],
                        sourceLabel: "S.to"
                    }
                });
                console.log(`[S.TO] Added: ${hosterName}`);
            }
        }
    } catch (e) {
        console.error("[S.TO] Critical Error during execution:", e.message);
    }

    console.log(`[S.TO] Finished. Total results: ${results.length}\n`);
    return results;
}

module.exports = { getStreams };
