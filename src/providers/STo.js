var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://s.to';
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0'
};

var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractDomain(url) {
    if (!url || typeof url !== 'string') return 'Server';
    var matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    var domain = matches && matches[1];
    if (domain) return domain.replace(/^www\./i, '');
    return 'Server';
}

/**
 * Resolves redirectional links securely by following structural locations
 */
async function resolveGatewayRedirect(playPath, hosterName) {
    if (!playPath) return null;
    var targetUrl = playPath.startsWith('http') ? playPath : BASE_URL + playPath;

    try {
        // Humanized thread pacing interval
        await sleep(600 + Math.random() * 400);

        var firstHop = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                ...DEFAULT_HEADERS,
                'Referer': BASE_URL + '/'
            },
            redirect: 'manual'
        });

        var location = firstHop.headers.get('location');
        
        // Secondary pattern matching fallback for meta refreshes
        if (!location) {
            var html = await firstHop.text();
            var metaMatch = html.match(/meta\s+http-equiv=["']refresh["']\s+content=["']\d+;\s*url=([^"']+)["']/i);
            if (metaMatch && metaMatch[1]) {
                location = metaMatch[1];
            } else {
                var scriptMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
                if (scriptMatch && scriptMatch[1]) location = scriptMatch[1];
            }
        }

        if (location) {
            var finalDestination = location.startsWith('http') ? location : BASE_URL + location;
            finalDestination = finalDestination.replace(/&amp;/g, '&').trim();

            // Intercept downstream tracking buffers
            if (finalDestination.includes('s.to/r?t=') || finalDestination.includes('/r?t=')) {
                await sleep(400);
                var intermediateHop = await fetch(finalDestination, {
                    method: 'GET',
                    headers: { ...DEFAULT_HEADERS, 'Referer': targetUrl },
                    redirect: 'manual'
                });
                var freshLocation = intermediateHop.headers.get('location');
                if (freshLocation) finalDestination = freshLocation;
            }

            return finalDestination;
        }
    } catch (e) {
        // Isolated exception boundary
    }

    // Default static fallback structural handler
    var nameLower = hosterName.toLowerCase();
    if (nameLower.includes('voe')) return 'https://voe.sx';
    if (nameLower.includes('dood')) return 'https://dood.yt';
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

        // Targeted link extraction elements
        var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        console.log(`[S.TO] Found ${linkBoxes.length} potential German streams.`);
        
        for (var el of linkBoxes) {
            var $el = $ep(el);
            var hosterName = $el.attr('data-provider-name') || $el.find('h4').text().trim() || 'Hoster';
            
            // Comprehensive path parsing cascade
            var playPath = $el.attr('data-play-url') || 
                           $el.attr('data-url') || 
                           $el.attr('href') || '';

            // Backup assembly parsing pattern if attributes are missing
            if (!playPath) {
                var linkId = $el.attr('data-link-id') || $el.attr('data-id');
                if (linkId) {
                    playPath = `/redirect/link/${linkId}`;
                }
            }
            
            if (!playPath) continue;

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
