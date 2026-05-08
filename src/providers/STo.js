var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://s.to';
var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ==========================================
// 1. HELPER UTILS
// ==========================================

/**
 * S.to specific redirect handler. 
 * It follows the /r/ redirect links to find the actual hoster URL.
 */
async function getFinalUrl(url, referer) {
    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                ...DEFAULT_HEADERS,
                'Referer': referer
            }
        });
        return response.url;
    } catch (e) {
        console.log("[S.TO] Redirect Error:", e.message);
        return url;
    }
}

// ==========================================
// 2. MAIN FUNCTION
// ==========================================

async function getStreams(imdbId, type, season, episode) {
    if (type !== 'series') return [];
    
    var results = [];
    console.log("[S.TO] Searching for Series IMDb:", imdbId);

    try {
        // 1. Search by IMDb ID
        var searchUrl = BASE_URL + '/suche?term=' + imdbId;
        var searchRes = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
        var searchHtml = await searchRes.text();
        var $search = cheerio.load(searchHtml);

        // 2. Get the series relative path
        var relativeSeriesLink = $search('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href');
        if (!relativeSeriesLink) {
            console.log("[S.TO] No series found for ID");
            return [];
        }

        // 3. Build the specific Episode URL
        // Format: https://s.to/serie/stream/[name]/staffel-[x]/episode-[y]
        var targetUrl = BASE_URL + relativeSeriesLink + '/staffel-' + (season || 1) + '/episode-' + (episode || 1);
        console.log("[S.TO] Target URL:", targetUrl);

        var epRes = await fetch(targetUrl, { headers: DEFAULT_HEADERS });
        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        // 4. Target German links (data-language-id="1")
        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        
        for (var el of linkBoxes) {
            var playPath = $ep(el).attr('data-play-url');
            var hosterName = $ep(el).attr('data-provider-name') || 'Unknown';

            if (!playPath) continue;

            // 5. Resolve the redirect
            // S.to links are typically /r/12345 which redirect to Voe, Doodstream, etc.
            var fullRedirectUrl = BASE_URL + playPath;
            var finalStreamUrl = await getFinalUrl(fullRedirectUrl, targetUrl);

            // Filter out internal s.to links that failed to redirect
            if (finalStreamUrl.includes('s.to/r/')) continue;

            results.push({
                url: finalStreamUrl,
                meta: {
                    title: hosterName + " (DE) - S" + season + "E" + episode,
                    countryCodes: ['de'],
                    sourceLabel: "S.to"
                }
            });
        }

    } catch (e) {
        console.log("[S.TO] Global Error:", e.message);
    }

    console.log("[S.TO] Found " + results.length + " German streams.");
    return results;
}

module.exports = { getStreams };
