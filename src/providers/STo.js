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
// 1. REDIRECT HELPER (With Debugging)
// ==========================================
async function getFinalRedirect(url, referer) {
    try {
        console.log(`[S.TO] Resolving redirect: ${url}`);
        const response = await fetch(url, {
            method: 'GET',
            headers: { ...DEFAULT_HEADERS, 'Referer': referer },
            redirect: 'follow'
        });
        console.log(`[S.TO] Redirect resolved to: ${response.url}`);
        return response.url;
    } catch (e) {
        console.error(`[S.TO] Redirect Error for ${url}:`, e.message);
        return url;
    }
}

// ==========================================
// 2. MAIN FUNCTION (With Debugging)
// ==========================================
async function getStreams(tmdbId, type, season, episode) {
    if (type !== 'series') {
        console.log("[S.TO] Skip: Type is not 'series'");
        return [];
    }
    
    var results = [];
    console.log(`\n--- [S.TO] Starting Search: ID ${tmdbId} (S${season}E${episode}) ---`);

    try {
        // Schritt A: TMDB API
        var tmdbUrl = `${TMDB_BASE_URL}/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
        console.log(`[S.TO] Fetching IMDB ID from TMDB...`);
        var idRes = await fetch(tmdbUrl);
        
        if (!idRes.ok) throw new Error(`TMDB API returned status ${idRes.status}`);
        
        var idData = await idRes.json();
        var imdbId = idData.imdb_id;

        if (!imdbId) {
            console.warn("[S.TO] Abort: No IMDB-ID found for this TMDB ID.");
            return [];
        }
        console.log(`[S.TO] Found IMDB ID: ${imdbId}`);

        // Schritt B: Suche auf s.to
        var searchUrl = `${BASE_URL}/suche?term=${imdbId}`;
        console.log(`[S.TO] Searching S.TO: ${searchUrl}`);
        var searchRes = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
        var searchHtml = await searchRes.text();
        var $search = cheerio.load(searchHtml);

        var relativeSeriesLink = $search('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href');
        
        if (!relativeSeriesLink) {
            console.warn("[S.TO] Scraping Error: Series link not found in search results. Check if selector changed.");
            // Log a snippet of HTML to see what's actually there
            console.debug("[S.TO] Search HTML Sample:", searchHtml.substring(0, 500));
            return [];
        }
        console.log(`[S.TO] Found series path: ${relativeSeriesLink}`);

        // Schritt C: Episoden-Seite
        var targetUrl = `${BASE_URL}${relativeSeriesLink}/staffel-${season || 1}/episode-${episode || 1}`;
        console.log(`[S.TO] Navigating to Episode: ${targetUrl}`);
        var epRes = await fetch(targetUrl, { headers: DEFAULT_HEADERS });
        
        if (epRes.status === 404) {
            console.error(`[S.TO] 404: Episode or Season not found at ${targetUrl}`);
            return [];
        }

        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        // Schritt D: Links extrahieren
        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        console.log(`[S.TO] Found ${linkBoxes.length} German stream links.`);
        
        for (var el of linkBoxes) {
            var playPath = $ep(el).attr('data-play-url');
            var hosterName = $ep(el).attr('data-provider-name') || 'Hoster';

            if (!playPath) {
                console.warn(`[S.TO] Missing data-play-url for ${hosterName}`);
                continue;
            }

            var redirectUrl = BASE_URL + playPath;
            var rawHosterUrl = await getFinalRedirect(redirectUrl, targetUrl);

            if (rawHosterUrl && rawHosterUrl !== redirectUrl) {
                results.push({
                    url: rawHosterUrl,
                    meta: {
                        title: `${hosterName} (DE) - S${season}E${episode}`,
                        countryCodes: ['de'],
                        sourceLabel: "S.to"
                    }
                });
            } else {
                console.warn(`[S.TO] Failed to resolve a valid external hoster link for ${hosterName}`);
            }
        }
    } catch (e) {
        console.error("[S.TO] Critical Error:", e);
    }

    console.log(`[S.TO] Search finished. Found ${results.length} results.\n`);
    return results;
}

module.exports = { getStreams };
