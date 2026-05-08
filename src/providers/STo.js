var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://s.to';
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
        // This follows s.to/r/123 until it reaches voe.sx/e/abc
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

async function getStreams(imdbId, type, season, episode) {
    if (type !== 'series') return [];
    
    var results = [];

    try {
        // 1. Search for series path
        var searchUrl = `${BASE_URL}/suche?term=${imdbId}`;
        var searchRes = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
        var searchHtml = await searchRes.text();
        var $search = cheerio.load(searchHtml);

        var relativeSeriesLink = $search('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href');
        if (!relativeSeriesLink) return [];

        // 2. Go to Episode Page
        var targetUrl = `${BASE_URL}${relativeSeriesLink}/staffel-${season || 1}/episode-${episode || 1}`;
        var epRes = await fetch(targetUrl, { headers: DEFAULT_HEADERS });
        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        // 3. Get German links
        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        
        for (var el of linkBoxes) {
            var playPath = $ep(el).attr('data-play-url');
            var hosterName = $ep(el).attr('data-provider-name') || 'Hoster';

            if (!playPath) continue;

            // 4. Resolve the s.to redirect to get the raw Hoster URL
            var redirectUrl = BASE_URL + playPath;
            var rawHosterUrl = await getFinalRedirect(redirectUrl, targetUrl);

            // 5. Push the raw URL directly to the app
            if (rawHosterUrl) {
                results.push({
                    url: rawHosterUrl, // This will be the https://voe.sx/e/... link
                    meta: {
                        title: `${hosterName} (DE) - S${season}E${episode}`,
                        countryCodes: ['de'],
                        sourceLabel: "S.to"
                    }
                });
            }
        }
    } catch (e) {
        console.log("[S.TO] Error:", e.message);
    }

    return results;
}

module.exports = { getStreams };
