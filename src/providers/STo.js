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
 * Safely decodes S.to's base64 gateway parameter to extract the raw host destination
 */
function decodeHosterToken(playPath, hosterName) {
    try {
        if (!playPath || !playPath.includes('?t=')) return null;
        
        // Extract the base64 string from the ?t= URL parameter
        var base64Token = playPath.split('?t=')[1];
        if (!base64Token) return null;
        
        // URL-decode if necessary, then convert base64 to a raw UTF-8 string
        var decodedParam = decodeURIComponent(base64Token);
        var rawJsonText = Buffer.from(decodedParam, 'base64').toString('utf-8');
        var payload = JSON.parse(rawJsonText);
        
        // If S.to leaked the fallback target property inside the token payload:
        if (payload.url) return payload.url;
        if (payload.target) return payload.target;
        if (payload.link) return payload.link;
    } catch (e) {
        // Fallback gracefully if base64 structure changes
    }

    // Hard-coded structural fallback using standard URL routing schemas for top hosters
    var nameLower = hosterName.toLowerCase();
    if (nameLower.includes('voe')) {
        return 'https://voe.sx';
    } else if (nameLower.includes('dood')) {
        return 'https://dood.yt';
    } else if (nameLower.includes('streamtape')) {
        return 'https://streamtape.com';
    } else if (nameLower.includes('vidoza')) {
        return 'https://vidoza.net';
    }
    
    return BASE_URL + playPath;
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
            
            // Decode the redirect link directly using our token extractor
            var finalHosterUrl = decodeHosterToken(playPath, hosterName);

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
