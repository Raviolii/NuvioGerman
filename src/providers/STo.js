var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://s.to';
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

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

/**
 * Automatically captures the target destination location header from the gateway wrapper link
 */
async function resolveGatewayRedirect(playPath, hosterName) {
    if (!playPath) return null;
    var targetUrl = playPath.startsWith('http') ? playPath : BASE_URL + playPath;

    try {
        // Intercept the redirect before the browser takes action
        var response = await fetch(targetUrl, {
            method: 'GET',
            headers: DEFAULT_HEADERS,
            redirect: 'manual' 
        });

        // Read the true destination from the HTTP Location header
        var trueDestination = response.headers.get('location');
        if (trueDestination) {
            return trueDestination;
        }
    } catch (e) {
        // Fallback catch-all if connection fails
    }

    // Default structural layout fallback
    var nameLower = hosterName.toLowerCase();
    if (nameLower.includes('voe')) return 'https://voe.sx';
    if (nameLower.includes('dood')) return 'https://dood.yt';
    if (nameLower.includes('streamtape')) return 'https://streamtape.com';
    return targetUrl;
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
            
            // Resolve the gateway parameter to extract the real long URL path
            var finalHosterUrl = await resolveGatewayRedirect(playPath, hosterName);

            if (finalHosterUrl) {
                var hostDomain = extractDomain(finalHosterUrl);
                var streamHeaders = { 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'Referer': BASE_URL + '/' };

                results.push({
                    name: 'DE - ' + hosterName.toUpperCase(),
                    title: 'DE - ' + hosterName.toUpperCase(), 
                    url: finalHosterUrl,
                    quality: 'HD',
                    size: hostDomain,
                    headers: streamHeaders,
                    provider: 's.to'
                });
                console.log(`[S.TO] Added & Parsed: ${hosterName} -> ${finalHosterUrl}`);
            }
        }
    } catch (e) {
        console.error("[S.TO] Critical Error:", e.message);
    }

    console.log(`[S.TO] Finished. Total results: ${results.length}\n`);
    return results;
}

module.exports = { getStreams };
